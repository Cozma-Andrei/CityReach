import { useState, useEffect } from "react";
import { useAuth } from "../../contexts/AuthContext";
import apiClient from "../../utils/axiosConfig";
import "./AdminDashboard.css";

export function AdminDashboard() {
  const { currentUser, userRole } = useAuth();
  const [stats, setStats] = useState({
    totalStations: 0,
    totalNeighborhoods: 0,
    totalUsers: 0,
    totalPopulation: 0,
  });
  const [loading, setLoading] = useState(true);
  const [coverageResults, setCoverageResults] = useState([]);
  const [filteredCoverageResults, setFilteredCoverageResults] = useState([]);
  const [loadingCoverage, setLoadingCoverage] = useState(false);
  const [calculatingCoverage, setCalculatingCoverage] = useState(false);
  const [searchFilter, setSearchFilter] = useState("");
  const [sortBy, setSortBy] = useState("coveragePercentage");
  const [sortOrder, setSortOrder] = useState("desc");
  const [adminLevelFilter, setAdminLevelFilter] = useState("all");

  useEffect(() => {
    loadStatistics();
    loadCoverageAnalysis();
    loadTypeStatistics();
  }, []);

  const [statistics, setStatistics] = useState(null);
  const [stationTypeStats, setStationTypeStats] = useState(null);
  const [neighborhoodTypeStats, setNeighborhoodTypeStats] = useState(null);

  async function loadCoverageAnalysis() {
    try {
      const { data } = await apiClient.get("/api/coverage-analysis");
      if (data.success && data.results) {
        setCoverageResults(data.results);
        setStatistics(data.statistics || null);
        applyFilters(data.results, searchFilter, sortBy, sortOrder, adminLevelFilter);
      }
    } catch (err) {
      console.error("Error loading coverage analysis:", err);
    }
  }

  async function loadTypeStatistics() {
    try {
      const [stationsRes, neighborhoodsRes] = await Promise.all([
        apiClient.get("/api/feature-layers/stations"),
        apiClient.get("/api/feature-layers/neighborhoods"),
      ]);

      const stations = stationsRes.data.geojson?.features || [];
      const neighborhoods = neighborhoodsRes.data.geojson?.features || [];

      const stationTypes = { bus: 0, tram: 0, metro: 0 };
      stations.forEach(station => {
        const type = station.properties?.type || "bus";
        if (stationTypes[type] !== undefined) {
          stationTypes[type]++;
        }
      });

      const neighborhoodTypes = { level8: 0, level9: 0, level10: 0 };
      neighborhoods.forEach(neighborhood => {
        const level = neighborhood.properties?.admin_level;
        if (level === "8") neighborhoodTypes.level8++;
        else if (level === "9") neighborhoodTypes.level9++;
        else if (level === "10") neighborhoodTypes.level10++;
      });

      setStationTypeStats(stationTypes);
      setNeighborhoodTypeStats(neighborhoodTypes);
    } catch (err) {
      console.error("Error loading type statistics:", err);
    }
  }

  function applyFilters(results, search, sort, order, adminFilter = adminLevelFilter) {
    let filtered = [...results];

    if (search) {
      const searchLower = search.toLowerCase();
      filtered = filtered.filter((r) => {
        const name = (r.neighborhoodName || "").toLowerCase();
        return name.includes(searchLower);
      });
    }

    if (adminFilter && adminFilter !== "all") {
      filtered = filtered.filter((r) => {
        const level = r.adminLevel ? String(r.adminLevel) : null;
        return level === adminFilter;
      });
    }

    filtered.sort((a, b) => {
      let comparison = 0;
      if (sort === "neighborhoodName") {
        comparison = (a.neighborhoodName || "").localeCompare(b.neighborhoodName || "");
      } else if (sort === "adminLevel") {
        const levelA = a.adminLevel ? Number(a.adminLevel) : 999;
        const levelB = b.adminLevel ? Number(b.adminLevel) : 999;
        comparison = levelA - levelB;
      } else if (sort === "population") {
        comparison = (a.population || 0) - (b.population || 0);
      } else if (sort === "stationsCount") {
        comparison = (a.stationsCount || 0) - (b.stationsCount || 0);
      } else if (sort === "coveragePercentage") {
        comparison = (a.coveragePercentage || 0) - (b.coveragePercentage || 0);
      } else if (sort === "coveredPopulation") {
        comparison = (a.coveredPopulation || 0) - (b.coveredPopulation || 0);
      } else if (sort === "uncoveredPopulation") {
        comparison = (a.uncoveredPopulation || 0) - (b.uncoveredPopulation || 0);
      }

      return order === "asc" ? comparison : -comparison;
    });

    setFilteredCoverageResults(filtered);
  }

  useEffect(() => {
    applyFilters(coverageResults, searchFilter, sortBy, sortOrder, adminLevelFilter);
  }, [searchFilter, sortBy, sortOrder, coverageResults, adminLevelFilter]);

  async function calculateCoverage() {
    try {
      setCalculatingCoverage(true);
      setLoadingCoverage(true);

      const [stationsRes, neighborhoodsRes] = await Promise.all([
        apiClient.get("/api/feature-layers/stations"),
        apiClient.get("/api/feature-layers/neighborhoods"),
      ]);

      const stations = stationsRes.data.geojson?.features || [];
      const neighborhoods = neighborhoodsRes.data.geojson?.features || [];

      if (stations.length === 0 || neighborhoods.length === 0) {
        alert("Please ensure both stations and neighborhoods are loaded.");
        setCalculatingCoverage(false);
        setLoadingCoverage(false);
        return;
      }

      const geometryEngineModule = await import("@arcgis/core/geometry/geometryEngine");
      const geometryEngine = geometryEngineModule.default || geometryEngineModule;
      const { default: Point } = await import("@arcgis/core/geometry/Point");
      const { default: Polygon } = await import("@arcgis/core/geometry/Polygon");

      const coverageResults = [];

      for (const neighborhood of neighborhoods) {
        try {
          const neighborhoodId = neighborhood.id || neighborhood.properties?.id;
          const neighborhoodName = neighborhood.properties?.name || "Unknown";
          const population = neighborhood.properties?.population || 0;
          const adminLevel = neighborhood.properties?.admin_level || null;
          let geometry = neighborhood.geometry;

          if (!geometry) {
            continue;
          }

          if (typeof geometry === "string") {
            try {
              geometry = JSON.parse(geometry);
            } catch (parseErr) {
              console.error("Error parsing geometry string:", parseErr);
              continue;
            }
          }

          if (!geometry.type || (geometry.type !== "Polygon" && geometry.type !== "MultiPolygon")) {
            continue;
          }

          let neighborhoodGeometry;
          try {
            let rings;
            if (geometry.type === "Polygon") {
              rings = geometry.coordinates;
            } else if (geometry.type === "MultiPolygon") {
              rings = geometry.coordinates[0];
            } else {
              console.error("Unsupported geometry type:", geometry.type);
              continue;
            }
            
            if (!rings || !Array.isArray(rings) || rings.length === 0) {
              console.error("Invalid rings for neighborhood:", neighborhoodId);
              continue;
            }
            
            neighborhoodGeometry = new Polygon({
              rings: rings,
              spatialReference: { wkid: 4326 }
            });
            
            if (!neighborhoodGeometry || !neighborhoodGeometry.rings || neighborhoodGeometry.rings.length === 0) {
              console.error("Invalid Polygon created for neighborhood:", neighborhoodId, "rings:", rings);
              continue;
            }
            
            let testArea = geometryEngine.geodesicArea(neighborhoodGeometry, "square-meters");
            
            if (testArea && testArea < 0) {
              const reversedRings = rings.map(ring => [...ring].reverse());
              neighborhoodGeometry = new Polygon({
                rings: reversedRings,
                spatialReference: { wkid: 4326 }
              });
              testArea = geometryEngine.geodesicArea(neighborhoodGeometry, "square-meters");
            }
            
            if (!testArea || testArea <= 0 || isNaN(testArea)) {
              console.error("Invalid area for neighborhood geometry:", neighborhoodId, "area:", testArea);
              continue;
            }
          } catch (geoErr) {
            console.error("Error creating Polygon geometry:", geoErr, "for neighborhood:", neighborhoodId);
            continue;
          }

          const intersectingStationIds = new Set();
          const intersectingGeometries = [];
          
          console.log(`Calculating coverage for neighborhood: ${neighborhoodName} (${neighborhoodId}), stations count: ${stations.length}`);

          for (const station of stations) {
            const stationId = station.id || station.properties?.id;
            if (!stationId || !station.geometry || station.geometry.type !== "Point") continue;

            const bufferRadius = station.properties?.bufferRadius || 400;
            const coords = station.geometry.coordinates;

            const stationPoint = new Point({
              longitude: coords[0],
              latitude: coords[1],
              spatialReference: { wkid: 4326 }
            });

            const bufferGeometry = geometryEngine.geodesicBuffer(stationPoint, bufferRadius, "meters");
            if (!bufferGeometry) continue;

            const intersects = geometryEngine.intersects(bufferGeometry, neighborhoodGeometry);
            if (intersects) {
              intersectingStationIds.add(String(stationId));
              try {
                const intersection = geometryEngine.intersect(bufferGeometry, neighborhoodGeometry);
                if (intersection) {
                  const hasRings = intersection.rings && Array.isArray(intersection.rings) && intersection.rings.length > 0;
                  const hasPaths = intersection.paths && Array.isArray(intersection.paths) && intersection.paths.length > 0;
                  const hasType = intersection.type && typeof intersection.type === "string";
                  
                  if (hasType && (hasRings || hasPaths)) {
                    const intersectionArea = geometryEngine.geodesicArea(intersection, "square-meters");
                    if (intersectionArea && intersectionArea > 0 && !isNaN(intersectionArea)) {
                      intersectingGeometries.push(intersection);
                    } else if (intersectingStationIds.size <= 10) {
                      console.warn(`Intersection has zero or invalid area for station ${stationId}:`, intersectionArea);
                    }
                  } else if (intersectingStationIds.size <= 10) {
                    console.warn(`Invalid intersection geometry structure for station ${stationId}:`, {
                      hasType,
                      hasRings,
                      hasPaths,
                      type: intersection.type
                    });
                  }
                }
              } catch (err) {
                if (intersectingStationIds.size <= 10) {
                  console.error("Error calculating intersection for station:", stationId, err.message);
                }
              }
            }
          }
          
          console.log(`Neighborhood ${neighborhoodName}: ${intersectingStationIds.size} intersecting stations, ${intersectingGeometries.length} valid intersections`);

          let coveragePercentage = 0;

          if (intersectingGeometries.length > 0) {
            try {
              let unionGeometry;
              if (intersectingGeometries.length === 1) {
                unionGeometry = intersectingGeometries[0];
              } else {
                try {
                  unionGeometry = geometryEngine.union(intersectingGeometries);
                  if (!unionGeometry) {
                    unionGeometry = intersectingGeometries[0];
                    for (let i = 1; i < intersectingGeometries.length; i++) {
                      const newUnion = geometryEngine.union(unionGeometry, intersectingGeometries[i]);
                      if (newUnion) {
                        const oldArea = geometryEngine.geodesicArea(unionGeometry, "square-meters");
                        const newArea = geometryEngine.geodesicArea(newUnion, "square-meters");
                        if (newArea >= oldArea) {
                          unionGeometry = newUnion;
                        }
                      }
                    }
                  }
                } catch (unionErr) {
                  unionGeometry = intersectingGeometries[0];
                  for (let i = 1; i < intersectingGeometries.length; i++) {
                    const newUnion = geometryEngine.union(unionGeometry, intersectingGeometries[i]);
                    if (newUnion) {
                      const oldArea = geometryEngine.geodesicArea(unionGeometry, "square-meters");
                      const newArea = geometryEngine.geodesicArea(newUnion, "square-meters");
                      if (newArea >= oldArea) {
                        unionGeometry = newUnion;
                      }
                    }
                  }
                }
              }

              const neighborhoodArea = geometryEngine.geodesicArea(neighborhoodGeometry, "square-meters");
              
              if (!neighborhoodArea || neighborhoodArea <= 0 || isNaN(neighborhoodArea)) {
                console.warn(`Invalid neighborhood area for ${neighborhoodName}:`, neighborhoodArea);
                coverageResults.push({
                  neighborhoodId,
                  neighborhoodName,
                  adminLevel: adminLevel ? String(adminLevel) : null,
                  population: Number(population) || 0,
                  coveragePercentage: 0,
                  stationsCount: intersectingStationIds.size,
                  coveredPopulation: 0,
                  uncoveredPopulation: Number(population) || 0,
                });
                continue;
              }
              
              const coverageArea = geometryEngine.geodesicArea(unionGeometry, "square-meters");

              console.log(`Area calculation for ${neighborhoodName}: neighborhood=${neighborhoodArea?.toFixed(2)} m², coverage=${coverageArea?.toFixed(2)} m², intersections=${intersectingGeometries.length}`);

              if (coverageArea && coverageArea > 0 && !isNaN(coverageArea)) {
                coveragePercentage = Math.min(100, Math.max(0, (coverageArea / neighborhoodArea) * 100));
                console.log(`✓ Coverage percentage for ${neighborhoodName}: ${coveragePercentage.toFixed(2)}%`);
              } else {
                console.warn(`✗ Invalid coverage area for ${neighborhoodName}: coverage=${coverageArea}, intersections=${intersectingGeometries.length}`);
              }
            } catch (areaErr) {
              console.error("Error calculating coverage area for", neighborhoodName, ":", areaErr);
              console.error("Error details:", {
                message: areaErr.message,
                stack: areaErr.stack,
                neighborhoodGeometry: neighborhoodGeometry?.type,
                unionGeometry: unionGeometry?.type
              });
            }
          } else {
            console.log(`No intersections found for ${neighborhoodName}`);
          }

          coverageResults.push({
            neighborhoodId,
            neighborhoodName,
            adminLevel: adminLevel ? String(adminLevel) : null,
            population: Number(population) || 0,
            coveragePercentage: parseFloat(coveragePercentage.toFixed(2)),
            stationsCount: intersectingStationIds.size,
            coveredPopulation: Math.round((Number(population) || 0) * (coveragePercentage / 100)),
            uncoveredPopulation: Math.round((Number(population) || 0) * (1 - coveragePercentage / 100)),
          });
        } catch (err) {
          console.error("Error calculating coverage for neighborhood:", neighborhood.id, err);
        }
      }

      const sortedResults = [...coverageResults].sort((a, b) => b.coveragePercentage - a.coveragePercentage);
      
      const top5ByStations = [...sortedResults].sort((a, b) => b.stationsCount - a.stationsCount).slice(0, 5);
      const top5ByPopulation = [...sortedResults].sort((a, b) => b.population - a.population).slice(0, 5);
      const top5ByUncoveredPopulation = [...sortedResults].sort((a, b) => b.uncoveredPopulation - a.uncoveredPopulation).slice(0, 5);
      const top5ByUncoveredPopulationPercent = [...sortedResults]
        .filter(r => r.population > 0)
        .map(r => ({
          ...r,
          uncoveredPopulationPercent: (r.uncoveredPopulation / r.population) * 100
        }))
        .sort((a, b) => b.uncoveredPopulationPercent - a.uncoveredPopulationPercent)
        .slice(0, 5);

      const statsData = {
        top5ByStations,
        top5ByPopulation,
        top5ByUncoveredPopulation,
        top5ByUncoveredPopulationPercent,
      };

      await apiClient.post("/api/coverage-analysis", {
        coverageResults,
        statistics: statsData,
        userId: currentUser?.uid,
      });

      await apiClient.post("/api/coverage-analysis", {
        coverageResults: sortedResults,
        statistics: statsData,
        userId: currentUser?.uid,
      });

      setCoverageResults(sortedResults);
      setStatistics(statsData);
      applyFilters(sortedResults, searchFilter, sortBy, sortOrder, adminLevelFilter);
      setCalculatingCoverage(false);
      setLoadingCoverage(false);
    } catch (err) {
      console.error("Error calculating coverage:", err);
      alert(err.response?.data?.error || err.message || "Failed to calculate coverage");
      setCalculatingCoverage(false);
      setLoadingCoverage(false);
    }
  }

  async function loadStatistics() {
    try {
      setLoading(true);
      
      const [stationsRes, neighborhoodsRes] = await Promise.all([
        apiClient.get("/api/feature-layers/stations"),
        apiClient.get("/api/feature-layers/neighborhoods"),
      ]);

      const stationsCount = stationsRes.data.geojson?.features?.length || 0;
      const neighborhoodsCount = neighborhoodsRes.data.geojson?.features?.length || 0;

      let totalPopulation = 0;

      if (neighborhoodsRes.data.geojson?.features) {
        neighborhoodsRes.data.geojson.features.forEach((feature) => {
          const pop = feature.properties?.population || 0;
          totalPopulation += pop;
        });
      }

      setStats({
        totalStations: stationsCount,
        totalNeighborhoods: neighborhoodsCount,
        totalUsers: 0,
        totalPopulation,
      });
    } catch (err) {
      console.error("Error loading statistics:", err);
    } finally {
      setLoading(false);
    }
  }

  if (loading) {
    return (
      <div className="admin-dashboard">
        <div style={{ color: "#e2e8f0", fontSize: "18px", padding: "40px", textAlign: "center" }}>
          Loading statistics...
        </div>
      </div>
    );
  }

  return (
    <div className="admin-dashboard">
      <h1>Admin Dashboard</h1>
      
      <div className="stats-grid">
        <div className="stat-card">
          <h3>Total Stations</h3>
          <p className="stat-value">{stats.totalStations}</p>
        </div>
        
        <div className="stat-card">
          <h3>Total Neighborhoods</h3>
          <p className="stat-value">{stats.totalNeighborhoods}</p>
        </div>
        
        <div className="stat-card">
          <h3>Total Population</h3>
          <p className="stat-value">{stats.totalPopulation.toLocaleString()}</p>
        </div>
      </div>

      <div className="coverage-section">
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "20px" }}>
          <h2>Neighborhood Coverage Analysis</h2>
          <button
            onClick={calculateCoverage}
            disabled={calculatingCoverage}
            style={{
              background: calculatingCoverage ? "#6b7280" : "#10b981",
              color: "white",
              padding: "10px 20px",
              border: "none",
              borderRadius: "8px",
              cursor: calculatingCoverage ? "not-allowed" : "pointer",
              fontWeight: "600",
            }}
          >
            {calculatingCoverage ? "Calculating..." : "Calculate Coverage"}
          </button>
        </div>

        {loadingCoverage && !calculatingCoverage && (
          <div style={{ color: "#e2e8f0", fontSize: "16px", padding: "20px", textAlign: "center" }}>
            Loading coverage results...
          </div>
        )}

        {!loadingCoverage && coverageResults.length > 0 && (
          <>
            <div className="filters-section" style={{ marginBottom: "20px" }}>
              <div className="filter-group">
                <label>Search:</label>
                <input
                  type="text"
                  placeholder="Search by neighborhood name..."
                  value={searchFilter}
                  onChange={(e) => setSearchFilter(e.target.value)}
                />
              </div>
              <div className="filter-group">
                <label>Admin Level:</label>
                <select value={adminLevelFilter} onChange={(e) => setAdminLevelFilter(e.target.value)}>
                  <option value="all">All Levels</option>
                  <option value="8">Level 8</option>
                  <option value="9">Level 9</option>
                  <option value="10">Level 10</option>
                </select>
              </div>
              <div className="filter-group">
                <label>Sort by:</label>
                <select value={sortBy} onChange={(e) => setSortBy(e.target.value)}>
                  <option value="coveragePercentage">Coverage %</option>
                  <option value="neighborhoodName">Neighborhood Name</option>
                  <option value="adminLevel">Admin Level</option>
                  <option value="population">Population</option>
                  <option value="stationsCount">Stations Count</option>
                  <option value="coveredPopulation">Covered Population</option>
                  <option value="uncoveredPopulation">Uncovered Population</option>
                </select>
              </div>
              <div className="filter-group">
                <label>Order:</label>
                <select value={sortOrder} onChange={(e) => setSortOrder(e.target.value)}>
                  <option value="desc">Descending</option>
                  <option value="asc">Ascending</option>
                </select>
              </div>
            </div>
            <div className="coverage-table-container">
              <table className="coverage-table">
                <thead>
                  <tr>
                    <th>Neighborhood</th>
                    <th>Admin Level</th>
                    <th>Population</th>
                    <th>Stations Count</th>
                    <th>Coverage %</th>
                    <th>Covered Population</th>
                    <th>Uncovered Population</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredCoverageResults.map((result) => (
                    <tr key={result.neighborhoodId}>
                      <td>{result.neighborhoodName}</td>
                      <td>{result.adminLevel || "-"}</td>
                      <td>{result.population.toLocaleString()}</td>
                      <td>{result.stationsCount}</td>
                      <td style={{ 
                        color: result.coveragePercentage >= 80 ? "#10b981" : 
                               result.coveragePercentage >= 50 ? "#f59e0b" : "#ef4444",
                        fontWeight: "600"
                      }}>
                        {result.coveragePercentage.toFixed(2)}%
                      </td>
                      <td>{result.coveredPopulation.toLocaleString()}</td>
                      <td>{result.uncoveredPopulation.toLocaleString()}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}

        {!loadingCoverage && coverageResults.length === 0 && !calculatingCoverage && (
          <div style={{ color: "#9fb4d5", fontSize: "14px", padding: "20px", textAlign: "center" }}>
            No coverage analysis available. Click "Calculate Coverage" to analyze neighborhoods.
          </div>
        )}
      </div>

      <div className="charts-section">
        <h2>Charts and Statistics</h2>
        
        {statistics && (
          <div className="charts-grid">
            {statistics.top5ByStations && statistics.top5ByStations.length > 0 && (
              <div className="chart-card">
                <h3>Top 5 Neighborhoods by Stations Count</h3>
                <SimpleBarChart
                  data={statistics.top5ByStations.map(n => ({
                    name: n.neighborhoodName,
                    stations: n.stationsCount,
                    coverage: n.coveragePercentage
                  }))}
                  dataKey="stations"
                  color="#3b82f6"
                  labelKey="name"
                />
              </div>
            )}

            {statistics.top5ByPopulation && statistics.top5ByPopulation.length > 0 && (
              <div className="chart-card">
                <h3>Top 5 Neighborhoods by Population</h3>
                <SimpleBarChart
                  data={statistics.top5ByPopulation.map(n => ({
                    name: n.neighborhoodName,
                    population: n.population,
                    coverage: n.coveragePercentage
                  }))}
                  dataKey="population"
                  color="#10b981"
                  labelKey="name"
                />
              </div>
            )}

            {statistics.top5ByUncoveredPopulation && statistics.top5ByUncoveredPopulation.length > 0 && (
              <div className="chart-card">
                <h3>Top 5 Neighborhoods by Uncovered Population</h3>
                <SimpleBarChart
                  data={statistics.top5ByUncoveredPopulation.map(n => ({
                    name: n.neighborhoodName,
                    uncovered: n.uncoveredPopulation,
                    coverage: n.coveragePercentage
                  }))}
                  dataKey="uncovered"
                  color="#ef4444"
                  labelKey="name"
                />
              </div>
            )}

            {statistics.top5ByUncoveredPopulationPercent && statistics.top5ByUncoveredPopulationPercent.length > 0 && (
              <div className="chart-card">
                <h3>Top 5 Neighborhoods by Uncovered Population %</h3>
                <SimpleBarChart
                  data={statistics.top5ByUncoveredPopulationPercent.map(n => ({
                    name: n.neighborhoodName,
                    uncoveredPercent: n.uncoveredPopulationPercent,
                    coverage: n.coveragePercentage
                  }))}
                  dataKey="uncoveredPercent"
                  color="#f59e0b"
                  labelKey="name"
                />
              </div>
            )}
          </div>
        )}

        <div className="charts-grid" style={{ marginTop: "32px" }}>
          {stationTypeStats && (
            <div className="chart-card">
              <h3>Stations by Type</h3>
              <SimpleBarChart
                data={[
                  { name: "Bus", count: stationTypeStats.bus || 0 },
                  { name: "Tram", count: stationTypeStats.tram || 0 },
                  { name: "Metro", count: stationTypeStats.metro || 0 }
                ]}
                dataKey="count"
                color="#8b5cf6"
                labelKey="name"
              />
            </div>
          )}

          {neighborhoodTypeStats && (
            <div className="chart-card">
              <h3>Neighborhoods by Admin Level</h3>
              <SimpleBarChart
                data={[
                  { name: "Level 8", count: neighborhoodTypeStats.level8 || 0 },
                  { name: "Level 9", count: neighborhoodTypeStats.level9 || 0 },
                  { name: "Level 10", count: neighborhoodTypeStats.level10 || 0 }
                ]}
                dataKey="count"
                color="#06b6d4"
                labelKey="name"
              />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function SimpleBarChart({ data, dataKey, color, labelKey = "name" }) {
  const maxValue = Math.max(...data.map(d => d[dataKey] || 0), 1);
  
  return (
    <div style={{ padding: "20px 0" }}>
      {data.map((item, index) => {
        const value = item[dataKey] || 0;
        const percentage = (value / maxValue) * 100;
        const coverageValue = item.coverage !== undefined ? item.coverage : null;
        
        return (
          <div key={index} style={{ marginBottom: "16px" }}>
            <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "6px" }}>
              <span style={{ color: "#e2e8f0", fontSize: "14px", fontWeight: "500" }}>
                {item[labelKey]}
              </span>
              <span style={{ color: "#9fb4d5", fontSize: "14px" }}>
                {typeof value === "number" && value >= 1000 
                  ? value.toLocaleString() 
                  : value.toFixed(value >= 1 ? 0 : 2)}
                {coverageValue !== null && (
                  <span style={{ marginLeft: "8px", color: coverageValue >= 80 ? "#10b981" : coverageValue >= 50 ? "#f59e0b" : "#ef4444" }}>
                    ({coverageValue.toFixed(1)}% coverage)
                  </span>
                )}
              </span>
            </div>
            <div style={{ 
              width: "100%", 
              height: "24px", 
              background: "#1a2332", 
              borderRadius: "4px",
              overflow: "hidden"
            }}>
              <div style={{
                width: `${percentage}%`,
                height: "100%",
                background: color,
                borderRadius: "4px",
                transition: "width 0.3s ease"
              }} />
            </div>
          </div>
        );
      })}
    </div>
  );
}
