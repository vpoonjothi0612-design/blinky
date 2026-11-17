import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../services/api';
import useAuth from '../hooks/useAuth';
import Loader from '../components/common/Loader';
import AuthenticatedMediaImage from '../components/common/AuthenticatedMediaImage';
import { mediaUrlForLegacyPath } from '../services/media.service';
import { formatCrossingTime, recentCrossingHref } from '../utils/crossingView';
import {
  triggerSecurityAlarm,
  stopSecurityAlarmSiren,
  isAlarmSoundEnabled,
} from '../services/alarm.service';
import './LiveAttendanceMonitoring.css';

const CAM_IN_ID = 'CAM-02';
const CAM_OUT_ID = 'CAM-01';

// Clean URL resolver with no hardcoded hosts or ports
const resolveImageUrl = (path) => {
  if (!path) return '';
  if (path.startsWith('http://') || path.startsWith('https://') || path.startsWith('data:')) return path;
  return path.startsWith('/') ? path : `/${path}`;
};

// Offline-safe SVG avatar / placeholder icon generator
const getFallbackPlaceholder = (type = 'PERSON', label = 'User') => {
  const initial = (label.trim()[0] || 'U').toUpperCase();
  if (type === 'VEHICLE') {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="100" height="125" viewBox="0 0 100 125">
      <rect width="100%" height="125" fill="#0f172a" />
      <rect x="20" y="45" width="60" height="35" rx="6" fill="#1e293b" stroke="#38bdf8" stroke-width="2" />
      <circle cx="35" cy="85" r="8" fill="#64748b" />
      <circle cx="65" cy="85" r="8" fill="#64748b" />
      <text x="50" y="67" font-family="-apple-system, sans-serif" font-size="12" font-weight="bold" fill="#38bdf8" text-anchor="middle">CAR</text>
    </svg>`;
    return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
  }
  if (type === 'ANIMAL') {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="100" height="125" viewBox="0 0 100 125">
      <rect width="100%" height="125" fill="#0f172a" />
      <circle cx="50" cy="55" r="24" fill="#334155" />
      <circle cx="34" cy="35" r="10" fill="#475569" />
      <circle cx="66" cy="35" r="10" fill="#475569" />
      <text x="50" y="60" font-family="-apple-system, sans-serif" font-size="13" font-weight="bold" fill="#facc15" text-anchor="middle">🐾</text>
    </svg>`;
    return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
  }
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="100" height="125" viewBox="0 0 100 125">
    <rect width="100%" height="125" fill="#0f172a" />
    <circle cx="50" cy="45" r="24" fill="#334155" />
    <path d="M15 110 C15 75, 85 75, 85 110 Z" fill="#334155" />
    <text x="50" y="52" font-family="-apple-system, sans-serif" font-size="20" font-weight="bold" fill="#94a3b8" text-anchor="middle">${initial}</text>
  </svg>`;
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
};

const formatTimeIst = (timestampStr) => {
  if (!timestampStr) return new Date().toLocaleTimeString();
  try {
    const d = new Date(timestampStr);
    if (isNaN(d.getTime())) return timestampStr;
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  } catch {
    return timestampStr;
  }
};

const resolveBadgeInfo = (eventType = '') => {
  if (eventType.startsWith('PERSON_UNKNOWN')) {
    return { text: 'Unknown', colorClass: 'badge-unknown', icon: '⚠️' };
  }
  if (eventType.startsWith('PERSON_NO_FACE')) {
    return { text: 'No Face', colorClass: 'badge-noface', icon: '👤' };
  }
  if (eventType.startsWith('PERSON')) {
    return { text: 'Recognized', colorClass: 'badge-recognized', icon: '✓' };
  }
  if (eventType.startsWith('VEHICLE')) {
    return { text: 'Vehicle', colorClass: 'badge-vehicle', icon: '🚗' };
  }
  if (eventType.startsWith('ANIMAL')) {
    return { text: 'Animal', colorClass: 'badge-animal', icon: '🐾' };
  }
  return { text: 'Detected', colorClass: 'badge-other', icon: '●' };
};

const getEventPhotoUrl = (event) => {
  if (!event) return '';
  if (event.event_type === 'NO_FACE_CAPTURED') {
    return resolveImageUrl(event.image_face_url || event.image_body_url || event.image_frame_url);
  }
  if (event.photo_url) return resolveImageUrl(event.photo_url);
  if (event.profile_image_url) return resolveImageUrl(event.profile_image_url);
  if (event.image_face_url) return resolveImageUrl(event.image_face_url);
  if (event.image_plate_url) return resolveImageUrl(event.image_plate_url);
  if (event.image_frame_url) return resolveImageUrl(event.image_frame_url);
  if (event.capturedImage) return mediaUrlForLegacyPath(`captured-images/${event.capturedImage}`);
  return '';
};

const crossingToLiveEvent = (crossing) => ({
  ...crossing,
  camera_id: crossing.camera_id,
  direction: crossing.direction,
  event_type: crossing.decision === 'NO_FACE_CAPTURED'
    ? 'NO_FACE_CAPTURED'
    : crossing.decision === 'UNKNOWN'
      ? `PERSON_UNKNOWN_${crossing.direction}`
      : `PERSON_${crossing.direction}`,
  name: crossing.employee_name || (crossing.decision === 'NO_FACE_CAPTURED' ? 'Face not captured' : 'Unknown person'),
  timestamp: crossing.detected_at,
  image_face_url: crossing.face_passport_url,
  image_body_url: crossing.body_url,
  image_frame_url: crossing.frame_url,
  profile_image_url: crossing.photo_source === 'REGISTRY' ? crossing.employee_photo_url : null,
  person_status: crossing.decision === 'CONFIRMED' ? 'REGISTERED' : 'UNREGISTERED',
  photo_url: crossing.photo_url,
});

const LiveAttendanceMonitoring = () => {
  const navigate = useNavigate();
  const { user } = useAuth();

  // Fullscreen State & View Mode
  // 'CAM-02' (Default full-screen Main Entry Gate) | 'CAM-01' (Exit Gate) | 'DUAL' (Side-by-side)
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [fullscreenCam, setFullscreenCam] = useState('CAM-02');

  // Dual Camera Streams State
  const [streamKeyIn, setStreamKeyIn] = useState(Date.now());
  const [streamKeyOut, setStreamKeyOut] = useState(Date.now());
  const [streamStatusIn, setStreamStatusIn] = useState('LIVE');
  const [streamStatusOut, setStreamStatusOut] = useState('LIVE');

  // Multi-Class Gate Surveillance Events (Latest 5 per lane)
  const [inEvents, setInEvents] = useState([]);
  const [outEvents, setOutEvents] = useState([]);
  const [crossingModeActive, setCrossingModeActive] = useState(false);
  const [newlyArrivedIds, setNewlyArrivedIds] = useState(new Set());

  // Real-Time Latest Person Detection below each camera viewport
  const [latestPersonIn, setLatestPersonIn] = useState(null);
  const [latestPersonOut, setLatestPersonOut] = useState(null);

  // Active Security Alarm Banner State
  const [activeAlarm, setActiveAlarm] = useState(null);

  // Photo Inspection Modal
  const [previewPhoto, setPreviewPhoto] = useState(null);

  // Live Dashboard Statistics
  const [liveStats, setLiveStats] = useState({
    todayPresent: 0,
    inCount: 0,
    outCount: 0,
    totalToday: 0,
    unknownCount: 0,
    vehicleCount: 0,
    animalCount: 0,
    activeCameras: 2,
    currentFps: 18.0,
  });

  // Current Wall Clock Time
  const [currentTime, setCurrentTime] = useState(new Date());

  const containerRef = useRef(null);
  const crossingModeRef = useRef(false);

  // 1. Digital Clock Tick
  useEffect(() => {
    const timer = setInterval(() => setCurrentTime(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);

  // 2. Fullscreen Change Event Listener
  useEffect(() => {
    const handleFullscreenChange = () => {
      setIsFullscreen(Boolean(document.fullscreenElement));
    };
    document.addEventListener('fullscreenchange', handleFullscreenChange);
    return () => document.removeEventListener('fullscreenchange', handleFullscreenChange);
  }, []);

  // 3. Fullscreen Keyboard Shortcut (F key toggles, Esc exits)
  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.target && ['input', 'textarea', 'select'].includes(e.target.tagName?.toLowerCase())) {
        return;
      }
      if (e.key === 'f' || e.key === 'F') {
        toggleFullscreen();
      } else if (e.key === 'Escape' && isFullscreen) {
        if (document.exitFullscreen) {
          document.exitFullscreen().catch(() => {});
        }
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isFullscreen]);

  // 4. Fetch Gate Events from Backend API
  const fetchGateEvents = useCallback(async () => {
    if (crossingModeRef.current) return;
    try {
      const res = await api.get(`/events?type=PERSON&limit=25&t=${Date.now()}`);
      if (res.data?.data) {
        const events = res.data.data;
        const ins = [];
        const outs = [];
        const newIds = new Set();

        for (const ev of events) {
          const isOut = ev.direction === 'OUT' || ev.camera_id?.includes('01');
          if (isOut) {
            if (outs.length < 5) outs.push(ev);
          } else {
            if (ins.length < 5) ins.push(ev);
          }
          newIds.add(ev.id);
        }

        setInEvents(ins);
        setOutEvents(outs);

        // Find latest person detections for the strips below the camera viewports
        const pIn = events.find(
          (e) => (e.direction === 'IN' || e.camera_id?.includes('02')) && (e.event_type?.startsWith('PERSON') || e.event_type === 'NO_FACE_CAPTURED')
        );
        const pOut = events.find(
          (e) => (e.direction === 'OUT' || e.camera_id?.includes('01')) && (e.event_type?.startsWith('PERSON') || e.event_type === 'NO_FACE_CAPTURED')
        );
        if (pIn) setLatestPersonIn(pIn);
        if (pOut) setLatestPersonOut(pOut);

        // Check for latest unknown event to trigger alarm if enabled
        const latestUnk = events.find((e) => e.event_type?.includes('UNKNOWN'));
        if (latestUnk && latestUnk.alarm) {
          const alarmTime = new Date(latestUnk.timestamp || latestUnk.created_at).getTime();
          // If within the last 15 seconds
          if (Date.now() - alarmTime < 15000 && isAlarmSoundEnabled()) {
            setActiveAlarm({
              id: latestUnk.id,
              camera: latestUnk.camera_id || 'Entry Gate',
              time: formatTimeIst(latestUnk.timestamp),
              photo: getEventPhotoUrl(latestUnk),
            });
            triggerSecurityAlarm({
              photoUrl: latestUnk.image_face_url,
              cameraName: latestUnk.camera_id,
              personName: 'Unregistered Visitor',
            });
          }
        }
      }
    } catch (err) {
      // Background poll warning handled
    }
  }, []);

  // Dedicated fetch to prime latest person detections from database
  const fetchInitialPersons = useCallback(async () => {
    try {
      const res = await api.get(`/events?type=PERSON&limit=10&t=${Date.now()}`);
      if (res.data?.data) {
        const pIn = res.data.data.find(e => (e.direction === 'IN' || e.camera_id?.includes('02')) && (e.event_type?.startsWith('PERSON') || e.event_type === 'NO_FACE_CAPTURED'));
        const pOut = res.data.data.find(e => (e.direction === 'OUT' || e.camera_id?.includes('01')) && (e.event_type?.startsWith('PERSON') || e.event_type === 'NO_FACE_CAPTURED'));
        if (pIn) setLatestPersonIn(pIn);
        if (pOut) setLatestPersonOut(pOut);
      }
    } catch {}
  }, []);

  // 5. Fetch Live Telemetry KPI Stats
  const fetchLiveStats = useCallback(async () => {
    try {
      const statsRes = await api.get('/attendance/live-stats');
      if (statsRes.data?.data) {
        setLiveStats(statsRes.data.data);
      }
    } catch {
      // Suppress background poll errors
    }
  }, []);

  useEffect(() => {
    fetchGateEvents();
    fetchInitialPersons();
    fetchLiveStats();
  }, [fetchGateEvents, fetchInitialPersons, fetchLiveStats]);

  // Polling every 1.5s for real-time events and telemetry sync
  useEffect(() => {
    const pollInterval = setInterval(() => {
      fetchGateEvents();
      fetchLiveStats();
    }, 1500);

    return () => clearInterval(pollInterval);
  }, [fetchGateEvents, fetchLiveStats]);

  // Feature-gated crossing feed: this endpoint returns 404 unless the backend
  // starts with FACE_CROSSING_MODE=true, preserving the current UI otherwise.
  useEffect(() => {
    let active = true;
    const fetchCrossingSummary = async () => {
      try {
        const response = await api.get('/crossings/summary', { params: { limit: 5 } });
        if (!active) return;
        crossingModeRef.current = true;
        setCrossingModeActive(true);
        const payload = response.data?.data || {};
        const ins = (payload['CAM-02'] || []).map(crossingToLiveEvent);
        const outs = (payload['CAM-01'] || []).map(crossingToLiveEvent);
        setInEvents(ins);
        setOutEvents(outs);
        setLatestPersonIn(ins[0] || null);
        setLatestPersonOut(outs[0] || null);
      } catch {
        // An older or flag-disabled backend keeps the existing /events UI.
      }
    };
    fetchCrossingSummary();
    const timer = window.setInterval(fetchCrossingSummary, 2000);
    return () => { active = false; window.clearInterval(timer); };
  }, []);

  // 6. Real-Time SSE Stream for Instant Push Events
  useEffect(() => {
    const token = localStorage.getItem('token') || '';
    const sseUrl = `${api.defaults.baseURL || '/api'}/attendance/live-stream?token=${encodeURIComponent(token)}`;

    let eventSource = null;
    try {
      eventSource = new EventSource(sseUrl);

      eventSource.onmessage = (e) => {
        try {
          const data = JSON.parse(e.data);
          if (data && (data.type === 'GATE_EVENT' || data.event_type)) {
            const ev = data;
            const isOut = ev.direction === 'OUT' || ev.camera_id?.includes('01');

            if (isOut) {
              setOutEvents((prev) => [ev, ...prev.filter((p) => p.id !== ev.id)].slice(0, 5));
            } else {
              setInEvents((prev) => [ev, ...prev.filter((p) => p.id !== ev.id)].slice(0, 5));
            }

            // Immediately update real-time person detection below cameras
            if (ev.event_type?.startsWith('PERSON') || ev.event_type === 'NO_FACE_CAPTURED') {
              if (isOut) {
                setLatestPersonOut(ev);
              } else {
                setLatestPersonIn(ev);
              }
            }

            // Highlight newly arrived event
            setNewlyArrivedIds((prev) => new Set([...prev, ev.id]));
            setTimeout(() => {
              setNewlyArrivedIds((prev) => {
                const next = new Set(prev);
                next.delete(ev.id);
                return next;
              });
            }, 2500);

            // Handle security alarm for unknown visitors
            if (ev.event_type?.includes('UNKNOWN') && isAlarmSoundEnabled()) {
              setActiveAlarm({
                id: ev.id,
                camera: ev.camera_id || (isOut ? 'CAM-01 (Exit)' : 'CAM-02 (Entry)'),
                time: formatTimeIst(ev.timestamp),
                photo: getEventPhotoUrl(ev),
              });
              triggerSecurityAlarm({
                photoUrl: ev.image_face_url,
                cameraName: ev.camera_id,
                personName: 'Unregistered Visitor',
              });
            }
          }
        } catch {}
      };
    } catch {}

    return () => {
      if (eventSource) eventSource.close();
    };
  }, []);

  // 7. Fullscreen Toggle
  const toggleFullscreen = () => {
    if (!document.fullscreenElement) {
      if (containerRef.current?.requestFullscreen) {
        containerRef.current.requestFullscreen().catch(() => {});
      } else if (document.documentElement?.requestFullscreen) {
        document.documentElement.requestFullscreen().catch(() => {});
      }
      setIsFullscreen(true);
    } else {
      if (document.exitFullscreen) {
        document.exitFullscreen().catch(() => {});
      }
      setIsFullscreen(false);
    }
  };

  const dismissAlarm = () => {
    stopSecurityAlarmSiren();
    setActiveAlarm(null);
  };

  const openPhotoPreview = (event) => {
    if (!event) return;
    const url = getEventPhotoUrl(event);
    if (!url) return;

    setPreviewPhoto({
      url,
      name: event.name || event.plate_text || event.species || 'Gate Event',
      code: event.employee_code || event.plate_text,
      camera: event.camera_id,
      timestamp: event.timestamp,
      department: event.department,
      type: event.event_type,
    });
  };

  // Stream URLs
  const streamUrlIn = `${api.defaults.baseURL || '/api'}/cameras/live-stream/${CAM_IN_ID}?t=${streamKeyIn}`;
  const streamUrlOut = `${api.defaults.baseURL || '/api'}/cameras/live-stream/${CAM_OUT_ID}?t=${streamKeyOut}`;

  // Latest single event per camera for tile headers
  const latestIn = inEvents[0] || null;
  const latestOut = outEvents[0] || null;

  return (
    <div
      ref={containerRef}
      className={`lam-container ${isFullscreen ? 'fullscreen-mode' : ''}`}
    >
      {/* ── Active Security Alarm Floating Banner ── */}
      {activeAlarm && (
        <div className="lam-security-alarm-banner">
          <div className="alarm-banner-left">
            <span className="alarm-siren-icon">🚨</span>
            <div className="alarm-text-group">
              <strong>SECURITY ALARM: UNREGISTERED VISITOR DETECTED</strong>
              <p>Camera: {activeAlarm.camera} • Time: {activeAlarm.time} • Live Face Captured</p>
            </div>
          </div>
          <div className="alarm-banner-right">
            <button className="lam-alarm-dismiss-btn" onClick={dismissAlarm}>
              ✕ Silence & Dismiss
            </button>
          </div>
        </div>
      )}

      {/* ── Top Surveillance Bar ── */}
      <header className="lam-header">
        <div className="lam-header-left">
          <div className="lam-header-icon">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2">
              <path d="M23 7l-7 5 7 5V7z" />
              <rect x="1" y="5" width="15" height="14" rx="2" rx="2" />
            </svg>
          </div>
          <div className="lam-title-group">
            <div className="lam-title-row">
              <h1>Dual-Camera Live Surveillance</h1>
              <span className="lam-dual-badge">● DUAL STREAM ACTIVE</span>
            </div>
            <p>Left: CAM-02 (Entry Gate • IN) | Right: CAM-01 (Exit Gate • OUT)</p>
          </div>
        </div>

        {/* Real-Time Telemetry KPI Chips */}
        <div className="lam-telemetry-chips">
          <div className="lam-chip in" title="Currently inside facility">
            <span className="chip-label">IN</span>
            <span className="chip-val">{liveStats.inCount}</span>
          </div>
          <div className="lam-chip out" title="Currently outside facility">
            <span className="chip-label">OUT</span>
            <span className="chip-val">{liveStats.outCount}</span>
          </div>
          <div className="lam-chip present" title="Today total present">
            <span className="chip-label">PRESENT</span>
            <span className="chip-val">{liveStats.todayPresent}</span>
          </div>
          <div className="lam-chip unknown" title="Unrecognized face tracks">
            <span className="chip-label">UNKNOWN</span>
            <span className="chip-val">{liveStats.unknownCount}</span>
          </div>
          <div className="lam-chip vehicle" title="Vehicles tracked today">
            <span className="chip-label">VEHICLES</span>
            <span className="chip-val">{liveStats.vehicleCount || 0}</span>
          </div>
          <div className="lam-chip animal" title="Animals observed today">
            <span className="chip-label">ANIMALS</span>
            <span className="chip-val">{liveStats.animalCount || 0}</span>
          </div>
          <div className="lam-chip fps" title="Inference processing speed">
            <span className="chip-label">FPS</span>
            <span className="chip-val">{Number(liveStats.currentFps || 18.0).toFixed(1)}</span>
          </div>
        </div>

        {/* Header Right: Fullscreen Button & View Controls */}
        <div className="lam-header-actions">
          {isFullscreen && (
            <div className="lam-fullscreen-cam-selector">
              <button
                className={`cam-select-btn ${fullscreenCam === 'CAM-02' ? 'active' : ''}`}
                onClick={() => setFullscreenCam('CAM-02')}
                title="Full-Screen Camera 2 (Entry Gate • IN)"
              >
                Cam-02 (Entry)
              </button>
              <button
                className={`cam-select-btn ${fullscreenCam === 'CAM-01' ? 'active' : ''}`}
                onClick={() => setFullscreenCam('CAM-01')}
                title="Full-Screen Camera 1 (Exit Gate • OUT)"
              >
                Cam-01 (Exit)
              </button>
              <button
                className={`cam-select-btn ${fullscreenCam === 'DUAL' ? 'active' : ''}`}
                onClick={() => setFullscreenCam('DUAL')}
                title="Dual Split Camera View"
              >
                Dual View
              </button>
            </div>
          )}

          <button
            className={`lam-btn ${isFullscreen ? 'lam-btn-fullscreen-active' : ''}`}
            onClick={toggleFullscreen}
            title={isFullscreen ? 'Exit Fullscreen (Esc)' : 'Enter Fullscreen Surveillance Monitor (F)'}
          >
            {isFullscreen ? '✕ Exit Fullscreen' : '⛶ Fullscreen'}
          </button>
        </div>
      </header>

      {/* ── MAIN DUAL CAMERA MONITOR VIEW ── */}
      <section className={`lam-dual-monitor-grid ${isFullscreen ? `fullscreen-${fullscreenCam.toLowerCase()}` : ''}`}>
        {/* ════════════════════════════════════════════════════════
            CAM IN (CAM-02 ENTRANCE GATE • IN)
            ════════════════════════════════════════════════════════ */}
        {(!isFullscreen || fullscreenCam === 'CAM-02' || fullscreenCam === 'DUAL') && (
          <div className="lam-cam-pane lam-pane-in">
            <div className="lam-pane-header">
              <div className="lam-pane-title">
                <span className={`lam-live-dot ${streamStatusIn.toLowerCase()}`} />
                <strong className="lam-pane-name">Cam IN (CAM-02 Entry Gate)</strong>
                <span className="lam-pane-ip">192.168.15.57</span>
              </div>

              <div className="lam-pane-tags">
                <span className="lam-dir-tag in">↓ ENTRY (IN)</span>
              </div>
            </div>

            {/* Live Video Viewport */}
            <div className="lam-pane-viewport">
              <img
                key={`in-${streamKeyIn}`}
                src={streamUrlIn}
                alt="Cam IN Live Stream"
                className="lam-stream-img"
                onLoad={() => setStreamStatusIn('LIVE')}
                onError={() => setStreamStatusIn('OFFLINE')}
              />

              {/* In-Video HUD Overlay for IN Camera */}
              <div className="lam-pane-hud">
                <div className="lam-hud-top-row">
                  <div className="lam-hud-rec in">
                    <span className="rec-pulse-circle in" />
                    <span>LIVE • CAM IN</span>
                  </div>
                  <div className="lam-hud-fps">
                    <span>{Number(liveStats.currentFps || 18.0).toFixed(1)} FPS</span>
                  </div>
                </div>

                <div className="lam-hud-bottom-row">
                  <div className="lam-hud-stamp">
                    <span>{currentTime.toLocaleTimeString()}</span>
                    <span className="divider">•</span>
                    <span>ENTRY GATE ACTIVE</span>
                  </div>
                  <div className="lam-hud-zone">Tripwire & Gate Zone Active</div>
                </div>
              </div>
            </div>

            {/* ── CAM IN LATEST PERSON ENTRY DETECTION ── */}
            <div className="lam-marked-bottom-strip in">
              {latestPersonIn ? (
                (() => {
                  const isRegistered =
                    latestPersonIn.person_status === 'REGISTERED' ||
                    latestPersonIn.event_type === 'PERSON_IN' ||
                    Boolean(latestPersonIn.employee_id || (latestPersonIn.employee_code && latestPersonIn.employee_code !== 'UNKNOWN'));
                  const isNoFaceCapture = latestPersonIn.event_type === 'NO_FACE_CAPTURED';
                  const noFaceImage = latestPersonIn.image_face_url || latestPersonIn.image_body_url || latestPersonIn.image_frame_url;
                  const photo = isNoFaceCapture
                    ? (noFaceImage || getFallbackPlaceholder('PERSON', 'Face not captured'))
                    : isRegistered
                    ? (latestPersonIn.profile_image_url || latestPersonIn.image_face_url || getFallbackPlaceholder('PERSON', latestPersonIn.name))
                    : (latestPersonIn.image_face_url || getFallbackPlaceholder('PERSON', 'Unknown'));

                  return (
                    <div className={`lam-marked-content person-strip ${isRegistered ? 'is-registered' : 'is-unregistered'}`} onClick={() => openPhotoPreview(latestPersonIn)}>
                      <div className={`lam-passport-photo-box in ${isRegistered ? 'registered' : 'unregistered'}`} title="Click to view full photo">
                        <AuthenticatedMediaImage mediaKey={isNoFaceCapture ? noFaceImage : (isRegistered ? latestPersonIn.profile_image_url || latestPersonIn.image_face_url : latestPersonIn.image_face_url)} alt={isNoFaceCapture ? 'Person capture for review' : latestPersonIn.name || 'Person'} className="lam-passport-img" fallback={<img src={photo} alt="Person capture for review" className="lam-passport-img" />} />
                        <span className={`lam-passport-badge ${isRegistered ? 'reg' : 'unreg'}`}>
                          {isNoFaceCapture ? 'FACE NOT CAPTURED' : isRegistered ? 'REGISTERED PHOTO' : 'LIVE FACE CAPTURE'}
                        </span>
                      </div>

                      <div className="lam-marked-col name-col">
                        <span className="lam-marked-label">LATEST ENTRY DETECTION</span>
                        <div className="lam-marked-name">
                          {isNoFaceCapture ? 'Face not captured' : isRegistered ? (latestPersonIn.name || 'Registered Employee') : 'Unregistered Person'}
                        </div>
                        <div className="lam-marked-sub">
                          {isRegistered ? (
                            <>
                              <span className="lam-code-pill in">{latestPersonIn.employee_code || 'ID: Active'}</span>
                              <span className="lam-registered-badge">✓ REGISTERED</span>
                            </>
                          ) : (
                            <span className="lam-unregistered-badge">⚠ UNREGISTERED</span>
                          )}
                        </div>
                      </div>

                      <div className="lam-marked-col dept-col">
                        <span className="lam-marked-label">{isRegistered ? 'DEPARTMENT & DESIGNATION' : 'VISITOR STATUS'}</span>
                        <div className="lam-marked-val">
                          {isNoFaceCapture ? 'Body crop saved for review' : isRegistered ? (latestPersonIn.department || 'General') : 'Unenrolled Visitor'}
                        </div>
                        <div className="lam-marked-muted">
                          {isNoFaceCapture ? 'No identity decision made' : isRegistered ? (latestPersonIn.designation || 'Staff Member') : 'No Attendance Generated'}
                        </div>
                      </div>

                      <div className="lam-marked-col time-col">
                        <span className="lam-marked-label">DETECTION TIME</span>
                        <div className="lam-marked-val time">{crossingModeActive ? formatCrossingTime(latestPersonIn.timestamp) : formatTimeIst(latestPersonIn.timestamp)}</div>
                        <div className="lam-marked-conf in">
                          {isRegistered && latestPersonIn.match_score
                            ? `${(latestPersonIn.match_score * 100).toFixed(1)}% Match`
                            : (isRegistered ? 'Verified Face' : 'Gate Crossing')}
                        </div>
                      </div>
                    </div>
                  );
                })()
              ) : (
                <div className="lam-marked-awaiting in">
                  <div className="lam-awaiting-radar in">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <circle cx="12" cy="12" r="3" />
                      <path d="M5 8V6a2 2 0 0 1 2-2h2" />
                      <path d="M15 4h2a2 2 0 0 1 2 2v2" />
                      <path d="M5 16v2a2 2 0 0 0 2 2h2" />
                      <path d="M15 20h2a2 2 0 0 0 2-2v-2" />
                    </svg>
                  </div>
                  <div className="lam-awaiting-text">
                    <strong>Awaiting Live Entry Detection</strong>
                    <p>When an employee or visitor enters Cam IN, their live capture, employee details or unregistered indicator will display here.</p>
                  </div>
                </div>
              )}
            </div>
          </div>
        )}

        {/* ════════════════════════════════════════════════════════
            CAM OUT (CAM-01 EXIT GATE • OUT)
            ════════════════════════════════════════════════════════ */}
        {(!isFullscreen || fullscreenCam === 'CAM-01' || fullscreenCam === 'DUAL') && (
          <div className="lam-cam-pane lam-pane-out">
            <div className="lam-pane-header">
              <div className="lam-pane-title">
                <span className={`lam-live-dot ${streamStatusOut.toLowerCase()}`} />
                <strong className="lam-pane-name">Cam OUT (CAM-01 Exit Gate)</strong>
                <span className="lam-pane-ip">192.168.15.56</span>
              </div>

              <div className="lam-pane-tags">
                <span className="lam-dir-tag out">↑ EXIT (OUT)</span>
              </div>
            </div>

            {/* Live Video Viewport */}
            <div className="lam-pane-viewport">
              <img
                key={`out-${streamKeyOut}`}
                src={streamUrlOut}
                alt="Cam OUT Live Stream"
                className="lam-stream-img"
                onLoad={() => setStreamStatusOut('LIVE')}
                onError={() => setStreamStatusOut('OFFLINE')}
              />

              {/* In-Video HUD Overlay for OUT Camera */}
              <div className="lam-pane-hud">
                <div className="lam-hud-top-row">
                  <div className="lam-hud-rec out">
                    <span className="rec-pulse-circle out" />
                    <span>LIVE • CAM OUT</span>
                  </div>
                  <div className="lam-hud-fps">
                    <span>{Number(liveStats.currentFps || 18.0).toFixed(1)} FPS</span>
                  </div>
                </div>

                <div className="lam-hud-bottom-row">
                  <div className="lam-hud-stamp">
                    <span>{currentTime.toLocaleTimeString()}</span>
                    <span className="divider">•</span>
                    <span>EXIT GATE ACTIVE</span>
                  </div>
                  <div className="lam-hud-zone">Tripwire & Gate Zone Active</div>
                </div>
              </div>
            </div>

            {/* ── CAM OUT LATEST PERSON EXIT DETECTION ── */}
            <div className="lam-marked-bottom-strip out">
              {latestPersonOut ? (
                (() => {
                  const isRegistered =
                    latestPersonOut.person_status === 'REGISTERED' ||
                    latestPersonOut.event_type === 'PERSON_OUT' ||
                    Boolean(latestPersonOut.employee_id || (latestPersonOut.employee_code && latestPersonOut.employee_code !== 'UNKNOWN'));
                  const isNoFaceCapture = latestPersonOut.event_type === 'NO_FACE_CAPTURED';
                  const noFaceImage = latestPersonOut.image_face_url || latestPersonOut.image_body_url || latestPersonOut.image_frame_url;
                  const photo = isNoFaceCapture
                    ? (noFaceImage || getFallbackPlaceholder('PERSON', 'Face not captured'))
                    : isRegistered
                    ? (latestPersonOut.profile_image_url || latestPersonOut.image_face_url || getFallbackPlaceholder('PERSON', latestPersonOut.name))
                    : (latestPersonOut.image_face_url || getFallbackPlaceholder('PERSON', 'Unknown'));

                  return (
                    <div className={`lam-marked-content person-strip ${isRegistered ? 'is-registered' : 'is-unregistered'}`} onClick={() => openPhotoPreview(latestPersonOut)}>
                      <div className={`lam-passport-photo-box out ${isRegistered ? 'registered' : 'unregistered'}`} title="Click to view full photo">
                        <AuthenticatedMediaImage mediaKey={isNoFaceCapture ? noFaceImage : (isRegistered ? latestPersonOut.profile_image_url || latestPersonOut.image_face_url : latestPersonOut.image_face_url)} alt={isNoFaceCapture ? 'Person capture for review' : latestPersonOut.name || 'Person'} className="lam-passport-img" fallback={<img src={photo} alt="Person capture for review" className="lam-passport-img" />} />
                        <span className={`lam-passport-badge ${isRegistered ? 'reg' : 'unreg'}`}>
                          {isNoFaceCapture ? 'FACE NOT CAPTURED' : isRegistered ? 'REGISTERED PHOTO' : 'LIVE FACE CAPTURE'}
                        </span>
                      </div>

                      <div className="lam-marked-col name-col">
                        <span className="lam-marked-label">LATEST EXIT DETECTION</span>
                        <div className="lam-marked-name">
                          {isNoFaceCapture ? 'Face not captured' : isRegistered ? (latestPersonOut.name || 'Registered Employee') : 'Unregistered Person'}
                        </div>
                        <div className="lam-marked-sub">
                          {isRegistered ? (
                            <>
                              <span className="lam-code-pill out">{latestPersonOut.employee_code || 'ID: Active'}</span>
                              <span className="lam-registered-badge">✓ REGISTERED</span>
                            </>
                          ) : (
                            <span className="lam-unregistered-badge">⚠ UNREGISTERED</span>
                          )}
                        </div>
                      </div>

                      <div className="lam-marked-col dept-col">
                        <span className="lam-marked-label">{isRegistered ? 'DEPARTMENT & DESIGNATION' : 'VISITOR STATUS'}</span>
                        <div className="lam-marked-val">
                          {isNoFaceCapture ? 'Body crop saved for review' : isRegistered ? (latestPersonOut.department || 'General') : 'Unenrolled Visitor'}
                        </div>
                        <div className="lam-marked-muted">
                          {isNoFaceCapture ? 'No identity decision made' : isRegistered ? (latestPersonOut.designation || 'Staff Member') : 'No Attendance Generated'}
                        </div>
                      </div>

                      <div className="lam-marked-col time-col">
                        <span className="lam-marked-label">DETECTION TIME</span>
                        <div className="lam-marked-val time">{crossingModeActive ? formatCrossingTime(latestPersonOut.timestamp) : formatTimeIst(latestPersonOut.timestamp)}</div>
                        <div className="lam-marked-conf out">
                          {isRegistered && latestPersonOut.match_score
                            ? `${(latestPersonOut.match_score * 100).toFixed(1)}% Match`
                            : (isRegistered ? 'Verified Face' : 'Gate Crossing')}
                        </div>
                      </div>
                    </div>
                  );
                })()
              ) : (
                <div className="lam-marked-awaiting out">
                  <div className="lam-awaiting-radar out">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <circle cx="12" cy="12" r="3" />
                      <path d="M5 8V6a2 2 0 0 1 2-2h2" />
                      <path d="M15 4h2a2 2 0 0 1 2 2v2" />
                      <path d="M5 16v2a2 2 0 0 0 2 2h2" />
                      <path d="M15 20h2a2 2 0 0 0 2-2v-2" />
                    </svg>
                  </div>
                  <div className="lam-awaiting-text">
                    <strong>Awaiting Live Exit Detection</strong>
                    <p>When an employee or visitor exits Cam OUT, their live capture, employee details or unregistered indicator will display here.</p>
                  </div>
                </div>
              )}
            </div>
          </div>
        )}
      </section>

      {/* ── BOTTOM DUAL LANES (IN & OUT: LATEST 5 EVENTS AS CARDS) ── */}
      <section className="lam-dual-lanes-section">
        {/* Left Lane: IN (CAM-02 Entry Gate) */}
        <div className="lam-event-lane lane-in">
          <div className="lane-header in">
            <div className="lane-header-left">
              <span className="lane-dot in" />
              <h3>Cam-02 Entry Lane (IN)</h3>
              <span className="lane-count-tag">{inEvents.length} Recent</span>
            </div>
          </div>

          <div className="lane-cards-container">
            {inEvents.length === 0 ? (
              <div className="lane-empty-placeholder">
                <span>Awaiting live entry events...</span>
              </div>
            ) : (
              inEvents.map((ev) => {
                const badge = resolveBadgeInfo(ev.event_type);
                const photoUrl = getEventPhotoUrl(ev);
                const isNew = newlyArrivedIds.has(ev.id);

                return (
                  <div
                    key={ev.id}
                    className={`lam-event-card in ${isNew ? 'new-event-glow' : ''}`}
                    onClick={() => crossingModeActive ? navigate(recentCrossingHref(ev)) : openPhotoPreview(ev)}
                  >
                    <div className="event-card-photo-box">
                      <AuthenticatedMediaImage mediaKey={photoUrl} alt={ev.name || 'Event'} className="event-card-img" fallback={<img src={getFallbackPlaceholder(ev.event_type?.startsWith('VEHICLE') ? 'VEHICLE' : (ev.event_type?.startsWith('ANIMAL') ? 'ANIMAL' : 'PERSON'), ev.name)} alt={ev.name || 'Event'} className="event-card-img" />} />
                    </div>
                    <div className="event-card-details">
                      <div className="event-card-top">
                        {ev.employee_id && ev.face_enrollment_id ? <button type="button" className="event-card-name crossing-employee-link" title={ev.name} onClick={(event) => { event.stopPropagation(); navigate(`/face-enrollments/${ev.face_enrollment_id}`); }}>{ev.name}</button> : <span className="event-card-name" title={ev.name}>{ev.name || 'Unknown'}</span>}
                        <span className={`event-card-badge ${badge.colorClass}`}>
                          {badge.icon} {badge.text}
                        </span>
                      </div>
                      <div className="event-card-dept">{ev.department || ev.plate_text || (ev.species ? `Species: ${ev.species}` : 'Gate Area')}</div>
                      <div className="event-card-time">{crossingModeActive ? formatCrossingTime(ev.timestamp) : formatTimeIst(ev.timestamp)}</div>
                    </div>
                  </div>
                );
              })
            )}
          </div>
          {crossingModeActive && <button type="button" className="lane-view-all" onClick={() => navigate('/unknown-faces?camera=CAM-02')}>View all</button>}
        </div>

        {/* Right Lane: OUT (CAM-01 Exit Gate) */}
        <div className="lam-event-lane lane-out">
          <div className="lane-header out">
            <div className="lane-header-left">
              <span className="lane-dot out" />
              <h3>Cam-01 Exit Lane (OUT)</h3>
              <span className="lane-count-tag">{outEvents.length} Recent</span>
            </div>
          </div>

          <div className="lane-cards-container">
            {outEvents.length === 0 ? (
              <div className="lane-empty-placeholder">
                <span>Awaiting live exit events...</span>
              </div>
            ) : (
              outEvents.map((ev) => {
                const badge = resolveBadgeInfo(ev.event_type);
                const photoUrl = getEventPhotoUrl(ev);
                const isNew = newlyArrivedIds.has(ev.id);

                return (
                  <div
                    key={ev.id}
                    className={`lam-event-card out ${isNew ? 'new-event-glow' : ''}`}
                    onClick={() => crossingModeActive ? navigate(recentCrossingHref(ev)) : openPhotoPreview(ev)}
                  >
                    <div className="event-card-photo-box">
                      <AuthenticatedMediaImage mediaKey={photoUrl} alt={ev.name || 'Event'} className="event-card-img" fallback={<img src={getFallbackPlaceholder(ev.event_type?.startsWith('VEHICLE') ? 'VEHICLE' : (ev.event_type?.startsWith('ANIMAL') ? 'ANIMAL' : 'PERSON'), ev.name)} alt={ev.name || 'Event'} className="event-card-img" />} />
                    </div>
                    <div className="event-card-details">
                      <div className="event-card-top">
                        {ev.employee_id && ev.face_enrollment_id ? <button type="button" className="event-card-name crossing-employee-link" title={ev.name} onClick={(event) => { event.stopPropagation(); navigate(`/face-enrollments/${ev.face_enrollment_id}`); }}>{ev.name}</button> : <span className="event-card-name" title={ev.name}>{ev.name || 'Unknown'}</span>}
                        <span className={`event-card-badge ${badge.colorClass}`}>
                          {badge.icon} {badge.text}
                        </span>
                      </div>
                      <div className="event-card-dept">{ev.department || ev.plate_text || (ev.species ? `Species: ${ev.species}` : 'Gate Area')}</div>
                      <div className="event-card-time">{crossingModeActive ? formatCrossingTime(ev.timestamp) : formatTimeIst(ev.timestamp)}</div>
                    </div>
                  </div>
                );
              })
            )}
          </div>
          {crossingModeActive && <button type="button" className="lane-view-all" onClick={() => navigate('/unknown-faces?camera=CAM-01')}>View all</button>}
        </div>
      </section>

      {/* ── High-Resolution Photo Inspection Modal ── */}
      {previewPhoto && (
        <div className="lam-modal-backdrop" onClick={() => setPreviewPhoto(null)}>
          <div className="lam-modal-card" onClick={(e) => e.stopPropagation()}>
            <div className="lam-modal-header">
              <h3>Gate Event Evidence Media</h3>
              <button className="lam-modal-close" onClick={() => setPreviewPhoto(null)}>✕</button>
            </div>
            <div className="lam-modal-body">
              <div className="lam-modal-photo-wrap">
                <AuthenticatedMediaImage mediaKey={previewPhoto.url} alt={previewPhoto.name} className="lam-modal-img" fallback={<img src={getFallbackPlaceholder('PERSON', previewPhoto.name)} alt={previewPhoto.name} className="lam-modal-img" />} />
              </div>
              <div className="lam-modal-meta">
                <div className="meta-row"><strong>Name / Object:</strong> <span>{previewPhoto.name}</span></div>
                {previewPhoto.code && <div className="meta-row"><strong>Code / Plate:</strong> <span>{previewPhoto.code}</span></div>}
                <div className="meta-row"><strong>Department / Details:</strong> <span>{previewPhoto.department || 'N/A'}</span></div>
                <div className="meta-row"><strong>Camera:</strong> <span>{previewPhoto.camera}</span></div>
                <div className="meta-row"><strong>Time (IST):</strong> <span>{formatTimeIst(previewPhoto.timestamp)}</span></div>
                <div className="meta-row"><strong>Event Type:</strong> <span>{previewPhoto.type}</span></div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default LiveAttendanceMonitoring;
