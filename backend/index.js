const express = require("express");
const cors = require("cors");
const dotenv = require("dotenv");
const { importFromOSM, buildStationsQuery, buildNeighborhoodsQuery } = require("./osmService");
const { validateGeoJSON } = require("./geojsonService");
const { saveGeoJSON, readGeoJSON } = require("./featureLayerService");
const { verifyToken } = require("./authMiddleware");

dotenv.config();

const app = express();
const port = process.env.PORT || 5000;

app.use(cors());
app.use(express.json({ limit: "10mb" }));

app.get("/health", (_req, res) => res.json({ status: "ok" }));

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
    const { geojson, metadata } = req.body;
    if (!["stations", "neighborhoods"].includes(type)) {
      return res.status(400).json({ error: "Type must be stations or neighborhoods" });
    }
    const saved = await saveGeoJSON(type, geojson, metadata);
    res.json(saved);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get("/api/feature-layers/:type", async (req, res) => {
  try {
    const { type } = req.params;
    if (!["stations", "neighborhoods"].includes(type)) {
      return res.status(400).json({ error: "Type must be stations or neighborhoods" });
    }
    const data = await readGeoJSON(type);
    if (!data) return res.status(404).json({ error: "Not found" });
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.listen(port, () => {
  console.log(`CityReach backend running on port ${port}`);
});
