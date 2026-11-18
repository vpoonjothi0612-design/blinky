import React, { useEffect, useRef, useState } from 'react';
import api from '../../services/api';
import './LocalWebcamTestPanel.css';

const LOCAL_WEBCAM_API = 'http://127.0.0.1:5056';
const SAVED_EVENT_KEY = 'local-webcam-test-saved-events';

const isLoopback = (hostname) => ['localhost', '127.0.0.1', '::1'].includes(hostname);

const isLocalBackend = () => {
  try {
    const backendUrl = new URL(api.defaults.baseURL || '/api', window.location.origin);
    return isLoopback(backendUrl.hostname);
  } catch {
    return false;
  }
};

const getSavedEvents = () => {
  try {
    return new Set(JSON.parse(sessionStorage.getItem(SAVED_EVENT_KEY) || '[]'));
  } catch {
    return new Set();
  }
};

const LocalWebcamTestPanel = () => {
  const [status, setStatus] = useState(null);
  const [error, setError] = useState('');
  const [registryError, setRegistryError] = useState('');
  const [savedCount, setSavedCount] = useState(0);
  const [attendanceSavedCount, setAttendanceSavedCount] = useState(0);
  const [saving, setSaving] = useState(false);
  const pollingRef = useRef(false);
  const registrySyncAtRef = useRef(0);
  const processedEventsRef = useRef(getSavedEvents());
  const canRunOnThisHost = isLoopback(window.location.hostname);
  const canSaveLocally = canRunOnThisHost && isLocalBackend();

  useEffect(() => {
    if (!canRunOnThisHost) return undefined;
    let active = true;

    const syncRegisteredFaces = async () => {
      if (!canSaveLocally || Date.now() - registrySyncAtRef.current < 30_000) return;
      registrySyncAtRef.current = Date.now();
      try {
        const listResponse = await api.get('/face-enrollments');
        const records = listResponse.data?.data;
        if (!Array.isArray(records)) throw new Error('Registered face list has an invalid response.');

        const employees = [];
        for (let index = 0; index < records.length; index += 8) {
          const batch = await Promise.all(records.slice(index, index + 8).map(async (record) => {
            if (!record?.id) return null;
            const detailResponse = await api.get(`/face-enrollments/${encodeURIComponent(record.id)}`);
            const enrollment = detailResponse.data?.data;
            const employee = enrollment?.employee;
            if (!enrollment || !employee) return null;

            const embeddings = [
              enrollment.embedding,
              ...(Array.isArray(enrollment.embeddings) ? enrollment.embeddings : []),
            ].filter((vector) => (
              Array.isArray(vector)
              && vector.length === 512
              && vector.every((value) => Number.isFinite(value))
            ));
            const employeeId = employee.employeeCode || String(enrollment.employeeId || '');
            if (!employeeId || embeddings.length === 0) return null;

            return {
              employeeId,
              name: [employee.firstName, employee.lastName].filter(Boolean).join(' ').trim() || employeeId,
              department: employee.department || '',
              embeddings,
            };
          }));
          employees.push(...batch.filter(Boolean));
        }

        if (!active) return;
        const response = await fetch(`${LOCAL_WEBCAM_API}/registry`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ employees }),
        });
        const result = await response.json();
        if (!response.ok || !result.success) {
          throw new Error(result.error || `Local webcam registry sync returned ${response.status}`);
        }
        registrySyncAtRef.current = Number.POSITIVE_INFINITY;
        if (active) setRegistryError('');
      } catch (requestError) {
        if (active) {
          const message = requestError.response?.status === 403
            ? 'Sign in as an admin to load registered face profiles for the local test.'
            : requestError.response?.data?.message
              || requestError.message
              || 'Could not load registered face profiles for the local test.';
          setRegistryError(message);
        }
      }
    };

    const pollStatus = async () => {
      if (pollingRef.current) return;
      pollingRef.current = true;
      try {
        const response = await fetch(`${LOCAL_WEBCAM_API}/status`, { cache: 'no-store' });
        if (!response.ok) throw new Error(`Local webcam service returned ${response.status}`);
        const nextStatus = await response.json();
        if (!active) return;
        setStatus(nextStatus);
        setError('');
        if (!Number.isInteger(nextStatus.registryCount)) {
          setRegistryError('The local webcam test is running an older version. Stop it with Ctrl+C, restart start_local_webcam_test.cmd, then refresh this page.');
          return;
        }
        await syncRegisteredFaces();

        for (const event of nextStatus.pendingEvents || []) {
          if (processedEventsRef.current.has(event.eventId)) {
            await fetch(`${LOCAL_WEBCAM_API}/ack`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ eventId: event.eventId }),
            });
            continue;
          }
          if (!canSaveLocally) continue;

          setSaving(true);
          if (event.decision === 'RECOGNIZED') {
            if (!event.employeeId) throw new Error('Recognized local face is missing its employee code.');
            const attendanceResponse = await api.post('/attendance', {
              employeeId: event.employeeId,
              eventType: 'IN',
              similarity: event.similarity,
              eventId: event.eventId,
              timestamp: event.timestamp,
              source: 'AI_CAMERA',
              capturedImage: event.imagePath || null,
            });
            if (attendanceResponse.data?.created !== false) {
              setAttendanceSavedCount((count) => count + 1);
            }
          } else if (!event.decision || event.decision === 'UNKNOWN') {
            await api.post('/face-enrollments/capture-unknown', {
              decision: 'UNKNOWN',
              face_path: event.imagePath,
              embedding: event.embedding,
              face_quality_score: event.sharpness,
              face_reason: 'LOCAL_WEBCAM_TEST',
              metadata: {
                camera: 'LOCAL-PC Webcam',
                cameraId: 'LOCAL-PC',
                cameraName: 'Local PC Webcam Test',
                direction: 'IN',
                location: 'Local PC Test',
                timestamp: event.timestamp,
                trackId: event.trackId,
                bestScore: event.similarity,
                faceWidth: event.faceWidth,
                faceHeight: event.faceHeight,
                brightness: event.brightness,
                source: 'LOCAL_WEBCAM_TEST',
              },
            });
            setSavedCount((count) => count + 1);
          } else {
            throw new Error(`Unsupported local webcam event: ${event.decision}`);
          }
          processedEventsRef.current.add(event.eventId);
          sessionStorage.setItem(SAVED_EVENT_KEY, JSON.stringify([...processedEventsRef.current].slice(-100)));
          await fetch(`${LOCAL_WEBCAM_API}/ack`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ eventId: event.eventId }),
          });
        }
      } catch (requestError) {
        if (active) setError(requestError.message || 'Local webcam test service is unavailable.');
      } finally {
        pollingRef.current = false;
        if (active) setSaving(false);
      }
    };

    pollStatus();
    const timer = window.setInterval(pollStatus, 1000);
    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, [canRunOnThisHost, canSaveLocally]);

  if (!canRunOnThisHost) return null;

  const detections = status?.detections || [];
  const displayDetections = detections.filter((detection) => (
    detection.employeeId || detection.label === 'UNKNOWN' || detection.label === 'UNCERTAIN'
  ));
  const facePreviewRequiresRestart = (
    status?.connected
    && displayDetections.length > 0
    && status.facePreviewEnabled !== true
  );

  return (
    <section className="local-webcam-test-panel" aria-label="Local PC webcam test">
      <header className="local-webcam-test-header">
        <div>
          <h2>Local PC Webcam Test</h2>
          <p>Recognized faces create IN attendance only in the localhost backend.</p>
        </div>
        <span className={`local-webcam-test-state ${status?.connected ? 'connected' : 'offline'}`}>
          {status?.connected ? 'LOCAL CAMERA CONNECTED' : 'WAITING FOR LOCAL TEST'}
        </span>
      </header>

      <div className="local-webcam-test-content">
        <div className="local-webcam-test-preview">
          {status?.connected ? (
            <img src={`${LOCAL_WEBCAM_API}/stream.mjpg`} alt="Local PC webcam stream" />
          ) : (
            <div className="local-webcam-test-placeholder">
              <strong>Start the local webcam test to show its feed here.</strong>
              <code>start_local_webcam_test.cmd</code>
            </div>
          )}
        </div>

        <div className="local-webcam-test-details">
          <div className="local-webcam-test-metrics">
            <span>Resolution: <strong>{status?.resolution || '—'}</strong></span>
            <span>Processing: <strong>{status?.fps ?? '—'} FPS</strong></span>
            <span>Registered profiles: <strong>{status?.registryCount ?? '—'}</strong></span>
            <span>Local IN attendance saved: <strong>{attendanceSavedCount}</strong></span>
            <span>Unknown captures saved: <strong>{savedCount}</strong></span>
          </div>

          {!canSaveLocally && (
            <p className="local-webcam-test-warning">
              Preview is local-only. Registered face loading and saving are disabled because the frontend is not connected to a localhost backend.
            </p>
          )}
          {registryError && <p className="local-webcam-test-error">{registryError}</p>}
          {facePreviewRequiresRestart && (
            <p className="local-webcam-test-warning">
              Restart the local webcam test (Ctrl+C, then run start_local_webcam_test.cmd) to enable employee photo previews.
            </p>
          )}
          {status?.connected && status.registryCount === 0 && !registryError && (
            <p className="local-webcam-test-warning">
              No enrolled face profiles are loaded. Sign in as an admin and verify the face enrollment; faces will not be classified as unknown until profiles load.
            </p>
          )}
          {saving && <p className="local-webcam-test-note">Saving a local webcam event…</p>}
          {error && <p className="local-webcam-test-error">{error}</p>}

          <div className="local-webcam-test-detections">
            {detections.length === 0 ? (
              <span className="local-webcam-test-empty">No faces detected yet.</span>
            ) : detections.map((detection) => (
              <div className={`local-webcam-detection ${detection.label === 'UNKNOWN' ? 'unknown' : detection.label === 'LOW FACE QUALITY' ? 'low-quality' : detection.employeeId ? 'recognized' : 'uncertain'}`} key={detection.trackId}>
                <strong>{detection.label}</strong>
                <span>{detection.faceWidth} × {detection.faceHeight}px</span>
                {detection.similarity > 0 && <span>Similarity {Number(detection.similarity).toFixed(2)}</span>}
              </div>
            ))}
          </div>
        </div>
      </div>

      {displayDetections.length > 0 && (
        <div className="local-webcam-recognized">
          <h3>Registered &amp; Unregistered Faces</h3>
          <div className="local-webcam-recognized-list">
            {displayDetections.map((detection) => {
              const isRegistered = Boolean(detection.employeeId);
              const isUncertain = !isRegistered && detection.label === 'UNCERTAIN';
              const displayName = isRegistered
                ? detection.name || 'Recognized employee'
                : isUncertain ? 'Uncertain match' : 'Unregistered face';
              return (
                <article className={`local-webcam-employee-card ${isRegistered ? 'registered' : isUncertain ? 'uncertain' : 'unregistered'}`} key={detection.trackId}>
                  {detection.faceImage ? (
                    <img
                      className="local-webcam-employee-photo"
                      src={`data:image/jpeg;base64,${detection.faceImage}`}
                      alt={`${displayName} passport-style photo`}
                    />
                  ) : (
                    <div className="local-webcam-employee-photo-placeholder">
                      {facePreviewRequiresRestart ? 'Restart webcam test' : 'Preparing photo…'}
                    </div>
                  )}
                  <div className="local-webcam-employee-details">
                    <strong>{displayName}</strong>
                    <span>Status: {isRegistered ? 'Registered' : isUncertain ? 'Review match' : 'Not registered'}</span>
                    {isRegistered && (
                      <>
                        <span>Code: {detection.employeeId}</span>
                        <span>Department: {detection.department || '—'}</span>
                      </>
                    )}
                  </div>
                </article>
              );
            })}
          </div>
        </div>
      )}
    </section>
  );
};

export default LocalWebcamTestPanel;
