import React, { useEffect, useState } from 'react';
import useNetworkStatus from '../../hooks/useNetworkStatus';

const OfflineNotice = () => {
  const { isOnline, wasOffline, setWasOffline } = useNetworkStatus();
  const [dismissed, setDismissed] = useState(false);

  // Auto-dismiss reconnection banner after 4 seconds
  useEffect(() => {
    if (isOnline && wasOffline) {
      setDismissed(false);
      const timer = setTimeout(() => {
        setWasOffline(false);
      }, 4000);
      return () => clearTimeout(timer);
    }
  }, [isOnline, wasOffline, setWasOffline]);

  // When connection drops, un-dismiss so user sees the offline warning
  useEffect(() => {
    if (!isOnline) {
      setDismissed(false);
    }
  }, [isOnline]);

  // If online and not in recovery mode, or dismissed, render nothing
  if ((isOnline && !wasOffline) || dismissed) {
    return null;
  }

  const isReconnected = isOnline && wasOffline;

  const containerStyle = {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '8px 18px',
    fontSize: '12.5px',
    fontWeight: 500,
    letterSpacing: '0.01em',
    transition: 'all 0.25s ease-in-out',
    backgroundColor: isReconnected ? 'var(--success-light, #ecfdf5)' : 'var(--danger-light, #fef2f2)',
    borderBottom: `1px solid ${isReconnected ? 'var(--success-border, #a7f3d0)' : 'var(--danger-border, #fecaca)'}`,
    color: isReconnected ? 'var(--success-text, #065f46)' : 'var(--danger-text, #991b1b)',
    zIndex: 40,
    width: '100%',
    boxSizing: 'border-box',
  };

  const contentStyle = {
    display: 'flex',
    alignItems: 'center',
    gap: '10px',
    flexWrap: 'wrap',
  };

  const badgeStyle = {
    display: 'inline-flex',
    alignItems: 'center',
    gap: '6px',
    padding: '2px 8px',
    borderRadius: '4px',
    fontSize: '11px',
    fontWeight: 700,
    textTransform: 'uppercase',
    letterSpacing: '0.04em',
    backgroundColor: isReconnected ? 'rgba(16, 185, 129, 0.2)' : 'rgba(239, 68, 68, 0.2)',
    color: isReconnected ? 'var(--success, #10b981)' : 'var(--danger, #ef4444)',
  };

  const dotStyle = {
    width: '6px',
    height: '6px',
    borderRadius: '50%',
    backgroundColor: 'currentColor',
  };

  const closeBtnStyle = {
    background: 'transparent',
    border: 'none',
    color: 'inherit',
    cursor: 'pointer',
    padding: '4px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    opacity: 0.7,
    transition: 'opacity 0.2s',
  };

  return (
    <div
      role="status"
      aria-live="polite"
      className={`offline-notice-bar ${isReconnected ? 'is-online' : 'is-offline'}`}
      style={containerStyle}
    >
      <div style={contentStyle}>
        <span style={badgeStyle}>
          <span style={dotStyle} />
          {isReconnected ? 'Online' : 'Offline'}
        </span>

        {isReconnected ? (
          <span>Connection restored. System is back online.</span>
        ) : (
          <span>
            Connection lost. Working in offline mode — live camera feeds and server sync paused.
          </span>
        )}
      </div>

      <button
        type="button"
        style={closeBtnStyle}
        onClick={() => setDismissed(true)}
        aria-label="Dismiss network notice"
        title="Dismiss notice"
      >
        <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
          <line x1="18" y1="6" x2="6" y2="18" />
          <line x1="6" y1="6" x2="18" y2="18" />
        </svg>
      </button>
    </div>
  );
};

export default OfflineNotice;

