import { useState, useEffect, useMemo, useRef } from "react";
import { useAuth } from "../../contexts/AuthContext";
import apiClient from "../../utils/axiosConfig";
import "./AdminStations.css";

export function AdminStations() {
  const { currentUser } = useAuth();
  const [users, setUsers] = useState([]);
  const [selectedUserId, setSelectedUserId] = useState(null);
  const [stations, setStations] = useState([]);
  const [filteredStations, setFilteredStations] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadingUsers, setLoadingUsers] = useState(true);
  const [editingStation, setEditingStation] = useState(null);
  const [isAddingNew, setIsAddingNew] = useState(false);
  const [searchFilter, setSearchFilter] = useState("");
  const [typeFilter, setTypeFilter] = useState("all");
  const [sortBy, setSortBy] = useState("name");
  const [sortOrder, setSortOrder] = useState("asc");
  const [formData, setFormData] = useState({
    name: "",
    type: "bus",
    bufferRadius: 400,
    lines: "",
    latitude: "",
    longitude: "",
  });
  const editFormRef = useRef(null);

  useEffect(() => {
    loadUsers();
  }, []);

  useEffect(() => {
    if (selectedUserId) {
      loadStations();
    }
  }, [selectedUserId]);

  async function loadUsers() {
    try {
      setLoadingUsers(true);
      const { data } = await apiClient.get("/api/users");
      console.log("Loaded users:", data);
      const usersList = data.users || [];
      setUsers(usersList);
      if (usersList.length > 0 && !selectedUserId) {
        setSelectedUserId(currentUser?.uid || usersList[0].id);
      }
    } catch (err) {
      console.error("Error loading users:", err);
      console.error("Error details:", err.response?.data);
      setUsers([]);
    } finally {
      setLoadingUsers(false);
    }
  }

  async function loadStations() {
    if (!selectedUserId) {
      setStations([]);
      setFilteredStations([]);
      return;
    }
    
    try {
      setLoading(true);
      const { data } = await apiClient.get("/api/feature-layers/stations", {
        params: { userId: selectedUserId }
      });
      console.log("Loaded stations for user:", selectedUserId, data);
      const loadedStations = data.geojson?.features || [];
      setStations(loadedStations);
      applyFilters(loadedStations, searchFilter, typeFilter, sortBy, sortOrder);
      
      if (editingStation) {
        const updatedStation = loadedStations.find(s => {
          const sId = s.id || s.properties?.id;
          const eId = editingStation.id || editingStation.properties?.id;
          return sId === eId;
        });
        if (updatedStation) {
          setEditingStation(updatedStation);
          setFormData({
            name: updatedStation.properties?.name || "",
            type: updatedStation.properties?.type || "bus",
            bufferRadius: updatedStation.properties?.bufferRadius || 400,
            lines: updatedStation.properties?.lines || "",
          });
        }
      }
    } catch (err) {
      console.error("Error loading stations:", err);
      setStations([]);
      setFilteredStations([]);
    } finally {
      setLoading(false);
    }
  }

  function applyFilters(stationsList, search, type, sort, order) {
    let filtered = [...stationsList];

    if (search) {
      const searchLower = search.toLowerCase();
      filtered = filtered.filter((s) => {
        const props = s.properties || {};
        const name = (props.name || "").toLowerCase();
        const lines = (props.lines || "").toLowerCase();
        return name.includes(searchLower) || lines.includes(searchLower);
      });
    }

    if (type !== "all") {
      filtered = filtered.filter((s) => {
        const props = s.properties || {};
        return (props.type || "bus") === type;
      });
    }

    filtered.sort((a, b) => {
      const propsA = a.properties || {};
      const propsB = b.properties || {};
      let comparison = 0;

      if (sort === "name") {
        comparison = (propsA.name || "").localeCompare(propsB.name || "");
      } else if (sort === "type") {
        comparison = (propsA.type || "bus").localeCompare(propsB.type || "bus");
      } else if (sort === "bufferRadius") {
        comparison = (propsA.bufferRadius || 400) - (propsB.bufferRadius || 400);
      }

      return order === "asc" ? comparison : -comparison;
    });

    setFilteredStations(filtered);
  }

  useEffect(() => {
    applyFilters(stations, searchFilter, typeFilter, sortBy, sortOrder);
  }, [searchFilter, typeFilter, sortBy, sortOrder, stations]);

  function handleEdit(station) {
    console.log("handleEdit called with station:", station);
    setEditingStation(station);
    setFormData({
      name: station.properties?.name || "",
      type: station.properties?.type || "bus",
      bufferRadius: station.properties?.bufferRadius || 400,
      lines: station.properties?.lines || "",
    });
    console.log("editingStation set to:", station);
    
    setTimeout(() => {
      if (editFormRef.current) {
        editFormRef.current.scrollIntoView({ behavior: "smooth", block: "start" });
      }
    }, 100);
  }

  function handleCancel() {
    setEditingStation(null);
    setIsAddingNew(false);
    setFormData({
      name: "",
      type: "bus",
      bufferRadius: 400,
      lines: "",
      latitude: "",
      longitude: "",
    });
  }

  function handleAddNew() {
    setIsAddingNew(true);
    setEditingStation(null);
    setFormData({
      name: "",
      type: "bus",
      bufferRadius: 400,
      lines: "",
      latitude: "",
      longitude: "",
    });
    
    setTimeout(() => {
      if (editFormRef.current) {
        editFormRef.current.scrollIntoView({ behavior: "smooth", block: "start" });
      }
    }, 100);
  }

  async function handleSave() {
    if (isAddingNew) {
      if (!formData.name || !formData.latitude || !formData.longitude) {
        alert("Please fill in name, latitude, and longitude");
        return;
      }
      
      try {
        await apiClient.post("/api/feature-layers/stations/new", {
          name: formData.name,
          type: formData.type,
          bufferRadius: formData.bufferRadius,
          lines: formData.lines,
          latitude: parseFloat(formData.latitude),
          longitude: parseFloat(formData.longitude),
          userId: selectedUserId,
        });
        
        await loadStations();
        handleCancel();
      } catch (err) {
        console.error("Error creating station:", err);
        alert(err.response?.data?.error || err.message || "Failed to create station");
      }
      return;
    }

    if (!editingStation) return;

    try {
      const stationId = editingStation.id || editingStation.properties?.id;
      await apiClient.patch(`/api/feature-layers/stations/${encodeURIComponent(stationId)}`, {
        name: formData.name,
        type: formData.type,
        bufferRadius: formData.bufferRadius,
        lines: formData.lines,
      });
      
      await loadStations();
      handleCancel();
    } catch (err) {
      console.error("Error saving station:", err);
      alert(err.response?.data?.error || err.message || "Failed to save station");
    }
  }

  async function handleDelete(stationId) {
    if (!confirm("Are you sure you want to delete this station?")) return;

    try {
      await apiClient.delete(`/api/feature-layers/stations/${encodeURIComponent(stationId)}`);
      await loadStations();
    } catch (err) {
      console.error("Error deleting station:", err);
      alert(err.response?.data?.error || err.message || "Failed to delete station");
    }
  }


  if (loadingUsers) {
    return (
      <div className="admin-stations">
        <div style={{ color: "#e2e8f0", fontSize: "18px", padding: "40px", textAlign: "center" }}>
          Loading users...
        </div>
      </div>
    );
  }

  return (
    <div className="admin-stations">
      <h1>Manage Stations</h1>

      <div className="user-selector">
        <label>Select User:</label>
        {users.length > 0 ? (
          <select 
            value={selectedUserId || ""} 
            onChange={(e) => setSelectedUserId(e.target.value)}
            style={{ padding: "8px 12px", background: "#1a2332", border: "1px solid #1f2c47", borderRadius: "8px", color: "#e2e8f0", fontSize: "14px", minWidth: "200px" }}
          >
            {users.map((user) => (
              <option key={user.id} value={user.id}>
                {user.email} ({user.role})
              </option>
            ))}
          </select>
        ) : (
          <span style={{ color: "#9fb4d5" }}>No users found</span>
        )}
      </div>

      {(editingStation || isAddingNew) && (
        <div className="edit-form" ref={editFormRef}>
          <h2>{isAddingNew ? "Add New Station" : "Edit Station"}</h2>
          <div className="form-group">
            <label>Name:</label>
            <input
              type="text"
              value={formData.name}
              onChange={(e) => setFormData({ ...formData, name: e.target.value })}
            />
          </div>
          <div className="form-group">
            <label>Type:</label>
            <select
              value={formData.type}
              onChange={(e) => setFormData({ ...formData, type: e.target.value })}
            >
              <option value="bus">Bus</option>
              <option value="tram">Tram</option>
              <option value="metro">Metro</option>
            </select>
          </div>
          <div className="form-group">
            <label>Buffer Radius (meters):</label>
            <input
              type="number"
              min="300"
              max="500"
              value={formData.bufferRadius}
              onChange={(e) => setFormData({ ...formData, bufferRadius: parseInt(e.target.value) })}
            />
          </div>
          <div className="form-group">
            <label>Lines:</label>
            <input
              type="text"
              value={formData.lines}
              onChange={(e) => setFormData({ ...formData, lines: e.target.value })}
              placeholder="Comma-separated lines"
            />
          </div>
          {isAddingNew && (
            <>
              <div className="form-group">
                <label>Latitude (required):</label>
                <input
                  type="number"
                  step="any"
                  value={formData.latitude}
                  onChange={(e) => setFormData({ ...formData, latitude: e.target.value })}
                  placeholder="e.g., 44.4268"
                />
              </div>
              <div className="form-group">
                <label>Longitude (required):</label>
                <input
                  type="number"
                  step="any"
                  value={formData.longitude}
                  onChange={(e) => setFormData({ ...formData, longitude: e.target.value })}
                  placeholder="e.g., 26.1025"
                />
              </div>
            </>
          )}
          <div className="form-actions">
            <button onClick={handleSave}>{isAddingNew ? "Create" : "Save"}</button>
            <button onClick={handleCancel}>Cancel</button>
          </div>
        </div>
      )}

      {loading ? (
        <div style={{ color: "#e2e8f0", fontSize: "18px", padding: "40px", textAlign: "center" }}>
          Loading stations...
        </div>
      ) : (
      <div className="stations-list">
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "20px" }}>
          <h2>Stations List ({filteredStations.length} / {stations.length})</h2>
          <button 
            onClick={handleAddNew}
            style={{ background: "#10b981", color: "white", padding: "10px 20px", border: "none", borderRadius: "8px", cursor: "pointer", fontWeight: "600" }}
          >
            Add New Station
          </button>
        </div>
        
        <div className="filters-section">
          <div className="filter-group">
            <label>Search:</label>
            <input
              type="text"
              placeholder="Search by name or lines..."
              value={searchFilter}
              onChange={(e) => setSearchFilter(e.target.value)}
            />
          </div>
          <div className="filter-group">
            <label>Type:</label>
            <select value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)}>
              <option value="all">All</option>
              <option value="bus">Bus</option>
              <option value="tram">Tram</option>
              <option value="metro">Metro</option>
            </select>
          </div>
          <div className="filter-group">
            <label>Sort by:</label>
            <select value={sortBy} onChange={(e) => setSortBy(e.target.value)}>
              <option value="name">Name</option>
              <option value="type">Type</option>
              <option value="bufferRadius">Buffer Radius</option>
            </select>
          </div>
          <div className="filter-group">
            <label>Order:</label>
            <select value={sortOrder} onChange={(e) => setSortOrder(e.target.value)}>
              <option value="asc">Ascending</option>
              <option value="desc">Descending</option>
            </select>
          </div>
        </div>

        <div className="stations-table">
          <table>
            <thead>
              <tr>
                <th>Name</th>
                <th>Type</th>
                <th>Buffer Radius</th>
                <th>Lines</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {filteredStations.map((station, index) => {
                const props = station.properties || {};
                const stationId = station.id || props.id || index;
                return (
                  <tr key={stationId}>
                    <td>{props.name || "Unknown"}</td>
                    <td>{props.type || "bus"}</td>
                    <td>{props.bufferRadius || 400}m</td>
                    <td>{props.lines || "-"}</td>
                    <td>
                      <button 
                        onClick={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
                          console.log("Edit button clicked for station:", station);
                          handleEdit(station);
                        }}
                      >
                        Edit
                      </button>
                      <button onClick={() => handleDelete(stationId)}>Delete</button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
      )}
    </div>
  );
}
