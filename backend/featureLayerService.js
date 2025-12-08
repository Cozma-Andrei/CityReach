const { initFirebase } = require("./firebase");

const COLLECTION = "geojson";
const CHUNK_SIZE = 900000;

function getDb() {
  const admin = initFirebase();
  return admin.firestore();
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

async function saveGeoJSON(docId, geojson, metadata = {}) {
  if (!docId) throw new Error("Missing docId");
  if (!geojson) throw new Error("Missing geojson");
  
  const db = getDb();
  const clean = serializeGeoJSON(geojson);
  const geojsonString = JSON.stringify(clean);
  
  if (geojsonString.length <= CHUNK_SIZE) {
    const payload = { geojsonString, metadata, updatedAt: new Date(), chunked: false };
    await db.collection(COLLECTION).doc(docId).set(payload, { merge: true });
    return { geojson: clean, metadata, updatedAt: payload.updatedAt };
  }
  
  const chunks = chunkString(geojsonString, CHUNK_SIZE);
  const batch = db.batch();
  
  const mainDocRef = db.collection(COLLECTION).doc(docId);
  batch.set(mainDocRef, {
    metadata,
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

async function readGeoJSON(docId) {
  const db = getDb();
  const snap = await db.collection(COLLECTION).doc(docId).get();
  
  if (!snap.exists) return null;
  
  const data = snap.data();
  
  if (!data.chunked) {
    const parsed = data.geojsonString ? JSON.parse(data.geojsonString) : null;
    return { geojson: parsed, metadata: data.metadata, updatedAt: data.updatedAt };
  }
  
  const chunksSnap = await db.collection(COLLECTION).doc(docId).collection('chunks')
    .orderBy('index')
    .get();
  
  let geojsonString = '';
  chunksSnap.forEach(chunkDoc => {
    geojsonString += chunkDoc.data().data;
  });
  
  const parsed = JSON.parse(geojsonString);
  return { geojson: parsed, metadata: data.metadata, updatedAt: data.updatedAt };
}

module.exports = { saveGeoJSON, readGeoJSON };
