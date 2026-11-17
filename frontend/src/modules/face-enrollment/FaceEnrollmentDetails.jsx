import React, { useState, useEffect } from 'react';
import { useNavigate, useParams, Link } from 'react-router-dom';
import { getEnrollmentById, deleteEnrollment } from './face-enrollment.service';
import Button from '../../components/common/Button';
import Loader from '../../components/common/Loader';
import Modal from '../../components/common/Modal';

const FaceEnrollmentDetails = () => {
  const { id } = useParams();
  const navigate = useNavigate();

  const [enrollment, setEnrollment] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const [deleteModalOpen, setDeleteModalOpen] = useState(false);
  const [deleteLoading, setDeleteLoading] = useState(false);

  useEffect(() => {
    const fetchEnrollment = async () => {
      try {
        const response = await getEnrollmentById(id);
        setEnrollment(response.data);
      } catch (err) {
        setError(err.response?.data?.message || 'Failed to fetch face enrollment details.');
      } finally {
        setLoading(false);
      }
    };

    fetchEnrollment();
  }, [id]);

  const handleDelete = async () => {
    setDeleteLoading(true);
    try {
      await deleteEnrollment(id);
      navigate('/face-enrollments');
    } catch (err) {
      alert(err.response?.data?.message || 'Failed to delete face enrollment.');
      setDeleteLoading(false);
      setDeleteModalOpen(false);
    }
  };

  if (loading) {
    return (
      <div className="page-container">
        <Loader message="Loading face enrollment details..." />
      </div>
    );
  }

  if (error || !enrollment) {
    return (
      <div className="page-container">
        <div className="alert alert-danger">{error || 'Face enrollment record not found.'}</div>
        <Button variant="secondary" onClick={() => navigate('/face-enrollments')}>
          Back to List
        </Button>
      </div>
    );
  }

  const employee = enrollment.employee;
  const employeeName = employee
    ? `${employee.firstName} ${employee.lastName || ''}`.trim()
    : 'Unknown Employee';
  const employeeCode = employee?.employeeCode || 'N/A';
  const employeeInitials = employee
    ? `${employee.firstName?.[0] || ''}${employee.lastName?.[0] || employee.firstName?.[1] || ''}`.toUpperCase()
    : 'EM';

  const formatEnrollmentDate = (dateString) => {
    if (!dateString) return 'N/A';
    try {
      const d = new Date(dateString);
      if (isNaN(d.getTime())) return 'N/A';
      return (
        d.toLocaleDateString('en-GB', {
          day: 'numeric',
          month: 'short',
          year: 'numeric',
        }) +
        ', ' +
        d.toLocaleTimeString('en-US', {
          hour: 'numeric',
          minute: '2-digit',
          hour12: true,
        })
      );
    } catch (e) {
      return 'N/A';
    }
  };

  const enrolledDateFormatted = formatEnrollmentDate(enrollment.createdAt);

  return (
    <div className="page-container fade-in">
      {/* 1. Page Header */}
      <div className="page-header enrollment-page-header">
        <div className="enrollment-header-info">
          <Link to="/face-enrollments" className="btn btn-ghost btn-sm" style={{ padding: 0, marginBottom: '8px', color: 'var(--text-muted)' }}>
            &larr; Back to Face Registry
          </Link>
          <h1 className="page-title">Face Enrollment Details</h1>
          <p className="page-subtitle" style={{ color: 'var(--text-secondary)' }}>
            Employee biometric enrollment and captured face views.
          </p>
        </div>

        <div className="action-buttons">
          <Button
            variant="danger"
            onClick={() => setDeleteModalOpen(true)}
            title="Delete this enrollment"
          >
            Delete Enrollment
          </Button>
        </div>
      </div>

      {/* 2. Employee Summary */}
      <div className="details-card enrollment-main-card" style={{ marginBottom: '24px' }}>
        <div className="enrollment-emp-hero" style={{ display: 'flex', gap: '20px', alignItems: 'center' }}>
          {enrollment.images?.front ? (
            <img 
              src={enrollment.images.front} 
              alt="Employee"
              style={{ width: '80px', height: '80px', borderRadius: '50%', objectFit: 'cover', border: '2px solid var(--border)' }}
            />
          ) : (
            <div className="enrollment-emp-avatar" aria-label={employeeName} style={{ width: '80px', height: '80px', borderRadius: '50%', background: 'var(--surface-elevated)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '24px', fontWeight: 'bold' }}>
              {employeeInitials}
            </div>
          )}
          <div className="enrollment-emp-meta">
            <h2 className="enrollment-emp-name" style={{ fontSize: '20px', margin: '0 0 4px 0' }}>{employeeName}</h2>
            <div style={{ display: 'flex', gap: '12px', alignItems: 'center', marginBottom: '8px' }}>
              <span className="code-badge">{employeeCode}</span>
              <span className="status-pill status-pill-success">
                <span className="status-dot"></span>
                ENROLLED
              </span>
            </div>
            <div style={{ fontSize: '13px', color: 'var(--text-muted)' }}>
              Enrolled on<br />
              <strong style={{ color: 'var(--text-primary)' }}>{enrolledDateFormatted}</strong>
            </div>
          </div>
        </div>
      </div>

      {/* 3. Three Captured Face Views */}
      {enrollment.images && (
        <div className="details-card" style={{ marginBottom: '24px' }}>
          <h3 style={{ margin: '0 0 16px 0', fontSize: '16px', borderBottom: '1px solid var(--border)', paddingBottom: '12px' }}>Captured Face Views</h3>
          
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '24px' }}>
            {/* Front View */}
            <div style={{ background: 'var(--surface-2)', borderRadius: 'var(--radius)', overflow: 'hidden', border: '1px solid var(--border)' }}>
              {enrollment.images.front ? (
                <img src={enrollment.images.front} alt="Front View" style={{ width: '100%', aspectRatio: '3/4', objectFit: 'cover' }} />
              ) : (
                <div style={{ width: '100%', aspectRatio: '3/4', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-muted)' }}>No Image</div>
              )}
              <div style={{ padding: '12px', textAlign: 'center', fontWeight: '600', letterSpacing: '0.05em', borderTop: '1px solid var(--border)' }}>
                FRONT PHOTO
              </div>
            </div>

            {/* Left View */}
            <div style={{ background: 'var(--surface-2)', borderRadius: 'var(--radius)', overflow: 'hidden', border: '1px solid var(--border)' }}>
              {enrollment.images.left ? (
                <img src={enrollment.images.left} alt="Left View" style={{ width: '100%', aspectRatio: '3/4', objectFit: 'cover' }} />
              ) : (
                <div style={{ width: '100%', aspectRatio: '3/4', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-muted)' }}>No Image</div>
              )}
              <div style={{ padding: '12px', textAlign: 'center', fontWeight: '600', letterSpacing: '0.05em', borderTop: '1px solid var(--border)' }}>
                LEFT PHOTO
              </div>
            </div>

            {/* Right View */}
            <div style={{ background: 'var(--surface-2)', borderRadius: 'var(--radius)', overflow: 'hidden', border: '1px solid var(--border)' }}>
              {enrollment.images.right ? (
                <img src={enrollment.images.right} alt="Right View" style={{ width: '100%', aspectRatio: '3/4', objectFit: 'cover' }} />
              ) : (
                <div style={{ width: '100%', aspectRatio: '3/4', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-muted)' }}>No Image</div>
              )}
              <div style={{ padding: '12px', textAlign: 'center', fontWeight: '600', letterSpacing: '0.05em', borderTop: '1px solid var(--border)' }}>
                RIGHT PHOTO
              </div>
            </div>
          </div>
        </div>
      )}

      {/* 4. Basic Enrollment Information */}
      <div className="details-card" style={{ marginBottom: '24px' }}>
        <h3 style={{ margin: '0 0 16px 0', fontSize: '16px', borderBottom: '1px solid var(--border)', paddingBottom: '12px' }}>Enrollment Information</h3>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '20px' }} className="enrollment-info-grid-simple">
          <div>
            <div style={{ fontSize: '11px', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '4px' }}>Employee</div>
            <div style={{ fontSize: '14px', color: 'var(--text-primary)', fontWeight: '500' }}>{employeeName}</div>
          </div>
          <div>
            <div style={{ fontSize: '11px', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '4px' }}>Employee Code</div>
            <div style={{ fontSize: '14px', color: 'var(--text-primary)', fontWeight: '500' }}>{employeeCode}</div>
          </div>
          <div>
            <div style={{ fontSize: '11px', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '4px' }}>Status</div>
            <div style={{ fontSize: '14px', color: 'var(--text-primary)', fontWeight: '500' }}>{enrollment.status || 'Enrolled'}</div>
          </div>
          <div>
            <div style={{ fontSize: '11px', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '4px' }}>Enrolled On</div>
            <div style={{ fontSize: '14px', color: 'var(--text-primary)', fontWeight: '500' }}>{enrolledDateFormatted}</div>
          </div>
          <div>
            <div style={{ fontSize: '11px', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '4px' }}>Biometric Profile</div>
            <div style={{ fontSize: '14px', color: 'var(--text-primary)', fontWeight: '500' }}>Active — Face Biometric Profile</div>
          </div>
          <div>
            <div style={{ fontSize: '11px', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '4px' }}>Total Camera Scans</div>
            <div style={{ fontSize: '14px', color: 'var(--primary)', fontWeight: '700' }}>
              {enrollment.employee?.attendances?.length || 0} Scans Recorded
            </div>
          </div>
        </div>
      </div>

      {/* 5. Camera Detection & Scan Logs (Grid Box Type) */}
      <div className="details-card" style={{ marginBottom: '24px' }}>
        <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'space-between', alignItems: 'center', margin: '0 0 16px 0', borderBottom: '1px solid var(--border)', paddingBottom: '12px', gap: '12px' }}>
          <div>
            <h3 style={{ margin: '0 0 4px 0', fontSize: '16px' }}>Camera Detection & Scan Logs</h3>
            <p style={{ margin: 0, fontSize: '13px', color: 'var(--text-secondary)' }}>
              Complete audit trail of all camera scans with exact dates and timestamps.
            </p>
          </div>
          <span className="badge badge-success" style={{ fontSize: '12px', padding: '4px 10px' }}>
            {enrollment.employee?.attendances?.length || 0} TOTAL SCANS
          </span>
        </div>

        {/* Scan Logs Grid Box Display */}
        {(!enrollment.employee?.attendances || enrollment.employee.attendances.length === 0) ? (
          <div style={{ textAlign: 'center', padding: '36px 16px', background: 'var(--surface-2)', borderRadius: '10px', border: '1px dashed var(--border)' }}>
            <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="var(--text-muted)" strokeWidth="1.5" style={{ margin: '0 auto 8px auto', display: 'block' }}>
              <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z" />
              <circle cx="12" cy="13" r="4" />
            </svg>
            <h4 style={{ margin: '0 0 4px 0', fontSize: '14px' }}>No Camera Scans Recorded Yet</h4>
            <p style={{ margin: 0, fontSize: '12px', color: 'var(--text-muted)' }}>
              When this employee scans their face on camera, every detection event will be archived in this grid.
            </p>
          </div>
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: '16px' }}>
            {enrollment.employee.attendances.map((scan, idx) => {
              const scanNum = enrollment.employee.attendances.length - idx;
              const scanDate = new Date(scan.timestamp);
              const formattedDateStr = isNaN(scanDate.getTime())
                ? '—'
                : scanDate.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', weekday: 'short' });
              const formattedTimeStr = isNaN(scanDate.getTime())
                ? '—'
                : scanDate.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: true });

              return (
                <div
                  key={scan.id || idx}
                  style={{
                    background: 'var(--surface-2)',
                    border: '1px solid var(--border)',
                    borderRadius: '12px',
                    padding: '16px',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '12px',
                    boxShadow: '0 2px 6px rgba(0, 0, 0, 0.03)',
                    transition: 'all 0.2s',
                  }}
                  onMouseOver={(e) => {
                    e.currentTarget.style.borderColor = 'var(--primary)';
                    e.currentTarget.style.boxShadow = '0 6px 16px rgba(79, 70, 229, 0.12)';
                  }}
                  onMouseOut={(e) => {
                    e.currentTarget.style.borderColor = 'var(--border)';
                    e.currentTarget.style.boxShadow = '0 2px 6px rgba(0, 0, 0, 0.03)';
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span style={{ fontSize: '12px', fontWeight: '800', color: 'var(--primary)', background: 'var(--primary-light)', padding: '2px 8px', borderRadius: '6px' }}>
                      SCAN #{scanNum}
                    </span>
                    <span className="status-pill status-pill-success" style={{ fontSize: '11px', padding: '2px 8px' }}>
                      <span className="status-dot"></span>
                      {scan.status || 'PRESENT'}
                    </span>
                  </div>

                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="var(--text-muted)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
                      <line x1="16" y1="2" x2="16" y2="6" />
                      <line x1="8" y1="2" x2="8" y2="6" />
                      <line x1="3" y1="10" x2="21" y2="10" />
                    </svg>
                    <div>
                      <div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>Scan Date</div>
                      <div style={{ fontSize: '13px', fontWeight: '600', color: 'var(--text-primary)' }}>
                        {formattedDateStr}
                      </div>
                    </div>
                  </div>

                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="var(--primary)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <circle cx="12" cy="12" r="10" />
                      <polyline points="12 6 12 12 16 14" />
                    </svg>
                    <div>
                      <div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>Exact Timestamp</div>
                      <div style={{ fontSize: '15px', fontWeight: '800', color: 'var(--primary)' }}>
                        {formattedTimeStr}
                      </div>
                    </div>
                  </div>

                  <div style={{ paddingTop: '8px', borderTop: '1px solid var(--border)', display: 'flex', alignItems: 'center', gap: '6px', fontSize: '11px', color: 'var(--text-secondary)' }}>
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z" />
                      <circle cx="12" cy="13" r="4" />
                    </svg>
                    <span>{scan.camera?.name || 'Facial Recognition Camera'}</span>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Delete Confirmation Modal */}
      <Modal
        isOpen={deleteModalOpen}
        title="Confirm Biometric Delete"
        onClose={() => setDeleteModalOpen(false)}
        onConfirm={handleDelete}
        confirmText="Delete Enrollment"
        confirmVariant="danger"
        loading={deleteLoading}
      >
        <p>
          Are you sure you want to delete the biometric face enrollment for{' '}
          <strong>
            {employeeName} ({employeeCode})
          </strong>
          ?
        </p>
        <p className="text-sm text-muted" style={{ marginTop: '8px' }}>
          This will remove their facial recognition profile from the camera system. The employee will not be recognized by attendance cameras until a new face scan is registered.
        </p>
      </Modal>
    </div>
  );
};

export default FaceEnrollmentDetails;
