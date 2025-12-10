import { useState } from "react";
import { useAuth } from "../contexts/AuthContext";
import { getFirebaseErrorMessage } from "../utils/firebaseErrors";
import "./Auth.css";

export function Login({ onSwitchToRegister }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const { login } = useAuth();

  async function handleSubmit(e) {
    e.preventDefault();

    try {
      setError("");
      setLoading(true);
      await login(email.trim(), password);
    } catch (err) {
      console.error("Login error:", err);
      const errorMessage = getFirebaseErrorMessage(err);
      setError(errorMessage);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="auth-container">
      <div className="auth-panel">
        <h2>Autentificare</h2>
        {error && <div className="auth-error">{error}</div>}
        <form onSubmit={handleSubmit}>
          <div className="auth-field">
            <label>Email</label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              placeholder="email@example.com"
            />
          </div>
          <div className="auth-field">
            <label>Parolă</label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              placeholder="••••••••"
            />
          </div>
          <button type="submit" disabled={loading} className="auth-button">
            {loading ? "Se autentifică..." : "Autentificare"}
          </button>
        </form>
        <div className="auth-switch">
          Nu ai cont?{" "}
          <button type="button" onClick={onSwitchToRegister} className="auth-link">
            Înregistrează-te
          </button>
        </div>
      </div>
    </div>
  );
}
