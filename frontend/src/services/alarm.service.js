/**
 * alarm.service.js
 * Multi-channel Security Alarm System for Face Detection System.
 * Optimized for Mobile Devices & Installed Progressive Web Apps (PWA).
 * Handles:
 *  1. Dual-tone Synthesized Security Siren (Web Audio API)
 *  2. Hardware Device Vibration on Mobile Phones & Installed Apps (Vibration API)
 *  3. ServiceWorker Notification Vibration for Installed PWA on Android
 *  4. System Native Push Notifications
 *  5. Global Window Event Dispatching for React UI Banners
 *  6. AudioContext & Notification Permission User Gesture Auto-Unlock
 */

let sharedAudioCtx = null;
let activeOscillators = [];
let activeGainNodes = [];
let activeVibrationTimer = null;

/**
 * Detects if the web app is running in installed PWA standalone mode.
 */
export const isAppInstalled = () => {
  if (typeof window === 'undefined') return false;
  return Boolean(
    window.matchMedia('(display-mode: standalone)').matches ||
    window.matchMedia('(display-mode: fullscreen)').matches ||
    window.navigator.standalone === true ||
    (typeof document !== 'undefined' && document.referrer.includes('android-app://')) ||
    localStorage.getItem('pwa_installed') === 'true'
  );
};

/**
 * Detects if the current client is a mobile device / smartphone.
 */
export const isMobileDevice = () => {
  if (typeof window === 'undefined' || typeof navigator === 'undefined') return false;
  const ua = navigator.userAgent || '';
  return Boolean(
    /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(ua) ||
    ('maxTouchPoints' in navigator && navigator.maxTouchPoints > 0)
  );
};

/**
 * Ensures AudioContext is created and unlocked after the first user gesture,
 * and requests native notification permission for mobile vibration alerts.
 */
export const initAudioUnlock = () => {
  if (typeof window === 'undefined') return;

  const unlock = () => {
    try {
      if (!sharedAudioCtx) {
        sharedAudioCtx = new (window.AudioContext || window.webkitAudioContext)();
      }
      if (sharedAudioCtx && sharedAudioCtx.state === 'suspended') {
        sharedAudioCtx.resume();
      }
    } catch (e) {
      // Handled silently
    }

    // Proactively request notification permission on first interaction so mobile alerts & vibration are ready
    try {
      if ('Notification' in window && Notification.permission === 'default') {
        Notification.requestPermission().catch(() => {});
      }
    } catch (e) {}

    window.removeEventListener('click', unlock);
    window.removeEventListener('touchstart', unlock);
    window.removeEventListener('keydown', unlock);
  };

  window.addEventListener('click', unlock, { passive: true });
  window.addEventListener('touchstart', unlock, { passive: true });
  window.addEventListener('keydown', unlock, { passive: true });
};

// Initialize unlock listener immediately
initAudioUnlock();

/**
 * Sound preferences
 */
export const isAlarmSoundEnabled = () => {
  try {
    return localStorage.getItem('face_alarm_sound_enabled') !== 'false';
  } catch {
    return true;
  }
};

export const setAlarmSoundEnabled = (enabled) => {
  try {
    localStorage.setItem('face_alarm_sound_enabled', enabled ? 'true' : 'false');
    window.dispatchEvent(new CustomEvent('face-alarm-settings-changed', { detail: { sound: enabled } }));
  } catch (e) {
    console.warn('Failed to save alarm preference', e);
  }
};

export const isAlarmVibrateEnabled = () => {
  try {
    return localStorage.getItem('face_alarm_vibrate_enabled') !== 'false';
  } catch {
    return true;
  }
};

export const setAlarmVibrateEnabled = (enabled) => {
  try {
    localStorage.setItem('face_alarm_vibrate_enabled', enabled ? 'true' : 'false');
    window.dispatchEvent(new CustomEvent('face-alarm-settings-changed', { detail: { vibrate: enabled } }));
  } catch (e) {
    console.warn('Failed to save vibrate preference', e);
  }
};

/**
 * One-touch permission grant for Mobile Vibration and Audio Siren.
 * Must be invoked from a user gesture (e.g. click/tap) to ensure
 * browsers grant notification and vibration permissions without intervention blocks.
 */
