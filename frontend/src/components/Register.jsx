import { useState } from "react";
import { useAuth } from "../contexts/AuthContext";
import { getFirebaseErrorMessage } from "../utils/firebaseErrors";
import "./Auth.css";

export function Register({ onSwitchToLogin }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const { signup } = useAuth();

  async function handleSubmit(e) {
    e.preventDefault();

    if (password !== confirmPassword) {
      return setError("Parolele nu coincid");
    }

    if (password.length < 6) {
      return setError("Parola trebuie să aibă cel puțin 6 caractere");
    }

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      return setError("Adresa de email nu este validă");
    }

    try {
      setError("");
      setLoading(true);
      await signup(email.trim(), password);
    } catch (err) {
      console.error("Registration error:", err);
      const errorMessage = getFirebaseErrorMessage(err);
      setError(errorMessage);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="auth-container">
      <div className="auth-panel">
        <h2>Înregistrare</h2>
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
              minLength={6}
            />
          </div>
          <div className="auth-field">
            <label>Confirmă parola</label>
            <input
              type="password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              required
              placeholder="••••••••"
              minLength={6}
            />
          </div>
          <button type="submit" disabled={loading} className="auth-button">
            {loading ? "Se înregistrează..." : "Înregistrare"}
          </button>
        </form>
        <div className="auth-switch">
          Ai deja cont?{" "}
          <button type="button" onClick={onSwitchToLogin} className="auth-link">
            Autentifică-te
          </button>
        </div>
      </div>
    </div>
  );
}
