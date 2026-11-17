/**
 * Mobile Sound & Ring Service
 * Provides loud, audible security ring alerts when an unknown person is detected.
 * Works across Web, PWA, and Mobile environments using the Web Audio API.
 */

let audioCtx = null;
let ringInterval = null;
let isRinging = false;

const getAudioContext = () => {
  if (typeof window === "undefined") return null;
  const AudioContextClass = window.AudioContext || window.webkitAudioContext;
  if (!AudioContextClass) return null;

  if (!audioCtx) {
    audioCtx = new AudioContextClass();
  }
  if (audioCtx.state === "suspended") {
    audioCtx.resume().catch(() => {});
  }
  return audioCtx;
};

/**
 * Plays a single security chime / ring pulse
 */
const playChimePulse = (freq1 = 880, freq2 = 660, durationMs = 320) => {
  const ctx = getAudioContext();
  if (!ctx) return;

  try {
    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    osc.type = "sine";
    // Alternating two-tone emergency ring
    osc.frequency.setValueAtTime(freq1, now);
    osc.frequency.setValueAtTime(freq2, now + 0.16);

    // Volume envelope (loud attack, smooth decay)
    gain.gain.setValueAtTime(0.001, now);
    gain.gain.linearRampToValueAtTime(0.45, now + 0.04);
    gain.gain.exponentialRampToValueAtTime(0.001, now + (durationMs / 1000));

    osc.connect(gain);
    gain.connect(ctx.destination);

    osc.start(now);
    osc.stop(now + (durationMs / 1000));
  } catch (e) {
    console.warn("[SoundService] Ring chime pulse error:", e);
  }
};

/**
 * Starts continuous mobile ring alert when unknown person enters
 */
export const startAlarmRing = () => {
  if (isRinging) return;
  isRinging = true;

  // Immediate first ring
  playChimePulse(920, 680, 350);

  // Repeat ring pattern every 850ms (mimicking phone ring / siren)
  ringInterval = setInterval(() => {
    if (!isRinging) {
      clearInterval(ringInterval);
      return;
    }
    playChimePulse(920, 680, 350);
  }, 850);
};

/**
 * Stops mobile ring alert immediately upon acknowledgment
 */
export const stopAlarmRing = () => {
  isRinging = false;
  if (ringInterval) {
    clearInterval(ringInterval);
    ringInterval = null;
  }
};

export default {
  startAlarmRing,
  stopAlarmRing,
};

