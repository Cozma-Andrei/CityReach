const express = require("express");
const cors = require("cors");
const dotenv = require("dotenv");
const axios = require("axios");
const { importFromOSM, buildStationsQuery, buildNeighborhoodsQuery } = require("./osmService");
const { validateGeoJSON } = require("./geojsonService");
const { 
  saveGeoJSON, 
  readGeoJSON,
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
    const { bbox, type, customQuery } = req.body;
    const validatedBbox = customQuery ? null : normalizeBbox(bbox);
    const overpassQuery =
      customQuery ||
      (type === "stations"
        ? buildStationsQuery(validatedBbox)
        : type === "neighborhoods"
          ? buildNeighborhoodsQuery(validatedBbox)
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

app.get("/api/feature-layers/:type", async (req, res) => {
  try {
    const { type } = req.params;
    const userId = req.user?.uid;
    
    if (!userId) {
      return res.status(401).json({ error: "User not authenticated" });
    }
    
    if (!["stations", "neighborhoods"].includes(type)) {
      return res.status(400).json({ error: "Type must be stations or neighborhoods" });
    }
    
    if (type === "stations") {
      const result = await readStations(userId);
      if (!result.stations || !result.stations.features || result.stations.features.length === 0) {
        return res.status(404).json({ error: "Not found" });
      }
      return res.json({ geojson: result.stations, buffers: result.buffers });
    } else {
      const geojson = await readNeighborhoods(userId);
      if (!geojson || !geojson.features || geojson.features.length === 0) {
        return res.status(404).json({ error: "Not found" });
      }
      return res.json({ geojson });
    }
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.patch("/api/feature-layers/neighborhoods/:neighborhoodId", async (req, res) => {
  try {
    const { neighborhoodId } = req.params;
    const { population } = req.body;
    const userId = req.user?.uid;
    
    if (!userId) {
      return res.status(401).json({ error: "User not authenticated" });
    }
    
    if (population === undefined || population === null) {
      return res.status(400).json({ error: "Missing population" });
    }
    
    const populationNum = Number(population);
    if (isNaN(populationNum) || populationNum < 0) {
      return res.status(400).json({ error: "Population must be a non-negative number" });
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
    await docRef.update({
      population: populationNum,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    });
    
    res.json({ success: true, population: populationNum });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.listen(port, () => {
  console.log(`CityReach backend running on port ${port}`);
});
