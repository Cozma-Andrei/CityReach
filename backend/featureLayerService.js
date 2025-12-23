const { initFirebase } = require("./firebase");
const turfBuffer = require("@turf/buffer").default;

const COLLECTION = "geojson";
const CHUNK_SIZE = 900000;
const DEFAULT_BUFFER_RADIUS = 400;

function getDb() {
  const admin = initFirebase();
  return admin.firestore();
}

function extractName(properties) {
  return properties.name || 
         properties.official_name || 
         properties.loc_name || 
         properties.local_name || 
         properties.alt_name || 
         properties.ref || 
         properties["@id"] || 
         properties.id || 
         "Unnamed";
}

function extractStationType(properties) {
  const publicTransport = properties.public_transport?.toLowerCase();
  const railway = properties.railway?.toLowerCase();
  const highway = properties.highway?.toLowerCase();
  
  if (publicTransport === "platform" || publicTransport === "station") {
    if (railway === "tram_stop" || railway === "tram") return "tram";
    if (railway === "station" || railway === "subway") return "metro";
    return "bus";
  }
  
  if (railway === "tram_stop" || railway === "tram") return "tram";
  if (railway === "station" || railway === "subway") return "metro";
  if (highway === "bus_stop") return "bus";
  
  return "bus";
}

function sanitizeDocumentId(id) {
  if (!id) return null;
  const str = String(id);
  return str.replace(/[\/\s]/g, "_").replace(/[^a-zA-Z0-9_-]/g, "");
}

function getCoordinatesFromGeometry(geometry) {
  if (!geometry || !geometry.coordinates) return null;
  
  if (geometry.type === "Point") {
    return { longitude: geometry.coordinates[0], latitude: geometry.coordinates[1] };
  }
  
  if (geometry.type === "LineString" || geometry.type === "Polygon") {
    const coords = geometry.coordinates[0];
    return { longitude: coords[0], latitude: coords[1] };
  }
  
  return null;
}

function serializeGeoJSON(geojson) {
  const serialized = JSON.stringify(geojson, (_k, v) => {
    if (Number.isNaN(v) || v === Infinity || v === -Infinity || v === undefined) return null;
    return v;
  });
  return JSON.parse(serialized);
}

function chunkString(str, size) {
  const chunks = [];
  for (let i = 0; i < str.length; i += size) {
    chunks.push(str.slice(i, i + size));
  }
  return chunks;
}

async function saveGeoJSON(docId, geojson, metadata = {}, userId) {
  if (!docId) throw new Error("Missing docId");
  if (!geojson) throw new Error("Missing geojson");
  if (!userId) throw new Error("Missing userId");
  
  const db = getDb();
  const clean = serializeGeoJSON(geojson);
  const geojsonString = JSON.stringify(clean);
  const userDocId = `${userId}_${docId}`;
  
  if (geojsonString.length <= CHUNK_SIZE) {
    const payload = { geojsonString, metadata, userId, updatedAt: new Date(), chunked: false };
    await db.collection(COLLECTION).doc(userDocId).set(payload, { merge: true });
    return { geojson: clean, metadata, updatedAt: payload.updatedAt };
  }
  
  const chunks = chunkString(geojsonString, CHUNK_SIZE);
  const batch = db.batch();
  
  const mainDocRef = db.collection(COLLECTION).doc(userDocId);
  batch.set(mainDocRef, {
    metadata,
    userId,
    updatedAt: new Date(),
    chunked: true,
    chunkCount: chunks.length,
    totalSize: geojsonString.length
  }, { merge: true });
  
  chunks.forEach((chunk, index) => {
    const chunkRef = mainDocRef.collection('chunks').doc(`chunk_${index}`);
    batch.set(chunkRef, { data: chunk, index });
  });
  
  await batch.commit();
  return { geojson: clean, metadata, updatedAt: new Date() };
}

async function readGeoJSON(docId, userId) {
  if (!docId) throw new Error("Missing docId");
  if (!userId) throw new Error("Missing userId");
  
  const db = getDb();
  const userDocId = `${userId}_${docId}`;
  const snap = await db.collection(COLLECTION).doc(userDocId).get();
  
  if (!snap.exists) return null;
  
  const data = snap.data();
  
  if (data.userId !== userId) {
    return null;
  }
  
  if (!data.chunked) {
    const parsed = data.geojsonString ? JSON.parse(data.geojsonString) : null;
    return { geojson: parsed, metadata: data.metadata, updatedAt: data.updatedAt };
  }
  
  const chunksSnap = await db.collection(COLLECTION).doc(userDocId).collection('chunks')
    .orderBy('index')
    .get();
  
  let geojsonString = '';
  chunksSnap.forEach(chunkDoc => {
    geojsonString += chunkDoc.data().data;
  });
  
  const parsed = JSON.parse(geojsonString);
  return { geojson: parsed, metadata: data.metadata, updatedAt: data.updatedAt };
}

