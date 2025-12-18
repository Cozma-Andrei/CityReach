import "./Landing.css";

export function Landing({ onNavigateToLogin }) {
  return (
    <div className="landing-container">
      <div className="landing-content">
        <div className="landing-hero">
          <h1 className="landing-title">CityReach</h1>
          <p className="landing-subtitle">
            Planifică și analizează accesibilitatea transportului public în orașe
          </p>
          <p className="landing-description">
            Platformă inteligentă pentru gestionarea stațiilor de transport public și analiza acoperirii acestora în cartierele urbane. Vizualizează zonele de acoperire, gestionează date despre populație și optimizează planificarea infrastructurii de transport.
          </p>
        </div>
        
        <div className="landing-features">
          <div className="feature-card">
            <h3>Hărți interactive</h3>
            <p>Vizualizează stațiile de transport public și cartierele pe hărți detaliate cu funcții interactive</p>
          </div>
          <div className="feature-card">
            <h3>Analiză de acoperire</h3>
            <p>Calculează zonele de acoperire în jurul stațiilor pentru a evalua accesibilitatea transportului public</p>
          </div>
          <div className="feature-card">
            <h3>Gestionare date</h3>
            <p>Importă și gestionează date despre stații și populația cartierelor pentru analize detaliate</p>
          </div>
        </div>
        
        <div className="landing-actions">
          <button className="landing-button primary" onClick={onNavigateToLogin}>
            Get Started
          </button>
        </div>
      </div>
    </div>
  );
}
