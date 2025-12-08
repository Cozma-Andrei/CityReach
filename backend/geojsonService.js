const { hint } = require("@mapbox/geojsonhint");
const cleanCoords = require("@turf/clean-coords").default;

function validateGeoJSON(geojson) {
  if (!geojson) {
    throw new Error("Missing GeoJSON payload");
  }

  const errors = hint(geojson) || [];
  let cleaned = geojson;

  if (geojson.type === "FeatureCollection" && Array.isArray(geojson.features)) {
    cleaned = {
      ...geojson,
      features: geojson.features
        .map((feature) => ({
          ...feature,
          geometry: feature.geometry ? cleanCoords(feature.geometry) : null,
        }))
        .filter((feature) => feature.geometry),
    };
  } else if (geojson.geometry) {
    cleaned = { ...geojson, geometry: cleanCoords(geojson.geometry) };
  }

  return { errors, cleaned };
}

module.exports = { validateGeoJSON };
