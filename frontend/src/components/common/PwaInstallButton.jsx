import React, { useState, useEffect } from 'react';
import usePwaInstall from '../../hooks/usePwaInstall';
import Modal from './Modal';
import Button from './Button';
import installOrbIcon from '../../assets/pwa-install-icon.jpg';

const PwaInstallButton = ({ variant = 'icon' }) => {
  const {
    isInstalled,
    isIOS,
    showIosGuide,
    setShowIosGuide,
    showDesktopGuide,
    setShowDesktopGuide,
    installApp,
  } = usePwaInstall();

  // Mobile / Idle teaser auto-flip: Every 7.5 seconds, flip for 2.4 seconds to show "Install App"
  const [isAutoFlipped, setIsAutoFlipped] = useState(false);

  useEffect(() => {
    if (isInstalled || variant !== 'floating') return;

    const interval = setInterval(() => {
      setIsAutoFlipped(true);
      const timer = setTimeout(() => {
        setIsAutoFlipped(false);
      }, 2400);
      return () => clearTimeout(timer);
    }, 7500);

    return () => clearInterval(interval);
  }, [isInstalled, variant]);

  // Once the application is installed, remove the install button completely
  if (isInstalled) {
    return null;
  }

  const iosModal = isIOS && (
    <Modal
      isOpen={showIosGuide}
      title="Install FaceDetect on iOS"
      onClose={() => setShowIosGuide(false)}
      footer={
        <Button variant="primary" onClick={() => setShowIosGuide(false)}>
          Got it
        </Button>
      }
    >
      <div style={{ fontSize: '13.5px', lineHeight: '1.6', color: 'var(--text-primary)' }}>
        <p style={{ marginTop: 0, marginBottom: '14px', color: 'var(--text-secondary)' }}>
          Follow these simple steps in Safari to add FaceDetect to your Home Screen:
        </p>

        <ol style={{ paddingLeft: '20px', margin: 0, display: 'flex', flexDirection: 'column', gap: '12px' }}>
          <li>
            Tap the <strong>Share</strong> button{' '}
            <span
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                padding: '2px 6px',
                borderRadius: '4px',
                backgroundColor: 'var(--surface-2, #f3f4f6)',
                border: '1px solid var(--border)',
                verticalAlign: 'middle',
              }}
            >
              <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8" />
                <polyline points="16 6 12 2 8 6" />
                <line x1="12" y1="2" x2="12" y2="15" />
              </svg>
            </span>{' '}
            in Safari's toolbar.
          </li>
          <li>
            Scroll down and select <strong>"Add to Home Screen"</strong>{' '}
            <span
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                padding: '2px 6px',
                borderRadius: '4px',
                backgroundColor: 'var(--surface-2, #f3f4f6)',
                border: '1px solid var(--border)',
                verticalAlign: 'middle',
              }}
            >
              <svg viewBox="0 0 24 24" width="18" height="18" rx="2" ry="2" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
                <line x1="12" y1="8" x2="12" y2="16" />
                <line x1="8" y1="12" x2="16" y2="12" />
              </svg>
            </span>.
          </li>
          <li>
            Tap <strong>Add</strong> in the top-right corner to finish installation.
          </li>
        </ol>
      </div>
    </Modal>
  );

  const desktopModal = (
    <Modal
      isOpen={showDesktopGuide}
      title="Install FaceDetect"
      onClose={() => setShowDesktopGuide(false)}
      footer={
        <Button variant="primary" onClick={() => setShowDesktopGuide(false)}>
          Got it
        </Button>
      }
    >
      <div style={{ fontSize: '13.5px', lineHeight: '1.6', color: 'var(--text-primary)' }}>
        <p style={{ marginTop: 0, marginBottom: '12px' }}>
          To install FaceDetect on your device:
        </p>
        <ol style={{ paddingLeft: '20px', margin: 0, display: 'flex', flexDirection: 'column', gap: '10px' }}>
          <li>
            Look at your browser's address bar at the top-right.
          </li>
          <li>
            Click the <strong>Install</strong> or <strong>Open in app</strong> icon{' '}
            <span
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                padding: '2px 8px',
                borderRadius: '4px',
                backgroundColor: 'var(--surface-2, #f3f4f6)',
                border: '1px solid var(--border)',
                fontSize: '12px',
                fontWeight: 600,
              }}
            >
              [ 💻 Open in app ]
            </span>.
          </li>
          <li>
            Once installed, FaceDetect runs as an independent desktop or mobile application.
          </li>
        </ol>
      </div>
    </Modal>
  );

  // Attractive 3D Flip Floating Action Button (Used on Auth Pages & MainLayout)
  if (variant === 'floating') {
    return (
      <>
        <div
          className={`pwa-flip-btn-container ${isAutoFlipped ? 'is-flipped' : ''}`}
          onClick={installApp}
          title="Install FaceDetect as Native Application"
          role="button"
          tabIndex={0}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              installApp();
            }
          }}
          aria-label="Install FaceDetect App"
        >
          <div className="pwa-flip-card">
            {/* FRONT FACE: Glowing Neon Cyber Install Orb */}
            <div className="pwa-flip-face pwa-flip-front">
              <img
                src={installOrbIcon}
                alt="Install FaceDetect App"
                className="pwa-flip-orb-img"
                draggable={false}
              />
            </div>

            {/* BACK FACE: Revealed on Hover/Flip with 'Install App' */}
            <div className="pwa-flip-face pwa-flip-back">
              <div className="pwa-flip-back-orb-badge">
                <img
                  src={installOrbIcon}
                  alt=""
                  className="pwa-flip-back-mini-orb"
                  draggable={false}
                />
              </div>
              <span className="pwa-flip-install-label">Install App</span>
            </div>
          </div>
        </div>
        {iosModal}
        {desktopModal}
      </>
    );
  }

  // Default: 'icon' (Used in Header topbar actions group)
  return (
    <>
      <button
        type="button"
        className="topbar-action-btn pwa-install-topbar-btn"
        title="Install FaceDetect App"
        aria-label="Install FaceDetect App"
        onClick={installApp}
        style={{
          cursor: 'pointer',
          padding: '2px',
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: 'none',
          border: 'none',
        }}
      >
        <img
          src={installOrbIcon}
          alt="Install App"
          style={{
            width: '26px',
            height: '26px',
            borderRadius: '50%',
            filter: 'drop-shadow(0 0 6px rgba(0, 245, 212, 0.75))',
            transition: 'transform 0.2s ease, filter 0.2s ease',
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.transform = 'scale(1.12)';
            e.currentTarget.style.filter = 'drop-shadow(0 0 10px rgba(0, 245, 212, 1))';
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.transform = 'scale(1)';
            e.currentTarget.style.filter = 'drop-shadow(0 0 6px rgba(0, 245, 212, 0.75))';
          }}
        />
      </button>
      {iosModal}
      {desktopModal}
    </>
  );
};

export default PwaInstallButton;
