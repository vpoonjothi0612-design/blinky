import React, { useState, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import useAuth from '../../hooks/useAuth';
import {
  getCameras,
  deleteCamera,
  getCameraStreamStatus,
  startCameraStream,
  testCameraStreamConnection,
  testRtspCamera,
  getCameraStreamEvents,
} from './camera.service';
import Loader from '../../components/common/Loader';
import Modal from '../../components/common/Modal';

const cameraReachabilityLabel = (camera, reachable) => {
  if (camera.status === 'INACTIVE') return 'INACTIVE';
  if (!camera.ipAddress) return 'NOT CONFIGURED';
  return reachable ? 'NETWORK REACHABLE' : 'NETWORK UNREACHABLE';
};

const isCameraReachable = (camera, streamStatus) => {
  const ipAddress = String(camera?.ipAddress || '').trim();
  const eventStreamMatches = Boolean(
    ipAddress &&
    streamStatus?.connected &&
    (streamStatus.cameraIp === ipAddress || streamStatus.configuredUrl?.includes(ipAddress))
  );
  return Boolean(camera?.isOnline ?? (camera?.connectionStatus === 'ONLINE' || eventStreamMatches));
};

const CameraList = () => {
  const navigate = useNavigate();
  const { user } = useAuth();
  const isAdmin = (user?.role || '').toUpperCase() === 'ADMIN' || (user?.role || '').toUpperCase() === 'SUPER_ADMIN';

  const [cameras, setCameras] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  // CP PLUS Camera API Stream Status State
  const [streamStatus, setStreamStatus] = useState(null);
  const [streamLoading, setStreamLoading] = useState(false);
  const [testResult, setTestResult] = useState(null);
  const [testingConnection, setTestingConnection] = useState(false);
  const [rtspTests, setRtspTests] = useState({});
  const [eventsModalOpen, setEventsModalOpen] = useState(false);
  const [recentEvents, setRecentEvents] = useState([]);
  const [loadingEvents, setLoadingEvents] = useState(false);

  // Sorting
  const [sortField, setSortField] = useState('NAME');
  const [sortAsc, setSortAsc] = useState(true);

  // Delete Modal
  const [deleteModal, setDeleteModal] = useState({
    isOpen: false,
    camera: null,
    loading: false,
  });

  const fetchStreamStatus = async () => {
    try {
      const data = await getCameraStreamStatus();
      setStreamStatus(data);
    } catch (err) {
      console.warn('Failed to load camera stream status:', err);
    }
  };

  const handleTestConnection = async () => {
    setTestingConnection(true);
    setTestResult(null);
    try {
      const res = await testCameraStreamConnection();
      setTestResult(res?.data || res);
      fetchStreamStatus();
    } catch (err) {
      setTestResult({
        success: false,
        error: err.response?.data?.message || err.message || 'Connection test failed',
      });
    } finally {
      setTestingConnection(false);
    }
  };

  const handleRtspTest = async (cameraId) => {
    setRtspTests((previous) => ({
      ...previous,
      [cameraId]: { loading: true, result: null },
    }));
    try {
      const response = await testRtspCamera(cameraId);
      setRtspTests((previous) => ({
        ...previous,
        [cameraId]: { loading: false, result: response.data || response },
      }));
    } catch (err) {
      setRtspTests((previous) => ({
        ...previous,
        [cameraId]: {
          loading: false,
          result: {
            success: false,
            state: err.response?.data?.data?.state || 'SERVICE_UNAVAILABLE',
            error: err.response?.data?.message || err.message || 'RTSP test failed.',
          },
        },
      }));
    }
  };

  const handleRestartStream = async () => {
    setStreamLoading(true);
    try {
      await startCameraStream();
      await fetchStreamStatus();
    } catch (err) {
      alert(err.response?.data?.message || 'Failed to restart camera stream');
    } finally {
      setStreamLoading(false);
    }
  };

  const handleOpenEventsModal = async () => {
    setEventsModalOpen(true);
    setLoadingEvents(true);
    try {
      const res = await getCameraStreamEvents();
      setRecentEvents(res?.data || []);
    } catch (err) {
      console.warn('Failed to fetch events:', err);
    } finally {
      setLoadingEvents(false);
    }
  };

  const fetchCameras = async () => {
    setLoading(true);
    setError('');
    try {
      const response = await getCameras();
      setCameras(response.data || []);
    } catch (err) {
      setError(err.response?.data?.message || 'Failed to fetch camera records.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchCameras();
    fetchStreamStatus();

    // Poll stream status every 10 seconds
    const timer = setInterval(() => {
      fetchStreamStatus();
    }, 10000);

    return () => clearInterval(timer);
  }, []);

  const handleSort = (field) => {
    if (sortField === field) {
      setSortAsc(!sortAsc);
    } else {
      setSortField(field);
      setSortAsc(true);
    }
  };

  const sortedCameras = useMemo(() => {
    return [...cameras].sort((a, b) => {
      let valA = '';
      let valB = '';

      switch (sortField) {
        case 'NAME':
          valA = a.name || '';
          valB = b.name || '';
          break;
        case 'LOCATION':
          valA = a.location || '';
          valB = b.location || '';
          break;
        case 'IP':
          valA = a.ipAddress || '';
          valB = b.ipAddress || '';
          break;
        case 'URL':
          valA = a.rtspUrl || '';
          valB = b.rtspUrl || '';
          break;
        case 'STATUS':
          valA = a.status || '';
          valB = b.status || '';
          break;
        default:
          break;
      }

      if (valA < valB) return sortAsc ? -1 : 1;
      if (valA > valB) return sortAsc ? 1 : -1;
      return 0;
    });
  }, [cameras, sortField, sortAsc]);

  const openDeleteModal = (camera) => {
    setDeleteModal({ isOpen: true, camera, loading: false });
  };

  const closeDeleteModal = () => {
    setDeleteModal({ isOpen: false, camera: null, loading: false });
  };

  const handleDeleteConfirm = async () => {
    if (!deleteModal.camera) return;
    setDeleteModal((prev) => ({ ...prev, loading: true }));
    try {
      await deleteCamera(deleteModal.camera.id);
      closeDeleteModal();
      fetchCameras();
    } catch (err) {
      alert(err.response?.data?.message || 'Failed to delete camera.');
      setDeleteModal((prev) => ({ ...prev, loading: false }));
    }
  };

  // Determine stream status display
  const isConnected = streamStatus?.connected;
  const isReconnecting = streamStatus?.status === 'RECONNECTING';
  const endpointUrl = streamStatus?.configuredUrl || 'Not configured';

  return (
    <div className="camera-feeds-page fade-in">
      {/* ── 1. PAGE HEADER ─────────────────────────────────────────────── */}
      <div className="cam-header-row">
        <div className="cam-header-left">
          <div className="cam-icon-box">
            <svg
              viewBox="0 0 24 24"
              width="26"
              height="26"
              fill="none"
              stroke="#059669"
              strokeWidth="2.2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M23 7l-7 5 7 5V7z" />
              <rect x="1" y="5" width="15" height="14" rx="2" ry="2" />
            </svg>
          </div>
          <div className="cam-header-text">
            <h1 className="cam-title">Camera Feeds</h1>
            <p className="cam-subtitle">
              Configure and monitor attendance cameras, RTSP streams, and detection zones.
            </p>
          </div>
        </div>

        {isAdmin && (
          <button
            type="button"
            className="cam-btn-add"
            onClick={() => navigate('/cameras/create')}
          >
            <svg
              viewBox="0 0 24 24"
              width="16"
              height="16"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <line x1="12" y1="5" x2="12" y2="19" />
              <line x1="5" y1="12" x2="19" y2="12" />
            </svg>
            <span>Add Camera</span>
          </button>
        )}
      </div>

      {error && <div className="alert alert-danger" style={{ marginBottom: '20px' }}>{error}</div>}

      {/* ── 2. CP PLUS / DAHUA CAMERA STREAM BANNER CARD ───────────────── */}
      <div className="cam-stream-card">
        <div className="cam-stream-left">
          <div className="cam-stream-icon-wrap">
            <svg
              viewBox="0 0 24 24"
              width="22"
              height="22"
              fill="none"
              stroke="#059669"
              strokeWidth="2.2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M23 7l-7 5 7 5V7z" />
              <rect x="1" y="5" width="15" height="14" rx="2" ry="2" />
            </svg>
          </div>
          <div className="cam-stream-info">
            <div className="cam-stream-title-row">
              <span className="cam-stream-title">Camera AlarmMaster Event API</span>
              <span
                className={`cam-stream-status-pill ${
                  isConnected
                    ? 'status-online'
                    : isReconnecting
                    ? 'status-reconnecting'
                    : 'status-offline'
                }`}
              >
                <span className="cam-status-dot" />
                <span>{isConnected ? 'API ONLINE' : 'API OFFLINE'}</span>
              </span>
            </div>
            <div className="cam-stream-endpoint-row">
              <span className="endpoint-label">Endpoint:</span>
              <code className="endpoint-code">{endpointUrl}</code>
            </div>
          </div>
        </div>

        <div className="cam-stream-actions">
          <button
            type="button"
            className="cam-action-btn-white"
            onClick={handleTestConnection}
            disabled={testingConnection}
          >
            <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
              <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
            </svg>
            <span>{testingConnection ? 'Testing...' : 'Test Camera API'}</span>
          </button>

          <button
            type="button"
            className="cam-action-btn-white"
            onClick={handleRestartStream}
            disabled={streamLoading}
          >
            <svg
              viewBox="0 0 24 24"
              width="14"
              height="14"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.2"
              strokeLinecap="round"
              strokeLinejoin="round"
              style={{ animation: streamLoading ? 'spin 1s linear infinite' : 'none' }}
            >
              <polyline points="23 4 23 10 17 10" />
              <polyline points="1 20 1 14 7 14" />
              <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" />
            </svg>
            <span>{streamLoading ? 'Reconnecting...' : 'Reconnect Stream'}</span>
          </button>

          <button
            type="button"
            className="cam-btn-events"
            onClick={handleOpenEventsModal}
          >
            <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
              <polyline points="14 2 14 8 20 8" />
              <line x1="16" y1="13" x2="8" y2="13" />
              <line x1="16" y1="17" x2="8" y2="17" />
              <polyline points="10 9 9 9 8 9" />
            </svg>
            <span>Live Event Logs ({streamStatus?.stats?.eventsCount || 0})</span>
          </button>
        </div>
      </div>

      {/* Test Connection Alert Feedback */}
      {testResult && (
        <div
          className={`cam-test-feedback ${
            testResult.success ? 'feedback-success' : 'feedback-error'
          }`}
        >
          <div>
            <strong>{testResult.success ? '✓ Camera API Reachable: ' : '✗ Camera API Test Notice: '}</strong>
            {testResult.success
              ? `HTTP ${testResult.statusCode} (${testResult.statusMessage || 'OK'}), Latency: ${testResult.latencyMs}ms, Server: ${testResult.server || 'Camera'}`
              : testResult.error || 'Could not reach camera at configured endpoint.'}
          </div>
          <button
            type="button"
            className="feedback-close-btn"
            onClick={() => setTestResult(null)}
          >
            ×
          </button>
        </div>
      )}

      <section
        aria-label="RTSP camera decode tests"
        style={{
          display: 'flex',
          flexWrap: 'wrap',
          alignItems: 'center',
          gap: '12px',
          padding: '16px 20px',
          marginBottom: '18px',
          border: '1px solid #dbe3ec',
          borderRadius: '12px',
          background: '#fff',
        }}
      >
        <div style={{ minWidth: '220px', flex: '1 1 260px' }}>
          <strong>RTSP stream &amp; frame decode test</strong>
          <div style={{ marginTop: '4px', color: '#64748b', fontSize: '13px' }}>
            Uses camera credentials stored in the AI service&apos;s local environment.
          </div>
        </div>
        {[
          ['CAM-01', 'Exit · OUT'],
          ['CAM-02', 'Entry · IN'],
        ].map(([cameraId, label]) => {
          const test = rtspTests[cameraId];
          const result = test?.result;
          return (
            <div key={cameraId} style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
              <button
                type="button"
                className="cam-action-btn-white"
                onClick={() => handleRtspTest(cameraId)}
                disabled={test?.loading}
                aria-label={`Test RTSP stream for ${cameraId} ${label}`}
              >
                {test?.loading ? `Testing ${cameraId}…` : `Test ${cameraId} · ${label}`}
              </button>
              {result && (
                <div
                  role="status"
                  aria-live="polite"
                  style={{
                    maxWidth: '300px',
                    color: result.success ? '#047857' : '#b91c1c',
                    fontSize: '12px',
                  }}
                >
                  <strong>{result.state || 'UNKNOWN'}</strong>
                  {result.resolution && ` · ${result.resolution}`}
                  {Number.isFinite(result.fps) && ` · ${result.fps} measured FPS`}
                  {result.codec && ` · ${result.codec}`}
                  {Number.isFinite(result.frames_decoded) && ` · ${result.frames_decoded} frames decoded`}
                  {result.first_frame_ms != null && ` · first frame ${result.first_frame_ms} ms`}
                  {result.error && <div>{result.error}</div>}
                </div>
              )}
            </div>
          );
        })}
      </section>

      {/* ── 3. CAMERAS TABLE CARD ─────────────────────────────────────── */}
      <div className="cam-table-card">
        {loading ? (
          <div style={{ padding: '60px 0' }}>
            <Loader message="Loading camera records..." />
          </div>
        ) : (
          <>
            {/* Desktop Table View */}
            <div className="cam-table-wrap cam-desktop-table table-responsive" style={{ overflowX: 'auto', width: '100%' }}>
              <table className="cam-custom-table">
                <thead>
                  <tr>
                    <th onClick={() => handleSort('NAME')} style={{ cursor: 'pointer', width: '22%' }}>
                      <div className="cam-th-content">
                        <span>CAMERA NAME</span>
                        <svg width="10" height="12" viewBox="0 0 10 12" fill="none" className="sort-arrows">
                          <path d="M5 2L2 5h6L5 2z" fill="#047857" opacity={sortField === 'NAME' && sortAsc ? 1 : 0.4} />
                          <path d="M5 10l3-3H2l3 3z" fill="#047857" opacity={sortField === 'NAME' && !sortAsc ? 1 : 0.4} />
                        </svg>
                      </div>
                    </th>
                    <th onClick={() => handleSort('LOCATION')} style={{ cursor: 'pointer', width: '18%' }}>
                      <div className="cam-th-content">
                        <span>LOCATION</span>
                        <svg width="10" height="12" viewBox="0 0 10 12" fill="none" className="sort-arrows">
                          <path d="M5 2L2 5h6L5 2z" fill="#047857" opacity={sortField === 'LOCATION' && sortAsc ? 1 : 0.4} />
                          <path d="M5 10l3-3H2l3 3z" fill="#047857" opacity={sortField === 'LOCATION' && !sortAsc ? 1 : 0.4} />
                        </svg>
                      </div>
                    </th>
                    <th onClick={() => handleSort('IP')} style={{ cursor: 'pointer', width: '16%' }}>
                      <div className="cam-th-content">
                        <span>IP ADDRESS</span>
                        <svg width="10" height="12" viewBox="0 0 10 12" fill="none" className="sort-arrows">
                          <path d="M5 2L2 5h6L5 2z" fill="#047857" opacity={sortField === 'IP' && sortAsc ? 1 : 0.4} />
                          <path d="M5 10l3-3H2l3 3z" fill="#047857" opacity={sortField === 'IP' && !sortAsc ? 1 : 0.4} />
                        </svg>
                      </div>
                    </th>
                    <th onClick={() => handleSort('URL')} style={{ cursor: 'pointer', width: '22%' }}>
                      <div className="cam-th-content">
                        <span>RTSP URL</span>
                        <svg width="10" height="12" viewBox="0 0 10 12" fill="none" className="sort-arrows">
                          <path d="M5 2L2 5h6L5 2z" fill="#047857" opacity={sortField === 'URL' && sortAsc ? 1 : 0.4} />
                          <path d="M5 10l3-3H2l3 3z" fill="#047857" opacity={sortField === 'URL' && !sortAsc ? 1 : 0.4} />
                        </svg>
                      </div>
                    </th>
                    <th onClick={() => handleSort('STATUS')} style={{ cursor: 'pointer', width: '12%' }}>
                      <div className="cam-th-content">
                        <span>STATUS</span>
                        <svg width="10" height="12" viewBox="0 0 10 12" fill="none" className="sort-arrows">
                          <path d="M5 2L2 5h6L5 2z" fill="#047857" opacity={sortField === 'STATUS' && sortAsc ? 1 : 0.4} />
                          <path d="M5 10l3-3H2l3 3z" fill="#047857" opacity={sortField === 'STATUS' && !sortAsc ? 1 : 0.4} />
                        </svg>
                      </div>
                    </th>
                    <th style={{ width: '10%', textAlign: 'center' }}>ACTIONS</th>
                  </tr>
                </thead>
                <tbody>
                  {sortedCameras.length === 0 ? (
                    <tr>
                      <td colSpan={6} style={{ padding: 0 }}>
                        <div className="cam-empty-wrap">
                          {/* Empty Illustration with Halo, CCTV Camera, & Sparkles */}
                          <div className="cam-empty-icon">
                            <svg width="86" height="86" viewBox="0 0 90 90" fill="none">
                              {/* Star sparkles */}
                              <path d="M22 36 L24 38 L22 40 L20 38 Z" fill="#34d399" />
                              <circle cx="28" cy="24" r="1.5" fill="#10b981" />
                              <circle cx="68" cy="24" r="1.5" fill="#10b981" />
                              <path d="M72 36 L74 38 L72 40 L70 38 Z" fill="#34d399" />

                              {/* Soft glowing aura */}
                              <ellipse cx="45" cy="45" rx="36" ry="26" fill="#ecfdf5" />

                              {/* CCTV Security Camera Lineart pointing down-right */}
                              <g transform="translate(18, 18)">
                                {/* Wall mount base */}
                                <path
                                  d="M6 34 L12 34 M9 34 L9 26 L16 26"
                                  stroke="#059669"
                                  strokeWidth="2.5"
                                  strokeLinecap="round"
                                />
                                {/* Camera body angled */}
                                <polygon
                                  points="16,21 38,13 42,24 20,32"
                                  fill="#ffffff"
                                  stroke="#059669"
                                  strokeWidth="2.5"
                                  strokeLinejoin="round"
                                />
                                {/* Camera lens cap front */}
                                <line
                                  x1="38"
                                  y1="13"
                                  x2="42"
                                  y2="24"
                                  stroke="#059669"
                                  strokeWidth="3"
                                  strokeLinecap="round"
                                />
                                {/* Lens cone */}
                                <polygon
                                  points="42,16 48,14 48,23 42,21"
                                  fill="#d1fae5"
                                  stroke="#059669"
                                  strokeWidth="2"
                                />
                                {/* Blinking red LED indicator */}
                                <circle cx="22" cy="25" r="1.5" fill="#ef4444" />
                              </g>
                            </svg>
                          </div>
                          <h3 className="cam-empty-title">
                            No cameras registered yet.
                          </h3>
                          <p className="cam-empty-desc">
                            Click &quot;Add Camera&quot; to configure your first camera.
                          </p>
                        </div>
                      </td>
                    </tr>
                  ) : (
                    sortedCameras.map((row) => (
                      <tr key={row.id}>
                        <td>
                          <div className="cam-name-cell">
                            <div className="cam-name-icon">
                              <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="#059669" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                <path d="M23 7l-7 5 7 5V7z" />
                                <rect x="1" y="5" width="15" height="14" rx="2" ry="2" />
                              </svg>
                            </div>
                            <span className="cam-name-text">{row.name}</span>
                          </div>
                        </td>
                        <td>
                          <span className="cam-location-pill">{row.location || '—'}</span>
                        </td>
                        <td>
                          {row.ipAddress ? (
                            <span className="cam-ip-badge">{row.ipAddress}</span>
                          ) : (
                            '—'
                          )}
                        </td>
                        <td>
                          <span className="cam-rtsp-text" title={row.rtspUrl}>
                            {row.rtspUrl || '—'}
                          </span>
                        </td>
                        <td>
                          {(() => {
                            const isOnline = isCameraReachable(row, streamStatus);
                            return (
                              <span className={`cam-status-pill ${isOnline ? 'status-active' : 'status-inactive'}`}>
                                <span className="cam-status-dot" />
                                <span title="Network reachability only; use the RTSP decode test to verify video.">
                                  {cameraReachabilityLabel(row, isOnline)}
                                </span>
                              </span>
                            );
                          })()}
                        </td>
                        <td style={{ textAlign: 'center' }}>
                          <div className="cam-actions-wrap">
                            <button
                              type="button"
                              className="cam-action-btn view"
                              onClick={() => navigate(`/cameras/${row.id}`)}
                              title="View Camera Details"
                            >
                              <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
                                <circle cx="12" cy="12" r="3" />
                              </svg>
                            </button>
                            {isAdmin && (
                              <>
                                <button
                                  type="button"
                                  className="cam-action-btn edit"
                                  onClick={() => navigate(`/cameras/${row.id}/edit`)}
                                  title="Edit Camera Configuration"
                                >
                                  <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                    <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
                                    <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
                                  </svg>
                                </button>
                                <button
                                  type="button"
                                  className="cam-action-btn delete"
                                  onClick={() => openDeleteModal(row)}
                                  title="Delete Camera"
                                >
                                  <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                    <polyline points="3 6 5 6 21 6" />
                                    <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                                  </svg>
                                </button>
                              </>
                            )}
                          </div>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>

            {/* Dedicated Mobile Cards View (Visible on screens <= 768px) */}
            <div className="cam-mobile-cards">
              {sortedCameras.length === 0 ? (
                <div className="cam-empty-wrap">
                  <div className="cam-empty-icon">
                    <svg width="68" height="68" viewBox="0 0 90 90" fill="none">
                      <ellipse cx="45" cy="45" rx="36" ry="26" fill="#ecfdf5" />
                      <g transform="translate(18, 18)">
                        <path d="M6 34 L12 34 M9 34 L9 26 L16 26" stroke="#059669" strokeWidth="2.5" strokeLinecap="round" />
                        <polygon points="16,21 38,13 42,24 20,32" fill="#ffffff" stroke="#059669" strokeWidth="2.5" strokeLinejoin="round" />
                        <line x1="38" y1="13" x2="42" y2="24" stroke="#059669" strokeWidth="3" strokeLinecap="round" />
                        <polygon points="42,16 48,14 48,23 42,21" fill="#d1fae5" stroke="#059669" strokeWidth="2" />
                        <circle cx="22" cy="25" r="1.5" fill="#ef4444" />
                      </g>
                    </svg>
                  </div>
                  <h3 className="cam-empty-title">No cameras registered yet.</h3>
                  <p className="cam-empty-desc">Click &quot;Add Camera&quot; to configure your first camera.</p>
                </div>
              ) : (
                sortedCameras.map((row) => {
                  const isOnline = isCameraReachable(row, streamStatus);
                  return (
                    <div key={row.id} className="cam-m-card">
                      <div className="cam-m-card-header">
                        <div className="cam-m-header-left">
                          <div className={`cam-m-avatar ${isOnline ? 'online' : 'offline'}`}>
                            <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                              <path d="M23 7l-7 5 7 5V7z" />
                              <rect x="1" y="5" width="15" height="14" rx="2" ry="2" />
                            </svg>
                          </div>
                          <div className="cam-m-header-titles">
                            <span className="cam-m-name">{row.name}</span>
                            <div className="cam-m-location">
                              <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="#64748b" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
                                <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z" />
                                <circle cx="12" cy="10" r="3" />
                              </svg>
                              <span>{row.location || 'No location set'}</span>
                            </div>
                          </div>
                        </div>
                        <span className={`cam-status-pill ${isOnline ? 'status-active' : 'status-inactive'}`}>
                          <span className="cam-status-dot" />
                          <span title="Network reachability only; use the RTSP decode test to verify video.">
                            {cameraReachabilityLabel(row, isOnline)}
                          </span>
                        </span>
                      </div>

                      <div className="cam-m-body">
                        <div className="cam-m-grid">
                          <div className="cam-m-info-box">
                            <span className="cam-m-label">IP ADDRESS</span>
                            <span className="cam-m-value ip-code">{row.ipAddress || '—'}</span>
                          </div>
                          <div className="cam-m-info-box">
                            <span className="cam-m-label">STREAM TYPE</span>
                            <span className="cam-m-value">RTSP / H.264</span>
                          </div>
                        </div>

                        {row.rtspUrl && (
                          <div className="cam-m-url-box">
                            <span className="cam-m-label">RTSP STREAM URL</span>
                            <code className="cam-m-url-text" title={row.rtspUrl}>
                              {row.rtspUrl}
                            </code>
                          </div>
                        )}
                      </div>

                      <div className="cam-m-footer">
                        <button
                          type="button"
                          className="cam-m-btn view"
                          onClick={() => navigate(`/cameras/${row.id}`)}
                        >
                          <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
                            <circle cx="12" cy="12" r="3" />
                          </svg>
                          <span>View Feed</span>
                        </button>
                        {isAdmin && (
                          <>
                            <button
                              type="button"
                              className="cam-m-btn edit"
                              onClick={() => navigate(`/cameras/${row.id}/edit`)}
                            >
                              <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
                                <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
                              </svg>
                              <span>Edit</span>
                            </button>
                            <button
                              type="button"
                              className="cam-m-btn delete"
                              onClick={() => openDeleteModal(row)}
                            >
                              <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                <polyline points="3 6 5 6 21 6" />
                                <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                              </svg>
                              <span>Delete</span>
                            </button>
                          </>
                        )}
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </>
        )}

        {/* Table Footer */}
        <div className="cam-table-footer">
          <span className="cam-footer-count">
            Showing {sortedCameras.length} of {sortedCameras.length} records
          </span>

          <div className="cam-pagination">
            <button type="button" className="cam-page-arrow" disabled>
              <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="15 18 9 12 15 6" />
              </svg>
            </button>
            <button type="button" className="cam-page-num active">
              1
            </button>
            <button type="button" className="cam-page-arrow" disabled>
              <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="9 18 15 12 9 6" />
              </svg>
            </button>
          </div>
        </div>
      </div>

      {/* ── 5. DELETE MODAL ───────────────────────────────────────────── */}
      <Modal
        isOpen={deleteModal.isOpen}
        title="Confirm Delete"
        onClose={closeDeleteModal}
        onConfirm={handleDeleteConfirm}
        confirmText="Delete"
        confirmVariant="danger"
        loading={deleteModal.loading}
      >
        <p style={{ margin: 0, fontSize: '14px', color: '#334155' }}>
          Are you sure you want to delete camera{' '}
          <strong>{deleteModal.camera?.name}</strong>? This action cannot be undone.
        </p>
      </Modal>

      {/* ── 6. CAMERA LIVE EVENT LOGS MODAL ───────────────────────────── */}
      <Modal
        isOpen={eventsModalOpen}
        title="CP PLUS Camera Live Event Logs"
        onClose={() => setEventsModalOpen(false)}
        hideCancel
        confirmText="Close"
        onConfirm={() => setEventsModalOpen(false)}
        className="modal-lg"
      >
        <div style={{ maxHeight: '480px', overflowY: 'auto', fontSize: '13px' }}>
          {loadingEvents ? (
            <div style={{ padding: '30px 0' }}>
              <Loader message="Fetching camera event stream history..." />
            </div>
          ) : recentEvents.length === 0 ? (
            <div style={{ padding: '30px 20px', textAlign: 'center', color: '#64748b' }}>
              <p style={{ margin: '0 0 6px 0', fontWeight: 600, color: '#0f172a' }}>
                No face detection events recorded in the current session yet.
              </p>
              <span style={{ fontSize: '12px' }}>
                When an employee or visitor appears in front of the camera, live detection events and attendance timestamps will appear here.
              </span>
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              {recentEvents.map((evt) => (
                <div
                  key={evt.id}
                  style={{
                    padding: '10px 14px',
                    borderRadius: '8px',
                    background: '#f8fafc',
                    border: '1px solid #e2e8f0',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                    <span style={{ fontWeight: 600, color: '#0f172a' }}>
                      {evt.action || 'FaceDetection'}
                    </span>
                    <span style={{ fontSize: '11px', color: '#64748b' }}>
                      Index: {evt.index}
                    </span>
                  </div>
                  <div style={{ fontSize: '12px', color: '#64748b' }}>
                    {new Date(evt.timestamp).toLocaleTimeString()}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </Modal>

      {/* ── 7. SCOPED MODERN CSS ───────────────────────────────────────── */}
      <style>{`
        .camera-feeds-page {
          width: 100%;
          padding: 24px 28px 48px;
          color: #0f172a;
          box-sizing: border-box;
          background: #f4fbf7;
          min-height: calc(100vh - 70px);
        }

        /* ── Header ── */
        .cam-header-row {
          display: flex;
          align-items: center;
          justify-content: space-between;
          margin-bottom: 22px;
          flex-wrap: wrap;
          gap: 16px;
        }

        .cam-header-left {
          display: flex;
          align-items: center;
          gap: 16px;
        }

        .cam-icon-box {
          width: 52px;
          height: 52px;
          border-radius: 14px;
          background: #d1fae5;
          display: flex;
          align-items: center;
          justify-content: center;
          color: #059669;
          flex-shrink: 0;
          box-shadow: 0 4px 12px rgba(16, 185, 129, 0.15);
        }

        .cam-header-text {
          display: flex;
          flex-direction: column;
        }

        .cam-title {
          font-size: 26px;
          font-weight: 800;
          color: #0f172a;
          letter-spacing: -0.01em;
          margin: 0 0 4px 0;
          line-height: 1.2;
        }

        .cam-subtitle {
          font-size: 14px;
          color: #475569;
          margin: 0;
          font-weight: 500;
        }

        .cam-btn-add {
          height: 42px;
          padding: 0 20px;
          border-radius: 10px;
          background: linear-gradient(135deg, #059669 0%, #10b981 100%);
          color: #ffffff;
          border: none;
          font-size: 13.5px;
          font-weight: 600;
          display: inline-flex;
          align-items: center;
          gap: 8px;
          cursor: pointer;
          transition: all 0.2s ease;
          box-shadow: 0 4px 12px rgba(16, 185, 129, 0.28);
        }

        .cam-btn-add:hover {
          opacity: 0.95;
          transform: translateY(-1px);
          box-shadow: 0 6px 16px rgba(16, 185, 129, 0.38);
        }

        /* ── CP PLUS / Dahua Stream Card ── */
        .cam-stream-card {
          background: #ffffff;
          border: 1px solid #e2ece8;
          border-radius: 16px;
          padding: 16px 20px;
          box-shadow: 0 1px 3px rgba(0, 0, 0, 0.02);
          display: flex;
          align-items: center;
          justify-content: space-between;
          margin-bottom: 22px;
          flex-wrap: wrap;
          gap: 16px;
        }

        .cam-stream-left {
          display: flex;
          align-items: center;
          gap: 14px;
        }

        .cam-stream-icon-wrap {
          width: 44px;
          height: 44px;
          border-radius: 12px;
          background: #d1fae5;
          display: flex;
          align-items: center;
          justify-content: center;
          flex-shrink: 0;
        }

        .cam-stream-info {
          display: flex;
          flex-direction: column;
          gap: 4px;
        }

        .cam-stream-title-row {
          display: flex;
          align-items: center;
          gap: 10px;
          flex-wrap: wrap;
        }

        .cam-stream-title {
          font-size: 15px;
          font-weight: 700;
          color: #0f172a;
        }

        .cam-stream-status-pill {
          display: inline-flex;
          align-items: center;
          gap: 6px;
          padding: 3px 10px;
          border-radius: 9999px;
          font-size: 11px;
          font-weight: 700;
          letter-spacing: 0.03em;
        }

        .cam-status-dot {
          width: 6px;
          height: 6px;
          border-radius: 50%;
        }

        .status-online {
          background: #ecfdf5;
          color: #059669;
          border: 1px solid #a7f3d0;
        }
        .status-online .cam-status-dot {
          background: #10b981;
          box-shadow: 0 0 6px #10b981;
        }

        .status-reconnecting {
          background: #fef3c7;
          color: #d97706;
          border: 1px solid #fde68a;
        }
        .status-reconnecting .cam-status-dot {
          background: #f59e0b;
        }

        .status-offline {
          background: #fee2e2;
          color: #dc2626;
          border: 1px solid #fecaca;
        }
        .status-offline .cam-status-dot {
          background: #ef4444;
        }

        .cam-stream-endpoint-row {
          display: flex;
          align-items: center;
          gap: 6px;
          font-size: 12.5px;
          color: #64748b;
        }

        .endpoint-label {
          font-weight: 500;
        }

        .endpoint-code {
          font-family: 'JetBrains Mono', monospace;
          font-size: 11.5px;
          background: #f1f5f9;
          border: 1px solid #e2e8f0;
          padding: 2px 7px;
          border-radius: 5px;
          color: #334155;
        }

        .cam-stream-actions {
          display: flex;
          align-items: center;
          gap: 10px;
          flex-wrap: wrap;
        }

        .cam-action-btn-white {
          height: 38px;
          padding: 0 15px;
          border-radius: 8px;
          border: 1px solid #e2e8f0;
          background: #ffffff;
          color: #334155;
          font-size: 12.5px;
          font-weight: 600;
          display: inline-flex;
          align-items: center;
          gap: 6px;
          cursor: pointer;
          transition: all 0.2s ease;
        }

        .cam-action-btn-white:hover:not(:disabled) {
          background: #f0fdf4;
          border-color: #a7f3d0;
          color: #059669;
        }

        .cam-btn-events {
          height: 38px;
          padding: 0 16px;
          border-radius: 8px;
          border: none;
          background: linear-gradient(135deg, #059669 0%, #10b981 100%);
          color: #ffffff;
          font-size: 12.5px;
          font-weight: 700;
          display: inline-flex;
          align-items: center;
          gap: 7px;
          cursor: pointer;
          transition: all 0.2s ease;
          box-shadow: 0 3px 10px rgba(16, 185, 129, 0.28);
        }

        .cam-btn-events:hover {
          opacity: 0.95;
          transform: translateY(-1px);
          box-shadow: 0 5px 14px rgba(16, 185, 129, 0.38);
        }

        .cam-test-feedback {
          padding: 10px 14px;
          border-radius: 8px;
          font-size: 13px;
          display: flex;
          justify-content: space-between;
          align-items: center;
          margin-bottom: 18px;
        }

        .feedback-success {
          background: #ecfdf5;
          border: 1px solid #a7f3d0;
          color: #065f46;
        }

        .feedback-error {
          background: #fef2f2;
          border: 1px solid #fecaca;
          color: #991b1b;
        }

        .feedback-close-btn {
          background: none;
          border: none;
          color: inherit;
          cursor: pointer;
          font-size: 18px;
          line-height: 1;
        }

        /* ── 4 Executive Stat Cards ── */
        .cam-stat-cards-grid {
          display: grid;
          grid-template-columns: repeat(4, 1fr);
          gap: 16px;
          margin-bottom: 22px;
        }

        .cam-stat-card {
          background: #ffffff;
          border: 1px solid #e2ece8;
          border-radius: 16px;
          padding: 18px 20px 14px;
          box-shadow: 0 1px 3px rgba(0, 0, 0, 0.02);
          display: flex;
          flex-direction: column;
          justify-content: space-between;
          position: relative;
          overflow: hidden;
          transition: all 0.2s ease;
        }

        .cam-stat-card:hover {
          border-color: #10b981;
          box-shadow: 0 4px 12px rgba(5, 150, 105, 0.06);
          transform: translateY(-1px);
        }

        .cam-stat-card-top {
          display: flex;
          align-items: flex-start;
          gap: 14px;
        }

        .cam-stat-icon-wrap {
          width: 46px;
          height: 46px;
          border-radius: 12px;
          display: flex;
          align-items: center;
          justify-content: center;
          flex-shrink: 0;
        }

        .icon-mint {
          background: #d1fae5;
        }

        .icon-blue {
          background: #dbeafe;
        }

        .icon-amber {
          background: #fef3c7;
        }

        .icon-rose {
          background: #fee2e2;
        }

        .cam-stat-card-meta {
          flex: 1;
        }

        .cam-stat-label {
          font-size: 11px;
          font-weight: 700;
          letter-spacing: 0.05em;
          color: #64748b;
          text-transform: uppercase;
          display: block;
        }

        .cam-stat-number {
          font-size: 28px;
          font-weight: 800;
          color: #0f172a;
          line-height: 1.1;
          margin-top: 4px;
          display: block;
        }

        .cam-stat-wave-wrap {
          width: 105px;
          height: 34px;
          position: absolute;
          right: -8px;
          bottom: -4px;
          z-index: 1;
          pointer-events: none;
        }

        .cam-stat-wave-svg {
          width: 100%;
          height: 100%;
        }

        /* ── Cameras Table Card ── */
        .cam-table-card {
          background: #ffffff;
          border: 1px solid #e2ece8;
          border-radius: 18px;
          padding: 16px 20px 20px;
          box-shadow: 0 1px 4px rgba(0, 0, 0, 0.02);
        }

        .cam-custom-table {
          width: 100%;
          border-collapse: separate;
          border-spacing: 0;
          text-align: left;
        }

        .cam-custom-table th {
          background-color: #dff5ea;
          color: #064e3b;
          font-size: 11px;
          font-weight: 700;
          letter-spacing: 0.04em;
          text-transform: uppercase;
          padding: 13px 14px;
          border: none;
          white-space: nowrap;
          vertical-align: middle;
        }

        .cam-custom-table th:first-child {
          border-top-left-radius: 12px;
          border-bottom-left-radius: 12px;
        }

        .cam-custom-table th:last-child {
          border-top-right-radius: 12px;
          border-bottom-right-radius: 12px;
        }

        .cam-th-content {
          display: inline-flex;
          align-items: center;
          gap: 6px;
        }

        .sort-arrows {
          flex-shrink: 0;
        }

        .cam-custom-table td {
          padding: 14px 14px;
          font-size: 13px;
          color: #0f172a;
          border-bottom: 1px solid #f1f5f9;
          vertical-align: middle;
        }

        .cam-custom-table tr:hover td {
          background-color: #f8fafc;
        }

        .cam-name-cell {
          display: flex;
          align-items: center;
          gap: 10px;
        }

        .cam-name-icon {
          width: 32px;
          height: 32px;
          border-radius: 8px;
          background: #ecfdf5;
          display: flex;
          align-items: center;
          justify-content: center;
          color: #059669;
          flex-shrink: 0;
        }

        .cam-name-text {
          font-weight: 600;
          color: #0f172a;
        }

        .cam-location-pill {
          display: inline-block;
          padding: 3px 8px;
          border-radius: 6px;
          background: #f8fafc;
          border: 1px solid #e2e8f0;
          font-size: 12px;
          font-weight: 500;
          color: #334155;
        }

        .cam-ip-badge {
          font-family: 'JetBrains Mono', monospace;
          font-size: 12px;
          background: #f1f5f9;
          border: 1px solid #e2e8f0;
          padding: 3px 8px;
          border-radius: 6px;
          color: #0f172a;
          font-weight: 600;
        }

        .cam-rtsp-text {
          font-family: 'JetBrains Mono', monospace;
          font-size: 11.5px;
          color: #64748b;
          max-width: 200px;
          display: inline-block;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }

        .cam-status-pill {
          display: inline-flex;
          align-items: center;
          gap: 6px;
          padding: 4px 10px;
          border-radius: 9999px;
          font-size: 11px;
          font-weight: 700;
          letter-spacing: 0.02em;
        }

        .status-active {
          background: #ecfdf5;
          color: #059669;
        }
        .status-active .cam-status-dot {
          background: #10b981;
        }

        .status-inactive {
          background: #fef2f2;
          color: #dc2626;
        }
        .status-inactive .cam-status-dot {
          background: #ef4444;
        }

        .cam-actions-wrap {
          display: inline-flex;
          align-items: center;
          gap: 6px;
        }

        .cam-action-btn {
          width: 30px;
          height: 30px;
          border-radius: 7px;
          border: 1px solid #e2e8f0;
          background: #ffffff;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          cursor: pointer;
          transition: all 0.15s ease;
        }

        .cam-action-btn.view {
          color: #059669;
        }
        .cam-action-btn.view:hover {
          background: #ecfdf5;
          border-color: #10b981;
        }

        .cam-action-btn.edit {
          color: #2563eb;
        }
        .cam-action-btn.edit:hover {
          background: #eff6ff;
          border-color: #3b82f6;
        }

        .cam-action-btn.delete {
          color: #dc2626;
        }
        .cam-action-btn.delete:hover {
          background: #fef2f2;
          border-color: #ef4444;
        }

        /* ── Empty State ── */
        .cam-empty-wrap {
          padding: 60px 20px 70px;
          display: flex;
          flex-direction: column;
          align-items: center;
          text-align: center;
        }

        .cam-empty-icon {
          margin-bottom: 16px;
          display: flex;
          align-items: center;
          justify-content: center;
        }

        .cam-empty-title {
          font-size: 17px;
          font-weight: 800;
          color: #0f172a;
          margin: 0 0 6px 0;
        }

        .cam-empty-desc {
          font-size: 13.5px;
          color: #64748b;
          margin: 0;
        }

        /* ── Table Footer ── */
        .cam-table-footer {
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding-top: 18px;
          border-top: 1px solid #f1f5f9;
          margin-top: 6px;
        }

        .cam-footer-count {
          font-size: 12.5px;
          color: #64748b;
          font-weight: 500;
        }

        .cam-pagination {
          display: flex;
          align-items: center;
          gap: 6px;
        }

        .cam-page-arrow {
          width: 32px;
          height: 32px;
          border-radius: 8px;
          border: 1px solid #e2e8f0;
          background: #ffffff;
          color: #94a3b8;
          display: flex;
          align-items: center;
          justify-content: center;
          cursor: pointer;
        }

        .cam-page-num {
          min-width: 32px;
          height: 32px;
          border-radius: 8px;
          border: 1px solid transparent;
          font-size: 13px;
          font-weight: 700;
          cursor: pointer;
          display: flex;
          align-items: center;
          justify-content: center;
          background: #ffffff;
          color: #334155;
        }

        .cam-page-num.active {
          background: #059669;
          color: #ffffff;
        }

        /* ── Dark Theme Overrides ── */
        [data-theme="dark"] .cam-table-card,
        .dark .cam-table-card {
          background: #111528 !important;
          border-color: rgba(139, 92, 246, 0.25) !important;
        }
        [data-theme="dark"] .cam-stat-card,
        .dark .cam-stat-card {
          background: #111528 !important;
          border-color: rgba(139, 92, 246, 0.25) !important;
        }
        [data-theme="dark"] .cam-stat-number,
        .dark .cam-stat-number {
          color: #ffffff !important;
        }
        [data-theme="dark"] .cam-stat-label,
        .dark .cam-stat-label {
          color: #94a3b8 !important;
        }
        [data-theme="dark"] .cam-stream-card,
        .dark .cam-stream-card {
          background: #111528 !important;
          border-color: rgba(139, 92, 246, 0.25) !important;
        }
        [data-theme="dark"] .cam-stream-title,
        .dark .cam-stream-title {
          color: #ffffff !important;
        }
        [data-theme="dark"] .cam-stream-label,
        .dark .cam-stream-label {
          color: #94a3b8 !important;
        }
        [data-theme="dark"] .cam-stream-endpoint-val,
        .dark .cam-stream-endpoint-val {
          color: #c084fc !important;
          background: #171b38 !important;
          border-color: rgba(139, 92, 246, 0.3) !important;
        }
        [data-theme="dark"] .cam-stream-icon-wrap,
        .dark .cam-stream-icon-wrap {
          background: rgba(16, 185, 129, 0.16) !important;
          color: #34d399 !important;
          border: 1px solid rgba(16, 185, 129, 0.3) !important;
        }
        [data-theme="dark"] .cam-name-icon,
        .dark .cam-name-icon {
          background: rgba(16, 185, 129, 0.16) !important;
          color: #34d399 !important;
        }
        [data-theme="dark"] .cam-name-text,
        .dark .cam-name-text {
          color: #f1f5f9 !important;
        }
        [data-theme="dark"] .cam-location-pill,
        .dark .cam-location-pill {
          background: #171b38 !important;
          border-color: rgba(139, 92, 246, 0.25) !important;
          color: #cbd5e1 !important;
        }
        [data-theme="dark"] .cam-ip-badge,
        .dark .cam-ip-badge {
          background: rgba(16, 185, 129, 0.14) !important;
          border-color: rgba(16, 185, 129, 0.3) !important;
          color: #34d399 !important;
        }
        [data-theme="dark"] .cam-rtsp-text,
        .dark .cam-rtsp-text {
          color: #94a3b8 !important;
        }
        [data-theme="dark"] .cam-custom-table th,
        .dark .cam-custom-table th {
          background-color: #171b38 !important;
          color: #34d399 !important;
        }
        [data-theme="dark"] .cam-custom-table td,
        .dark .cam-custom-table td {
          color: #cbd5e1 !important;
          border-bottom-color: rgba(255, 255, 255, 0.06) !important;
        }
        [data-theme="dark"] .cam-custom-table tr:hover td,
        .dark .cam-custom-table tr:hover td {
          background-color: rgba(255, 255, 255, 0.03) !important;
        }
        [data-theme="dark"] .cam-action-btn,
        .dark .cam-action-btn {
          background: #171b38 !important;
          border-color: rgba(139, 92, 246, 0.25) !important;
          color: #94a3b8 !important;
        }
        [data-theme="dark"] .cam-action-btn:hover,
        .dark .cam-action-btn:hover {
          background: #23284f !important;
          color: #ffffff !important;
        }
        [data-theme="dark"] .cam-table-footer,
        .dark .cam-table-footer {
          border-top-color: rgba(255, 255, 255, 0.06) !important;
        }
        [data-theme="dark"] .cam-footer-count,
        .dark .cam-footer-count {
          color: #94a3b8 !important;
        }
        [data-theme="dark"] .cam-page-arrow,
        .dark .cam-page-arrow {
          background: #171b38 !important;
          border-color: rgba(139, 92, 246, 0.25) !important;
          color: #cbd5e1 !important;
        }
        [data-theme="dark"] .cam-page-num,
        .dark .cam-page-num {
          background: #171b38 !important;
          border-color: rgba(139, 92, 246, 0.25) !important;
          color: #cbd5e1 !important;
        }
        [data-theme="dark"] .cam-page-num.active,
        .dark .cam-page-num.active {
          background: #059669 !important;
          color: #ffffff !important;
          border-color: #059669 !important;
        }


        /* ── Accented Stat Cards ── */
        .cam-stat-card.stat-mint {
          border-left: 4px solid #10b981;
        }
        .cam-stat-card.stat-blue {
          border-left: 4px solid #3b82f6;
        }
        .cam-stat-card.stat-amber {
          border-left: 4px solid #f59e0b;
        }
        .cam-stat-card.stat-rose {
          border-left: 4px solid #ef4444;
        }

        /* ── Mobile Camera Cards (Hidden by default on Desktop) ── */
        .cam-mobile-cards {
          display: none;
        }
        .cam-desktop-table {
          display: block;
        }

        .cam-m-card {
          background: #ffffff;
          border: 1px solid #e2ece8;
          border-radius: 14px;
          padding: 14px;
          box-shadow: 0 1px 3px rgba(0, 0, 0, 0.03);
          display: flex;
          flex-direction: column;
          gap: 12px;
          transition: all 0.2s ease;
        }

        .cam-m-card-header {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 10px;
        }

        .cam-m-header-left {
          display: flex;
          align-items: center;
          gap: 10px;
          min-width: 0;
          flex: 1;
        }

        .cam-m-avatar {
          width: 38px;
          height: 38px;
          border-radius: 10px;
          display: flex;
          align-items: center;
          justify-content: center;
          flex-shrink: 0;
        }
        .cam-m-avatar.online {
          background: #ecfdf5;
          color: #059669;
          border: 1px solid #a7f3d0;
        }
        .cam-m-avatar.offline {
          background: #fef2f2;
          color: #dc2626;
          border: 1px solid #fecaca;
        }

        .cam-m-header-titles {
          min-width: 0;
          display: flex;
          flex-direction: column;
          gap: 2px;
        }

        .cam-m-name {
          font-size: 15px;
          font-weight: 700;
          color: #0f172a;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }

        .cam-m-location {
          display: flex;
          align-items: center;
          gap: 4px;
          font-size: 11.5px;
          color: #64748b;
          font-weight: 500;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }

        .cam-m-body {
          display: flex;
          flex-direction: column;
          gap: 8px;
          background: #f8fafc;
          border: 1px solid #f1f5f9;
          border-radius: 10px;
          padding: 10px 12px;
        }

        .cam-m-grid {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 10px;
        }

        .cam-m-info-box {
          display: flex;
          flex-direction: column;
          gap: 2px;
        }

        .cam-m-label {
          font-size: 9.5px;
          font-weight: 700;
          letter-spacing: 0.04em;
          color: #64748b;
          text-transform: uppercase;
        }

        .cam-m-value {
          font-size: 12.5px;
          font-weight: 600;
          color: #0f172a;
        }
        .cam-m-value.ip-code {
          font-family: 'JetBrains Mono', monospace;
          color: #059669;
        }

        .cam-m-url-box {
          display: flex;
          flex-direction: column;
          gap: 2px;
          padding-top: 6px;
          border-top: 1px dashed #e2e8f0;
        }

        .cam-m-url-text {
          font-family: 'JetBrains Mono', monospace;
          font-size: 11px;
          color: #475569;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
          display: block;
        }

        .cam-m-footer {
          display: flex;
          align-items: center;
          gap: 8px;
          padding-top: 2px;
        }

        .cam-m-btn {
          flex: 1;
          height: 36px;
          border-radius: 8px;
          font-size: 12px;
          font-weight: 600;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          gap: 6px;
          cursor: pointer;
          border: 1px solid transparent;
          transition: all 0.15s ease;
        }

        .cam-m-btn.view {
          background: #ecfdf5;
          color: #059669;
          border-color: #a7f3d0;
        }
        .cam-m-btn.view:hover {
          background: #d1fae5;
        }

        .cam-m-btn.edit {
          background: #eff6ff;
          color: #2563eb;
          border-color: #bfdbfe;
        }
        .cam-m-btn.edit:hover {
          background: #dbeafe;
        }

        .cam-m-btn.delete {
          background: #fef2f2;
          color: #dc2626;
          border-color: #fecaca;
        }
        .cam-m-btn.delete:hover {
          background: #fee2e2;
        }

        /* ── Dark Theme Mobile Card Overrides ── */
        [data-theme="dark"] .cam-m-card,
        .dark .cam-m-card {
          background: #171b38 !important;
          border-color: rgba(139, 92, 246, 0.25) !important;
        }
        [data-theme="dark"] .cam-m-name,
        .dark .cam-m-name {
          color: #f1f5f9 !important;
        }
        [data-theme="dark"] .cam-m-body,
        .dark .cam-m-body {
          background: #111528 !important;
          border-color: rgba(139, 92, 246, 0.18) !important;
        }
        [data-theme="dark"] .cam-m-value,
        .dark .cam-m-value {
          color: #e2e8f0 !important;
        }
        [data-theme="dark"] .cam-m-value.ip-code,
        .dark .cam-m-value.ip-code {
          color: #34d399 !important;
        }
        [data-theme="dark"] .cam-m-url-text,
        .dark .cam-m-url-text {
          color: #94a3b8 !important;
        }
        [data-theme="dark"] .cam-m-url-box,
        .dark .cam-m-url-box {
          border-top-color: rgba(255, 255, 255, 0.08) !important;
        }
        [data-theme="dark"] .cam-m-btn.view,
        .dark .cam-m-btn.view {
          background: rgba(16, 185, 129, 0.14) !important;
          border-color: rgba(16, 185, 129, 0.3) !important;
          color: #34d399 !important;
        }
        [data-theme="dark"] .cam-m-btn.edit,
        .dark .cam-m-btn.edit {
          background: rgba(59, 130, 246, 0.14) !important;
          border-color: rgba(59, 130, 246, 0.3) !important;
          color: #60a5fa !important;
        }
        [data-theme="dark"] .cam-m-btn.delete,
        .dark .cam-m-btn.delete {
          background: rgba(239, 68, 68, 0.14) !important;
          border-color: rgba(239, 68, 68, 0.3) !important;
          color: #f87171 !important;
        }

        /* ── Responsive Rules (Tablets & Desktops) ── */
        @media (max-width: 1024px) {
          .cam-stat-cards-grid {
            grid-template-columns: repeat(2, 1fr);
          }
        }

        /* ── Mobile Layout (<= 768px) ── */
        @media (max-width: 880px) {
          .camera-feeds-page {
            padding: 12px 14px 32px !important;
          }

          /* Compact 1-Row Mobile Header */
          .cam-header-row {
            display: flex !important;
            flex-direction: row !important;
            align-items: center !important;
            justify-content: space-between !important;
            gap: 10px !important;
            margin-bottom: 14px !important;
          }
          .cam-header-left {
            gap: 10px !important;
          }
          .cam-icon-box {
            width: 38px !important;
            height: 38px !important;
            border-radius: 10px !important;
          }
          .cam-icon-box svg {
            width: 20px !important;
            height: 20px !important;
          }
          .cam-title {
            font-size: 19px !important;
            margin: 0 !important;
            font-weight: 800 !important;
            letter-spacing: -0.01em;
          }
          .cam-subtitle {
            display: none !important;
          }
          .cam-btn-add {
            height: 36px !important;
            padding: 0 12px !important;
            font-size: 12.5px !important;
            border-radius: 8px !important;
            white-space: nowrap !important;
          }

          /* Stream Banner Card */
          .cam-stream-card {
            flex-direction: column !important;
            align-items: stretch !important;
            padding: 12px 14px !important;
            gap: 12px !important;
            margin-bottom: 14px !important;
            border-radius: 14px !important;
          }
          .cam-stream-left {
            gap: 10px !important;
            width: 100% !important;
          }
          .cam-stream-icon-wrap {
            width: 36px !important;
            height: 36px !important;
            border-radius: 10px !important;
          }
          .cam-stream-title {
            font-size: 13.5px !important;
            font-weight: 700 !important;
          }
          .cam-stream-endpoint-row {
            display: flex !important;
            align-items: center !important;
            gap: 6px !important;
            font-size: 11px !important;
            max-width: 100% !important;
          }
          .endpoint-code {
            max-width: 180px !important;
            overflow: hidden !important;
            text-overflow: ellipsis !important;
            white-space: nowrap !important;
            display: inline-block !important;
            font-size: 11px !important;
          }

          /* 2-Row Action Buttons Grid */
          .cam-stream-actions {
            display: grid !important;
            grid-template-columns: 1fr 1fr !important;
            gap: 8px !important;
            width: 100% !important;
          }
          .cam-action-btn-white {
            height: 36px !important;
            padding: 0 8px !important;
            font-size: 11.5px !important;
            justify-content: center !important;
            width: 100% !important;
            border-radius: 8px !important;
          }
          .cam-btn-events {
            grid-column: span 2 !important;
            height: 36px !important;
            font-size: 12px !important;
            justify-content: center !important;
            width: 100% !important;
            border-radius: 8px !important;
          }

          /* Stat Cards 2x2 Grid */
          .cam-stat-cards-grid {
            grid-template-columns: repeat(2, 1fr) !important;
            gap: 10px !important;
            margin-bottom: 14px !important;
          }
          .cam-stat-card {
            padding: 10px 12px !important;
            border-radius: 12px !important;
          }
          .cam-stat-icon-wrap {
            width: 32px !important;
            height: 32px !important;
            border-radius: 8px !important;
          }
          .cam-stat-icon-wrap svg {
            width: 16px !important;
            height: 16px !important;
          }
          .cam-stat-label {
            font-size: 10px !important;
            font-weight: 700 !important;
            letter-spacing: 0.03em !important;
          }
          .cam-stat-number {
            font-size: 20px !important;
            font-weight: 800 !important;
            margin-top: 2px !important;
          }
          .cam-stat-wave-wrap {
            display: none !important;
          }

          /* Hide Desktop Table, Show Mobile Cards */
          .cam-desktop-table {
            display: none !important;
          }
          .cam-mobile-cards {
            display: flex !important;
            flex-direction: column !important;
            gap: 12px !important;
            width: 100% !important;
          }
          .cam-table-card {
            padding: 12px 12px 14px !important;
            border-radius: 14px !important;
          }
          .cam-table-footer {
            flex-direction: column !important;
            gap: 10px !important;
            align-items: center !important;
            padding-top: 12px !important;
          }
        }
      `}</style>
    </div>
  );
};

export default CameraList;
