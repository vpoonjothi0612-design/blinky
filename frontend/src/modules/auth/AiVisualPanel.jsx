import React from 'react';
import aiFaceImage from '../../assets/ai_face_biometric.jpg';

const AiVisualPanel = ({ mode = 'login' }) => {
  const isRegister = mode === 'register';

  return (
    <div className="ai-panel-wrapper ai-panel-face-only">
      <div className="ai-panel-grid" />

      {/* Top Telemetry Header */}
      <div className="ai-telemetry-header">
        <div className="ai-live-badge">
          <span className="ai-live-dot" />
          <span>{isRegister ? 'ENROLLMENT SCAN' : 'LIVE BIOMETRICS'}</span>
        </div>
        <div className="ai-sys-specs">
          <div className="ai-sys-item">
            <span>MODE:</span>
            <strong>{isRegister ? 'ENROLLMENT' : 'FACE SCANNER'}</strong>
          </div>
          <div className="ai-sys-item">
            <span>FPS:</span>
            <strong>60</strong>
          </div>
          <div className="ai-sys-item">
            <span>STATUS:</span>
            <strong className="status-highlight">{isRegister ? 'ENROLLING' : 'ACTIVE'}</strong>
          </div>
        </div>
      </div>

      {/* Hero Biometric Face Scan Stage (Prominent & Centered) */}
      <div className="ai-scan-stage ai-scan-stage-hero">
        <div className="ai-scan-hologram-container">
          {/* Ambient Multi-Layer Radial Glow */}
          <div className="ai-scan-glow-backdrop" />
          <div className="ai-scan-glow-pulse" />

          {/* Biometric Hologram Face */}
          <img
            src={aiFaceImage}
            alt="Face Recognition Biometric Scan"
            className="ai-scan-face-image"
          />

          {/* Double Orbital Radar Rings */}
          <div className="ai-radar-ring" />
          <div className="ai-radar-ring-inner" />

          {/* HUD Bounding Reticle Frame */}
          <div className="ai-hud-frame">
            <span className="ai-hud-corner top-left" />
            <span className="ai-hud-corner top-right" />
            <span className="ai-hud-corner bottom-left" />
            <span className="ai-hud-corner bottom-right" />
          </div>

          {/* Sweeping Laser Scan Beam */}
          <div className="ai-scan-laser-beam" />

          {/* Biometric Landmark Tags */}
          <div className="ai-hud-tag tag-top-right">
            <span className="ai-hud-tag-node" />
            <span>{isRegister ? 'BIOMETRIC PROFILE' : 'MATCH ACCURACY: 99.8%'}</span>
          </div>

          <div className="ai-hud-tag tag-bottom-left">
            <span className="ai-hud-tag-node" />
            <span>{isRegister ? 'ANTI-SPOOF: PASSED' : 'ENCRYPTION: AES-256'}</span>
          </div>

          <div className="ai-hud-tag tag-mid-left">
            <span className="ai-hud-tag-node-cyan" />
            <span>LIVENESS: VERIFIED</span>
          </div>
        </div>
      </div>

      {/* Minimalist Bottom HUD Telemetry Footer (No heavy card, pure biometric feed) */}
      <div className="ai-minimal-footer">
        <div className="ai-footer-track">
          <span className="ai-footer-dot" />
          <span className="ai-footer-text">
            SYS // REAL-TIME BIOMETRIC ENGINE • LATENCY: 12ms • ZERO-TRUST VERIFIED
          </span>
        </div>
      </div>
    </div>
  );
};

export default AiVisualPanel;