export const requestAlarmPermissions = async () => {
  let notifGranted = false;
  if (typeof window !== 'undefined' && 'Notification' in window) {
    try {
      const perm = await Notification.requestPermission();
      notifGranted = perm === 'granted';
    } catch (e) {
      console.warn('[AlarmService] Notification request error:', e);
    }
  }

  // Unlock / Resume AudioContext with user gesture
  try {
    if (!sharedAudioCtx) {
      sharedAudioCtx = new (window.AudioContext || window.webkitAudioContext)();
    }
    if (sharedAudioCtx && sharedAudioCtx.state === 'suspended') {
      await sharedAudioCtx.resume();
    }
  } catch (e) {
    console.warn('[AlarmService] AudioContext resume error:', e);
  }

  // Trigger tactile test vibration pulse (300ms buzz, 100ms pause, 400ms buzz)
  let vibSuccess = false;
  if (typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function') {
    try {
      vibSuccess = navigator.vibrate([300, 100, 400]);
    } catch (e) {
      console.warn('[AlarmService] Vibration trigger error:', e);
    }
  }

  setAlarmSoundEnabled(true);
  setAlarmVibrateEnabled(true);

  return {
    notifGranted,
    vibSuccess,
    audioReady: Boolean(sharedAudioCtx && sharedAudioCtx.state === 'running'),
  };
};

/**
 * Queries current vibration and notification permission state.
 */
export const getAlarmAccessStatus = () => {
  const hasNotif = typeof window !== 'undefined' && 'Notification' in window;
  const notifState = hasNotif ? Notification.permission : 'unsupported';
  const hasVibrate = typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function';
  const soundOn = isAlarmSoundEnabled();
  const vibrateOn = isAlarmVibrateEnabled();

  return {
    hasNotif,
    notifState, // 'granted' | 'denied' | 'default' | 'unsupported'
    hasVibrate,
    soundOn,
    vibrateOn,
    isFullyGranted: notifState === 'granted' && soundOn && vibrateOn,
  };
};

/**
 * Stops device physical vibration immediately.
 */
export const stopMobileVibration = () => {
  if (activeVibrationTimer) {
    clearInterval(activeVibrationTimer);
    activeVibrationTimer = null;
  }
  if (typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function') {
    try {
      navigator.vibrate(0);
    } catch (e) {}
  }
};

/**
 * Stops any currently sounding alarm sirens and physical vibrations.
 */
export const stopSecurityAlarmSiren = () => {
  try {
    activeOscillators.forEach((osc) => {
      try {
        osc.stop();
        osc.disconnect();
      } catch (e) {}
    });
    activeGainNodes.forEach((gain) => {
      try {
        gain.disconnect();
      } catch (e) {}
    });
  } catch (e) {}
  activeOscillators = [];
  activeGainNodes = [];

  // Stop device vibration
  stopMobileVibration();
};

/**
 * Plays a loud, distinctive dual-tone security alarm siren.
 * Sweeps between 720 Hz and 1180 Hz with rich undertones.
 */
