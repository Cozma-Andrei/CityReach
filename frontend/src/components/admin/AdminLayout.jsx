import { Navigate, Outlet, Link, useLocation } from "react-router-dom";
import { useAuth } from "../../contexts/AuthContext";
import "./AdminLayout.css";

export function AdminLayout() {
  const { currentUser, userRole } = useAuth();
  const location = useLocation();

  if (!currentUser) {
    return <Navigate to="/" replace />;
  }

  if (userRole !== "admin") {
    return (
      <div className="admin-forbidden">
        <h1>Access Denied</h1>
        <p>You need admin privileges to access this page.</p>
        <Link to="/">Go to Home</Link>
      </div>
    );
  }

  return (
    <div className="admin-layout">
      <nav className="admin-nav">
        <h2>Admin Panel</h2>
        <div className="admin-nav-links">
          <Link to="/admin" className={location.pathname === "/admin" ? "active" : ""}>
            Dashboard
          </Link>
          <Link to="/admin/stations" className={location.pathname === "/admin/stations" ? "active" : ""}>
            Stations
          </Link>
          <Link to="/admin/neighborhoods" className={location.pathname === "/admin/neighborhoods" ? "active" : ""}>
            Neighborhoods
          </Link>
          <Link to="/" className="back-link">
            Back to Map
          </Link>
        </div>
      </nav>
      <main className="admin-content">
        <Outlet />
      </main>
    </div>
  );
}
