const express = require("express");
const cors = require("cors");
const dotenv = require("dotenv");
const axios = require("axios");
const { importFromOSM, buildStationsQuery, buildNeighborhoodsQuery } = require("./osmService");
const { validateGeoJSON } = require("./geojsonService");
const { 
  saveGeoJSON, 
  saveStations,
  saveNeighborhoods,
  readStations,
  readNeighborhoods,
} = require("./featureLayerService");
const { verifyToken } = require("./authMiddleware");
const { initFirebase } = require("./firebase");

dotenv.config();

const app = express();
const port = process.env.PORT || 5000;

app.use(cors());
app.use(express.json({ limit: "10mb" }));

app.get("/health", (_req, res) => res.json({ status: "ok" }));

app.post("/api/geocode", async (req, res) => {
  try {
    const { query } = req.body;
    if (!query) {
      return res.status(400).json({ error: "Missing query parameter" });
    }
    
    const response = await axios.get("https://nominatim.openstreetmap.org/search", {
      params: {
        q: query,
        format: "json",
        limit: 1,
        addressdetails: 1,
        extratags: 1,
      },
      headers: {
        "User-Agent": "CityReach/1.0"
      }
    });
    
    if (!response.data || response.data.length === 0) {
      return res.status(404).json({ error: "Location not found" });
    }
    
    const result = response.data[0];
    const bbox = result.boundingbox;
    
    if (!bbox || bbox.length !== 4) {
      return res.status(404).json({ error: "Bounding box not available for this location" });
    }
    
    res.json({
      bbox: [parseFloat(bbox[0]), parseFloat(bbox[2]), parseFloat(bbox[1]), parseFloat(bbox[3])],
      name: result.display_name,
      lat: parseFloat(result.lat),
      lon: parseFloat(result.lon),
    });
  } catch (err) {
    console.error("Geocoding error:", err);
    res.status(500).json({ error: err.message || "Geocoding failed" });
  }
});

app.use("/api", verifyToken);

function normalizeBbox(bbox) {
  if (!bbox) throw new Error("Missing bbox");
  const parts = Array.isArray(bbox) ? bbox : String(bbox).split(",");
  if (parts.length !== 4) throw new Error("BBox must have four numbers: south,west,north,east");
  const nums = parts.map((v) => Number(String(v).trim()));
  if (nums.some((n) => Number.isNaN(n) || !Number.isFinite(n))) {
    throw new Error("BBox must contain only numbers");
  }
  const [south, west, north, east] = nums;
  if (Math.abs(south) > 90 || Math.abs(north) > 90) throw new Error("Latitude must be between -90 and 90");
  if (Math.abs(west) > 180 || Math.abs(east) > 180) throw new Error("Longitude must be between -180 and 180");
  if (south >= north) throw new Error("south must be less than north");
  if (west >= east) throw new Error("west must be less than east");
  return [south, west, north, east];
}

app.post("/api/import/osm", async (req, res) => {
  try {
    const { bbox, type, customQuery, adminLevel } = req.body;
    const validatedBbox = customQuery ? null : normalizeBbox(bbox);
    const overpassQuery =
      customQuery ||
      (type === "stations"
        ? buildStationsQuery(validatedBbox)
        : type === "neighborhoods"
          ? buildNeighborhoodsQuery(validatedBbox, adminLevel)
          : null);

    const geojson = await importFromOSM(overpassQuery);
    res.json({ geojson });
  } catch (err) {
    console.error(err);
    const status = err.message?.toLowerCase().includes("bbox") ? 400 : 500;
    res.status(status).json({ error: err.message });
  }
});

