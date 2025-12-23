import { useState, useEffect, useMemo, useRef } from "react";
import { useAuth } from "../../contexts/AuthContext";
import apiClient from "../../utils/axiosConfig";
import "./AdminNeighborhoods.css";

export function AdminNeighborhoods() {
  const { currentUser } = useAuth();
  const [users, setUsers] = useState([]);
  const [selectedUserId, setSelectedUserId] = useState(null);
  const [neighborhoods, setNeighborhoods] = useState([]);
  const [filteredNeighborhoods, setFilteredNeighborhoods] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadingUsers, setLoadingUsers] = useState(true);
  const [editingNeighborhood, setEditingNeighborhood] = useState(null);
  const [isAddingNew, setIsAddingNew] = useState(false);
  const editFormRef = useRef(null);
  const [searchFilter, setSearchFilter] = useState("");
  const [adminLevelFilter, setAdminLevelFilter] = useState("all");
  const [sortBy, setSortBy] = useState("name");
  const [sortOrder, setSortOrder] = useState("asc");
  const [formData, setFormData] = useState({
    name: "",
    population: 0,
    admin_level: "8",
    geometry: null,
  });

  useEffect(() => {
    loadUsers();
  }, []);

  useEffect(() => {
    if (selectedUserId) {
      loadNeighborhoods();
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

  async function loadNeighborhoods() {
    if (!selectedUserId) {
      setNeighborhoods([]);
      setFilteredNeighborhoods([]);
      return;
    }
    
    try {
      setLoading(true);
      const { data } = await apiClient.get("/api/feature-layers/neighborhoods", {
        params: { userId: selectedUserId }
      });
      console.log("Loaded neighborhoods for user:", selectedUserId, data);
      const loadedNeighborhoods = data.geojson?.features || [];
      setNeighborhoods(loadedNeighborhoods);
      applyFilters(loadedNeighborhoods, searchFilter, adminLevelFilter, sortBy, sortOrder);
    } catch (err) {
      console.error("Error loading neighborhoods:", err);
      setNeighborhoods([]);
      setFilteredNeighborhoods([]);
    } finally {
      setLoading(false);
    }
  }

  function applyFilters(neighborhoodsList, search, adminLevel, sort, order) {
    let filtered = [...neighborhoodsList];

    if (search) {
      const searchLower = search.toLowerCase();
      filtered = filtered.filter((n) => {
        const props = n.properties || {};
        const name = (props.name || "").toLowerCase();
        return name.includes(searchLower);
      });
    }

    if (adminLevel !== "all") {
      filtered = filtered.filter((n) => {
        const props = n.properties || {};
        return String(props.admin_level || "8") === adminLevel;
      });
    }

    filtered.sort((a, b) => {
      const propsA = a.properties || {};
      const propsB = b.properties || {};
      let comparison = 0;

      if (sort === "name") {
        comparison = (propsA.name || "").localeCompare(propsB.name || "");
      } else if (sort === "population") {
        comparison = (propsA.population || 0) - (propsB.population || 0);
      } else if (sort === "admin_level") {
        const levelA = parseInt(propsA.admin_level || "8", 10);
        const levelB = parseInt(propsB.admin_level || "8", 10);
        comparison = levelA - levelB;
      }

      return order === "asc" ? comparison : -comparison;
    });

    setFilteredNeighborhoods(filtered);
  }

  useEffect(() => {
    applyFilters(neighborhoods, searchFilter, adminLevelFilter, sortBy, sortOrder);
  }, [searchFilter, adminLevelFilter, sortBy, sortOrder, neighborhoods]);

  function handleEdit(neighborhood) {
    setEditingNeighborhood(neighborhood);
    setFormData({
      name: neighborhood.properties?.name || "",
      population: neighborhood.properties?.population || 0,
      admin_level: neighborhood.properties?.admin_level || "8",
    });
  }

  function handleCancel() {
    setEditingNeighborhood(null);
    setIsAddingNew(false);
    setFormData({
      name: "",
      population: 0,
      admin_level: "8",
      geometry: null,
    });
  }

  function handleAddNew() {
    setIsAddingNew(true);
    setEditingNeighborhood(null);
    setFormData({
      name: "",
      population: 0,
      admin_level: "8",
      geometry: null,
    });
    
    setTimeout(() => {
      if (editFormRef.current) {
        editFormRef.current.scrollIntoView({ behavior: "smooth", block: "start" });
      }
    }, 100);
  }

  async function handleSave() {
    if (isAddingNew) {
      if (!formData.name || !formData.geometry) {
        alert("Please fill in name and paste a valid GeoJSON Polygon geometry");
        return;
      }
      
      try {
        await apiClient.post("/api/feature-layers/neighborhoods/new", {
          name: formData.name,
          population: formData.population,
          admin_level: formData.admin_level,
          geometry: formData.geometry,
          userId: selectedUserId,
        });
        
        await loadNeighborhoods();
        handleCancel();
      } catch (err) {
        console.error("Error creating neighborhood:", err);
        alert(err.response?.data?.error || err.message || "Failed to create neighborhood");
      }
      return;
    }

    if (!editingNeighborhood) return;

    try {
      const neighborhoodId = editingNeighborhood.id || editingNeighborhood.properties?.id;
      await apiClient.patch(`/api/feature-layers/neighborhoods/${encodeURIComponent(neighborhoodId)}`, {
        name: formData.name,
        population: formData.population,
        admin_level: formData.admin_level,
      });
      
      await loadNeighborhoods();
      handleCancel();
    } catch (err) {
      console.error("Error saving neighborhood:", err);
      alert(err.response?.data?.error || err.message || "Failed to save neighborhood");
    }
  }

  async function handleDelete(neighborhoodId) {
    if (!confirm("Are you sure you want to delete this neighborhood?")) return;

    try {
      await apiClient.delete(`/api/feature-layers/neighborhoods/${encodeURIComponent(neighborhoodId)}`);
      await loadNeighborhoods();
    } catch (err) {
      console.error("Error deleting neighborhood:", err);
      alert(err.response?.data?.error || err.message || "Failed to delete neighborhood");
    }
  }

  if (loadingUsers) {
    return (
      <div className="admin-neighborhoods">
        <div style={{ color: "#e2e8f0", fontSize: "18px", padding: "40px", textAlign: "center" }}>
          Loading users...
        </div>
      </div>
    );
  }

  return (
    <div className="admin-neighborhoods">
      <h1>Manage Neighborhoods</h1>

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

      {loading && (
        <div style={{ color: "#e2e8f0", fontSize: "18px", padding: "40px", textAlign: "center" }}>
          Loading neighborhoods...
        </div>
      )}

      {(editingNeighborhood || isAddingNew) && (
        <div className="edit-form" ref={editFormRef}>
          <h2>{isAddingNew ? "Add New Neighborhood" : "Edit Neighborhood"}</h2>
          <div className="form-group">
            <label>Name:</label>
            <input
              type="text"
              value={formData.name}
              onChange={(e) => setFormData({ ...formData, name: e.target.value })}
            />
          </div>
          <div className="form-group">
            <label>Population:</label>
            <input
              type="number"
              min="0"
              value={formData.population}
              onChange={(e) => setFormData({ ...formData, population: parseInt(e.target.value) || 0 })}
            />
          </div>
          <div className="form-group">
            <label>Admin Level:</label>
            <select
              value={formData.admin_level}
              onChange={(e) => setFormData({ ...formData, admin_level: e.target.value })}
            >
              <option value="8">Level 8</option>
              <option value="9">Level 9</option>
              <option value="10">Level 10</option>
            </select>
          </div>
          {isAddingNew && (
            <div className="form-group">
              <label>Geometry (GeoJSON Polygon - required):</label>
              <textarea
                rows="8"
                value={formData.geometry ? JSON.stringify(formData.geometry, null, 2) : ""}
                onChange={(e) => {
                  try {
                    const parsed = JSON.parse(e.target.value);
                    setFormData({ ...formData, geometry: parsed });
                  } catch (err) {
                    setFormData({ ...formData, geometry: null });
                  }
                }}
                placeholder='{"type": "Polygon", "coordinates": [[[lon1, lat1], [lon2, lat2], ...]]}'
              />
              <small style={{ color: "#9fb4d5", fontSize: "12px" }}>
                Paste a valid GeoJSON Polygon geometry
              </small>
            </div>
          )}
          <div className="form-actions">
            <button onClick={handleSave}>{isAddingNew ? "Create" : "Save"}</button>
            <button onClick={handleCancel}>Cancel</button>
          </div>
        </div>
      )}

      {!loading && (
      <div className="neighborhoods-list">
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "20px" }}>
          <h2>Neighborhoods List ({filteredNeighborhoods.length} / {neighborhoods.length})</h2>
          <button 
            onClick={handleAddNew}
            style={{ background: "#10b981", color: "white", padding: "10px 20px", border: "none", borderRadius: "8px", cursor: "pointer", fontWeight: "600" }}
          >
            Add New Neighborhood
          </button>
        </div>
        
        <div className="filters-section">
          <div className="filter-group">
            <label>Search:</label>
            <input
              type="text"
              placeholder="Search by name..."
              value={searchFilter}
              onChange={(e) => setSearchFilter(e.target.value)}
            />
          </div>
          <div className="filter-group">
            <label>Admin Level:</label>
            <select value={adminLevelFilter} onChange={(e) => setAdminLevelFilter(e.target.value)}>
              <option value="all">All</option>
              <option value="8">Level 8</option>
              <option value="9">Level 9</option>
              <option value="10">Level 10</option>
            </select>
          </div>
          <div className="filter-group">
            <label>Sort by:</label>
            <select value={sortBy} onChange={(e) => setSortBy(e.target.value)}>
              <option value="name">Name</option>
              <option value="population">Population</option>
              <option value="admin_level">Admin Level</option>
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

        <div className="neighborhoods-table">
          <table>
            <thead>
              <tr>
                <th>Name</th>
                <th>Population</th>
                <th>Admin Level</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {filteredNeighborhoods.map((neighborhood, index) => {
                const props = neighborhood.properties || {};
                const neighborhoodId = neighborhood.id || props.id || index;
                return (
                  <tr key={neighborhoodId}>
                    <td>{props.name || "Unknown"}</td>
                    <td>{props.population || 0}</td>
                    <td>{props.admin_level || "N/A"}</td>
                    <td>
                      <button onClick={() => handleEdit(neighborhood)}>Edit</button>
                      <button onClick={() => handleDelete(neighborhoodId)}>Delete</button>
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
