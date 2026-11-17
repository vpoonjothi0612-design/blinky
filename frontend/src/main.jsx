import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App.jsx';
import './index.css';
import './responsive.css';
import './dark.css';

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);

// Register Service Worker safely without blocking React startup
function registerServiceWorker() {
  if ('serviceWorker' in navigator) {
    const isSupportedHost = Boolean(
      window.location.hostname === 'localhost' ||
      window.location.hostname === '[::1]' ||
      window.location.hostname.match(/^127\./) ||
      window.location.hostname.match(/^192\.168\./) ||
      window.location.hostname.match(/^10\./) ||
      window.location.protocol === 'https:'
    );

    if (import.meta.env.PROD || isSupportedHost) {
      window.addEventListener('load', () => {
        navigator.serviceWorker
          .register('/sw.js', { scope: '/' })
          .then((registration) => {
            console.log('[PWA] Service Worker registered with scope:', registration.scope);

            // Listen for service worker updates
            registration.onupdatefound = () => {
              const installingWorker = registration.installing;
              if (installingWorker == null) return;

              installingWorker.onstatechange = () => {
                if (installingWorker.state === 'installed') {
                  if (navigator.serviceWorker.controller) {
                    // Update available: content cached for next visit; do not force reload active sessions
                    console.log('[PWA] New version installed and available. It will activate on next visit.');
                  } else {
                    console.log('[PWA] App shell content cached for offline use.');
                  }
                }
              };
            };
          })
          .catch((error) => {
            console.warn('[PWA] Service Worker registration failed (non-fatal):', error);
          });
      });
    }
  }
}

registerServiceWorker();
