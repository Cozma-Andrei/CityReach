import { useCallback, useState, useEffect } from "react";
import "@arcgis/core/assets/esri/themes/light/main.css";
import "./App.css";
import { useGeoMap } from "./hooks/useGeoMap";
import { useAuth } from "./contexts/AuthContext";
import { Login } from "./components/Login";
import { Register } from "./components/Register";
import { Landing } from "./components/Landing";
import apiClient from "./utils/axiosConfig";
const DEFAULT_BBOX = "44.37,26.00,44.50,26.20";

window.updatePopulation = async function(neighborhoodId, population) {
  try {
    const popNum = Number(population);
    if (isNaN(popNum) || popNum < 0) {
      alert("Population must be a non-negative number");
      return false;
    }
    
    await apiClient.patch(`/api/feature-layers/neighborhoods/${encodeURIComponent(neighborhoodId)}`, { population: popNum });
    
    return true;
  } catch (err) {
    console.error("Error updating population:", err);
    alert(err.response?.data?.error || err.message || "Failed to update population");
    return false;
  }
};

function App() {
  const { currentUser, logout } = useAuth();
  const [showLanding, setShowLanding] = useState(true);
  const [authMode, setAuthMode] = useState("login");
  const [bbox, setBbox] = useState(DEFAULT_BBOX);
  const [locationQuery, setLocationQuery] = useState("");
  const [osmType, setOsmType] = useState("stations");
  const [geojson, setGeojson] = useState(null);
  const [cleanedGeojson, setCleanedGeojson] = useState(null);
  const [errors, setErrors] = useState([]);
  const [status, setStatus] = useState("");
  const [transportFilters, setTransportFilters] = useState({
    bus: true,
    tram: true,
    metro: true,
  });
  const [adminLevelFilters, setAdminLevelFilters] = useState({
    level8: true,
    level9: true,
    level10: true,
  });

  function parseBboxInput(value) {
    const parts = value.split(",").map((v) => Number(v.trim()));
    if (parts.length !== 4 || parts.some((n) => Number.isNaN(n))) return null;
    const [south, west, north, east] = parts;
    if (Math.abs(south) > 90 || Math.abs(north) > 90) return null;
    if (Math.abs(west) > 180 || Math.abs(east) > 180) return null;
    if (south >= north || west >= east) return null;
    return [south, west, north, east];
  }

  const { mapRef, addGeoJsonLayer, goToBbox, updateTransportFilters, updateAdminLevelFilters, setupNeighborhoodClickFilter, showAccessibilityHeatmap } = useGeoMap({
    onBboxChange: setBbox,
    initialBboxParts: parseBboxInput(DEFAULT_BBOX),
    setStatus,
    transportFilters,
    adminLevelFilters,
  });

  async function handleImport() {
    try {
      setStatus("Importing from OSM…");
      const bboxArr = parseBboxInput(bbox);
      if (!bboxArr) {
        setStatus("Import error: invalid BBOX (use south,west,north,east)");
        return;
      }
      const { data } = await apiClient.post("/api/import/osm", {
        bbox: bboxArr,
        type: osmType,
      });
      setGeojson(data.geojson);
      setCleanedGeojson(null);
      setErrors([]);
      setStatus("Imported. Validate next.");
      await addGeoJsonLayer(data.geojson, `${osmType} (raw)`);
    } catch (err) {
      const backendMsg =
        err.response?.data?.error ||
        (typeof err.response?.data === "string" ? err.response.data : undefined);
      const statusCode = err.response?.status;
      const message = backendMsg || err.message || "Unknown error";
      setStatus(`Import error${statusCode ? ` (${statusCode})` : ""}: ${message}`);
    }
  }

  async function handleValidate() {
    if (!geojson) return;
    try {
      setStatus("Validating…");
      const { data } = await apiClient.post("/api/geojson/validate", { geojson });
      setCleanedGeojson(data.cleaned);
      setErrors(data.errors || []);
      setStatus(`Validated. ${data.errors?.length || 0} issues.`);
      await addGeoJsonLayer(data.cleaned, `${osmType} (cleaned)`);
    } catch (err) {
      setStatus(err.response?.data?.error || err.message);
    }
  }

  async function handleSave() {
    if (!cleanedGeojson) return;
    try {
      setStatus("Saving to Firestore…");
      const { data } = await apiClient.post(`/api/feature-layers/${osmType}`, {
        geojson: cleanedGeojson,
        bufferRadius: 400,
      });
      setStatus(`Saved ${data.saved || 0} ${osmType} and GeoJSON to Firestore.`);
    } catch (err) {
      setStatus(err.response?.data?.error || err.message);
    }
  }

  async function handleLoad(type) {
    try {
      setStatus(`Loading ${type} from Firestore…`);
      const { data } = await apiClient.get(`/api/feature-layers/${type}`);
      console.log("Loaded data:", { 
        type, 
        hasGeojson: !!data.geojson, 
        hasBuffers: !!data.buffers, 
        geojsonFeatures: data.geojson?.features?.length, 
        bufferFeatures: data.buffers?.features?.length,
        buffers: data.buffers
      });
      setGeojson(null);
      setCleanedGeojson(null);
      setErrors([]);
      const buffersToPass = type === "stations" && data.buffers ? data.buffers : null;
      console.log("Passing to addGeoJsonLayer:", { type, buffersToPass: !!buffersToPass, buffersFeatures: buffersToPass?.features?.length });
      await addGeoJsonLayer(data.geojson, type, buffersToPass);
      setStatus(`Loaded ${data.geojson.features.length} ${type} from Firestore.`);
    } catch (err) {
      setStatus(err.response?.data?.error || err.message);
    }
  }

  async function handleLoadBoth() {
    try {
      setStatus("Loading stations and neighborhoods from Firestore…");
      
      const [stationsResponse, neighborhoodsResponse] = await Promise.all([
        apiClient.get("/api/feature-layers/stations"),
        apiClient.get("/api/feature-layers/neighborhoods")
      ]);
      
      const stationsData = stationsResponse.data;
      const neighborhoodsData = neighborhoodsResponse.data;
      
      setGeojson(null);
      setCleanedGeojson(null);
      setErrors([]);
      
      const stationsBuffers = stationsData.buffers ? stationsData.buffers : null;
      
      await addGeoJsonLayer(stationsData.geojson, "stations", stationsBuffers);
      await addGeoJsonLayer(neighborhoodsData.geojson, "neighborhoods", null);
      
      await new Promise(resolve => setTimeout(resolve, 500));
      await setupNeighborhoodClickFilter();
      
      setStatus(
        `Loaded ${stationsData.geojson.features.length} stations and ${neighborhoodsData.geojson.features.length} neighborhoods. Click on a neighborhood to filter stations.`
      );
    } catch (err) {
      setStatus(err.response?.data?.error || err.message);
    }
  }

  const applyBboxToMap = useCallback(async () => {
    const parts = parseBboxInput(bbox);
    if (!parts) {
      setStatus("Invalid BBOX: use south,west,north,east");
      return;
    }
    try {
      await goToBbox(parts);
      setStatus("BBOX applied to map.");
    } catch (err) {
      setStatus(err.message);
    }
  }, [bbox, goToBbox, setStatus]);

  useEffect(() => {
    if (currentUser) {
      setShowLanding(false);
    }
  }, [currentUser]);

  if (!currentUser) {
    if (showLanding) {
      return <Landing onNavigateToLogin={() => setShowLanding(false)} />;
    }
    return (
      <>
        {authMode === "login" ? (
          <Login onSwitchToRegister={() => setAuthMode("register")} />
        ) : (
          <Register onSwitchToLogin={() => setAuthMode("login")} />
        )}
      </>
    );
  }

  return (
    <div className="shell">
      <div className="hero">
        <div>
          <h1>CityReach</h1>
          <p className="tagline">
            Import OSM data, validate GeoJSON, and publish FeatureLayers for stations and neighborhoods with live map preview.
          </p>
        </div>
        <div style={{ marginLeft: "auto" }}>
          <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
            <span style={{ color: "#9fb4d5", fontSize: "14px" }}>
              {currentUser.email}
            </span>
            <button
              onClick={logout}
              style={{
                background: "#7f1d1d",
                color: "white",
                border: "none",
                padding: "8px 14px",
                borderRadius: "10px",
                cursor: "pointer",
                fontSize: "13px",
                fontWeight: "600",
              }}
            >
              Deconectare
            </button>
          </div>
        </div>
      </div>

      <div className="grid">
        <section className="panel">
          <div className="flex-between">
            <h3>Import settings</h3>
            <span className="badge">BBOX + Layer type</span>
          </div>
          <div className="controls" style={{ display: "grid", gridTemplateColumns: "1.2fr 240px", gap: "12px", alignItems: "start" }}>
            <div className="field">
              <label>Location (city, country)</label>
              <div style={{ display: "flex", gap: "8px" }}>
                <input
                  placeholder="e.g., Bucharest, Romania"
                  value={locationQuery}
                  onChange={(e) => setLocationQuery(e.target.value)}
                  onKeyDown={async (e) => {
                    if (e.key === "Enter" && locationQuery.trim()) {
                      try {
                        setStatus("Geocoding location…");
                        const { data } = await apiClient.post("/api/geocode", { query: locationQuery });
                        console.log("Geocoding result:", data);
                        
                        let parts;
                        const queryLower = locationQuery.toLowerCase();
                        if (queryLower.includes("bucharest") || queryLower.includes("bucurești")) {
                          parts = parseBboxInput(DEFAULT_BBOX);
                          setBbox(DEFAULT_BBOX);
                          setStatus(`Found: ${data.name} - Using default Bucharest extent`);
                        } else {
                          const [south, west, north, east] = data.bbox;
                          const newBbox = `${south},${west},${north},${east}`;
                          setBbox(newBbox);
                          parts = [south, west, north, east];
                          setStatus(`Found: ${data.name}`);
                        }
                        
                        console.log("Moving map to:", parts);
                        if (parts && parts.every(n => !isNaN(n) && n !== null && n !== undefined)) {
                          await goToBbox(parts);
                          setStatus(`Found: ${data.name} - Map updated`);
                        } else {
                          setStatus(`Found: ${data.name} - Invalid coordinates`);
                        }
                      } catch (err) {
                        console.error("Geocoding error:", err);
                        setStatus(err.response?.data?.error || err.message);
                      }
                    }
                  }}
                  style={{ flex: 1 }}
                />
                <button
                  onClick={async () => {
                    if (!locationQuery.trim()) return;
                    try {
                      setStatus("Geocoding location…");
                      const { data } = await apiClient.post("/api/geocode", { query: locationQuery });
                      console.log("Geocoding result:", data);
                      
                      let parts;
                      const queryLower = locationQuery.toLowerCase();
                      if (queryLower.includes("bucharest") || queryLower.includes("bucurești")) {
                        parts = parseBboxInput(DEFAULT_BBOX);
                        setBbox(DEFAULT_BBOX);
                        setStatus(`Found: ${data.name} - Using default Bucharest extent`);
                      } else {
                        const [south, west, north, east] = data.bbox;
                        const newBbox = `${south},${west},${north},${east}`;
                        setBbox(newBbox);
                        parts = [south, west, north, east];
                        setStatus(`Found: ${data.name}`);
                      }
                      
                      console.log("Moving map to:", parts);
                      if (parts && parts.every(n => !isNaN(n) && n !== null && n !== undefined)) {
                        await goToBbox(parts);
                        setStatus(`Found: ${data.name} - Map updated`);
                      } else {
                        setStatus(`Found: ${data.name} - Invalid coordinates`);
                      }
                    } catch (err) {
                      console.error("Geocoding error:", err);
                      setStatus(err.response?.data?.error || err.message);
                    }
                  }}
                >
                  Search
                </button>
              </div>
            </div>
            <div className="field">
              <label>Layer</label>
              <select value={osmType} onChange={(e) => setOsmType(e.target.value)}>
                <option value="stations">Stations</option>
                <option value="neighborhoods">Neighborhoods</option>
              </select>
            </div>
          </div>
          <div className="actions">
            <button onClick={handleImport}>Import OSM</button>
            <button onClick={handleValidate} disabled={!geojson}>
              Validate & Clean
            </button>
            <button onClick={handleSave} disabled={!cleanedGeojson}>
              Save to Firestore
            </button>
            <button onClick={() => handleLoad("stations")}>Load saved stations</button>
            <button onClick={() => handleLoad("neighborhoods")}>Load saved neighborhoods</button>
            <button onClick={handleLoadBoth} style={{ backgroundColor: "#10b981", color: "white" }}>
              Load Both
            </button>
            <button onClick={showAccessibilityHeatmap} style={{ backgroundColor: "#f59e0b", color: "white" }}>
              Show Accessibility Heatmap
            </button>
          </div>
          <div className="status">Status: {status}</div>
        </section>

      </div>

      <section className="content">
        <div className="panel map" ref={mapRef} />
        <div className="side">
          <div className="panel">
            <div className="flex-between">
              <h3>Validation issues</h3>
              <span className="badge">{errors.length} issues</span>
            </div>
            {errors.length === 0 && <p style={{ color: "#cbd5e1", margin: 0 }}>No errors.</p>}
            {errors.length > 0 && (
              <ul className="errors">
                {errors.map((err, idx) => (
                  <li key={idx}>{err.message || JSON.stringify(err)}</li>
                ))}
              </ul>
            )}
          </div>
          <div className="panel">
            <h3>Legend</h3>
            {osmType === "stations" ? (
              <div className="legend">
                <div className="legend-item">
                  <label style={{ display: "flex", alignItems: "center", gap: "10px", cursor: "pointer", width: "100%" }}>
                    <input
                      type="checkbox"
                      checked={transportFilters.bus}
                      onChange={(e) => {
                        setTransportFilters({ ...transportFilters, bus: e.target.checked });
                        updateTransportFilters?.({ ...transportFilters, bus: e.target.checked });
                      }}
                      style={{ cursor: "pointer" }}
                    />
                    <div className="legend-symbol" style={{ backgroundColor: "rgba(0, 150, 255, 0.8)", border: "1px solid rgba(255, 255, 255, 0.8)" }}></div>
                    <span>Bus</span>
                  </label>
                </div>
                <div className="legend-item">
                  <label style={{ display: "flex", alignItems: "center", gap: "10px", cursor: "pointer", width: "100%" }}>
                    <input
                      type="checkbox"
                      checked={transportFilters.tram}
                      onChange={(e) => {
                        setTransportFilters({ ...transportFilters, tram: e.target.checked });
                        updateTransportFilters?.({ ...transportFilters, tram: e.target.checked });
                      }}
                      style={{ cursor: "pointer" }}
                    />
                    <div className="legend-symbol" style={{ backgroundColor: "rgba(255, 150, 0, 0.8)", border: "1px solid rgba(255, 255, 255, 0.8)" }}></div>
                    <span>Tram</span>
                  </label>
                </div>
                <div className="legend-item">
                  <label style={{ display: "flex", alignItems: "center", gap: "10px", cursor: "pointer", width: "100%" }}>
                    <input
                      type="checkbox"
                      checked={transportFilters.metro}
                      onChange={(e) => {
                        setTransportFilters({ ...transportFilters, metro: e.target.checked });
                        updateTransportFilters?.({ ...transportFilters, metro: e.target.checked });
                      }}
                      style={{ cursor: "pointer" }}
                    />
                    <div className="legend-symbol" style={{ backgroundColor: "rgba(255, 0, 0, 0.8)", border: "1px solid rgba(255, 255, 255, 0.8)" }}></div>
                    <span>Metro</span>
                  </label>
                </div>
              </div>
            ) : (
              <div className="legend">
                <div className="legend-item">
                  <label style={{ display: "flex", alignItems: "center", gap: "10px", cursor: "pointer", width: "100%" }}>
                    <input
                      type="checkbox"
                      checked={adminLevelFilters.level8}
                      onChange={(e) => {
                        const newFilters = { ...adminLevelFilters, level8: e.target.checked };
                        setAdminLevelFilters(newFilters);
                        setTimeout(() => updateAdminLevelFilters?.(newFilters), 0);
                      }}
                      style={{ cursor: "pointer" }}
                    />
                    <div className="legend-symbol" style={{ backgroundColor: "rgba(100, 200, 100, 0.3)", border: "2px solid rgba(50, 150, 50, 0.8)" }}></div>
                    <span>Level 8 (Districts)</span>
                  </label>
                </div>
                <div className="legend-item">
                  <label style={{ display: "flex", alignItems: "center", gap: "10px", cursor: "pointer", width: "100%" }}>
                    <input
                      type="checkbox"
                      checked={adminLevelFilters.level9}
                      onChange={(e) => {
                        const newFilters = { ...adminLevelFilters, level9: e.target.checked };
                        setAdminLevelFilters(newFilters);
                        setTimeout(() => updateAdminLevelFilters?.(newFilters), 0);
                      }}
                      style={{ cursor: "pointer" }}
                    />
                    <div className="legend-symbol" style={{ backgroundColor: "rgba(100, 200, 100, 0.3)", border: "2px solid rgba(50, 150, 50, 0.8)" }}></div>
                    <span>Level 9 (Sub-districts)</span>
                  </label>
                </div>
                <div className="legend-item">
                  <label style={{ display: "flex", alignItems: "center", gap: "10px", cursor: "pointer", width: "100%" }}>
                    <input
                      type="checkbox"
                      checked={adminLevelFilters.level10}
                      onChange={(e) => {
                        const newFilters = { ...adminLevelFilters, level10: e.target.checked };
                        setAdminLevelFilters(newFilters);
                        setTimeout(() => updateAdminLevelFilters?.(newFilters), 0);
                      }}
                      style={{ cursor: "pointer" }}
                    />
                    <div className="legend-symbol" style={{ backgroundColor: "rgba(100, 200, 100, 0.3)", border: "2px solid rgba(50, 150, 50, 0.8)" }}></div>
                    <span>Level 10 (Neighborhoods)</span>
                  </label>
                </div>
              </div>
            )}
          </div>
        </div>
      </section>
      <section className="panel code-panel wide">
        <div className="flex-between">
          <h3>GeoJSON preview</h3>
          <span className="badge">read-only</span>
        </div>
        <textarea
          value={JSON.stringify(cleanedGeojson || geojson || {}, null, 2)}
          readOnly
          rows={18}
        />
      </section>
    </div>
  );
}

export default App;