app.post("/api/geojson/validate", (req, res) => {
  try {
    const { geojson } = req.body;
    const { errors, cleaned } = validateGeoJSON(geojson);
    res.json({ errors, cleaned });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.post("/api/feature-layers/:type", async (req, res) => {
  try {
    const { type } = req.params;
    const { geojson, bufferRadius } = req.body;
    const userId = req.user?.uid;
    
    if (!userId) {
      return res.status(401).json({ error: "User not authenticated" });
    }
    
    if (!["stations", "neighborhoods"].includes(type)) {
      return res.status(400).json({ error: "Type must be stations or neighborhoods" });
    }
    
    const [saved, geojsonSaved] = await Promise.all([
      type === "stations" 
        ? saveStations(geojson, bufferRadius, userId)
        : saveNeighborhoods(geojson, userId),
      saveGeoJSON(type, geojson, { source: "osm", updatedAt: new Date().toISOString() }, userId)
    ]);
    
    res.json({ ...saved, geojsonSaved: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get("/api/users", async (req, res) => {
  try {
    const userId = req.user?.uid;
    
    if (!userId) {
      console.error("Users endpoint: User not authenticated");
      return res.status(401).json({ error: "User not authenticated" });
    }
    
    console.log("Users endpoint: Checking user", userId);
    const admin = initFirebase();
    const db = admin.firestore();
    
    const userDoc = await db.collection("users").doc(userId).get();
    if (!userDoc.exists) {
      console.error("Users endpoint: User document not found", userId);
      return res.status(403).json({ error: "User not found" });
    }
    
    const userData = userDoc.data();
    console.log("Users endpoint: User role", userData.role);
    if (userData.role !== "admin") {
      console.error("Users endpoint: Admin access required", userData.role);
      return res.status(403).json({ error: "Admin access required" });
    }
    
    console.log("Users endpoint: Fetching all users");
    const usersSnapshot = await db.collection("users").get();
    const users = [];
    usersSnapshot.forEach(doc => {
      const docData = doc.data();
      users.push({
        id: doc.id,
        email: docData.email || "Unknown",
        role: docData.role || "user",
      });
    });
    
    console.log("Users endpoint: Found", users.length, "users");
    res.json({ users });
  } catch (err) {
    console.error("Users endpoint error:", err);
    res.status(500).json({ error: err.message });
  }
});

app.get("/api/feature-layers/:type", async (req, res) => {
  try {
    const { type } = req.params;
    const { userId: targetUserId } = req.query;
    const userId = req.user?.uid;
    
    if (!userId) {
      return res.status(401).json({ error: "User not authenticated" });
    }
    
    const admin = initFirebase();
    const db = admin.firestore();
    
    let finalUserId = userId;
    
    if (targetUserId) {
      const userDoc = await db.collection("users").doc(userId).get();
      if (!userDoc.exists) {
        return res.status(403).json({ error: "User not found" });
      }
      
      const userData = userDoc.data();
      if (userData.role !== "admin") {
        return res.status(403).json({ error: "Admin access required to view other users' data" });
      }
      
      finalUserId = targetUserId;
    }
    
    if (!["stations", "neighborhoods"].includes(type)) {
      return res.status(400).json({ error: "Type must be stations or neighborhoods" });
    }
    
    if (type === "stations") {
      const result = await readStations(finalUserId);
      const stationsGeoJSON = result.stations || { type: "FeatureCollection", features: [] };
      const buffers = result.buffers || { type: "FeatureCollection", features: [] };
      return res.json({ geojson: stationsGeoJSON, buffers });
    } else {
      const geojson = await readNeighborhoods(finalUserId);
      const neighborhoodsGeoJSON = geojson || { type: "FeatureCollection", features: [] };
      return res.json({ geojson: neighborhoodsGeoJSON });
    }
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.patch("/api/feature-layers/neighborhoods/:neighborhoodId", async (req, res) => {
  try {
    const { neighborhoodId } = req.params;
    const { population, name, admin_level } = req.body;
    const userId = req.user?.uid;
    
    if (!userId) {
      return res.status(401).json({ error: "User not authenticated" });
    }
    
    const admin = initFirebase();
    const db = admin.firestore();
    
    const neighborhoodsSnapshot = await db.collection("neighborhoods")
      .where("userId", "==", userId)
      .where("id", "==", neighborhoodId)
      .limit(1)
      .get();
    
    if (neighborhoodsSnapshot.empty) {
      return res.status(404).json({ error: "Neighborhood not found" });
    }
    
    const docRef = neighborhoodsSnapshot.docs[0].ref;
    const updateData = {
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    };
    
    if (population !== undefined && population !== null) {
      const populationNum = Number(population);
      if (isNaN(populationNum) || populationNum < 0) {
        return res.status(400).json({ error: "Population must be a non-negative number" });
      }
      updateData.population = populationNum;
    }
    
    if (name !== undefined && name !== null) {
      updateData.name = String(name);
    }
    
    if (admin_level !== undefined && admin_level !== null) {
      updateData.admin_level = String(admin_level);
    }
    
    await docRef.update(updateData);
    
    res.json({ success: true, ...updateData });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete("/api/feature-layers/neighborhoods/:neighborhoodId", async (req, res) => {
  try {
    const { neighborhoodId } = req.params;
    const userId = req.user?.uid;
    
    if (!userId) {
      return res.status(401).json({ error: "User not authenticated" });
    }
    
    const admin = initFirebase();
    const db = admin.firestore();
    
    const neighborhoodsSnapshot = await db.collection("neighborhoods")
      .where("userId", "==", userId)
      .where("id", "==", neighborhoodId)
      .limit(1)
      .get();
    
    if (neighborhoodsSnapshot.empty) {
      return res.status(404).json({ error: "Neighborhood not found" });
    }
    
    await neighborhoodsSnapshot.docs[0].ref.delete();
    
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.patch("/api/feature-layers/stations/:stationId", async (req, res) => {
  try {
    const { stationId } = req.params;
    const { name, type, bufferRadius, lines } = req.body;
    const userId = req.user?.uid;
    
    if (!userId) {
      return res.status(401).json({ error: "User not authenticated" });
    }
    
    const admin = initFirebase();
    const db = admin.firestore();
    
    const stationsSnapshot = await db.collection("stations")
      .where("userId", "==", userId)
      .where("id", "==", stationId)
      .limit(1)
      .get();
    
    if (stationsSnapshot.empty) {
      return res.status(404).json({ error: "Station not found" });
    }
    
    const docRef = stationsSnapshot.docs[0].ref;
    const updateData = {
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    };
    
    if (name !== undefined && name !== null) {
      updateData.name = String(name);
    }
    
    if (type !== undefined && type !== null) {
      const validTypes = ["bus", "tram", "metro"];
      if (!validTypes.includes(type)) {
        return res.status(400).json({ error: "Type must be one of: bus, tram, metro" });
      }
      updateData.type = type;
    }
    
    if (bufferRadius !== undefined && bufferRadius !== null) {
      const radiusNum = Number(bufferRadius);
      if (isNaN(radiusNum) || radiusNum < 300 || radiusNum > 500) {
        return res.status(400).json({ error: "Buffer radius must be between 300 and 500 meters" });
      }
      updateData.bufferRadius = radiusNum;
    }
    
    if (lines !== undefined && lines !== null) {
      updateData.lines = String(lines);
    }
    
    await docRef.update(updateData);
    
    res.json({ success: true, ...updateData });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete("/api/feature-layers/stations/:stationId", async (req, res) => {
  try {
    const { stationId } = req.params;
    const userId = req.user?.uid;
    
    if (!userId) {
      return res.status(401).json({ error: "User not authenticated" });
    }
    
    const admin = initFirebase();
    const db = admin.firestore();
    
    const stationsSnapshot = await db.collection("stations")
      .where("userId", "==", userId)
      .where("id", "==", stationId)
      .limit(1)
      .get();
    
    if (stationsSnapshot.empty) {
      return res.status(404).json({ error: "Station not found" });
    }
    
    await stationsSnapshot.docs[0].ref.delete();
    
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post("/api/feature-layers/stations/new", async (req, res) => {
  try {
    const { name, type, bufferRadius, lines, latitude, longitude, userId: targetUserId } = req.body;
    const userId = req.user?.uid;
    
    if (!userId) {
      return res.status(401).json({ error: "User not authenticated" });
    }
    
    if (!name || !type || latitude === undefined || longitude === undefined) {
      return res.status(400).json({ error: "Missing required fields: name, type, latitude, longitude" });
    }
    
    if (!["bus", "tram", "metro"].includes(type)) {
      return res.status(400).json({ error: "Type must be bus, tram, or metro" });
    }
    
    const lat = Number(latitude);
    const lon = Number(longitude);
    if (isNaN(lat) || isNaN(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) {
      return res.status(400).json({ error: "Invalid latitude or longitude" });
    }
    
    const radius = bufferRadius ? Number(bufferRadius) : 400;
    if (isNaN(radius) || radius < 300 || radius > 500) {
      return res.status(400).json({ error: "Buffer radius must be between 300 and 500 meters" });
    }
    
    let finalUserId = targetUserId || userId;
    
    if (targetUserId && targetUserId !== userId) {
      const admin = initFirebase();
      const db = admin.firestore();
      const userDoc = await db.collection("users").doc(userId).get();
      if (!userDoc.exists || userDoc.data().role !== "admin") {
        return res.status(403).json({ error: "Admin access required to create stations for other users" });
      }
      finalUserId = targetUserId;
    }
    
    const admin = initFirebase();
    const db = admin.firestore();
    
    const stationId = `admin_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    const sanitizedId = stationId.replace(/[\/\s]/g, "_").replace(/[^a-zA-Z0-9_-]/g, "");
    
    const stationData = {
      id: sanitizedId,
      userId: finalUserId,
      name: String(name),
      type: String(type),
      bufferRadius: radius,
      location: new admin.firestore.GeoPoint(lat, lon),
      lines: lines ? String(lines) : "",
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    };
    
    await db.collection("stations").doc(sanitizedId).set(stationData);
    
    res.json({ success: true, station: stationData });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post("/api/feature-layers/neighborhoods/new", async (req, res) => {
  try {
    const { name, population, admin_level, geometry, userId: targetUserId } = req.body;
    const userId = req.user?.uid;
    
    if (!userId) {
      return res.status(401).json({ error: "User not authenticated" });
    }
    
    if (!name || !geometry) {
      return res.status(400).json({ error: "Missing required fields: name, geometry" });
    }
    
    if (geometry.type !== "Polygon" && geometry.type !== "MultiPolygon") {
      return res.status(400).json({ error: "Geometry must be a Polygon or MultiPolygon" });
    }
    
    const popNum = population !== undefined ? Number(population) : 0;
    if (isNaN(popNum) || popNum < 0) {
      return res.status(400).json({ error: "Population must be a non-negative number" });
    }
    
    const adminLevel = admin_level ? String(admin_level) : "8";
    if (!["8", "9", "10"].includes(adminLevel)) {
      return res.status(400).json({ error: "Admin level must be 8, 9, or 10" });
    }
    
    let finalUserId = targetUserId || userId;
    
    if (targetUserId && targetUserId !== userId) {
      const admin = initFirebase();
      const db = admin.firestore();
      const userDoc = await db.collection("users").doc(userId).get();
      if (!userDoc.exists || userDoc.data().role !== "admin") {
        return res.status(403).json({ error: "Admin access required to create neighborhoods for other users" });
      }
      finalUserId = targetUserId;
    }
    
    const admin = initFirebase();
    const db = admin.firestore();
    
    const neighborhoodId = `admin_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    const sanitizedId = neighborhoodId.replace(/[\/\s]/g, "_").replace(/[^a-zA-Z0-9_-]/g, "");
    
    const geometryString = JSON.stringify(geometry);
    
    const neighborhoodData = {
      id: sanitizedId,
      userId: finalUserId,
      name: String(name),
      population: popNum,
      admin_level: adminLevel,
      geometry: geometryString,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    };
    
    await db.collection("neighborhoods").doc(sanitizedId).set(neighborhoodData);
    
    const responseData = {
      ...neighborhoodData,
      geometry: geometry,
    };
    
    res.json({ success: true, neighborhood: responseData });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post("/api/analysis-results", async (req, res) => {
  try {
    const { analysisType, results, metadata } = req.body;
    const userId = req.user?.uid;
    
    if (!userId) {
      return res.status(401).json({ error: "User not authenticated" });
    }
    
    if (!analysisType || !results) {
      return res.status(400).json({ error: "Missing analysisType or results" });
    }
    
    const admin = initFirebase();
    const db = admin.firestore();
    
    const analysisData = {
      userId,
      analysisType,
      results,
      metadata: metadata || {},
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    };
    
    const docRef = await db.collection("analysisResults").add(analysisData);
    
    res.json({ success: true, id: docRef.id });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post("/api/coverage-analysis", async (req, res) => {
  try {
    const { coverageResults, statistics, userId: targetUserId } = req.body;
    const userId = req.user?.uid;
    
    if (!userId) {
      return res.status(401).json({ error: "User not authenticated" });
    }
    
    if (!coverageResults || !Array.isArray(coverageResults)) {
      return res.status(400).json({ error: "Missing or invalid coverageResults array" });
    }
    
    let finalUserId = targetUserId || userId;
    
    if (targetUserId && targetUserId !== userId) {
      const admin = initFirebase();
      const db = admin.firestore();
      const userDoc = await db.collection("users").doc(userId).get();
      if (!userDoc.exists || userDoc.data().role !== "admin") {
        return res.status(403).json({ error: "Admin access required" });
      }
      finalUserId = targetUserId;
    }
    
    const admin = initFirebase();
    const db = admin.firestore();
    
    const analysisData = {
      userId: finalUserId,
      analysisType: "neighborhood_coverage",
      results: coverageResults,
      statistics: statistics || {},
      metadata: {
        calculatedAt: new Date().toISOString(),
        neighborhoodCount: coverageResults.length,
      },
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    };
    
    const existingAnalysis = await db.collection("analysisResults")
      .where("userId", "==", finalUserId)
      .where("analysisType", "==", "neighborhood_coverage")
      .get();
    
    if (!existingAnalysis.empty) {
      let latestDoc = existingAnalysis.docs[0];
      let latestTimestamp = latestDoc.data().createdAt?.toMillis() || 0;
      
      existingAnalysis.docs.forEach(doc => {
        const data = doc.data();
        const timestamp = data.createdAt?.toMillis() || 0;
        if (timestamp > latestTimestamp) {
          latestTimestamp = timestamp;
          latestDoc = doc;
        }
      });
      
      await latestDoc.ref.update({
        results: coverageResults,
        statistics: statistics || {},
        metadata: analysisData.metadata,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      });
      res.json({ success: true, id: latestDoc.id, updated: true });
    } else {
      const docRef = await db.collection("analysisResults").add(analysisData);
      res.json({ success: true, id: docRef.id, updated: false });
    }
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get("/api/coverage-analysis", async (req, res) => {
  try {
    const userId = req.user?.uid;
    const { userId: targetUserId } = req.query;
    
    if (!userId) {
      return res.status(401).json({ error: "User not authenticated" });
    }
    
    let finalUserId = targetUserId || userId;
    
    if (targetUserId && targetUserId !== userId) {
      const admin = initFirebase();
      const db = admin.firestore();
      const userDoc = await db.collection("users").doc(userId).get();
      if (!userDoc.exists || userDoc.data().role !== "admin") {
        return res.status(403).json({ error: "Admin access required" });
      }
      finalUserId = targetUserId;
    }
    
    const admin = initFirebase();
    const db = admin.firestore();
    
    const analysisSnapshot = await db.collection("analysisResults")
      .where("userId", "==", finalUserId)
      .where("analysisType", "==", "neighborhood_coverage")
      .get();
    
    if (analysisSnapshot.empty) {
      return res.json({ success: true, results: null });
    }
    
    let latestDoc = analysisSnapshot.docs[0];
    let latestTimestamp = latestDoc.data().createdAt?.toMillis() || 0;
    
    analysisSnapshot.docs.forEach(doc => {
      const data = doc.data();
      const timestamp = data.createdAt?.toMillis() || 0;
      if (timestamp > latestTimestamp) {
        latestTimestamp = timestamp;
        latestDoc = doc;
      }
    });
    
    const analysisData = latestDoc.data();
    res.json({ 
      success: true, 
      results: analysisData.results || [], 
      statistics: analysisData.statistics || {},
      metadata: analysisData.metadata || {} 
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.listen(port, () => {
  console.log(`CityReach backend running on port ${port}`);
});
