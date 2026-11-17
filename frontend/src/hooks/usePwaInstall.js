import { useState, useEffect, useCallback } from 'react';

/**
 * Detects if the current window is running in standalone PWA mode.
 */
const checkIsStandalone = () => {
  if (typeof window === 'undefined') return false;
  return Boolean(
    window.matchMedia('(display-mode: standalone)').matches ||
    window.matchMedia('(display-mode: fullscreen)').matches ||
    window.matchMedia('(display-mode: minimal-ui)').matches ||
    window.navigator.standalone === true ||
    (typeof document !== 'undefined' && document.referrer.includes('android-app://'))
  );
};

/**
 * Detects if the client is on an iOS device (iPhone, iPad, iPod).
 */
const checkIsIOS = () => {
  if (typeof window === 'undefined' || typeof navigator === 'undefined') return false;
  const ua = navigator.userAgent.toLowerCase();
  return (
    /iphone|ipad|ipod/.test(ua) ||
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
  );
};

/**
 * Custom React hook for PWA installation management.
 * Tracks installation status, handles beforeinstallprompt and appinstalled events,
 * detects standalone mode, and manages the disabled/enabled button states.
 */
export const usePwaInstall = () => {
  const [deferredPrompt, setDeferredPrompt] = useState(null);
  const [isStandalone, setIsStandalone] = useState(checkIsStandalone);
  const [isInstalled, setIsInstalled] = useState(() => {
    if (checkIsStandalone()) return true;
    if (typeof window !== 'undefined' && window.localStorage) {
      return window.localStorage.getItem('pwa_installed') === 'true';
    }
    return false;
  });
  const [isIOS] = useState(checkIsIOS);
  const [showIosGuide, setShowIosGuide] = useState(false);
  const [showDesktopGuide, setShowDesktopGuide] = useState(false);

  useEffect(() => {
    // 1. If running in standalone window, it is definitely installed
    if (checkIsStandalone()) {
      setIsStandalone(true);
      setIsInstalled(true);
      try {
        localStorage.setItem('pwa_installed', 'true');
      } catch {}
      return;
    }

    // 2. Query getInstalledRelatedApps if supported by Chromium
    if (typeof navigator !== 'undefined' && 'getInstalledRelatedApps' in navigator) {
      navigator
        .getInstalledRelatedApps()
        .then((relatedApps) => {
          if (Array.isArray(relatedApps) && relatedApps.length > 0) {
            setIsInstalled(true);
            try {
              localStorage.setItem('pwa_installed', 'true');
            } catch {}
          }
        })
        .catch(() => {});
    }

    // 3. Capture beforeinstallprompt event (Chromium)
    const handleBeforeInstallPrompt = (e) => {
      e.preventDefault();
      setDeferredPrompt(e);
      // When beforeinstallprompt fires, the app is not currently installed in this browser
      setIsInstalled(false);
      try {
        localStorage.removeItem('pwa_installed');
      } catch {}
    };

    // 4. Capture appinstalled event
    const handleAppInstalled = () => {
      setIsInstalled(true);
      setDeferredPrompt(null);
      try {
        localStorage.setItem('pwa_installed', 'true');
      } catch {}
      console.log('[PWA] Application successfully installed.');
    };

    // 5. Listen for display-mode media query changes
    const mediaQuery = window.matchMedia('(display-mode: standalone)');
    const handleDisplayModeChange = (e) => {
      if (e.matches) {
        setIsStandalone(true);
        setIsInstalled(true);
        try {
          localStorage.setItem('pwa_installed', 'true');
        } catch {}
      }
    };

    window.addEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
    window.addEventListener('appinstalled', handleAppInstalled);
    if (mediaQuery.addEventListener) {
      mediaQuery.addEventListener('change', handleDisplayModeChange);
    }

    return () => {
      window.removeEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
      window.removeEventListener('appinstalled', handleAppInstalled);
      if (mediaQuery.removeEventListener) {
        mediaQuery.removeEventListener('change', handleDisplayModeChange);
      }
    };
  }, []);

  const installApp = useCallback(async () => {
    // Already installed -> do nothing
    if (isInstalled || isStandalone) {
      return;
    }

    // iOS Safari
    if (isIOS) {
      setShowIosGuide(true);
      return;
    }

    // Chromium with deferredPrompt ready
    if (deferredPrompt) {
      try {
        await deferredPrompt.prompt();
        const choice = await deferredPrompt.userChoice;
        if (choice && choice.outcome === 'accepted') {
          setIsInstalled(true);
          setDeferredPrompt(null);
          try {
            localStorage.setItem('pwa_installed', 'true');
          } catch {}
        }
      } catch (err) {
        console.warn('[PWA] Prompt error:', err);
      }
      return;
    }

    // Desktop/Browser where prompt isn't fired yet
    setShowDesktopGuide(true);
  }, [deferredPrompt, isIOS, isInstalled, isStandalone]);

  return {
    isInstalled: isInstalled || isStandalone,
    isStandalone,
    isIOS,
    showIosGuide,
    setShowIosGuide,
    showDesktopGuide,
    setShowDesktopGuide,
    installApp,
    deferredPrompt,
  };
};

export default usePwaInstall;
