import React, { useState, useEffect } from 'react';
import { useNavigate, useParams, useLocation } from 'react-router-dom';
import { getAttendance } from './attendance.service';
import Loader from '../../components/common/Loader';

const AttendanceDetails = () => {
  const { id } = useParams();
  const navigate = useNavigate();
  const location = useLocation();

  const [records, setRecords] = useState(
    location.state?.records || (location.state?.record ? [location.state.record] : null)
  );
  const [loading, setLoading] = useState(!records);
  const [error, setError] = useState('');

  useEffect(() => {
    if (records) {
      return;
    }

    const fetchRecord = async () => {
      try {
        const response = await getAttendance(1, 1000);
        const rows = response.data?.rows || [];
        const found = rows.find((r) => String(r.id) === String(id));
        if (found) {
          // If fetched by ID, we only have the one record.
          setRecords([found]);
        } else {
          setError('Attendance record not found.');
        }
      } catch (err) {
        setError(err.response?.data?.message || 'Failed to fetch attendance record.');
      } finally {
        setLoading(false);
      }
    };

    fetchRecord();
  }, [id, records]);

  if (loading) {
    return (
      <div className="attendance-details-container fade-in">
        <Loader message="Loading attendance details..." />
      </div>
    );
  }

  if (error || !records || records.length === 0) {
    return (
      <div className="attendance-details-container fade-in">
        <div className="alert alert-danger">{error || 'Record not found.'}</div>
        <button className="back-link-btn mt-4" onClick={() => navigate('/attendance')}>
          &larr; Back to Attendance Log
        </button>
      </div>
    );
  }

  // Derive stats
  const employee = records[0].employee;
  const dateStr = records[0].timestamp 
    ? new Date(records[0].timestamp).toLocaleDateString(undefined, {
        year: 'numeric',
        month: 'long',
        day: 'numeric'
      })
    : 'Unknown Date';

  // Sort chronologically
  const sortedRecords = [...records].sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));

  const inRecords = sortedRecords.filter(r => r.eventType === 'IN');
  const outRecords = sortedRecords.filter(r => r.eventType === 'OUT');

  const firstIn = inRecords[0] || null;
  const lastOut = outRecords[outRecords.length - 1] || null;

  const firstInTime = firstIn?.timestamp 
    ? new Date(firstIn.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) 
    : '—';
  const firstInCamera = firstIn?.camera?.name || (firstIn ? 'CAM-02' : '—');
    
  const lastOutTime = lastOut?.timestamp 
    ? new Date(lastOut.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) 
    : '—';
  const lastOutCamera = lastOut?.camera?.name || (lastOut ? 'CAM-01' : '—');

  let workingDuration = '—';
  if (firstIn && lastOut) {
    const inMs = new Date(firstIn.timestamp).getTime();
    const outMs = new Date(lastOut.timestamp).getTime();
    if (outMs > inMs) {
      const diffMins = Math.round((outMs - inMs) / 60000);
      const hrs = Math.floor(diffMins / 60);
      const mins = diffMins % 60;
      workingDuration = `${hrs} hrs ${mins} mins`;
    }
  }

  const isIncomplete = Boolean((firstIn && !lastOut) || (!firstIn && lastOut));
  const incompleteMessage = (firstIn && !lastOut)
    ? 'Incomplete Attendance: Entry recorded at CAM-02 (IN) but no valid exit punch (CAM-01 OUT) has been recorded yet.'
    : (!firstIn && lastOut)
    ? 'Incomplete Attendance: Exit recorded at CAM-01 (OUT) without prior verified entry punch (CAM-02 IN).'
    : null;

  const totalCaptures = sortedRecords.length;

  const hasPresent = sortedRecords.some(r => ['PRESENT', 'LATE', 'OVERTIME', 'HALF_DAY'].includes(r.status));
  const hasLeave = sortedRecords.some(r => r.status === 'LEAVE');
  const hasOD = sortedRecords.some(r => r.status === 'OD' || r.status === 'OFFICIAL_DUTY');
  
  let overallStatus = 'ABSENT';
  if (hasPresent) overallStatus = 'PRESENT';
  else if (hasLeave) overallStatus = 'LEAVE';
  else if (hasOD) overallStatus = 'OD';

  const uniqueSources = Array.from(new Set(sortedRecords.map(r => r.source === 'MANUAL' ? 'Manual' : 'Camera')));

  // Avatar Helper
  const getInitials = (first, last) => {
    const f = first ? first.charAt(0).toUpperCase() : '';
    const l = last ? last.charAt(0).toUpperCase() : '';
    return (f + l) || '?';
  };

  const statusColorClass = 
    overallStatus === 'PRESENT' ? 'status-badge-success' : 
    overallStatus === 'ABSENT' ? 'status-badge-danger' : 
    overallStatus === 'LEAVE' ? 'status-badge-warning' : 'status-badge-od';

  return (
    <div className="attendance-details-container fade-in">
      
      {/* SECTION 1 - PAGE HEADER */}
      <div className="details-header">
        <button className="back-link-btn" onClick={() => navigate('/attendance')}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="19" y1="12" x2="5" y2="12"></line><polyline points="12 19 5 12 12 5"></polyline></svg>
          Back to Attendance Log
        </button>
        <h1 className="details-title">Attendance Details</h1>
        <p className="details-subtitle">Daily attendance and dual-camera detection history.</p>
      </div>

      {/* Incomplete attendance alert banner */}
      {isIncomplete && (
        <div style={{
          background: 'rgba(239, 68, 68, 0.1)',
          border: '1px solid rgba(239, 68, 68, 0.3)',
          borderRadius: 'var(--radius, 8px)',
          padding: '14px 18px',
          marginBottom: '20px',
          display: 'flex',
          alignItems: 'center',
          gap: '12px',
          color: '#ef4444',
          fontSize: '14px',
          fontWeight: 500,
        }}>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="8" x2="12" y2="12"></line><line x1="12" y1="16" x2="12.01" y2="16"></line></svg>
          <span>{incompleteMessage}</span>
        </div>
      )}

      {/* SECTION 2 - EMPLOYEE PROFILE HEADER */}
      <div className="profile-header-card">
        <div className="profile-header-content">
          <div className="profile-left">
            {employee?.photoUrl ? (
              <img 
                src={(employee.photoUrl?.startsWith('http') ? employee.photoUrl : `/employee-images/${employee.photoUrl}`)} 
                alt="Employee"
                className="profile-avatar"
                onError={(e) => { e.target.style.display = 'none'; e.target.nextSibling.style.display = 'flex'; }}
              />
            ) : null}
            <div className="profile-avatar-fallback" style={{ display: employee?.photoUrl ? 'none' : 'flex' }}>
              {getInitials(employee?.firstName, employee?.lastName)}
            </div>
            <div className="profile-info">
              <h2 className="profile-name">
                {employee ? `${employee.firstName} ${employee.lastName || ''}`.trim() : 'Unknown Employee'}
              </h2>
              <div className="profile-meta">
                <span className="profile-code">{employee?.employeeCode || 'N/A'}</span>
                <span className="profile-date">{dateStr}</span>
              </div>
            </div>
          </div>
          <div className="profile-right">
            <span className={`large-status-badge ${statusColorClass}`}>
              <span className="status-dot"></span>
              {overallStatus}
            </span>
          </div>
        </div>
      </div>

      {/* SECTION 3 - ATTENDANCE SUMMARY */}
      <div className="summary-grid">
        <div className="summary-card">
          <span className="summary-label">ENTRY (IN)</span>
          <span className="summary-value" style={{ color: firstIn ? '#22c55e' : 'inherit' }}>
            {firstInTime}
          </span>
          <span style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: '2px' }}>
            {firstIn ? `${firstInCamera} (Dedicated Entry)` : 'No Entry Punch'}
          </span>
        </div>
        <div className="summary-card">
          <span className="summary-label">EXIT (OUT)</span>
          <span className="summary-value" style={{ color: lastOut ? '#10b981' : 'inherit' }}>
            {lastOutTime}
          </span>
          <span style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: '2px' }}>
            {lastOut ? `${lastOutCamera} (Dedicated Exit)` : 'No Exit Punch'}
          </span>
        </div>
        <div className="summary-card">
          <span className="summary-label">WORKING DURATION</span>
          <span className="summary-value">{workingDuration}</span>
          <span style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: '2px' }}>
            {isIncomplete ? 'Pending complete punch' : 'From verified IN/OUT'}
          </span>
        </div>
        <div className="summary-card">
          <span className="summary-label">TOTAL DETECTIONS</span>
          <span className="summary-value">{totalCaptures}</span>
          <span style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: '2px' }}>
            {uniqueSources.join(', ')}
          </span>
        </div>
      </div>

      {/* SECTION 4 - DETECTION HISTORY */}
      <div className="history-section">
        <h3 className="history-title">Camera Detection History</h3>
        <p className="history-subtitle">Individual attendance events recorded for this employee across CAM-01 and CAM-02.</p>
        
        <div className="history-table-container">
          {sortedRecords.length === 0 ? (
            <div className="empty-history">
              <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"></circle><polyline points="12 6 12 12 16 14"></polyline></svg>
              <p>No camera detections recorded for this date.</p>
            </div>
          ) : (
            <table className="history-table">
              <thead>
                <tr>
                  <th style={{ width: '8%' }}>S.No</th>
                  <th style={{ width: '22%' }}>TIME</th>
                  <th style={{ width: '22%' }}>CAMERA & DIRECTION</th>
                  <th style={{ width: '18%' }}>SIMILARITY</th>
                  <th style={{ width: '15%' }}>SOURCE</th>
                  <th style={{ width: '15%' }}>STATUS</th>
                </tr>
              </thead>
              <tbody>
                {sortedRecords.map((record, index) => {
                  const rStatus = record.status === 'OVERTIME' ? 'OVERTIME (OT)' : record.status || 'PRESENT';
                  const rColor = rStatus.includes('PRESENT') || rStatus.includes('OVERTIME') 
                    ? 'status-badge-success' 
                    : rStatus === 'LATE' ? 'status-badge-warning' : 'status-badge-purple';
                  
                  const isEntry = record.eventType === 'IN';
                  const camName = record.camera?.name || (isEntry ? 'CAM-02' : 'CAM-01');
                    
                  return (
                    <tr key={record.id}>
                      <td className="row-num">{String(index + 1).padStart(2, '0')}</td>
                      <td className="row-time">
                        {record.timestamp 
                          ? new Date(record.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }) 
                          : '—'}
                      </td>
                      <td>
                        <span style={{
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: '6px',
                          fontWeight: 600,
                          fontSize: '12px',
                          color: isEntry ? '#22c55e' : '#10b981',
                        }}>
                          {camName} [{record.eventType || 'IN'}]
                        </span>
                      </td>
                      <td>
                        <span style={{ fontSize: '13px', fontFamily: 'monospace' }}>
                          {record.similarity ? `${(record.similarity * 100).toFixed(1)}%` : '—'}
                        </span>
                      </td>
                      <td>
                        <span className="source-label">
                          {record.source === 'MANUAL' ? 'Manual' : 'Camera'}
                        </span>
                      </td>
                      <td>
                        <span className={`compact-status-badge ${rColor}`}>
                          <span className="status-dot"></span>
                          {rStatus}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      </div>


      <style>{`
        .attendance-details-container {
          max-width: 96%;
          margin: 0 auto;
          padding: 20px 20px 60px;
        }
        
        .details-header {
          margin-bottom: 28px;
        }
        
        .back-link-btn {
          display: inline-flex;
          align-items: center;
          gap: 6px;
          background: transparent;
          border: none;
          color: var(--text-muted);
          font-size: 14px;
          font-weight: 500;
          cursor: pointer;
          padding: 0;
          margin-bottom: 20px;
          transition: color 0.15s ease;
        }
        
        .back-link-btn:hover {
          color: var(--primary);
        }
        
        .details-title {
          font-size: 26px;
          font-weight: 700;
          color: var(--text-primary);
          letter-spacing: -0.015em;
          margin: 0 0 6px 0;
        }
        
        .details-subtitle {
          font-size: 14px;
          color: var(--text-muted);
          margin: 0;
        }

        /* SECTION 2 - EMPLOYEE PROFILE HEADER */
        .profile-header-card {
          background: var(--surface);
          border: 1px solid var(--border);
          border-radius: var(--radius-lg);
          padding: 24px;
          margin-bottom: 24px;
          box-shadow: var(--shadow-sm);
        }
        
        .profile-header-content {
          display: flex;
          align-items: center;
          justify-content: space-between;
          flex-wrap: wrap;
          gap: 20px;
        }
        
        .profile-left {
          display: flex;
          align-items: center;
          gap: 20px;
        }
        
        .profile-avatar, .profile-avatar-fallback {
          width: 72px;
          height: 72px;
          border-radius: var(--radius-full);
          flex-shrink: 0;
        }
        
        .profile-avatar {
          object-fit: cover;
          border: 1px solid var(--border);
        }
        
        .profile-avatar-fallback {
          background: var(--surface-elevated);
          border: 1px solid var(--border-strong);
          color: var(--text-secondary);
          display: flex;
          align-items: center;
          justify-content: center;
          font-size: 22px;
          font-weight: 600;
          letter-spacing: 0.05em;
        }
        
        .profile-info {
          display: flex;
          flex-direction: column;
          gap: 6px;
        }
        
        .profile-name {
          font-size: 22px;
          font-weight: 700;
          color: var(--text-primary);
          margin: 0;
          line-height: 1.2;
        }
        
        .profile-meta {
          display: flex;
          align-items: center;
          gap: 12px;
        }
        
        .profile-code {
          font-size: 13px;
          font-weight: 600;
          color: var(--text-muted);
          background: var(--surface-2);
          padding: 2px 8px;
          border-radius: var(--radius-sm);
          font-family: 'JetBrains Mono', monospace;
        }
        
        .profile-date {
          font-size: 14px;
          font-weight: 500;
          color: var(--text-secondary);
        }

        .large-status-badge {
          display: inline-flex;
          align-items: center;
          gap: 8px;
          padding: 8px 16px;
          border-radius: var(--radius-full);
          font-size: 14px;
          font-weight: 700;
          letter-spacing: 0.05em;
          border: 1px solid transparent;
        }

        .status-dot {
          width: 8px;
          height: 8px;
          border-radius: 50%;
          background-color: currentColor;
        }

        .status-badge-success {
          background: var(--success-light);
          color: var(--success-text);
          border-color: var(--success-border);
        }
        
        .status-badge-danger {
          background: var(--danger-light);
          color: var(--danger-text);
          border-color: var(--danger-border);
        }
        
        .status-badge-warning {
          background: var(--warning-light);
          color: var(--warning-text);
          border-color: var(--warning-border);
        }
        
        .status-badge-od, .status-badge-purple {
          background: var(--purple-light);
          color: var(--purple-text);
          border-color: var(--purple-border);
        }

        /* SECTION 3 - ATTENDANCE SUMMARY */
        .summary-grid {
          display: grid;
          grid-template-columns: repeat(4, 1fr);
          gap: 16px;
          margin-bottom: 40px;
        }
        
        .summary-card {
          background: var(--surface);
          border: 1px solid var(--border);
          border-radius: var(--radius);
          padding: 16px 20px;
          display: flex;
          flex-direction: column;
          gap: 6px;
          box-shadow: var(--shadow-xs);
        }
        
        .summary-label {
          font-size: 11px;
          font-weight: 700;
          letter-spacing: 0.08em;
          color: var(--text-muted);
          text-transform: uppercase;
        }
        
        .summary-value {
          font-size: 18px;
          font-weight: 600;
          color: var(--text-primary);
        }

        /* SECTION 4 - DETECTION HISTORY */
        .history-section {
          margin-top: 30px;
        }
        
        .history-title {
          font-size: 18px;
          font-weight: 700;
          color: var(--text-primary);
          margin: 0 0 4px 0;
        }
        
        .history-subtitle {
          font-size: 13.5px;
          color: var(--text-muted);
          margin: 0 0 20px 0;
        }
        
        .history-table-container {
          background: var(--surface);
          border: 1px solid var(--border);
          border-radius: var(--radius-lg);
          overflow: hidden;
          box-shadow: var(--shadow-sm);
        }
        
        .history-table {
          width: 100%;
          border-collapse: collapse;
        }
        
        .history-table th {
          background: var(--surface-2);
          padding: 14px 24px;
          font-size: 11px;
          font-weight: 700;
          color: var(--text-muted);
          text-transform: uppercase;
          letter-spacing: 0.06em;
          border-bottom: 1px solid var(--border-strong);
          text-align: left;
        }
        
        .history-table td {
          padding: 16px 24px;
          border-bottom: 1px solid var(--divider);
          vertical-align: middle;
        }
        
        .history-table tr:hover {
          background: var(--surface-2);
        }
        
        .history-table tr:last-child td {
          border-bottom: none;
        }
        
        .row-num {
          font-size: 13px;
          color: var(--text-muted);
          font-weight: 500;
        }
        
        .row-time {
          font-size: 14px;
          font-weight: 600;
          color: var(--text-primary);
          font-family: 'JetBrains Mono', monospace;
        }
        
        .source-label {
          font-size: 13px;
          font-weight: 500;
          color: var(--text-secondary);
        }

        .compact-status-badge {
          display: inline-flex;
          align-items: center;
          gap: 6px;
          padding: 4px 10px;
          border-radius: var(--radius-sm);
          font-size: 12px;
          font-weight: 600;
          border: 1px solid transparent;
        }
        
        .empty-history {
          padding: 60px 20px;
          text-align: center;
          color: var(--text-muted);
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 16px;
        }
        
        .empty-history svg {
          color: var(--border-strong);
        }

        /* Responsive Layout */
        @media (max-width: 900px) {
          .summary-grid {
            grid-template-columns: repeat(2, 1fr);
          }
          
          .profile-header-content {
            flex-direction: column;
            align-items: flex-start;
          }
          
          .profile-right {
            align-self: flex-start;
          }
        }
        
        @media (max-width: 600px) {
          .summary-grid {
            grid-template-columns: 1fr;
          }
        }
      `}</style>
    </div>
  );
};

export default AttendanceDetails;