export const playSecurityAlarmSiren = (durationSeconds = 2.4) => {
  if (!isAlarmSoundEnabled()) return null;

  try {
    if (!sharedAudioCtx) {
      sharedAudioCtx = new (window.AudioContext || window.webkitAudioContext)();
    }
    if (sharedAudioCtx.state === 'suspended') {
      sharedAudioCtx.resume();
    }

    const ctx = sharedAudioCtx;
    const now = ctx.currentTime;

    // Stop any existing sirens first
    stopSecurityAlarmSiren();

    // Create Main Siren Oscillator
    const osc = ctx.createOscillator();
    const gainNode = ctx.createGain();

    // Dual-tone frequency sweep: 720 Hz -> 1150 Hz -> 750 Hz -> 1180 Hz -> 720 Hz
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(720, now);
    osc.frequency.exponentialRampToValueAtTime(1120, now + 0.35);
    osc.frequency.exponentialRampToValueAtTime(740, now + 0.7);
    osc.frequency.exponentialRampToValueAtTime(1180, now + 1.1);
    osc.frequency.exponentialRampToValueAtTime(760, now + 1.5);
    osc.frequency.exponentialRampToValueAtTime(1150, now + 1.9);
    osc.frequency.exponentialRampToValueAtTime(720, now + durationSeconds);

    // Low-pass filter to prevent digital harshness
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(2200, now);

    // Volume Envelope
    gainNode.gain.setValueAtTime(0.01, now);
    gainNode.gain.linearRampToValueAtTime(0.35, now + 0.08);
    gainNode.gain.setValueAtTime(0.35, now + durationSeconds - 0.2);
    gainNode.gain.linearRampToValueAtTime(0.001, now + durationSeconds);

    // Secondary sub-oscillator for punchy industrial alarm undertone (360 Hz -> 580 Hz)
    const subOsc = ctx.createOscillator();
    const subGain = ctx.createGain();
    subOsc.type = 'sine';
    subOsc.frequency.setValueAtTime(360, now);
    subOsc.frequency.exponentialRampToValueAtTime(560, now + 0.35);
    subOsc.frequency.exponentialRampToValueAtTime(370, now + 0.7);
    subOsc.frequency.exponentialRampToValueAtTime(580, now + 1.1);
    subOsc.frequency.exponentialRampToValueAtTime(360, now + durationSeconds);
    subGain.gain.setValueAtTime(0.18, now);
    subGain.gain.linearRampToValueAtTime(0.001, now + durationSeconds);

    // Connect audio graph
    osc.connect(filter);
    filter.connect(gainNode);
    gainNode.connect(ctx.destination);

    subOsc.connect(subGain);
    subGain.connect(ctx.destination);

    // Start oscillators
    osc.start(now);
    osc.stop(now + durationSeconds);

    subOsc.start(now);
    subOsc.stop(now + durationSeconds);

    activeOscillators.push(osc, subOsc);
    activeGainNodes.push(gainNode, subGain);

    osc.onended = () => {
      const idx = activeOscillators.indexOf(osc);
      if (idx > -1) activeOscillators.splice(idx, 1);
    };

    return () => stopSecurityAlarmSiren();
  } catch (err) {
    console.warn('[AlarmService] Web Audio API siren blocked or unsupported:', err);
    return null;
  }
};

/**
 * Triggers hardware device physical vibration on mobile phones and installed PWAs.
 * Pattern: [500ms buzz, 150ms pause, 500ms buzz, 150ms pause, 800ms buzz, 200ms pause, 500ms buzz, 150ms pause, 1000ms buzz]
 * Repeats in cycles so the user cannot miss the alarm even if phone is in pocket.
 */
export const triggerMobileVibration = (
  pattern = [500, 150, 500, 150, 800, 200, 500, 150, 1000],
  repeatCycles = 3
) => {
  if (!isAlarmVibrateEnabled()) return;
  if (typeof navigator === 'undefined' || typeof navigator.vibrate !== 'function') return;

  try {
    // Clear any prior running interval
    if (activeVibrationTimer) {
      clearInterval(activeVibrationTimer);
      activeVibrationTimer = null;
    }

    // Immediate initial vibration pulse
    navigator.vibrate(pattern);

    // For mobile devices or installed PWA, repeat the physical vibration pattern
    if (repeatCycles > 1) {
      let cycle = 1;
      activeVibrationTimer = setInterval(() => {
        if (cycle >= repeatCycles) {
          clearInterval(activeVibrationTimer);
          activeVibrationTimer = null;
          return;
        }
        try {
          if (isAlarmVibrateEnabled()) {
            navigator.vibrate(pattern);
          }
        } catch (e) {}
        cycle++;
      }, 3400);
    }
  } catch (e) {
    console.warn('[AlarmService] Device vibration error:', e);
  }
};

/**
 * Triggers native notifications with vibration for installed PWAs and mobile browsers.
 * Uses ServiceWorkerRegistration.showNotification() which is the required standard for
 * installed PWAs and Android to vibrate the physical phone hardware.
 */
