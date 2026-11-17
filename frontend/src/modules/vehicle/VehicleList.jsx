import React, { useState, useEffect, useCallback, useMemo } from 'react';
import api from '../../services/api';
import Loader from '../../components/common/Loader';
import AuthenticatedMediaImage from '../../components/common/AuthenticatedMediaImage';
import { getVehicleDetections } from './vehicle.service';

const formatTimeIst = (timestampStr) => {
  if (!timestampStr) return new Date().toLocaleTimeString();
  try {
    const d = new Date(timestampStr);
    if (isNaN(d.getTime())) return timestampStr;
    return d.toLocaleString('en-IN', {
      timeZone: 'Asia/Kolkata',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      day: '2-digit',
      month: 'short',
      year: 'numeric',
    });
  } catch {
    return timestampStr;
  }
};

const resolveImageUrl = (path) => {
  if (!path) return '';
  if (path.startsWith('http://') || path.startsWith('https://') || path.startsWith('data:')) return path;
  return path.startsWith('/') ? path : `/${path}`;
};

// Fallback SVG placeholder when vehicle image is unavailable
const getVehicleFallbackSvg = (type = 'Car') => {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="320" height="180" viewBox="0 0 320 180">
    <rect width="100%" height="100%" fill="#090e17" />
    <rect x="70" y="70" width="180" height="55" rx="10" fill="#1e293b" stroke="#38bdf8" stroke-width="2" />
    <circle cx="110" cy="130" r="16" fill="#334155" stroke="#64748b" stroke-width="3" />
    <circle cx="210" cy="130" r="16" fill="#334155" stroke="#64748b" stroke-width="3" />
    <path d="M100 70 L130 35 L190 35 L220 70 Z" fill="#0f172a" stroke="#38bdf8" stroke-width="2" />
    <text x="160" y="102" font-family="-apple-system, sans-serif" font-size="14" font-weight="bold" fill="#38bdf8" text-anchor="middle">${type.toUpperCase()}</text>
  </svg>`;
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
};

const VehicleList = () => {
  const [detections, setDetections] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [filterMovement, setFilterMovement] = useState('ALL'); // 'ALL' | 'ENTRY' | 'EXIT' | 'RECOGNIZED' | 'UNRECOGNIZED'
  const [searchTerm, setSearchTerm] = useState('');
  const [previewModal, setPreviewModal] = useState(null);
  const [manualPlateText, setManualPlateText] = useState('');
  const [plateCorrectionSaving, setPlateCorrectionSaving] = useState(false);
  const [plateCorrectionError, setPlateCorrectionError] = useState('');
  const [newlyArrivedIds, setNewlyArrivedIds] = useState(new Set());

  const openEvidence = (detection) => {
    setPreviewModal(detection);
    setManualPlateText(detection.plate_text || detection.raw_plate_text || '');
    setPlateCorrectionError('');
  };

  const savePlateCorrection = async () => {
    if (!previewModal?.id || !manualPlateText.trim()) return;
    setPlateCorrectionSaving(true);
    setPlateCorrectionError('');
    try {
      const response = await api.post(`/events/${previewModal.id}/plate-correction`, { plate_text: manualPlateText.trim() });
      const corrected = response.data?.data;
      if (corrected) {
        setPreviewModal(corrected);
        setDetections((current) => current.map((item) => item.id === corrected.id ? corrected : item));
      }
    } catch (error) {
      setPlateCorrectionError(error.response?.data?.message || 'Could not save this plate correction.');
    } finally {
      setPlateCorrectionSaving(false);
    }
  };

  // 1. Fetch Real Vehicle Detections from Backend
  const fetchDetections = useCallback(async () => {
    try {
      const res = await getVehicleDetections({ limit: 100 });
      if (res && res.data) {
        setDetections((prev) => {
          // Merge and avoid duplicate entries
          const map = new Map();
          // Existing detections
          prev.forEach((d) => map.set(d.id, d));
          // New detections overwrite or add
          res.data.forEach((d) => map.set(d.id, d));
          // Sort chronological descending (latest detection first)
          return Array.from(map.values()).sort(
            (a, b) => new Date(b.timestamp || b.created_at) - new Date(a.timestamp || a.created_at)
          );
        });
        setError('');
      }
    } catch (err) {
      if (!detections.length) {
        setError('Failed to load vehicle detection events. Reconnecting...');
      }
    } finally {
      setLoading(false);
    }
  }, [detections.length]);

  // Initial Load & Polling (every 2.5s)
  useEffect(() => {
    fetchDetections();
    const interval = setInterval(fetchDetections, 2500);
    return () => clearInterval(interval);
  }, [fetchDetections]);

  // 2. Real-Time SSE Stream for Instant Push Detections
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
            // Only handle vehicle detections
            if (ev.event_type?.startsWith('VEHICLE') || ev.eventType?.startsWith('VEHICLE')) {
              setDetections((prev) => {
                // Avoid duplicates
                if (prev.some((p) => p.id === ev.id)) return prev;
                return [ev, ...prev];
              });

              // Glow newly arrived detection
              setNewlyArrivedIds((prev) => new Set([...prev, ev.id]));
              setTimeout(() => {
                setNewlyArrivedIds((prev) => {
                  const next = new Set(prev);
                  next.delete(ev.id);
                  return next;
                });
              }, 3000);
            }
          }
        } catch {}
      };
    } catch {}

    return () => {
      if (eventSource) eventSource.close();
    };
  }, []);

  // Filtered & Searched Detections
  const filteredDetections = useMemo(() => {
    return detections.filter((d) => {
      const isEntry = d.direction === 'IN' || d.camera_id?.includes('02') || d.event_type === 'VEHICLE_IN';
      const isExit = d.direction === 'OUT' || d.camera_id?.includes('01') || d.event_type === 'VEHICLE_OUT';
      const hasPlate = Boolean(d.plate_text && d.plate_text.trim());

      if (filterMovement === 'ENTRY' && !isEntry) return false;
      if (filterMovement === 'EXIT' && !isExit) return false;
      if (filterMovement === 'RECOGNIZED' && !hasPlate) return false;
      if (filterMovement === 'UNRECOGNIZED' && hasPlate) return false;

      if (searchTerm.trim()) {
        const query = searchTerm.toLowerCase().trim();
        const plate = (d.plate_text || d.raw_plate_text || '').toLowerCase();
        const type = (d.name || d.department || '').toLowerCase();
        const cam = (d.camera_id || '').toLowerCase();
        if (!plate.includes(query) && !type.includes(query) && !cam.includes(query)) {
          return false;
        }
      }

      return true;
    });
  }, [detections, filterMovement, searchTerm]);

  // Telemetry KPI Stats
  const kpiStats = useMemo(() => {
    let entries = 0;
    let exits = 0;
    let recognized = 0;
    let unrecognized = 0;

    detections.forEach((d) => {
      const isEntry = d.direction === 'IN' || d.camera_id?.includes('02') || d.event_type === 'VEHICLE_IN';
      if (isEntry) entries++;
      else exits++;

      if (d.plate_text && d.plate_text.trim()) recognized++;
      else unrecognized++;
    });

    return {
      total: detections.length,
      entries,
      exits,
      recognized,
      unrecognized,
    };
  }, [detections]);

  return (
    <div className="veh-monitoring-container">
      {/* ── 1. Top Surveillance Header ── */}
      <header className="veh-header-row">
        <div className="veh-header-left">
          <div className="veh-icon-box">
            <svg viewBox="0 0 24 24" width="28" height="28" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
              <rect x="1" y="3" width="15" height="13" rx="2" />
              <polygon points="16 8 20 8 23 11 23 16 16 16 16 8" />
              <circle cx="5.5" cy="18.5" r="2.5" />
              <circle cx="18.5" cy="18.5" r="2.5" />
            </svg>
          </div>
          <div className="veh-header-text">
            <div className="veh-title-flex">
              <h1 className="veh-title">Automatic Vehicle Detection</h1>
              <span className="veh-live-badge">● REAL-TIME SURVEILLANCE</span>
            </div>
            <p className="veh-subtitle">
              Live gate vehicle monitoring, license plate recognition (ANPR), and entry/exit movement logs.
            </p>
          </div>
        </div>

        <div className="veh-header-right">
          <button
            type="button"
            className="veh-refresh-btn"
            onClick={fetchDetections}
            title="Refresh Detection Feed"
          >
            <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2.2">
              <path d="M23 4v6h-6" />
              <path d="M1 20v-6h6" />
              <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" />
            </svg>
            <span>Live Sync</span>
          </button>
        </div>
      </header>

      {/* ── 2. Telemetry KPI Summary Cards ── */}
      <section className="veh-kpi-grid">
        <div className="veh-kpi-card total">
          <div className="kpi-icon">🚗</div>
          <div className="kpi-info">
            <span className="kpi-label">TOTAL DETECTIONS</span>
            <span className="kpi-value">{kpiStats.total}</span>
          </div>
        </div>

        <div className="veh-kpi-card entry">
          <div className="kpi-icon">↓</div>
          <div className="kpi-info">
            <span className="kpi-label">VEHICLE ENTRIES (IN)</span>
            <span className="kpi-value">{kpiStats.entries}</span>
            <span className="kpi-sub">Cam-02 Entry Gate</span>
          </div>
        </div>

        <div className="veh-kpi-card exit">
          <div className="kpi-icon">↑</div>
          <div className="kpi-info">
            <span className="kpi-label">VEHICLE EXITS (OUT)</span>
            <span className="kpi-value">{kpiStats.exits}</span>
            <span className="kpi-sub">Cam-01 Exit Gate</span>
          </div>
        </div>

        <div className="veh-kpi-card recognized">
          <div className="kpi-icon">🔍</div>
          <div className="kpi-info">
            <span className="kpi-label">PLATES RECOGNIZED</span>
            <span className="kpi-value">{kpiStats.recognized}</span>
            <span className="kpi-sub">ANPR Success</span>
          </div>
        </div>

        <div className="veh-kpi-card unrecognized">
          <div className="kpi-icon">⚠️</div>
          <div className="kpi-info">
            <span className="kpi-label">UNRECOGNIZED PLATES</span>
            <span className="kpi-value">{kpiStats.unrecognized}</span>
            <span className="kpi-sub">Needs Review</span>
          </div>
        </div>
      </section>

      {/* ── 3. Filters & Search Control Bar ── */}
      <section className="veh-controls-bar">
        <div className="veh-filter-tabs">
          <button
            type="button"
            className={`veh-filter-tab ${filterMovement === 'ALL' ? 'active' : ''}`}
            onClick={() => setFilterMovement('ALL')}
          >
            All Movements ({detections.length})
          </button>
          <button
            type="button"
            className={`veh-filter-tab ${filterMovement === 'ENTRY' ? 'active' : ''}`}
            onClick={() => setFilterMovement('ENTRY')}
          >
            ↓ Entry (IN) ({kpiStats.entries})
          </button>
          <button
            type="button"
            className={`veh-filter-tab ${filterMovement === 'EXIT' ? 'active' : ''}`}
            onClick={() => setFilterMovement('EXIT')}
          >
            ↑ Exit (OUT) ({kpiStats.exits})
          </button>
          <button
            type="button"
            className={`veh-filter-tab ${filterMovement === 'RECOGNIZED' ? 'active' : ''}`}
            onClick={() => setFilterMovement('RECOGNIZED')}
          >
            ✓ Plate Recognized ({kpiStats.recognized})
          </button>
          <button
            type="button"
            className={`veh-filter-tab ${filterMovement === 'UNRECOGNIZED' ? 'active' : ''}`}
            onClick={() => setFilterMovement('UNRECOGNIZED')}
          >
            Plate Not Recognized ({kpiStats.unrecognized})
          </button>
        </div>

        <div className="veh-search-box">
          <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2.2">
            <circle cx="11" cy="11" r="8" />
            <line x1="21" y1="21" x2="16.65" y2="16.65" />
          </svg>
          <input
            type="text"
            placeholder="Search by plate number, car, truck..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
          />
          {searchTerm && (
            <button className="clear-search-btn" onClick={() => setSearchTerm('')}>✕</button>
          )}
        </div>
      </section>

      {error && <div className="veh-alert-banner">{error}</div>}

      {/* ── 4. Real-Time Vehicle Detection Feed ── */}
      <main className="veh-feed-container">
        {loading && detections.length === 0 ? (
          <div className="veh-loading-box">
            <Loader text="Connecting to dual camera vehicle stream..." />
          </div>
        ) : filteredDetections.length === 0 ? (
          <div className="veh-empty-feed">
            <div className="empty-radar-circle">🚗</div>
            <h3>No Vehicle Detections Found</h3>
            <p>
              {searchTerm || filterMovement !== 'ALL'
                ? 'Try adjusting your filters or search keywords.'
                : 'Vehicles detected at CAM-01 (Exit) or CAM-02 (Entry) will automatically appear here in real time.'}
            </p>
          </div>
        ) : (
          <div className="veh-card-grid">
            {filteredDetections.map((d) => {
              const isEntry = d.direction === 'IN' || d.camera_id?.includes('02') || d.event_type === 'VEHICLE_IN';
              const hasPlate = Boolean(d.plate_text && d.plate_text.trim());
              const isNew = newlyArrivedIds.has(d.id);
              const snapshotUrl = d.image_frame_url ? resolveImageUrl(d.image_frame_url) : '';
              const plateCropUrl = d.image_plate_url ? resolveImageUrl(d.image_plate_url) : '';

              return (
                <article
                  key={d.id}
                  className={`veh-detection-card ${isEntry ? 'lane-in' : 'lane-out'} ${isNew ? 'new-arrival-glow' : ''}`}
                  onClick={() => openEvidence(d)}
                >
                  {/* Top Header Row: Movement Type & Detection Time */}
                  <div className="card-top-row">
                    <div className="movement-badge-group">
                      <span className={`movement-badge ${isEntry ? 'entry' : 'exit'}`}>
                        {isEntry ? '↓ ENTRY (IN)' : '↑ EXIT (OUT)'}
                      </span>
                      <span className="camera-code-tag">{d.camera_id || (isEntry ? 'CAM-02' : 'CAM-01')}</span>
                    </div>

                    <div className="timestamp-tag" title={d.timestamp || d.created_at}>
                      <span className="clock-icon">🕒</span>
                      <span>{formatTimeIst(d.timestamp || d.created_at)}</span>
                    </div>
                  </div>

                  {/* Vehicle Media Snapshot */}
                  <div className="card-media-viewport">
                    <AuthenticatedMediaImage mediaKey={snapshotUrl} alt={d.name || 'Vehicle'} className="vehicle-snapshot-img" fallback={<img src={getVehicleFallbackSvg(d.name || 'Vehicle')} alt={d.name || 'Vehicle'} className="vehicle-snapshot-img" />} />
                    <div className="media-zoom-overlay">
                      <span>🔍 Click to View Full Image</span>
                    </div>
                  </div>

                  {/* Number Plate Display Section */}
                  <div className="card-plate-section">
                    <div className="plate-box-wrap">
                      {hasPlate ? (
                        <div className="plate-recognized-display">
                          {plateCropUrl && (
                            <AuthenticatedMediaImage mediaKey={plateCropUrl} alt="License Plate Crop" className="plate-crop-thumb" />
                          )}
                          <div className="plate-text-pill">
                            <span className="plate-country-code">IND</span>
                            <span className="plate-registration-number">{d.plate_text}</span>
                          </div>
                          <span className="plate-status-badge recognized">✓ RECOGNIZED</span>
                        </div>
                      ) : (
                        <div className="plate-unrecognized-display">
                          <div className="plate-unrecognized-text">
                            <span className="warn-icon">⚠️</span>
                            <strong>Number Plate Not Recognized</strong>
                          </div>
                          <span className="plate-status-badge unrecognized">UNRECOGNIZED</span>
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Card Bottom Details */}
                  <div className="card-bottom-info">
                    <div className="info-item">
                      <span className="info-label">VEHICLE TYPE</span>
                      <span className="info-val strong">{d.name || d.department || 'Motorized Vehicle'}</span>
                    </div>

                    <div className="info-item">
                      <span className="info-label">GATE LOCATION</span>
                      <span className="info-val">
                        {isEntry ? 'Main Entry Gate (CAM-02)' : 'Main Exit Gate (CAM-01)'}
                      </span>
                    </div>
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </main>

      {/* ── 5. High-Resolution Inspection Modal ── */}
      {previewModal && (
        <div className="veh-modal-backdrop" onClick={() => setPreviewModal(null)}>
          <div className="veh-modal-card" onClick={(e) => e.stopPropagation()}>
            <div className="veh-modal-header">
              <div className="modal-title-wrap">
                <span className={`modal-dir-pill ${previewModal.direction === 'IN' || previewModal.camera_id?.includes('02') ? 'entry' : 'exit'}`}>
                  {previewModal.direction === 'IN' || previewModal.camera_id?.includes('02') ? '↓ ENTRY VEHICLE' : '↑ EXIT VEHICLE'}
                </span>
                <h3>Vehicle Evidence Inspection</h3>
              </div>
              <button className="veh-modal-close" onClick={() => setPreviewModal(null)}>✕</button>
            </div>

            <div className="veh-modal-body">
              {/* Full Captured Snapshot */}
              <div className={`modal-image-preview ${previewModal.image_plate_url ? 'has-plate-crop' : ''}`}>
                <AuthenticatedMediaImage mediaKey={resolveImageUrl(previewModal.image_frame_url)} alt="Vehicle Full Capture" className="modal-full-img" fallback={<img src={getVehicleFallbackSvg(previewModal.name || 'Vehicle')} alt="Vehicle Full Capture" className="modal-full-img" />} />
                {previewModal.image_plate_url && (
                  <div className="modal-plate-next-to-vehicle">
                    <span className="crop-label">Plate Crop</span>
                    <AuthenticatedMediaImage mediaKey={resolveImageUrl(previewModal.image_plate_url)} alt="Detected vehicle plate crop" className="modal-plate-next-img" />
                  </div>
                )}
              </div>

              {/* Plate Crop & Metadata */}
              <div className="modal-details-grid">
                <div className="modal-meta-box">
                  <h4>License Plate Recognition</h4>
                  {previewModal.plate_status === 'invalid_format' ? (
                    <div className="modal-plate-none">
                      <span className="warn-badge">Plate text needs review</span>
                      {previewModal.image_plate_url && (
                        <div className="modal-crop-wrap">
                          <span className="crop-label">Captured Plate Crop</span>
                          <AuthenticatedMediaImage mediaKey={resolveImageUrl(previewModal.image_plate_url)} alt="Captured vehicle plate" className="modal-plate-crop modal-plate-crop-review" />
                        </div>
                      )}
                      <label className="plate-correction-label" htmlFor="manual-plate-correction">Correct vehicle number</label>
                      <div className="plate-correction-row">
                        <input id="manual-plate-correction" value={manualPlateText} onChange={(event) => setManualPlateText(event.target.value.toUpperCase())} placeholder="TN39DU0320" maxLength={15} />
                        <button type="button" onClick={savePlateCorrection} disabled={plateCorrectionSaving || !manualPlateText.trim()}>{plateCorrectionSaving ? 'Saving…' : 'Save'}</button>
                      </div>
                      {plateCorrectionError && <p className="plate-correction-error">{plateCorrectionError}</p>}
                    </div>
                  ) : previewModal.plate_text && previewModal.plate_status === 'low_confidence' ? (
                    <div className="modal-plate-view">
                      <span className="plate-string">{previewModal.plate_text} (low confidence - verify)</span>
                      {previewModal.image_plate_url && <AuthenticatedMediaImage mediaKey={resolveImageUrl(previewModal.image_plate_url)} alt="Plate Crop" className="modal-plate-crop" />}
                    </div>
                  ) : previewModal.plate_text && (!previewModal.plate_status || ['recognized', 'ok'].includes(previewModal.plate_status)) ? (
                    <div className="modal-plate-view">
                      {previewModal.image_plate_url && (
                        <div className="modal-crop-wrap">
                          <span className="crop-label">Extracted Plate Crop</span>
                          <AuthenticatedMediaImage mediaKey={resolveImageUrl(previewModal.image_plate_url)} alt="Plate Crop" className="modal-plate-crop" />
                        </div>
                      )}
                      <div className="modal-plate-number">
                        <span className="plate-country">IND</span>
                        <span className="plate-string">{previewModal.plate_text}</span>
                      </div>
                      <span className="modal-badge-ok">● License Plate Successfully Verified</span>
                    </div>
                  ) : (
                    <div className="modal-plate-none">
                      <span className="warn-badge">⚠️ Number Plate Not Recognized</span>
                      {previewModal.image_plate_url && (
                        <div className="modal-crop-wrap">
                          <span className="crop-label">Captured Plate Crop</span>
                          <AuthenticatedMediaImage
                            mediaKey={resolveImageUrl(previewModal.image_plate_url)}
                            alt="Captured vehicle plate"
                            className="modal-plate-crop modal-plate-crop-review"
                          />
                        </div>
                      )}
                      <p>Plate text could not be extracted with high confidence from this camera angle.</p>
                    </div>
                  )}
                </div>

                <div className="modal-meta-box">
                  <h4>Surveillance Telemetry</h4>
                  <div className="meta-table">
                    <div className="meta-row">
                      <span className="m-label">Movement:</span>
                      <span className="m-val strong">
                        {previewModal.direction === 'IN' || previewModal.camera_id?.includes('02') ? 'ENTRY (IN)' : 'EXIT (OUT)'}
                      </span>
                    </div>
                    <div className="meta-row">
                      <span className="m-label">Camera:</span>
                      <span className="m-val">{previewModal.camera_id || 'Gate Camera'}</span>
                    </div>
                    <div className="meta-row">
                      <span className="m-label">Detected Time (IST):</span>
                      <span className="m-val">{formatTimeIst(previewModal.timestamp || previewModal.created_at)}</span>
                    </div>
                    <div className="meta-row">
                      <span className="m-label">Vehicle Classification:</span>
                      <span className="m-val">{previewModal.name || 'Motorized Vehicle'}</span>
                    </div>
                    <div className="meta-row">
                      <span className="m-label">Event ID:</span>
                      <span className="m-val font-mono">{previewModal.id}</span>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── 6. Embedded Styles for Vehicle Module ── */}
      <style>{`
        .veh-monitoring-container {
          width: 100%;
          padding: 20px 28px 48px;
          color: #0f172a;
          box-sizing: border-box;
          background: #f8fafc;
          min-height: calc(100vh - 70px);
          font-family: 'Inter', -apple-system, BlinkMacSystemFont, sans-serif;
        }

        /* ── Header ── */
        .veh-header-row {
          display: flex;
          align-items: center;
          justify-content: space-between;
          margin-bottom: 20px;
          flex-wrap: wrap;
          gap: 16px;
        }

        .veh-header-left {
          display: flex;
          align-items: center;
          gap: 16px;
        }

        .veh-icon-box {
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

        .veh-header-text {
          display: flex;
          flex-direction: column;
        }

        .veh-title-flex {
          display: flex;
          align-items: center;
          gap: 12px;
          flex-wrap: wrap;
        }

        .veh-title {
          font-size: 24px;
          font-weight: 800;
          color: #0f172a;
          letter-spacing: -0.01em;
          margin: 0;
        }

        .veh-live-badge {
          display: inline-flex;
          align-items: center;
          padding: 4px 10px;
          border-radius: 9999px;
          font-size: 11px;
          font-weight: 800;
          letter-spacing: 0.05em;
          background: rgba(16, 185, 129, 0.15);
          color: #059669;
          border: 1px solid rgba(16, 185, 129, 0.35);
        }

        .veh-subtitle {
          font-size: 13.5px;
          color: #64748b;
          margin: 4px 0 0 0;
          font-weight: 500;
        }

        .veh-refresh-btn {
          display: inline-flex;
          align-items: center;
          gap: 8px;
          background: #ffffff;
          border: 1px solid #cbd5e1;
          color: #0f172a;
          padding: 9px 18px;
          border-radius: 10px;
          font-size: 13.5px;
          font-weight: 700;
          cursor: pointer;
          transition: all 0.15s ease;
          box-shadow: 0 2px 6px rgba(0, 0, 0, 0.04);
        }

        .veh-refresh-btn:hover {
          background: #f1f5f9;
          transform: translateY(-1px);
        }

        /* ── Telemetry KPI Grid ── */
        .veh-kpi-grid {
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
          gap: 14px;
          margin-bottom: 22px;
        }

        .veh-kpi-card {
          background: #ffffff;
          border: 1px solid #e2e8f0;
          border-radius: 14px;
          padding: 14px 18px;
          display: flex;
          align-items: center;
          gap: 14px;
          box-shadow: 0 2px 8px rgba(0, 0, 0, 0.03);
          transition: transform 0.15s;
        }

        .veh-kpi-card:hover {
          transform: translateY(-2px);
        }

        .veh-kpi-card.entry { border-left: 4px solid #10b981; }
        .veh-kpi-card.exit { border-left: 4px solid #ef4444; }
        .veh-kpi-card.recognized { border-left: 4px solid #0284c7; }
        .veh-kpi-card.unrecognized { border-left: 4px solid #f59e0b; }

        .kpi-icon {
          font-size: 24px;
          display: flex;
          align-items: center;
          justify-content: center;
        }

        .kpi-info {
          display: flex;
          flex-direction: column;
        }

        .kpi-label {
          font-size: 11px;
          font-weight: 700;
          color: #64748b;
          letter-spacing: 0.04em;
        }

        .kpi-value {
          font-size: 22px;
          font-weight: 800;
          color: #0f172a;
          line-height: 1.2;
          font-family: 'JetBrains Mono', monospace;
        }

        .kpi-sub {
          font-size: 11px;
          color: #94a3b8;
          margin-top: 2px;
        }

        /* ── Controls Bar ── */
        .veh-controls-bar {
          display: flex;
          align-items: center;
          justify-content: space-between;
          flex-wrap: wrap;
          gap: 12px;
          background: #ffffff;
          border: 1px solid #e2e8f0;
          border-radius: 12px;
          padding: 10px 14px;
          margin-bottom: 22px;
        }

        .veh-filter-tabs {
          display: flex;
          align-items: center;
          gap: 6px;
          flex-wrap: wrap;
        }

        .veh-filter-tab {
          padding: 7px 14px;
          border-radius: 8px;
          border: 1px solid transparent;
          background: transparent;
          font-size: 12.5px;
          font-weight: 700;
          color: #64748b;
          cursor: pointer;
          transition: all 0.15s;
        }

        .veh-filter-tab:hover {
          background: #f1f5f9;
          color: #0f172a;
        }

        .veh-filter-tab.active {
          background: #0f172a;
          color: #ffffff;
        }

        .veh-search-box {
          position: relative;
          display: flex;
          align-items: center;
          min-width: 280px;
        }

        .veh-search-box svg {
          position: absolute;
          left: 12px;
          color: #94a3b8;
        }

        .veh-search-box input {
          width: 100%;
          padding: 8px 32px 8px 36px;
          border-radius: 8px;
          border: 1px solid #cbd5e1;
          background: #f8fafc;
          font-size: 13px;
          outline: none;
          transition: border-color 0.15s;
        }

        .veh-search-box input:focus {
          border-color: #0284c7;
          background: #ffffff;
        }

        .clear-search-btn {
          position: absolute;
          right: 10px;
          background: none;
          border: none;
          color: #94a3b8;
          cursor: pointer;
          font-size: 12px;
        }

        .veh-alert-banner {
          background: #fef2f2;
          color: #b91c1c;
          border: 1px solid #fecaca;
          padding: 12px 18px;
          border-radius: 10px;
          margin-bottom: 18px;
          font-size: 13.5px;
          font-weight: 600;
        }

        /* ── Detections Card Grid ── */
        .veh-feed-container {
          width: 100%;
        }

        .veh-loading-box, .veh-empty-feed {
          background: #ffffff;
          border: 1px solid #e2e8f0;
          border-radius: 16px;
          padding: 50px 20px;
          text-align: center;
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
        }

        .empty-radar-circle {
          font-size: 40px;
          margin-bottom: 14px;
        }

        .veh-empty-feed h3 {
          font-size: 18px;
          font-weight: 800;
          color: #0f172a;
          margin: 0 0 6px 0;
        }

        .veh-empty-feed p {
          font-size: 14px;
          color: #64748b;
          max-width: 480px;
          margin: 0;
        }

        .veh-card-grid {
          display: grid;
          grid-template-columns: repeat(auto-fill, minmax(320px, 1fr));
          gap: 18px;
        }

        .veh-detection-card {
          background: #ffffff;
          border: 1px solid #e2e8f0;
          border-radius: 14px;
          overflow: hidden;
          box-shadow: 0 2px 10px rgba(0, 0, 0, 0.04);
          cursor: pointer;
          display: flex;
          flex-direction: column;
          transition: transform 0.2s, box-shadow 0.2s;
        }

        .veh-detection-card:hover {
          transform: translateY(-3px);
          box-shadow: 0 8px 24px rgba(0, 0, 0, 0.08);
        }

        .veh-detection-card.lane-in {
          border-top: 4px solid #10b981;
        }

        .veh-detection-card.lane-out {
          border-top: 4px solid #ef4444;
        }

        .new-arrival-glow {
          animation: cardFlash 2.5s ease-out;
        }

        @keyframes cardFlash {
          0% { box-shadow: 0 0 22px rgba(16, 185, 129, 0.8); }
          100% { box-shadow: 0 2px 10px rgba(0, 0, 0, 0.04); }
        }

        /* Card Top Row */
        .card-top-row {
          padding: 10px 14px;
          display: flex;
          align-items: center;
          justify-content: space-between;
          background: #f8fafc;
          border-bottom: 1px solid #edf2f7;
        }

        .movement-badge-group {
          display: flex;
          align-items: center;
          gap: 6px;
        }

        .movement-badge {
          font-size: 11px;
          font-weight: 800;
          padding: 3px 8px;
          border-radius: 6px;
          letter-spacing: 0.04em;
        }

        .movement-badge.entry {
          background: #d1fae5;
          color: #065f46;
          border: 1px solid #a7f3d0;
        }

        .movement-badge.exit {
          background: #fee2e2;
          color: #991b1b;
          border: 1px solid #fecaca;
        }

        .camera-code-tag {
          font-size: 11px;
          font-weight: 700;
          color: #64748b;
          font-family: 'JetBrains Mono', monospace;
        }

        .timestamp-tag {
          font-size: 11.5px;
          font-weight: 600;
          color: #475569;
          display: flex;
          align-items: center;
          gap: 4px;
        }

        /* Snapshot Media */
        .card-media-viewport {
          position: relative;
          width: 100%;
          aspect-ratio: 16 / 9;
          background: #090e17;
          overflow: hidden;
        }

        .vehicle-snapshot-img {
          width: 100%;
          height: 100%;
          object-fit: contain;
          display: block;
        }

        .media-zoom-overlay {
          position: absolute;
          inset: 0;
          background: rgba(15, 23, 42, 0.6);
          display: flex;
          align-items: center;
          justify-content: center;
          color: #ffffff;
          font-size: 12px;
          font-weight: 700;
          opacity: 0;
          transition: opacity 0.2s;
        }

        .veh-detection-card:hover .media-zoom-overlay {
          opacity: 1;
        }

        /* Plate Section */
        .card-plate-section {
          padding: 12px 14px;
          background: #ffffff;
          border-bottom: 1px solid #f1f5f9;
        }

        .plate-box-wrap {
          width: 100%;
        }

        .plate-recognized-display {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 10px;
          background: #f8fafc;
          border: 1px solid #cbd5e1;
          border-radius: 8px;
          padding: 6px 10px;
        }

        .plate-crop-thumb {
          height: 32px;
          max-width: 80px;
          object-fit: contain;
          border-radius: 4px;
          border: 1px solid #94a3b8;
          background: #090e17;
        }

        .plate-text-pill {
          display: inline-flex;
          align-items: center;
          background: #fef08a;
          border: 2px solid #ca8a04;
          border-radius: 6px;
          overflow: hidden;
          box-shadow: 0 1px 3px rgba(0, 0, 0, 0.1);
        }

        .plate-country-code {
          background: #1e3a8a;
          color: #ffffff;
          font-size: 9px;
          font-weight: 800;
          padding: 4px 5px;
          letter-spacing: 0.05em;
        }

        .plate-registration-number {
          padding: 3px 10px;
          font-size: 14px;
          font-weight: 800;
          color: #0f172a;
          letter-spacing: 0.08em;
          font-family: 'JetBrains Mono', monospace;
        }

        .plate-status-badge {
          font-size: 10.5px;
          font-weight: 800;
          padding: 3px 8px;
          border-radius: 9999px;
          letter-spacing: 0.04em;
        }

        .plate-status-badge.recognized {
          background: #dbeafe;
          color: #1d4ed8;
          border: 1px solid #bfdbfe;
        }

        .plate-status-badge.unrecognized {
          background: #fef3c7;
          color: #b45309;
          border: 1px solid #fde68a;
        }

        .plate-unrecognized-display {
          display: flex;
          align-items: center;
          justify-content: space-between;
          background: #fffbeb;
          border: 1px solid #fde68a;
          border-radius: 8px;
          padding: 8px 12px;
        }

        .plate-unrecognized-text {
          display: flex;
          align-items: center;
          gap: 6px;
          color: #92400e;
          font-size: 12.5px;
        }

        /* Card Bottom Info */
        .card-bottom-info {
          padding: 10px 14px 12px;
          display: flex;
          align-items: center;
          justify-content: space-between;
          background: #ffffff;
        }

        .info-item {
          display: flex;
          flex-direction: column;
        }

        .info-label {
          font-size: 10.5px;
          color: #94a3b8;
          font-weight: 700;
          letter-spacing: 0.03em;
        }

        .info-val {
          font-size: 12.5px;
          color: #334155;
          font-weight: 600;
        }

        .info-val.strong {
          color: #0f172a;
          font-weight: 800;
        }

        /* ── Modal ── */
        .veh-modal-backdrop {
          position: fixed;
          inset: 0;
          background: rgba(15, 23, 42, 0.75);
          backdrop-filter: blur(4px);
          z-index: 999999;
          display: flex;
          align-items: center;
          justify-content: center;
          padding: 20px;
        }

        .veh-modal-card {
          background: #ffffff;
          border-radius: 16px;
          width: 100%;
          max-width: 780px;
          max-height: 90vh;
          overflow-y: auto;
          box-shadow: 0 20px 50px rgba(0, 0, 0, 0.3);
          border: 1px solid #e2e8f0;
        }

        .veh-modal-header {
          padding: 16px 20px;
          display: flex;
          align-items: center;
          justify-content: space-between;
          border-bottom: 1px solid #e2e8f0;
          background: #f8fafc;
        }

        .modal-title-wrap {
          display: flex;
          align-items: center;
          gap: 10px;
        }

        .modal-dir-pill {
          font-size: 11px;
          font-weight: 800;
          padding: 4px 10px;
          border-radius: 6px;
        }

        .modal-dir-pill.entry {
          background: #10b981;
          color: #ffffff;
        }

        .modal-dir-pill.exit {
          background: #ef4444;
          color: #ffffff;
        }

        .veh-modal-header h3 {
          margin: 0;
          font-size: 17px;
          font-weight: 800;
          color: #0f172a;
        }

        .veh-modal-close {
          background: #e2e8f0;
          border: none;
          width: 32px;
          height: 32px;
          border-radius: 50%;
          cursor: pointer;
          font-weight: 800;
          display: flex;
          align-items: center;
          justify-content: center;
        }

        .veh-modal-close:hover {
          background: #cbd5e1;
        }

        .veh-modal-body {
          padding: 20px;
          display: flex;
          flex-direction: column;
          gap: 20px;
        }

        .modal-image-preview {
          width: 100%;
          background: #090e17;
          border-radius: 12px;
          overflow: hidden;
          aspect-ratio: 16 / 9;
          display: flex;
          align-items: center;
          justify-content: center;
        }

        .modal-image-preview.has-plate-crop {
          display: grid;
          grid-template-columns: minmax(0, 1fr) minmax(150px, 0.32fr);
        }

        .modal-full-img {
          width: 100%;
          height: 100%;
          object-fit: contain;
        }

        .modal-plate-next-to-vehicle {
          height: 100%;
          min-width: 0;
          padding: 12px;
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          gap: 8px;
          background: #111827;
          border-left: 1px solid #334155;
        }

        .modal-plate-next-img {
          width: 100%;
          max-height: calc(100% - 24px);
          object-fit: contain;
        }

        .modal-details-grid {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 16px;
        }

        @media (max-width: 650px) {
          .modal-details-grid {
            grid-template-columns: 1fr;
          }
        }

        .modal-meta-box {
          background: #f8fafc;
          border: 1px solid #e2e8f0;
          border-radius: 12px;
          padding: 16px;
        }

        .modal-meta-box h4 {
          margin: 0 0 12px 0;
          font-size: 13.5px;
          font-weight: 800;
          color: #0f172a;
          border-bottom: 1px solid #e2e8f0;
          padding-bottom: 8px;
        }

        .modal-plate-view {
          display: flex;
          flex-direction: column;
          gap: 10px;
        }

        .modal-crop-wrap {
          display: flex;
          flex-direction: column;
          gap: 4px;
        }

        .crop-label {
          font-size: 11px;
          font-weight: 700;
          color: #64748b;
        }

        .modal-plate-crop {
          max-height: 48px;
          width: auto;
          object-fit: contain;
          border: 1px solid #cbd5e1;
          border-radius: 6px;
          background: #090e17;
        }

        .modal-plate-crop-review {
          max-height: 88px;
          max-width: 100%;
        }

        .modal-plate-number {
          display: inline-flex;
          align-items: center;
          background: #fef08a;
          border: 2px solid #ca8a04;
          border-radius: 8px;
          overflow: hidden;
          align-self: flex-start;
        }

        .modal-plate-number .plate-country {
          background: #1e3a8a;
          color: #ffffff;
          font-size: 10px;
          font-weight: 800;
          padding: 6px 8px;
        }

        .modal-plate-number .plate-string {
          padding: 5px 14px;
          font-size: 16px;
          font-weight: 800;
          color: #0f172a;
          font-family: 'JetBrains Mono', monospace;
          letter-spacing: 0.08em;
        }

        .modal-badge-ok {
          font-size: 12px;
          font-weight: 700;
          color: #059669;
        }

        .modal-plate-none {
          padding: 10px 0;
        }

        .warn-badge {
          font-size: 13px;
          font-weight: 800;
          color: #b45309;
        }

        .modal-plate-none p {
          font-size: 12.5px;
          color: #64748b;
          margin: 6px 0 0 0;
        }

        .plate-correction-label {
          display: block;
          margin: 12px 0 6px;
          color: #334155;
          font-size: 12px;
          font-weight: 700;
        }

        .plate-correction-row {
          display: flex;
          gap: 8px;
        }

        .plate-correction-row input {
          min-width: 0;
          flex: 1;
          border: 1px solid #cbd5e1;
          border-radius: 6px;
          padding: 8px 10px;
          font: inherit;
          text-transform: uppercase;
        }

        .plate-correction-row button {
          border: 0;
          border-radius: 6px;
          padding: 8px 12px;
          color: white;
          background: #059669;
          font-weight: 700;
          cursor: pointer;
        }

        .plate-correction-row button:disabled {
          opacity: 0.6;
          cursor: wait;
        }

        .plate-correction-error {
          color: #dc2626 !important;
          margin-top: 8px !important;
        }

        .meta-table {
          display: flex;
          flex-direction: column;
          gap: 8px;
        }

        .meta-row {
          display: flex;
          justify-content: space-between;
          font-size: 12.5px;
        }

        .m-label {
          color: #64748b;
          font-weight: 600;
        }

        .m-val {
          color: #0f172a;
          font-weight: 700;
        }

        .m-val.strong {
          color: #0284c7;
        }

        .font-mono {
          font-family: 'JetBrains Mono', monospace;
          font-size: 11px;
        }
      `}</style>
    </div>
  );
};

export default VehicleList;
