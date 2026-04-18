import React from 'react';
import { Play, Mic, Shield, Zap, Globe, Activity } from 'lucide-react';

const LandingPage = ({ onLaunch }) => {
  return (
    <div className="landing-container">
      {/* Hero Section */}
      <section className="hero">
        <div className="hero-overlay"></div>
        <div className="hero-content">
          <div className="brand-badge">PRO CYCLING COMMENTARY</div>
          <h1 className="hero-title">
            VOCALSYNC <span className="text-accent">x</span> BREIZH-VÉLO
          </h1>
          <p className="hero-subtitle">
            The world's most advanced remote ADR station for professional cycling broadcasting. 
            Real-time synchronization, high-fidelity audio, and instant Breton terrain matching.
          </p>
          <div className="hero-actions">
            <button className="btn-primary" onClick={onLaunch}>
              <Play size={20} fill="currentColor" /> ENTER ADR STATION
            </button>
            <button className="btn-secondary">
              <Activity size={20} /> VIEW SOURCE
            </button>
          </div>
        </div>
      </section>

      {/* Features Grid */}
      <section className="features">
        <div className="feature-card">
          <Zap className="feature-icon" />
          <h3>Ultra-Low Latency</h3>
          <p>Powered by PeerJS for near-instant remote communication between Director and Speaker.</p>
        </div>
        <div className="feature-card">
          <Mic className="feature-icon" />
          <h3>Hi-Fi ADR Scripting</h3>
          <p>Precision pin-point markers and subtitle overlays for frame-perfect commentary.</p>
        </div>
        <div className="feature-card">
          <Shield className="feature-icon" />
          <h3>State-Shield™</h3>
          <p>Robust connection persistence that survives UI resizing and complex layout changes.</p>
        </div>
        <div className="feature-card">
          <Globe className="feature-icon" />
          <h3>Breizh Optimized</h3>
          <p>Tailored acoustics for the rugged landscapes and unique broadcasting needs of Brittany.</p>
        </div>
      </section>

      <footer className="landing-footer">
        <div className="footer-logo">VOCALSYNC 5.0</div>
        <div className="footer-links">
          <span>PRIVACY</span>
          <span>TERMS</span>
          <span>DOCUMENTATION</span>
        </div>
        <div className="footer-copy">© 2026 FIORAVANTE CAPACCIO — BREIZH-VÉLO BROADCASTING SYSTEMS</div>
      </footer>
    </div>
  );
};

export default LandingPage;