export const triggerNativeNotification = async ({ title, body, icon, faceId, onOpen }) => {
  if (typeof window === 'undefined') return;

  const vibrationPattern = [500, 150, 500, 150, 800, 200, 500, 150, 1000];
  const notifTitle = title || '🚨 Security Alarm: Unrecognized Face Detected';
  const notifBody = body || 'A new unrecognized person has been captured by surveillance cameras.';
  const notifIcon = icon || '/pwa-192.png';

  // Request permission if not yet requested
  if ('Notification' in window && Notification.permission === 'default') {
    try {
      await Notification.requestPermission();
    } catch (e) {}
  }

  // 1. PRIMARY FOR INSTALLED PWA & MOBILE DEVICES:
  // ServiceWorkerRegistration.showNotification triggers physical device vibration on Android & installed PWAs!
  if ('serviceWorker' in navigator) {
    try {
      const reg = await navigator.serviceWorker.ready;
      if (reg && typeof reg.showNotification === 'function') {
        await reg.showNotification(notifTitle, {
          body: notifBody,
          icon: notifIcon,
          badge: '/pwa-192.png',
          vibrate: vibrationPattern,
          tag: `unrec-face-${faceId || Date.now()}`,
          renotify: true,
          requireInteraction: true,
          data: {
            url: '/unknown-faces',
            faceId,
          },
          actions: [
            { action: 'review', title: '👀 View Face' },
            { action: 'dismiss', title: '✕ Dismiss' },
          ],
        });

        // Also post message to Service Worker for background dispatch
        if (reg.active) {
          reg.active.postMessage({
            type: 'TRIGGER_MOBILE_ALARM',
            title: notifTitle,
            body: notifBody,
            vibrate: vibrationPattern,
            url: '/unknown-faces',
            faceId,
          });
        }
        return;
      }
    } catch (swErr) {
      console.warn('[AlarmService] ServiceWorker notification fallback:', swErr);
    }
  }

  // 2. FALLBACK FOR STANDARD DESKTOP BROWSERS:
  if ('Notification' in window && Notification.permission === 'granted') {
    try {
      const notif = new Notification(notifTitle, {
        body: notifBody,
        icon: notifIcon,
        badge: '/pwa-192.png',
        tag: `unrec-face-${faceId || Date.now()}`,
        renotify: true,
        vibrate: vibrationPattern,
      });

      notif.onclick = () => {
        try {
          window.focus();
        } catch (e) {}
        if (typeof onOpen === 'function') {
          onOpen();
        } else if (window.location.pathname !== '/unknown-faces') {
          window.location.href = '/unknown-faces';
        }
        notif.close();
      };
    } catch (e) {}
  }
};

/**
 * Master Security Alarm Coordinator
 * Triggers siren sound, mobile device physical vibration (single or repeating),
 * ServiceWorker native push with vibration for installed PWAs, and UI banners.
 */
export const triggerSecurityAlarm = (faceData = {}, options = {}) => {
  const isTest = options.isTest || false;

  // 1. Play siren audio
  playSecurityAlarmSiren(isTest ? 2.0 : 2.5);

  // 2. Multi-pulse hardware vibration on mobile / installed PWA (3 repeating cycles)
  triggerMobileVibration([500, 150, 500, 150, 800, 200, 500, 150, 1000], isTest ? 1 : 3);

  // 3. Resolve camera and location info for native notification
  const camName =
    faceData.camera?.name ||
    faceData.cameraName ||
    (faceData.photoUrl?.includes('CAM-02') ? 'CAM-02 (Entrance / IN)' : 'CAM-01 (Exit / OUT)');
  const location = faceData.camera?.location || 'Main Gate';
  const personTitle = faceData.personName && !/^visitor\s*\d*$/i.test(faceData.personName.trim())
    ? faceData.personName
    : 'Unregistered Visitor';

  // 4. Native notification with ServiceWorker vibration
  const title = isTest
    ? '🔔 Security Alarm & Vibration Test'
    : `🚨 ALARM: Unrecognized Face at ${camName}`;
  const body = isTest
    ? 'Security siren audio and mobile physical vibration are active and working!'
    : `New unrecognized face detected at ${location} via ${camName}. Tap to inspect.`;

  triggerNativeNotification({
    title,
    body,
    // Web Push icons cannot attach the bearer token required by /api/media.
    // Keep the public app icon here; the authenticated UI alarm shows the face.
    icon: '/pwa-192.png',
    faceId: faceData.id,
  });

  // 5. Broadcast custom event to website & mobile UI components
  if (typeof window !== 'undefined') {
    const event = new CustomEvent('security-alarm-triggered', {
      detail: {
        face: faceData,
        isTest,
        title,
        body,
        camName,
        location,
        personTitle,
        isInstalled: isAppInstalled(),
        isMobile: isMobileDevice(),
        timestamp: Date.now(),
      },
    });
    window.dispatchEvent(event);
  }

  return {
    silence: stopSecurityAlarmSiren,
  };
};

export default {
  triggerSecurityAlarm,
  playSecurityAlarmSiren,
  stopSecurityAlarmSiren,
  triggerMobileVibration,
  stopMobileVibration,
  triggerNativeNotification,
  requestAlarmPermissions,
  getAlarmAccessStatus,
  isAlarmSoundEnabled,
  setAlarmSoundEnabled,
  isAlarmVibrateEnabled,
  setAlarmVibrateEnabled,
  isAppInstalled,
  isMobileDevice,
};
