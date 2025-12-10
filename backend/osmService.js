const axios = require("axios");
const osmtogeojson = require("osmtogeojson");

const OVERPASS_ENDPOINT = "https://overpass-api.de/api/interpreter";

/**
 * Fetch OSM data via Overpass and convert to GeoJSON
 * @param {string} overpassQuery full Overpass QL body (without [out:json])
 * @returns {Promise<object>} GeoJSON FeatureCollection
 */
async function importFromOSM(overpassQuery) {
  if (!overpassQuery) {
    throw new Error("Missing Overpass query");
  }

  const wrappedQuery = `
    [out:json][timeout:25];
    ${overpassQuery}
    out body;
    >;
    out skel qt;
  `;

  const response = await axios.post(
    OVERPASS_ENDPOINT,
    wrappedQuery,
    { headers: { "Content-Type": "text/plain" } }
  );

  if (!response?.data) {
    throw new Error("No data returned from Overpass");
  }

  const geojson = osmtogeojson(response.data, { polygonFeatures: { "building": true, "landuse": true, "leisure": true, "boundary": true } });
  return geojson;
}

function buildStationsQuery(bbox) {
  const bboxStr = bbox?.length === 4 ? bbox.join(",") : "";
  return `
    (
      node["public_transport"="platform"](${bboxStr});
      node["highway"="bus_stop"](${bboxStr});
      node["railway"="tram_stop"](${bboxStr});
      node["railway"="station"](${bboxStr});
      node["railway"="subway_entrance"](${bboxStr});
    );
  `;
}

function buildNeighborhoodsQuery(bbox) {
  const bboxStr = bbox?.length === 4 ? bbox.join(",") : "";
  return `
    (
      relation["boundary"="administrative"]["admin_level"~"^(8|9|10)$"](${bboxStr});
      way["place"="neighbourhood"](${bboxStr});
    );
  `;
}

module.exports = {
  importFromOSM,
  buildStationsQuery,
  buildNeighborhoodsQuery,
};

