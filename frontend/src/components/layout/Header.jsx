import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import useAuth from '../../hooks/useAuth';
import api from '../../services/api';
import { Icons } from '../common/Icons';
import PwaInstallButton from '../common/PwaInstallButton';
import AuthenticatedMediaImage from '../common/AuthenticatedMediaImage';
import {
  triggerSecurityAlarm,
  stopSecurityAlarmSiren,
  isAlarmSoundEnabled,
  setAlarmSoundEnabled,
  playSecurityAlarmSiren,
  triggerMobileVibration,
  requestAlarmPermissions,
} from '../../services/alarm.service';

const NOTIFICATION_STORAGE_KEY = 'facetrack.securityNotifications.v1';
const readNotificationState = () => {
  try {
    const stored = JSON.parse(localStorage.getItem(NOTIFICATION_STORAGE_KEY) || '{}');
    return {
      readIds: new Set(Array.isArray(stored.readIds) ? stored.readIds.map(String) : []),
      clearedIds: new Set(Array.isArray(stored.clearedIds) ? stored.clearedIds.map(String) : []),
    };
  } catch {
    return { readIds: new Set(), clearedIds: new Set() };
  }
};

const getFaceImageKey = (face) => face?.facePassportMediaKey || face?.image_face_url || null;

const Header = () => {
  const navigate = useNavigate();
  const { user, logout } = useAuth();
  const [searchQuery, setSearchQuery] = useState('');

  // Unrecognized Face Security Alarm System
  const [unknownCount, setUnknownCount] = useState(0);
  const [recentUnknowns, setRecentUnknowns] = useState([]);
  const [notificationIds, setNotificationIds] = useState([]);
  const [readNotificationIds, setReadNotificationIds] = useState(() => readNotificationState().readIds);
  const [clearedNotificationIds, setClearedNotificationIds] = useState(() => readNotificationState().clearedIds);
  const [showNotifications, setShowNotifications] = useState(false);
  const [latestAlert, setLatestAlert] = useState(null);
  const [isSirenPlaying, setIsSirenPlaying] = useState(false);
  const [isAlarmSoundOn, setIsAlarmSoundOn] = useState(() => isAlarmSoundEnabled());
  const notifDropdownRef = useRef(null);
  const watermarkRef = useRef({ initialized: false, seenIds: new Set(), lastTime: 0 });

  const [isDark, setIsDark] = useState(() => {
    const saved = localStorage.getItem('theme');
    if (saved) return saved === 'dark';
    return false; // Default to luminous emerald light theme
  });

  const getCamInfo = (face) => {
    if (!face) return '';
    if (face.camera?.name) return face.camera.name;
    if (face.cameraName) return face.cameraName;
    let notes = {};
    if (face.notes) {
      try {
        notes = typeof face.notes === 'string' ? JSON.parse(face.notes) : face.notes;
      } catch {}
    }
    if (notes.camera) return notes.camera;
    if (Array.isArray(face.allScans) && face.allScans[0]?.camera) return face.allScans[0].camera;
    if (Array.isArray(notes.scans) && notes.scans[0]?.camera) return notes.scans[0].camera;
    const photo = face.photoUrl || '';
    if (photo.includes('CAM-02') || photo.includes('208')) return 'CAM-02 (Entry)';
    if (photo.includes('CAM-01') || photo.includes('207')) return 'CAM-01 (Exit)';
    if (face.camera?.location) return face.camera.location;
    return '';
  };

  const getPersonTitle = (face) => {
    if (!face) return 'Unregistered Visitor';
    // Reject dummy/placeholder names like "Visitor 1", "Visitor", "dummy", etc.
    if (face.personName && !/^visitor\s*\d*$/i.test(face.personName.trim()) && !/^dummy/i.test(face.personName.trim())) {
      return face.personName;
    }
    const cam = getCamInfo(face);
    return cam ? `Unregistered Visitor (${cam})` : 'Unregistered Visitor';
  };

  const checkUnknownFaces = useCallback(async () => {
    if (!user) return;
    const userRole = (user.role || '').toUpperCase();
    // Only Security and Admin monitor surveillance alarms; Staff is excluded
    if (userRole === 'STAFF' || userRole === 'USER') return;
    try {
      const res = await api.get('/face-enrollments/unknown');
      const all = res.data.data || [];

      // STRICT FILTER: Only show truly unregistered / unassigned visitor faces (exclude assigned employees & registered passes)
      const valid = all.filter((f) => {
        if (f.employeeId || f.status === 'ASSIGNED' || f.status === 'REGISTERED_EMPLOYEE' || f.status === 'REGISTERED') {
          return false;
        }
        return f.status === 'UNREGISTERED' || f.status === 'UNASSIGNED';
      });

      const active = valid.filter((face) => !clearedNotificationIds.has(String(face.id)));
      const unread = active.filter((face) => !readNotificationIds.has(String(face.id)));
      setNotificationIds(active.map((face) => String(face.id)).filter(Boolean));
      setUnknownCount(unread.length);
      setRecentUnknowns(active.slice(0, 6).map((face) => ({
        ...face,
        notificationRead: readNotificationIds.has(String(face.id)),
      })));

      // Watermark-based live alarm detection:
      // Catches both brand-new face enrollments AND fresh camera scans of unrecognized visitors
      if (!watermarkRef.current.initialized) {
        // Initial page load: initialize watermark to current state to prevent false alarm on past history
        const idSet = new Set(valid.map((f) => f.id).filter(Boolean));
        let maxTime = 0;
        valid.forEach((f) => {
          const t = new Date(f.updatedAt || f.createdAt || 0).getTime();
          if (t > maxTime) maxTime = t;
        });
        watermarkRef.current = { initialized: true, seenIds: idSet, lastTime: maxTime };
      } else {
        // Subsequent poll: check for new unrecognized arrivals
        const newFace = valid.find((f) => {
          if (!watermarkRef.current.seenIds.has(f.id)) return true;
          const t = new Date(f.updatedAt || f.createdAt || 0).getTime();
          return t > watermarkRef.current.lastTime + 1000;
        });

        if (newFace) {
          setLatestAlert(newFace);
          setIsSirenPlaying(true);
          // Trigger multi-channel alarm: Siren audio, mobile vibration, browser push, and window event
          triggerSecurityAlarm(newFace);

          // Update watermark
          valid.forEach((f) => watermarkRef.current.seenIds.add(f.id));
          const t = new Date(newFace.updatedAt || newFace.createdAt || Date.now()).getTime();
          if (t > watermarkRef.current.lastTime) watermarkRef.current.lastTime = t;
        }
      }
    } catch {
      // Ignore background fetch error
    }
  }, [user, readNotificationIds, clearedNotificationIds]);

  useEffect(() => {
    checkUnknownFaces();
    const interval = setInterval(checkUnknownFaces, 4500);
    return () => clearInterval(interval);
  }, [checkUnknownFaces]);

  // Listen for security alarm events from other pages/modules
  useEffect(() => {
    const handleAlarmEvent = (e) => {
      if (e.detail?.face) {
        setLatestAlert(e.detail.face);
        setIsSirenPlaying(true);
      }
    };
    const handleSettingsEvent = (e) => {
      setIsAlarmSoundOn(e.detail?.sound ?? isAlarmSoundEnabled());
    };

    window.addEventListener('security-alarm-triggered', handleAlarmEvent);
    window.addEventListener('face-alarm-settings-changed', handleSettingsEvent);
    return () => {
      window.removeEventListener('security-alarm-triggered', handleAlarmEvent);
      window.removeEventListener('face-alarm-settings-changed', handleSettingsEvent);
    };
  }, []);

  // Request browser permission for native alerts on first interaction
  const handleToggleNotifications = () => {
    if ('Notification' in window && Notification.permission === 'default') {
      Notification.requestPermission();
    }
    setShowNotifications((prev) => !prev);
  };

  const saveNotificationState = (nextReadIds, nextClearedIds) => {
    setReadNotificationIds(nextReadIds);
    setClearedNotificationIds(nextClearedIds);
    try {
      localStorage.setItem(NOTIFICATION_STORAGE_KEY, JSON.stringify({
        readIds: [...nextReadIds].slice(-500),
        clearedIds: [...nextClearedIds].slice(-500),
      }));
    } catch {}
  };

  const handleMarkAllNotificationsRead = () => {
    const nextReadIds = new Set(readNotificationIds);
    notificationIds.forEach((id) => nextReadIds.add(id));
    saveNotificationState(nextReadIds, clearedNotificationIds);
  };

  const handleMarkNotificationRead = (id) => {
    const nextReadIds = new Set(readNotificationIds);
    nextReadIds.add(String(id));
    saveNotificationState(nextReadIds, clearedNotificationIds);
  };

  const handleClearNotifications = () => {
    const nextClearedIds = new Set(clearedNotificationIds);
    notificationIds.forEach((id) => nextClearedIds.add(id));
    saveNotificationState(readNotificationIds, nextClearedIds);
    setRecentUnknowns([]);
    setNotificationIds([]);
    setUnknownCount(0);
  };

  // Close dropdown on outside click
  useEffect(() => {
    const handleOutsideClick = (e) => {
      if (notifDropdownRef.current && !notifDropdownRef.current.contains(e.target)) {
        setShowNotifications(false);
      }
    };
    if (showNotifications) {
      document.addEventListener('mousedown', handleOutsideClick);
    }
    return () => document.removeEventListener('mousedown', handleOutsideClick);
  }, [showNotifications]);

  // Auto-dismiss floating alarm banner after 12 seconds and stop active siren state after 3.5s
  useEffect(() => {
    if (latestAlert) {
      const sirenTimer = setTimeout(() => setIsSirenPlaying(false), 3500);
      const dismissTimer = setTimeout(() => {
        setLatestAlert(null);
        setIsSirenPlaying(false);
      }, 12000);
      return () => {
        clearTimeout(sirenTimer);
        clearTimeout(dismissTimer);
      };
    }
  }, [latestAlert]);

  const handleSilenceAlarm = () => {
    stopSecurityAlarmSiren();
    setIsSirenPlaying(false);
    setLatestAlert(null);
  };

  const handleTestAlarm = () => {
    const sample = recentUnknowns[0] || {
      id: 'test-alarm',
      personName: 'Test Unrecognized Person',
      createdAt: new Date().toISOString(),
      camera: { name: 'CAM-02 (Entrance / IN)', location: 'Main Gate' },
    };
    triggerSecurityAlarm(sample, { isTest: true });
    setLatestAlert(sample);
    setIsSirenPlaying(true);
  };

  const handleToggleSoundPreference = () => {
    const nextVal = !isAlarmSoundOn;
    setAlarmSoundEnabled(nextVal);
    setIsAlarmSoundOn(nextVal);
    if (!nextVal) {
      stopSecurityAlarmSiren();
      setIsSirenPlaying(false);
    } else {
      requestAlarmPermissions().catch(() => {});
    }
  };

  useEffect(() => {
    if (isDark) {
      document.documentElement.setAttribute('data-theme', 'dark');
      document.documentElement.classList.add('dark');
      document.body.setAttribute('data-theme', 'dark');
      document.body.classList.add('dark');
      localStorage.setItem('theme', 'dark');
    } else {
      document.documentElement.removeAttribute('data-theme');
      document.documentElement.classList.remove('dark');
      document.body.removeAttribute('data-theme');
      document.body.classList.remove('dark');
      localStorage.setItem('theme', 'light');
    }
  }, [isDark]);

  const toggleTheme = () => setIsDark((prev) => !prev);

  const handleLogout = () => {
    logout();
    navigate('/login');
  };

  const handleSearchSubmit = (e) => {
    if (e.key === 'Enter' && searchQuery.trim()) {
      // Default to employee search or redirect
      navigate(`/employees?search=${encodeURIComponent(searchQuery.trim())}`);
    }
  };

  const displayName = user?.name || user?.email || 'User';
  const companyName = user?.company || 'Enterprise Attendance';
  const initials = displayName.slice(0, 2).toUpperCase();

  return (
    <header className="topbar">
      <div className="topbar-left">
        {/* Mobile menu hamburger button */}
        <button
          className="topbar-menu-btn"
          onClick={() => {
            const event = new CustomEvent('toggle-sidebar');
            window.dispatchEvent(event);
          }}
          aria-label="Toggle sidebar"
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <line x1="3" y1="12" x2="21" y2="12" />
            <line x1="3" y1="6" x2="21" y2="6" />
            <line x1="3" y1="18" x2="21" y2="18" />
          </svg>
        </button>

        


      </div>

      <div className="topbar-right">
        {/* Enterprise Global Search field */}
        <div className="topbar-global-search">
          <span className="topbar-search-icon">
            <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="11" cy="11" r="8" />
              <line x1="21" y1="21" x2="16.65" y2="16.65" />
            </svg>
          </span>
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            onKeyDown={handleSearchSubmit}
            placeholder="Search employees..."
            aria-label="Global Search"
          />
        </div>

        {/* Unified Action Buttons Toolbar */}
        <div className="topbar-actions-group">
          {/* Top Header Security Siren & Alarm Toggle Switch */}
          <button
            type="button"
            className={`topbar-alarm-toggle-header-btn ${isAlarmSoundOn ? 'alarm-active' : 'alarm-muted'} ${isSirenPlaying ? 'siren-alerting' : ''}`}
            onClick={handleToggleSoundPreference}
            title={isAlarmSoundOn ? 'Security Siren & Audio Alarm: ON (Click to turn OFF)' : 'Security Siren & Audio Alarm: OFF (Click to turn ON)'}
            aria-label="Toggle Security Alarm Sound"
          >
            <span className="alarm-toggle-icon" aria-hidden="true">
              {isSirenPlaying ? '🚨' : isAlarmSoundOn ? '🚨' : '🔕'}
            </span>
            <span className="alarm-toggle-text">
              <span className="alarm-toggle-title">Alarm</span>
              <span className={`alarm-toggle-status ${isAlarmSoundOn ? 'status-on' : 'status-off'}`}>
                {isAlarmSoundOn ? 'ON' : 'OFF'}
              </span>
            </span>
            <span className={`alarm-switch-track ${isAlarmSoundOn ? 'track-on' : 'track-off'}`} aria-hidden="true">
              <span className={`alarm-switch-thumb ${isAlarmSoundOn ? 'thumb-on' : 'thumb-off'}`} />
            </span>
          </button>
          {/* Notifications Icon Button with Dynamic Unrecognized Faces Badge & Dropdown */}
          <div className="topbar-notif-wrap" ref={notifDropdownRef}>
            <button
              className={`topbar-action-btn ${showNotifications ? 'active' : ''} ${isSirenPlaying ? 'topbar-bell-ringing' : ''}`}
              title="Security & Visitor Notifications"
              aria-label="Notifications"
              onClick={handleToggleNotifications}
            >
              <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
                <path d="M13.73 21a2 2 0 0 1-3.46 0" />
              </svg>
              {unknownCount > 0 && (
                <span className="topbar-notification-badge" title={`${unknownCount} Unregistered Visitor(s)`}>
                  {unknownCount > 99 ? '99+' : unknownCount}
                </span>
              )}
            </button>

            {/* Security Notifications Dropdown */}
            {showNotifications && (
              <div className="topbar-notif-dropdown">
                <div className="topbar-notif-header">
                  <div className="topbar-notif-title-row">
                    <span className="topbar-notif-title">Security Notifications</span>
                    <span className={`topbar-notif-count-tag ${unknownCount === 0 ? 'all-clear' : ''}`}>
                      {unknownCount === 0 ? 'All Clear' : `${unknownCount} Unregistered`}
                    </span>
                  </div>
                  <span className="topbar-notif-sub">Unrecognized visitors captured at camera gates</span>

                  <div className="topbar-notif-actions">
                    <button
                      type="button"
                      onClick={handleMarkAllNotificationsRead}
                      disabled={unknownCount === 0}
                    >
                      Mark all as read
                    </button>
                    <button
                      type="button"
                      onClick={handleClearNotifications}
                      disabled={notificationIds.length === 0}
                    >
                      Clear all
                    </button>
                  </div>

                  {/* Multi-channel Security Alarm Controls Bar */}
                  <div className="topbar-alarm-controls-bar">
                    <button
                      type="button"
                      className={`topbar-alarm-toggle-btn ${isAlarmSoundOn ? 'active' : 'muted'}`}
                      onClick={handleToggleSoundPreference}
                      title={isAlarmSoundOn ? 'Security siren sound is enabled' : 'Security siren sound is muted'}
                    >
                      <span className="topbar-alarm-btn-icon">{isAlarmSoundOn ? '🔊' : '🔇'}</span>
                      <span>{isAlarmSoundOn ? 'Siren: Active' : 'Siren: Muted'}</span>
                    </button>
                  </div>
                </div>

                <div className="topbar-notif-list">
                  {recentUnknowns.length === 0 ? (
                    <div className="topbar-notif-empty">
                      <svg viewBox="0 0 24 24" width="28" height="28" fill="none" stroke="#10b981" strokeWidth="2">
                        <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
                        <polyline points="22 4 12 14.01 9 11.01" />
                      </svg>
                      <span>No unrecognized visitors pending</span>
                    </div>
                  ) : (
                    recentUnknowns.map((face) => {
                      const img = getFaceImageKey(face);
                      const timeStr = new Date(face.createdAt).toLocaleTimeString([], {
                        hour: '2-digit',
                        minute: '2-digit',
                      });
                      const camName = getCamInfo(face);
                      const title = getPersonTitle(face);
                      return (
                        <div
                          key={face.id}
                          className={`topbar-notif-item ${face.notificationRead ? 'is-read' : ''}`}
                          onClick={() => {
                            setShowNotifications(false);
                            navigate('/unknown-faces');
                          }}
                        >
                          <div className="topbar-notif-avatar">
                            {img ? (
                              <AuthenticatedMediaImage mediaKey={img} alt="Visitor" />
                            ) : (
                              <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor">
                                <circle cx="12" cy="7" r="4" />
                                <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
                              </svg>
                            )}
                          </div>
                          <div className="topbar-notif-item-body">
                            <div className="topbar-notif-item-title">
                              {title}
                            </div>
                            <div className="topbar-notif-item-meta">
                              {camName && <span>{camName} • </span>}
                              <span>{timeStr}</span>
                            </div>
                          </div>
                          <span className="topbar-notif-item-actions">
                            {face.notificationRead ? (
                              <span className="topbar-notif-read-badge">Read</span>
                            ) : (
                              <button
                                type="button"
                                className="topbar-notif-mark-read"
                                onClick={(event) => {
                                  event.stopPropagation();
                                  handleMarkNotificationRead(face.id);
                                }}
                              >
                                Mark read
                              </button>
                            )}
                          </span>
                        </div>
                      );
                    })
                  )}
                </div>

                <div className="topbar-notif-footer">
                  <button
                    type="button"
                    className="topbar-notif-viewall-btn"
                    onClick={() => {
                      setShowNotifications(false);
                      navigate('/unknown-faces');
                    }}
                  >
                    View All Unrecognized Faces →
                  </button>
                </div>
              </div>
            )}
          </div>

          {/* Settings button - directly opens Profile & Settings */}
          <button
            className="topbar-action-btn"
            title="Account & System Settings"
            aria-label="Settings"
            onClick={() => navigate('/settings')}
          >
            <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="3" />
              <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" />
            </svg>
          </button>

          {/* Dark / Light Theme Toggle */}
          <button
            className="topbar-action-btn theme-toggle-btn"
            onClick={toggleTheme}
            title={isDark ? 'Switch to Light Mode' : 'Switch to Dark Mode'}
            aria-label="Toggle dark mode"
          >
            {isDark ? (
              <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="5" />
                <line x1="12" y1="1" x2="12" y2="3" />
                <line x1="12" y1="21" x2="12" y2="23" />
                <line x1="4.22" y1="4.22" x2="5.64" y2="5.64" />
                <line x1="18.36" y1="18.36" x2="19.78" y2="19.78" />
                <line x1="1" y1="12" x2="3" y2="12" />
                <line x1="21" y1="12" x2="23" y2="12" />
                <line x1="4.22" y1="19.78" x2="5.64" y2="18.36" />
                <line x1="18.36" y1="5.64" x2="19.78" y2="4.22" />
              </svg>
            ) : (
              <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
              </svg>
            )}
          </button>

          {/* PWA Install Button (renders only when installable or iOS browser) */}
          <PwaInstallButton />
        </div>

        {/* Elegant vertical separator */}
        <div className="topbar-divider" />

        {/* User Chip: Shows Name & Company (Clickable to open Settings) */}
        <div
          className="topbar-user-chip topbar-user-chip-clickable"
          onClick={() => navigate('/settings')}
          title="Click to edit Name, Password & Company Settings"
          role="button"
          tabIndex={0}
        >
          <div className="topbar-avatar">
            {initials}
          </div>
          <div className="topbar-user-info-text">
            <span className="topbar-username">{displayName}</span>
            <span className="topbar-company-tag">{companyName}</span>
          </div>
        </div>

        {/* Outlined Logout Button */}
        <button className="header-logout-btn" onClick={handleLogout} title="Sign out of system">
          <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
            <polyline points="16 17 21 12 16 7" />
            <line x1="21" y1="12" x2="9" y2="12" />
          </svg>
          <span>Logout</span>
        </button>
      </div>

      {/* Real-time Unrecognized Face Detection Security Alarm Banner */}
      {latestAlert && (
        <aside className={`topbar-alert-toast ${isSirenPlaying ? 'siren-pulsing' : ''}`} role="alert" aria-live="assertive">
          <div className="topbar-toast-icon-wrap">
            <span className="topbar-toast-beacon"></span>
            <span className="topbar-toast-icon">🚨</span>
          </div>

          <div className="topbar-toast-content">
            <div className="topbar-toast-badge-row">
              <span className="topbar-toast-alarm-pill">LIVE SECURITY ALARM</span>
              <span className="topbar-toast-time-tag">Just now</span>
            </div>
            <div className="topbar-toast-title">Unrecognized Person Detected</div>
            <div className="topbar-toast-body">
              <span className="topbar-toast-name">{getPersonTitle(latestAlert)}</span>
              {getCamInfo(latestAlert) && (
                <span className="topbar-toast-cam"> • {getCamInfo(latestAlert)}</span>
              )}
            </div>
          </div>

          {getFaceImageKey(latestAlert) && (
            <AuthenticatedMediaImage mediaKey={getFaceImageKey(latestAlert)} alt="Visitor" className="topbar-toast-thumb" />
          )}

          <div className="topbar-toast-actions">
            <button
              type="button"
              className="topbar-toast-silence-btn"
              onClick={handleSilenceAlarm}
              title="Silence siren audio and dismiss banner"
            >
              🔕 Silence
            </button>

            <button
              type="button"
              className="topbar-toast-action-btn"
              onClick={() => {
                handleSilenceAlarm();
                navigate('/unknown-faces');
              }}
            >
              Review Face →
            </button>

            <button
              type="button"
              className="topbar-toast-close-btn"
              onClick={handleSilenceAlarm}
              title="Dismiss notification"
            >
              ✕
            </button>
          </div>
        </aside>
      )}

      {/* Scoped Modern CSS for Notifications */}
      <style>{`
        /* ── Top Header Alarm Toggle Button ── */
        .topbar-alarm-toggle-header-btn {
          display: inline-flex;
          align-items: center;
          gap: 8px;
          height: 38px;
          padding: 0 10px 0 10px;
          border-radius: 10px;
          font-family: inherit;
          font-size: 12px;
          font-weight: 600;
          cursor: pointer;
          transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1);
          user-select: none;
          border: 1px solid transparent;
          flex-shrink: 0;
        }

        .topbar-alarm-toggle-header-btn.alarm-active {
          background: #ecfdf5;
          border-color: #a7f3d0;
          color: #065f46;
          box-shadow: 0 1px 3px rgba(16, 185, 129, 0.12);
        }

        .topbar-alarm-toggle-header-btn.alarm-active:hover {
          background: #d1fae5;
          border-color: #6ee7b7;
        }

        .topbar-alarm-toggle-header-btn.alarm-muted {
          background: #f8fafc;
          border-color: #e2e8f0;
          color: #64748b;
          box-shadow: 0 1px 2px rgba(0, 0, 0, 0.04);
        }

        .topbar-alarm-toggle-header-btn.alarm-muted:hover {
          background: #f1f5f9;
          border-color: #cbd5e1;
          color: #475569;
        }

        .topbar-alarm-toggle-header-btn.siren-alerting {
          background: #fef2f2 !important;
          border-color: #f87171 !important;
          color: #b91c1c !important;
          animation: headerAlarmPulse 1s infinite alternate;
        }

        @keyframes headerAlarmPulse {
          from {
            box-shadow: 0 0 0 0 rgba(239, 68, 68, 0.4);
            transform: scale(1);
          }
          to {
            box-shadow: 0 0 12px 3px rgba(239, 68, 68, 0.6);
            transform: scale(1.02);
          }
        }

        .alarm-toggle-icon {
          font-size: 15px;
          line-height: 1;
          display: flex;
          align-items: center;
        }

        .alarm-toggle-text {
          display: flex;
          align-items: center;
          gap: 4px;
          letter-spacing: 0.01em;
        }

        .alarm-toggle-title {
          font-weight: 600;
        }

        .alarm-toggle-status.status-on {
          font-weight: 800;
          color: #059669;
          padding: 1px 6px;
          border-radius: 4px;
          background: rgba(16, 185, 129, 0.15);
          font-size: 11px;
        }

        .alarm-toggle-status.status-off {
          font-weight: 700;
          color: #94a3b8;
          padding: 1px 6px;
          border-radius: 4px;
          background: rgba(148, 163, 184, 0.14);
          font-size: 11px;
        }

        /* Toggle Switch Track & Thumb */
        .alarm-switch-track {
          width: 30px;
          height: 17px;
          border-radius: 9999px;
          position: relative;
          transition: background-color 0.2s cubic-bezier(0.4, 0, 0.2, 1);
          display: inline-block;
          flex-shrink: 0;
        }

        .alarm-switch-track.track-on {
          background: #10b981;
        }

        .alarm-switch-track.track-off {
          background: #cbd5e1;
        }

        .alarm-switch-thumb {
          width: 13px;
          height: 13px;
          border-radius: 50%;
          background: #ffffff;
          position: absolute;
          top: 2px;
          left: 2px;
          box-shadow: 0 1px 3px rgba(0, 0, 0, 0.25);
          transition: transform 0.2s cubic-bezier(0.4, 0, 0.2, 1);
        }

        .alarm-switch-thumb.thumb-on {
          transform: translateX(13px);
        }

        .alarm-switch-thumb.thumb-off {
          transform: translateX(0);
        }

        /* Dark mode overrides for Header Alarm Toggle */
        .dark .topbar-alarm-toggle-header-btn.alarm-active,
        [data-theme="dark"] .topbar-alarm-toggle-header-btn.alarm-active {
          background: rgba(16, 185, 129, 0.15) !important;
          border-color: rgba(16, 185, 129, 0.4) !important;
          color: #34d399 !important;
          box-shadow: 0 0 10px rgba(16, 185, 129, 0.2) !important;
        }

        .dark .topbar-alarm-toggle-header-btn.alarm-active:hover,
        [data-theme="dark"] .topbar-alarm-toggle-header-btn.alarm-active:hover {
          background: rgba(16, 185, 129, 0.25) !important;
          border-color: rgba(16, 185, 129, 0.6) !important;
        }

        .dark .topbar-alarm-toggle-header-btn.alarm-muted,
        [data-theme="dark"] .topbar-alarm-toggle-header-btn.alarm-muted {
          background: #1e244d !important;
          border-color: rgba(139, 92, 246, 0.25) !important;
          color: #94a3b8 !important;
          box-shadow: none !important;
        }

        .dark .topbar-alarm-toggle-header-btn.alarm-muted:hover,
        [data-theme="dark"] .topbar-alarm-toggle-header-btn.alarm-muted:hover {
          background: #252c5c !important;
          border-color: rgba(139, 92, 246, 0.45) !important;
          color: #cbd5e1 !important;
        }

        .dark .alarm-toggle-status.status-on,
        [data-theme="dark"] .alarm-toggle-status.status-on {
          color: #34d399 !important;
          background: rgba(16, 185, 129, 0.25) !important;
        }

        .dark .alarm-toggle-status.status-off,
        [data-theme="dark"] .alarm-toggle-status.status-off {
          color: #94a3b8 !important;
          background: rgba(148, 163, 184, 0.2) !important;
        }

        .dark .alarm-switch-track.track-off,
        [data-theme="dark"] .alarm-switch-track.track-off {
          background: #475569 !important;
        }

        @media (max-width: 640px) {
          .alarm-toggle-title {
            display: none;
          }
        }

        .topbar-notif-wrap {
          position: relative;
        }

        .topbar-notification-badge {
          position: absolute;
          top: 3px;
          right: 3px;
          min-width: 17px;
          height: 17px;
          border-radius: 9999px;
          background: #ef4444;
          color: #ffffff;
          font-size: 10px;
          font-weight: 800;
          display: flex;
          align-items: center;
          justify-content: center;
          padding: 0 4px;
          box-shadow: 0 0 8px rgba(239, 68, 68, 0.6);
          animation: badgePulse 2s infinite;
        }

        @keyframes badgePulse {
          0%, 100% { transform: scale(1); }
          50% { transform: scale(1.1); }
        }

        /* ── Notifications Dropdown ── */
        .topbar-notif-dropdown {
          position: absolute;
          top: calc(100% + 10px);
          right: -60px;
          width: 360px;
          max-width: 90vw;
          background: #ffffff;
          border: 1px solid #e2ece8;
          border-radius: 16px;
          box-shadow: 0 16px 36px rgba(0, 0, 0, 0.12);
          z-index: 1000;
          overflow: hidden;
          animation: notifSlideDown 0.18s ease-out;
        }

        @keyframes notifSlideDown {
          from { opacity: 0; transform: translateY(-8px); }
          to { opacity: 1; transform: translateY(0); }
        }

        .topbar-notif-header {
          padding: 14px 18px 12px;
          background: #f8fafc;
          border-bottom: 1px solid #f1f5f9;
        }

        .topbar-notif-title-row {
          display: flex;
          align-items: center;
          justify-content: space-between;
          margin-bottom: 3px;
        }

        .topbar-notif-title {
          font-size: 13.5px;
          font-weight: 700;
          color: #0f172a;
        }

        .topbar-notif-count-tag {
          font-size: 11px;
          font-weight: 700;
          color: #dc2626;
          background: #fef2f2;
          border: 1px solid #fecaca;
          padding: 2px 8px;
          border-radius: 999px;
        }

        .topbar-notif-count-tag.all-clear {
          color: #059669;
          background: #ecfdf5;
          border-color: #a7f3d0;
        }

        .topbar-notif-sub {
          font-size: 11px;
          color: #64748b;
          display: block;
        }

        .topbar-notif-actions {
          display: flex;
          gap: 8px;
          margin-top: 10px;
        }

        .topbar-notif-actions button,
        .topbar-notif-mark-read {
          border: 1px solid #dbe7e3;
          border-radius: 7px;
          background: #fff;
          color: #334155;
          padding: 5px 8px;
          font: inherit;
          font-size: 10.5px;
          font-weight: 700;
          cursor: pointer;
        }

        .topbar-notif-actions button:disabled {
          opacity: 0.45;
          cursor: default;
        }

        .topbar-notif-item.is-read {
          opacity: 0.72;
        }

        .topbar-notif-item-actions {
          flex-shrink: 0;
        }

        .topbar-notif-read-badge {
          color: #64748b;
          font-size: 10.5px;
          font-weight: 600;
        }

        .topbar-notif-list {
          max-height: 290px;
          overflow-y: auto;
        }

        .topbar-notif-empty {
          padding: 28px 18px;
          text-align: center;
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 8px;
          color: #64748b;
          font-size: 12.5px;
        }

        .topbar-notif-item {
          display: flex;
          align-items: center;
          gap: 12px;
          padding: 11px 16px;
          border-bottom: 1px solid #f1f5f9;
          cursor: pointer;
          transition: background 0.15s ease;
        }

        .topbar-notif-item:hover {
          background: #f8fafc;
        }

        .topbar-notif-avatar {
          width: 38px;
          height: 38px;
          border-radius: 10px;
          background: #0f172a;
          border: 1.5px solid #10b981;
          display: flex;
          align-items: center;
          justify-content: center;
          overflow: hidden;
          flex-shrink: 0;
          color: #34d399;
        }

        .topbar-notif-avatar img {
          width: 100%;
          height: 100%;
          object-fit: cover;
        }

        .topbar-notif-item-body {
          flex: 1;
          min-width: 0;
        }

        .topbar-notif-item-title {
          font-size: 13px;
          font-weight: 700;
          color: #0f172a;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }

        .topbar-notif-item-meta {
          font-size: 11px;
          color: #64748b;
          margin-top: 2px;
        }

        .topbar-notif-item-badge {
          font-size: 10.5px;
          font-weight: 700;
          color: #d97706;
          background: #fffbeb;
          border: 1px solid #fef3c7;
          padding: 2px 6px;
          border-radius: 6px;
          flex-shrink: 0;
        }

        .topbar-notif-footer {
          padding: 10px 14px;
          background: #ffffff;
          border-top: 1px solid #f1f5f9;
          text-align: center;
        }

        .topbar-notif-viewall-btn {
          width: 100%;
          padding: 8px 12px;
          border-radius: 8px;
          background: #f0fdf4;
          border: 1px solid #bbf7d0;
          color: #059669;
          font-size: 12.5px;
          font-weight: 700;
          cursor: pointer;
          transition: all 0.15s ease;
        }

        .topbar-notif-viewall-btn:hover {
          background: #dcfce7;
          border-color: #86efac;
        }

        /* ── Bell ringing animation during active security alarm ── */
        .topbar-bell-ringing {
          animation: bellShake 0.6s infinite ease-in-out;
          color: #ef4444 !important;
        }

        @keyframes bellShake {
          0%, 100% { transform: rotate(0deg); }
          20% { transform: rotate(-14deg); }
          40% { transform: rotate(14deg); }
          60% { transform: rotate(-8deg); }
          80% { transform: rotate(8deg); }
        }

        /* ── Multi-channel Security Alarm Controls in Dropdown ── */
        .topbar-alarm-controls-bar {
          display: flex;
          align-items: center;
          gap: 8px;
          margin-top: 10px;
          padding-top: 10px;
          border-top: 1px dashed #e2ece8;
        }

        .topbar-alarm-toggle-btn {
          flex: 1;
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 6px;
          padding: 6px 10px;
          border-radius: 8px;
          font-size: 11.5px;
          font-weight: 700;
          cursor: pointer;
          transition: all 0.15s ease;
          border: 1px solid #bbf7d0;
          background: #f0fdf4;
          color: #059669;
        }

        .topbar-alarm-toggle-btn.muted {
          border-color: #f1f5f9;
          background: #f8fafc;
          color: #64748b;
        }

        .topbar-alarm-toggle-btn:hover {
          filter: brightness(0.96);
        }

        .topbar-alarm-test-btn {
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 5px;
          padding: 6px 10px;
          border-radius: 8px;
          font-size: 11.5px;
          font-weight: 700;
          cursor: pointer;
          transition: all 0.15s ease;
          border: 1px solid #fecaca;
          background: #fef2f2;
          color: #dc2626;
        }

        .topbar-alarm-test-btn:hover {
          background: #fee2e2;
        }

        /* ── Real-Time Floating Security Alarm Toast ── */
        .topbar-alert-toast {
          position: fixed;
          top: 74px;
          right: 20px;
          z-index: 99999;
          background: #ffffff;
          border: 1px solid #fca5a5;
          border-left: 5px solid #dc2626;
          border-radius: 14px;
          padding: 12px 14px;
          display: flex;
          align-items: center;
          gap: 12px;
          box-shadow: 0 16px 36px rgba(220, 38, 38, 0.22);
          animation: toastSlideIn 0.35s cubic-bezier(0.16, 1, 0.3, 1);
          max-width: 470px;
        }

        .topbar-alert-toast.siren-pulsing {
          box-shadow: 0 0 0 4px rgba(239, 68, 68, 0.25), 0 16px 36px rgba(220, 38, 38, 0.35);
          animation: toastSlideIn 0.35s ease-out, toastAlarmPulse 1.2s infinite alternate;
        }

        @keyframes toastAlarmPulse {
          0% { border-color: #f87171; box-shadow: 0 0 0 2px rgba(239, 68, 68, 0.2), 0 12px 28px rgba(220, 38, 38, 0.2); }
          100% { border-color: #dc2626; box-shadow: 0 0 0 6px rgba(239, 68, 68, 0.35), 0 18px 40px rgba(220, 38, 38, 0.38); }
        }

        @keyframes toastSlideIn {
          from { opacity: 0; transform: translateY(-16px) scale(0.96); }
          to { opacity: 1; transform: translateY(0) scale(1); }
        }

        .topbar-toast-icon-wrap {
          position: relative;
          display: flex;
          align-items: center;
          justify-content: center;
          width: 38px;
          height: 38px;
          flex-shrink: 0;
        }

        .topbar-toast-beacon {
          position: absolute;
          width: 36px;
          height: 36px;
          border-radius: 9999px;
          background: rgba(239, 68, 68, 0.3);
          animation: beaconRings 1.4s infinite ease-out;
        }

        @keyframes beaconRings {
          0% { transform: scale(0.85); opacity: 0.9; }
          100% { transform: scale(1.6); opacity: 0; }
        }

        .topbar-toast-icon {
          font-size: 22px;
          position: relative;
          z-index: 1;
        }

        .topbar-toast-content {
          display: flex;
          flex-direction: column;
          gap: 2px;
          flex: 1;
          min-width: 0;
        }

        .topbar-toast-badge-row {
          display: flex;
          align-items: center;
          gap: 6px;
          margin-bottom: 2px;
        }

        .topbar-toast-alarm-pill {
          font-size: 9.5px;
          font-weight: 800;
          color: #ffffff;
          background: #dc2626;
          padding: 1.5px 6px;
          border-radius: 4px;
          letter-spacing: 0.4px;
        }

        .topbar-toast-time-tag {
          font-size: 10px;
          font-weight: 600;
          color: #94a3b8;
        }

        .topbar-toast-title {
          font-size: 12.5px;
          font-weight: 800;
          color: #991b1b;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }

        .topbar-toast-body {
          font-size: 11px;
          color: #475569;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }

        .topbar-toast-name {
          font-weight: 700;
          color: #0f172a;
        }

        .topbar-toast-thumb {
          width: 36px;
          height: 36px;
          border-radius: 8px;
          object-fit: cover;
          border: 1.5px solid #ef4444;
          flex-shrink: 0;
        }

        .topbar-toast-actions {
          display: flex;
          align-items: center;
          gap: 6px;
          flex-shrink: 0;
        }

        .topbar-toast-silence-btn {
          height: 28px;
          padding: 0 8px;
          border-radius: 6px;
          background: #f8fafc;
          border: 1px solid #cbd5e1;
          color: #475569;
          font-size: 11px;
          font-weight: 700;
          cursor: pointer;
          transition: all 0.15s ease;
          white-space: nowrap;
        }

        .topbar-toast-silence-btn:hover {
          background: #f1f5f9;
          color: #0f172a;
        }

        .topbar-toast-action-btn {
          height: 28px;
          padding: 0 10px;
          border-radius: 6px;
          background: #dc2626;
          color: #ffffff;
          border: none;
          font-size: 11px;
          font-weight: 700;
          cursor: pointer;
          flex-shrink: 0;
          transition: background 0.15s ease;
          white-space: nowrap;
        }

        .topbar-toast-action-btn:hover {
          background: #b91c1c;
        }

        .topbar-toast-close-btn {
          background: none;
          border: none;
          color: #94a3b8;
          font-size: 14px;
          cursor: pointer;
          padding: 2px 4px;
          line-height: 1;
        }

        .topbar-toast-close-btn:hover {
          color: #0f172a;
        }

        /* Responsive Mobile Layout for Alarm Banner */
        @media (max-width: 640px) {
          .topbar-alert-toast {
            top: 56px !important;
            left: 8px !important;
            right: 8px !important;
            max-width: calc(100vw - 16px) !important;
            padding: 10px !important;
            gap: 8px !important;
            border-radius: 12px !important;
          }

          .topbar-toast-actions {
            flex-direction: column;
            gap: 4px;
          }

          .topbar-toast-silence-btn,
          .topbar-toast-action-btn {
            height: 24px !important;
            font-size: 10px !important;
            padding: 0 6px !important;
          }
        }

        /* Dark Mode overrides */
        .dark .topbar-alarm-controls-bar,
        [data-theme="dark"] .topbar-alarm-controls-bar {
          border-top-color: rgba(139, 92, 246, 0.2) !important;
        }

        .dark .topbar-alarm-toggle-btn,
        [data-theme="dark"] .topbar-alarm-toggle-btn {
          background: rgba(16, 185, 129, 0.15) !important;
          border-color: rgba(16, 185, 129, 0.35) !important;
          color: #34d399 !important;
        }

        .dark .topbar-alarm-toggle-btn.muted,
        [data-theme="dark"] .topbar-alarm-toggle-btn.muted {
          background: rgba(148, 163, 184, 0.1) !important;
          border-color: rgba(148, 163, 184, 0.25) !important;
          color: #94a3b8 !important;
        }

        .dark .topbar-alarm-test-btn,
        [data-theme="dark"] .topbar-alarm-test-btn {
          background: rgba(239, 68, 68, 0.15) !important;
          border-color: rgba(239, 68, 68, 0.35) !important;
          color: #f87171 !important;
        }

        .dark .topbar-toast-silence-btn,
        [data-theme="dark"] .topbar-toast-silence-btn {
          background: #1e244d !important;
          border-color: rgba(139, 92, 246, 0.3) !important;
          color: #cbd5e1 !important;
        }

        .dark .topbar-notif-dropdown,
        [data-theme="dark"] .topbar-notif-dropdown {
          background: #151936 !important;
          border-color: rgba(139, 92, 246, 0.25) !important;
          box-shadow: 0 16px 36px rgba(0, 0, 0, 0.45) !important;
        }

        .dark .topbar-notif-header,
        [data-theme="dark"] .topbar-notif-header {
          background: #181d3d !important;
          border-bottom-color: rgba(139, 92, 246, 0.2) !important;
        }

        .dark .topbar-notif-title,
        [data-theme="dark"] .topbar-notif-title {
          color: #f1f5f9 !important;
        }

        .dark .topbar-notif-sub,
        [data-theme="dark"] .topbar-notif-sub {
          color: #94a3b8 !important;
        }

        .dark .topbar-notif-item,
        [data-theme="dark"] .topbar-notif-item {
          border-bottom-color: rgba(139, 92, 246, 0.12) !important;
        }

        .dark .topbar-notif-item:hover,
        [data-theme="dark"] .topbar-notif-item:hover {
          background: rgba(16, 185, 129, 0.08) !important;
        }

        .dark .topbar-notif-item-title,
        [data-theme="dark"] .topbar-notif-item-title {
          color: #f1f5f9 !important;
        }

        .dark .topbar-notif-footer,
        [data-theme="dark"] .topbar-notif-footer {
          background: #151936 !important;
          border-top-color: rgba(139, 92, 246, 0.2) !important;
        }

        .dark .topbar-notif-viewall-btn,
        [data-theme="dark"] .topbar-notif-viewall-btn {
          background: rgba(16, 185, 129, 0.15) !important;
          border-color: rgba(16, 185, 129, 0.35) !important;
          color: #34d399 !important;
        }

        .dark .topbar-alert-toast,
        [data-theme="dark"] .topbar-alert-toast {
          background: #181d3d !important;
          border-color: rgba(239, 68, 68, 0.4) !important;
          border-left-color: #ef4444 !important;
          box-shadow: 0 12px 32px rgba(0, 0, 0, 0.5) !important;
        }

        .dark .topbar-toast-title,
        [data-theme="dark"] .topbar-toast-title {
          color: #f87171 !important;
        }

        .dark .topbar-toast-body,
        [data-theme="dark"] .topbar-toast-body {
          color: #cbd5e1 !important;
        }

        .dark .topbar-toast-name,
        [data-theme="dark"] .topbar-toast-name {
          color: #f1f5f9 !important;
        }
      `}</style>
    </header>
  );
};

export default Header;