async function saveStations(geojson, bufferRadius = DEFAULT_BUFFER_RADIUS, userId) {
  if (!geojson || !geojson.features) {
    throw new Error("Invalid GeoJSON: missing features");
  }
  if (!userId) {
    throw new Error("Missing userId");
  }
  
  const db = getDb();
  const admin = initFirebase();
  
  const existingStations = await db.collection("stations").where("userId", "==", userId).get();
  if (!existingStations.empty) {
    let deleteBatch = db.batch();
    let deleteCount = 0;
    for (const doc of existingStations.docs) {
      deleteBatch.delete(doc.ref);
      deleteCount++;
      if (deleteCount % 500 === 0) {
        await deleteBatch.commit();
        deleteBatch = db.batch();
      }
    }
    if (deleteCount % 500 !== 0) {
      await deleteBatch.commit();
    }
  }
  
  let batch = db.batch();
  const stationsRef = db.collection("stations");
  
  let count = 0;
  
  for (const feature of geojson.features) {
    if (!feature.geometry) continue;
    
    const coords = getCoordinatesFromGeometry(feature.geometry);
    if (!coords) continue;
    
    const rawId = feature.id || feature.properties?.id || feature.properties?.["@id"] || `station_${Date.now()}_${count}`;
    const sanitizedId = `${userId}_${sanitizeDocumentId(rawId) || `station_${Date.now()}_${count}`}`;
    const name = extractName(feature.properties || {});
    const type = extractStationType(feature.properties || {});
    
    const props = feature.properties || {};
    const lines = props.route_ref || 
                  props.lines || 
                  props.bus_routes || 
                  props.tram_routes || 
                  props.ref ||
                  props["route_ref"] ||
                  props["lines"] ||
                  props["tram:ref"] ||
                  props["subway:ref"] ||
                  props["metro:ref"] ||
                  props.network ||
                  props.operator ||
                  props["public_transport:version"] ||
                  null;
    
    const location = new admin.firestore.GeoPoint(coords.latitude, coords.longitude);
    
    const stationData = {
      id: rawId,
      name,
      type,
      location,
      bufferRadius: Math.max(300, Math.min(500, bufferRadius)),
      lines: lines ? String(lines) : null,
      userId,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    };
    
    const docRef = stationsRef.doc(sanitizedId);
    batch.set(docRef, stationData, { merge: true });
    count++;
    
    if (count % 500 === 0) {
      await batch.commit();
      batch = db.batch();
    }
  }
  
  if (count % 500 !== 0) {
    await batch.commit();
  }
  
  return { saved: count };
}

async function saveNeighborhoods(geojson, userId) {
  if (!geojson || !geojson.features) {
    throw new Error("Invalid GeoJSON: missing features");
  }
  if (!userId) {
    throw new Error("Missing userId");
  }
  
  const db = getDb();
  const admin = initFirebase();
  
  const existingNeighborhoods = await db.collection("neighborhoods").where("userId", "==", userId).get();
  if (!existingNeighborhoods.empty) {
    let deleteBatch = db.batch();
    let deleteCount = 0;
    for (const doc of existingNeighborhoods.docs) {
      deleteBatch.delete(doc.ref);
      deleteCount++;
      if (deleteCount % 500 === 0) {
        await deleteBatch.commit();
        deleteBatch = db.batch();
      }
    }
    if (deleteCount % 500 !== 0) {
      await deleteBatch.commit();
    }
  }
  
  let batch = db.batch();
  const neighborhoodsRef = db.collection("neighborhoods");
  
  let count = 0;
  
  for (const feature of geojson.features) {
    if (!feature.geometry || feature.geometry.type !== "Polygon" && feature.geometry.type !== "MultiPolygon") {
      continue;
    }
    
    const rawId = feature.id || feature.properties?.id || feature.properties?.["@id"] || `neighborhood_${Date.now()}_${count}`;
    const sanitizedId = `${userId}_${sanitizeDocumentId(rawId) || `neighborhood_${Date.now()}_${count}`}`;
    const name = extractName(feature.properties || {});
    
    const props = feature.properties || {};
    const population = props.population || 
                      props["population:total"] || 
                      props["population:year"] ||
                      props["population:date"] ||
                      props["census:population"] ||
                      props.pop || 
                      props.Population ||
                      props.POPULATION ||
                      0;
    
    let adminLevel = props.admin_level || props["admin_level"] || null;
    
    if (!adminLevel && props.tags) {
      const tags = typeof props.tags === "string" ? JSON.parse(props.tags) : props.tags;
      adminLevel = tags?.admin_level || tags?.["admin_level"] || null;
    }
    
    if (!adminLevel) {
      const placeType = props.place || props["place"];
      if (placeType === "neighbourhood" || placeType === "suburb" || placeType === "quarter") {
        adminLevel = "10";
      }
    }
    
    const neighborhoodData = {
      id: rawId,
      name,
      population: Number(population) || 0,
      geometry: JSON.stringify(feature.geometry),
      admin_level: adminLevel,
      userId,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    };
    
    const docRef = neighborhoodsRef.doc(sanitizedId);
    batch.set(docRef, neighborhoodData, { merge: true });
    count++;
    
    if (count % 500 === 0) {
      await batch.commit();
      batch = db.batch();
    }
  }
  
  if (count % 500 !== 0) {
    await batch.commit();
  }
  
  return { saved: count };
}

