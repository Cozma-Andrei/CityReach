import { useCallback, useState } from "react";
import "@arcgis/core/assets/esri/themes/light/main.css";
import "./App.css";
import { useGeoMap } from "./hooks/useGeoMap";
import { useAuth } from "./contexts/AuthContext";
import { Login } from "./components/Login";
import { Register } from "./components/Register";
import apiClient from "./utils/axiosConfig";
const DEFAULT_BBOX = "44.40,26.00,44.60,26.30";

function App() {
  const { currentUser, logout } = useAuth();
  const [authMode, setAuthMode] = useState("login");
  const [bbox, setBbox] = useState(DEFAULT_BBOX);
  const [osmType, setOsmType] = useState("stations");
  const [geojson, setGeojson] = useState(null);
  const [cleanedGeojson, setCleanedGeojson] = useState(null);
  const [errors, setErrors] = useState([]);
  const [status, setStatus] = useState("");

  function parseBboxInput(value) {
    const parts = value.split(",").map((v) => Number(v.trim()));
    if (parts.length !== 4 || parts.some((n) => Number.isNaN(n))) return null;
    const [south, west, north, east] = parts;
    if (Math.abs(south) > 90 || Math.abs(north) > 90) return null;
    if (Math.abs(west) > 180 || Math.abs(east) > 180) return null;
    if (south >= north || west >= east) return null;
    return [south, west, north, east];
  }

  const { mapRef, addGeoJsonLayer, goToBbox } = useGeoMap({
    onBboxChange: setBbox,
    initialBboxParts: parseBboxInput(DEFAULT_BBOX),
    setStatus,
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
    if (!cleanedGeojson && !geojson) return;
    const payload = cleanedGeojson || geojson;
    try {
      setStatus("Saving to Firestore…");
      await apiClient.post(`/api/feature-layers/${osmType}`, {
        geojson: payload,
        metadata: { source: "osm", updatedAt: new Date().toISOString() },
      });
      setStatus("Saved.");
    } catch (err) {
      setStatus(err.response?.data?.error || err.message);
    }
  }

  async function handleLoad(type) {
    try {
      setStatus(`Loading ${type} from Firestore…`);
      const { data } = await apiClient.get(`/api/feature-layers/${type}`);
      setGeojson(data.geojson);
      setCleanedGeojson(null);
      await addGeoJsonLayer(data.geojson, `${type} (saved)`);
      setStatus("Loaded.");
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

  if (!currentUser) {
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
          <div className="controls">
            <div className="field">
              <label>Bounding box (south,west,north,east)</label>
              <input
                value={bbox}
                onChange={(e) => setBbox(e.target.value)}
                onBlur={applyBboxToMap}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    applyBboxToMap();
                  }
                }}
              />
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
            <button onClick={handleSave} disabled={!geojson}>
              Save FeatureLayer (Firestore)
            </button>
            <button onClick={applyBboxToMap}>Set map from BBOX</button>
            <button onClick={() => handleLoad("stations")}>Load saved stations</button>
            <button onClick={() => handleLoad("neighborhoods")}>Load saved neighborhoods</button>
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
