import { useState, useEffect } from "react";
import { Routes, Route } from "react-router-dom";
import "./App.css";
import { useAuth } from "./contexts/AuthContext";
import { Login } from "./components/Login";
import { Register } from "./components/Register";
import { Landing } from "./components/Landing";
import { MapView } from "./components/MapView";
import { AdminLayout } from "./components/admin/AdminLayout";
import { AdminDashboard } from "./components/admin/AdminDashboard";
import { AdminStations } from "./components/admin/AdminStations";
import { AdminNeighborhoods } from "./components/admin/AdminNeighborhoods";

function App() {
  const { currentUser } = useAuth();
  const [showLanding, setShowLanding] = useState(true);
  const [authMode, setAuthMode] = useState("login");

  useEffect(() => {
    if (currentUser) {
      setShowLanding(false);
    }
  }, [currentUser]);

  return (
    <Routes>
      <Route
        path="/"
        element={
          !currentUser ? (
            showLanding ? (
              <Landing onNavigateToLogin={() => setShowLanding(false)} />
            ) : (
              <>
                {authMode === "login" ? (
                  <Login onSwitchToRegister={() => setAuthMode("register")} />
                ) : (
                  <Register onSwitchToLogin={() => setAuthMode("login")} />
                )}
              </>
            )
          ) : (
            <MapView />
          )
        }
      />
      <Route path="/admin" element={<AdminLayout />}>
        <Route index element={<AdminDashboard />} />
        <Route path="stations" element={<AdminStations />} />
        <Route path="neighborhoods" element={<AdminNeighborhoods />} />
      </Route>
    </Routes>
  );
}

export default App;