async function readStations(userId) {
  if (!userId) {
    throw new Error("Missing userId");
  }
  
  const db = getDb();
  const snapshot = await db.collection("stations").where("userId", "==", userId).get();
  
  const stationFeatures = [];
  const bufferFeatures = [];
  
  if (snapshot.empty) {
    return {
      stations: { type: "FeatureCollection", features: [] },
      buffers: { type: "FeatureCollection", features: [] }
    };
  }
  
  snapshot.forEach(doc => {
    const data = doc.data();
    const location = data.location;
    
    if (location && location.latitude && location.longitude) {
      const stationFeature = {
        type: "Feature",
        id: data.id || doc.id,
        properties: {
          id: data.id || doc.id,
          name: data.name,
          type: data.type,
          bufferRadius: data.bufferRadius,
          lines: data.lines || null,
        },
        geometry: {
          type: "Point",
          coordinates: [location.longitude, location.latitude],
        },
      };
      
      stationFeatures.push(stationFeature);
      
      const bufferRadius = data.bufferRadius || DEFAULT_BUFFER_RADIUS;
      try {
        const buffer = turfBuffer(stationFeature, bufferRadius / 1000, { units: "kilometers" });
        if (buffer && buffer.geometry) {
          bufferFeatures.push({
            type: "Feature",
            id: `buffer_${data.id || doc.id}`,
            properties: {
              stationId: data.id || doc.id,
              stationName: data.name,
              bufferRadius: bufferRadius,
            },
            geometry: buffer.geometry,
          });
        }
      } catch (err) {
        console.error("Error creating buffer for station:", data.id || doc.id, err);
      }
    }
  });
  
  return {
    stations: {
      type: "FeatureCollection",
      features: stationFeatures,
    },
    buffers: {
      type: "FeatureCollection",
      features: bufferFeatures,
    },
  };
}

async function readNeighborhoods(userId) {
  if (!userId) {
    throw new Error("Missing userId");
  }
  
  const db = getDb();
  const snapshot = await db.collection("neighborhoods").where("userId", "==", userId).get();
  
  const features = [];
  
  if (snapshot.empty) {
    return {
      type: "FeatureCollection",
      features: []
    };
  }
  snapshot.forEach(doc => {
    const data = doc.data();
    
    if (data.geometry) {
      let geometry = data.geometry;
      if (typeof geometry === "string") {
        try {
          geometry = JSON.parse(geometry);
        } catch (e) {
          console.error("Error parsing geometry for neighborhood:", doc.id, e);
          return;
        }
      }
      
      const featureId = data.id || doc.id;
      const adminLevel = data.admin_level || null;
      
      features.push({
        type: "Feature",
        id: featureId,
        properties: {
          id: featureId,
          name: data.name,
          population: data.population,
          admin_level: adminLevel ? String(adminLevel) : null,
        },
        geometry: geometry,
      });
    }
  });
  
  return {
    type: "FeatureCollection",
    features,
  };
}

module.exports = { 
  saveGeoJSON, 
  readGeoJSON,
  saveStations,
  saveNeighborhoods,
  readStations,
  readNeighborhoods,
};
