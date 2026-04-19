import React, { useState } from 'react';
import { Mic, Zap, Headphones, Film, BookOpen, User, Users, Lock } from 'lucide-react';

const DIRECTOR_PASSWORD = 'vocal2026'; // Password predefinita per il direttore

const LandingPage = ({ onLaunch }) => {
  const [showPasswordModal, setShowPasswordModal] = useState(false);
  const [password, setPassword] = useState('');
  const [passwordError, setPasswordError] = useState(false);

  const handleDirectorClick = () => {
    setShowPasswordModal(true);
    setPassword('');
    setPasswordError(false);
  };

  const handlePasswordSubmit = (e) => {
    e.preventDefault();
    if (password === DIRECTOR_PASSWORD) {
      setShowPasswordModal(false);
      onLaunch('host');
    } else {
      setPasswordError(true);
    }
  };

  const handleCloseModal = () => {
    setShowPasswordModal(false);
    setPassword('');
    setPasswordError(false);
  };

  return (
    <div className="landing-container">
      {/* Password Modal */}
      {showPasswordModal && (
        <div className="modal-overlay" onClick={handleCloseModal}>
          <div className="password-modal" onClick={e => e.stopPropagation()}>
            <div className="password-modal-header">
              <Lock size={24} />
              <h2>Accesso Direttore</h2>
            </div>
            <p className="password-modal-desc">Inserisci la password per accedere alla sala di controllo</p>
            <form onSubmit={handlePasswordSubmit}>
              <input
                type="password"
                value={password}
                onChange={(e) => {
                  setPassword(e.target.value);
                  setPasswordError(false);
                }}
                placeholder="Password..."
                className={passwordError ? 'error' : ''}
                autoFocus
              />
              {passwordError && (
                <span className="password-error">Password errata</span>
              )}
              <div className="password-modal-actions">
                <button type="button" className="btn-secondary" onClick={handleCloseModal}>
                  Annulla
                </button>
                <button type="submit" className="btn-primary">
                  Accedi
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Hero Section */}
      <section className="hero">
        <div className="hero-overlay"></div>
        <div className="hero-content">
          <div className="brand-badge">PROFESSIONAL REMOTE ADR</div>
          <h1 className="hero-title">
            VOCALSYNC <span className="text-accent">REMOTE ADR STUDIO</span>
          </h1>
          <p className="hero-subtitle">
            Connect your dubbing director directly to the recording booth — anywhere in the world.
            Real-time talkback, high-fidelity capture, and frame-perfect ADR synchronization.
          </p>
          
          {/* Role Selection */}
          <div className="role-selection">
            <p className="role-selection-title">SELECT YOUR ROLE TO ENTER</p>
            <div className="role-cards">
              <button 
                className="role-card"
                onClick={handleDirectorClick}
              >
                <Users size={32} />
                <span className="role-card-title">DIRETTORE</span>
                <span className="role-card-desc">Control room & recording</span>
              </button>
              <button 
                className="role-card"
                onClick={() => onLaunch('guest')}
              >
                <User size={32} />
                <span className="role-card-title">ATTORE / DOPPIATORE</span>
                <span className="role-card-desc">Remote dubbing booth</span>
              </button>
            </div>
          </div>

          <div className="hero-actions">
            <button className="btn-secondary">
              <BookOpen size={20} /> DOCUMENTATION
            </button>
          </div>
        </div>
      </section>

      {/* Features Grid */}
      <section className="features">
        <div className="feature-card">
          <Zap className="feature-icon" />
          <h3>P2P Low-Latency Connection</h3>
          <p>Powered by PeerJS for near-instant peer-to-peer communication between director and voice actor — no server delay.</p>
        </div>
        <div className="feature-card">
          <Mic className="feature-icon" />
          <h3>Hi-Fi Recording</h3>
          <p>Studio-grade capture at 48 kHz / 24-bit WAV. Every take lands broadcast-ready on the director's timeline.</p>
        </div>
        <div className="feature-card">
          <Headphones className="feature-icon" />
          <h3>Real-Time Talkback</h3>
          <p>The director speaks directly into the actor's headphones with zero-latency talkback — just like being in the same room.</p>
        </div>
        <div className="feature-card">
          <Film className="feature-icon" />
          <h3>ADR Cue List & Video Sync</h3>
          <p>Frame-accurate cue markers on the integrated timeline, with subtitle overlays and timecode locked to the picture.</p>
        </div>
      </section>

      <footer className="landing-footer">
        <div className="footer-logo">VOCALSYNC 5.0</div>
        <div className="footer-links">
          <span>PRIVACY</span>
          <span>TERMS</span>
          <span>DOCUMENTATION</span>
        </div>
        <div className="footer-copy">© 2026 FIORAVANTE CAPACCIO — ALL RIGHTS RESERVED</div>
      </footer>
    </div>
  );
};

export default LandingPage;
