import "./Landing.css";

export function Landing({ onNavigateToLogin }) {
  return (
    <div className="landing-container">
      <div className="landing-content">
        <div className="landing-hero">
          <h1 className="landing-title">CityReach</h1>
          <p className="landing-subtitle">
            Plan and analyze public transportation accessibility in cities
          </p>
          <p className="landing-description">
            An intelligent platform for managing public transportation stations and analyzing their coverage in urban neighborhoods. Visualize coverage areas, manage population data, and optimize transportation infrastructure planning.
          </p>
        </div>
        
        <div className="landing-features">
          <div className="feature-card">
            <h3>Interactive Maps</h3>
            <p>Visualize public transportation stations and neighborhoods on detailed maps with interactive features</p>
          </div>
          <div className="feature-card">
            <h3>Coverage Analysis</h3>
            <p>Calculate coverage areas around stations to evaluate public transportation accessibility</p>
          </div>
          <div className="feature-card">
            <h3>Data Management</h3>
            <p>Import and manage data about stations and neighborhood population for detailed analysis</p>
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
