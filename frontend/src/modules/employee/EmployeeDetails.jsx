import React, { useState, useEffect } from 'react';
import { useNavigate, useParams, Link } from 'react-router-dom';
import { getEmployeeById, deleteEmployee } from './employee.service';
import { getEnrollmentsByEmployee } from '../face-enrollment/face-enrollment.service';
import Button from '../../components/common/Button';
import Loader from '../../components/common/Loader';
import Modal from '../../components/common/Modal';
import AuthenticatedMediaImage from '../../components/common/AuthenticatedMediaImage';

const ANGLES = [
  { id: 'front', label: 'Front View', hint: 'Frontal biometric scan', fileName: (code) => `${code}_angle_01_front.jpg` },
  { id: 'left', label: 'Left Angle', hint: '30° left profile', fileName: (code) => `${code}_angle_02_left.jpg` },
  { id: 'right', label: 'Right Angle', hint: '30° right profile', fileName: (code) => `${code}_angle_03_right.jpg` },
];

const EmployeeDetails = () => {
  const { id } = useParams();
  const navigate = useNavigate();

  const [employee, setEmployee] = useState(null);
  const [enrollment, setEnrollment] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const [deleteModalOpen, setDeleteModalOpen] = useState(false);
  const [deleteLoading, setDeleteLoading] = useState(false);
  const [loadedDiskPhotos, setLoadedDiskPhotos] = useState({});

  useEffect(() => {
    setLoadedDiskPhotos({});
  }, [id]);

  useEffect(() => {
    const fetchEmployeeData = async () => {
      try {
        const empRes = await getEmployeeById(id);
        const empData = empRes.data || empRes;
        setEmployee(empData);

        // If backend returned faceEnrollment nested in employee
        if (empData.faceEnrollment) {
          setEnrollment(empData.faceEnrollment);
        } else {
          // Fallback: Query face enrollment by employee ID
          try {
            const enrollRes = await getEnrollmentsByEmployee(id);
            if (enrollRes.data) {
              setEnrollment(enrollRes.data);
            }
          } catch (e) {
            // No enrollment found or error, leave enrollment as null
            setEnrollment(null);
          }
        }
      } catch (err) {
        setError(err.response?.data?.message || 'Failed to fetch employee details.');
      } finally {
        setLoading(false);
      }
    };

    fetchEmployeeData();
  }, [id]);

  const handleDelete = async () => {
    setDeleteLoading(true);
    try {
      await deleteEmployee(id);
      navigate('/employees');
    } catch (err) {
      alert(err.response?.data?.message || 'Failed to delete employee.');
      setDeleteLoading(false);
      setDeleteModalOpen(false);
    }
  };

  if (loading) {
    return (
      <div className="page-container">
        <Loader message="Loading employee profile..." />
      </div>
    );
  }

  if (error || !employee) {
    return (
      <div className="page-container">
        <div className="alert alert-danger">{error || 'Employee not found.'}</div>
        <Button variant="secondary" onClick={() => navigate('/employees')}>
          Back to Directory
        </Button>
      </div>
    );
  }

  const fullName = `${employee.firstName || ''} ${employee.lastName || ''}`.trim() || 'Unnamed Employee';
  const employeeInitials = `${employee.firstName?.[0] || ''}${employee.lastName?.[0] || employee.firstName?.[1] || ''}`.toUpperCase() || 'EM';

  let imagesMap = {};
  if (enrollment?.images) {
    if (typeof enrollment.images === 'string') {
      try {
        imagesMap = JSON.parse(enrollment.images);
      } catch (e) {
        imagesMap = {};
      }
    } else if (typeof enrollment.images === 'object') {
      imagesMap = enrollment.images;
    }
  }

  // The registry create flow stores its selected images as an ordered photos array.
  // Keep support for the older named-angle format as well.
  if (Array.isArray(imagesMap)) {
    imagesMap = { photos: imagesMap };
  }
  if (Array.isArray(imagesMap.photos)) {
    imagesMap = {
      ...imagesMap,
      front: imagesMap.front || imagesMap.photos[0],
      left: imagesMap.left || imagesMap.photos[1],
      right: imagesMap.right || imagesMap.photos[2],
    };
  }

  const getAnglePhoto = (angle) => {
    if (imagesMap[angle.id]) return imagesMap[angle.id];
    if (!employee.employeeCode) return null;
    return `/employee-images/${encodeURIComponent(employee.employeeCode)}/${encodeURIComponent(angle.fileName(employee.employeeCode))}`;
  };

  const profilePhoto = enrollment?.photoUrl || imagesMap.front || getAnglePhoto(ANGLES[0]);
  const hasAnglePhoto = (angle) => !!imagesMap[angle.id] || !!loadedDiskPhotos[angle.id];
  const capturedCount = ANGLES.filter(hasAnglePhoto).length;
  const isEnrolled = !!enrollment;

  const formatDate = (dateStr) => {
    if (!dateStr) return 'N/A';
    try {
      const d = new Date(dateStr);
      if (isNaN(d.getTime())) return dateStr;
      return d.toLocaleDateString('en-GB', {
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
      });
    } catch (e) {
      return dateStr;
    }
  };

  return (
    <div className="emp-directory-page fade-in">
      {/* ── 1. HERO BANNER ─────────────────────────────────────────────── */}
      <div className="emp-hero-banner">
        <div className="emp-hero-left">
          <div className="emp-hero-icon-box">
            <svg viewBox="0 0 24 24" width="28" height="28" fill="#047857">
              <path d="M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z" />
            </svg>
          </div>
          <div className="emp-hero-text">
            <h1 className="emp-hero-title">Employee Profile</h1>
            <p className="emp-hero-subtitle">
              Enterprise personnel details &amp; biometric attendance credentials.
            </p>
          </div>
        </div>

        <div className="emp-hero-right" style={{ display: 'flex', gap: '10px' }}>
          <button
            type="button"
            className="emp-btn-back"
            onClick={() => navigate('/employees')}
          >
            <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="19" y1="12" x2="5" y2="12" />
              <polyline points="12 19 5 12 12 5" />
            </svg>
            <span>Back to Directory</span>
          </button>
          <button
            type="button"
            className="emp-btn-edit-action"
            onClick={() => navigate(`/employees/${id}/edit`)}
          >
            <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
              <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
            </svg>
            <span>Edit</span>
          </button>
          <button
            type="button"
            className="emp-btn-delete-action"
            onClick={() => setDeleteModalOpen(true)}
          >
            <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="3 6 5 6 21 6" />
              <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
            </svg>
            <span>Delete</span>
          </button>
        </div>
      </div>

      <div className="profile-page-wrapper">
        {/* 2. Employee Profile Header Card */}
        <div className="profile-hero-card">
          <div className="profile-hero-left">
            <div className="profile-avatar-box">
              {profilePhoto ? (
                <AuthenticatedMediaImage
                  mediaKey={profilePhoto}
                  alt={fullName}
                  className="profile-avatar-img"
                  fallback={<div className="profile-avatar-placeholder">{employeeInitials}</div>}
                />
              ) : (
                <div className="profile-avatar-placeholder">
                  {employeeInitials}
                </div>
              )}
            </div>

            <div className="profile-hero-meta">
              <div className="profile-hero-name-row">
                <h1 className="profile-hero-name">{fullName}</h1>
                <span className="code-badge">{employee.employeeCode}</span>
              </div>
              <div className="profile-hero-sub">
                <span>{employee.designation || 'Staff Member'}</span>
                {employee.department && (
                  <>
                    <span>&bull;</span>
                    <span>{employee.department}</span>
                  </>
                )}
              </div>
              <div className="profile-hero-tags">
                <span
                  className={`badge ${
                    employee.status === 'ACTIVE'
                      ? 'badge-success'
                      : 'badge-danger'
                  }`}
                >
                  Status: {employee.status || 'ACTIVE'}
                </span>

                {isEnrolled ? (
                  <span className="status-pill status-pill-success text-xs">
                    <span className="status-dot" />
                    Biometrics Active
                  </span>
                ) : (
                  <span className="badge badge-warning text-xs">
                    Face Enrollment Pending
                  </span>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* 3. Employee Information Section */}
        <div className="profile-card">
          <div className="profile-card-header">
            <div className="profile-card-title-wrap">
              <h3 className="profile-card-title">
                <svg
                  width="18"
                  height="18"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  className="text-primary"
                >
                  <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
                  <circle cx="12" cy="7" r="4" />
                </svg>
                Employee Information
              </h3>
              <span className="profile-card-subtitle">
                Core personnel records and contact details
              </span>
            </div>
          </div>

          <div className="profile-info-grid">
            <div className="profile-info-item">
              <span className="profile-info-label">Employee Code</span>
              <span className="profile-info-value font-mono">
                {employee.employeeCode}
              </span>
            </div>

            <div className="profile-info-item">
              <span className="profile-info-label">Full Name</span>
              <span className="profile-info-value">{fullName}</span>
            </div>

            <div className="profile-info-item">
              <span className="profile-info-label">Email Address</span>
              <span className="profile-info-value">
                {employee.email || 'N/A'}
              </span>
            </div>

            <div className="profile-info-item">
              <span className="profile-info-label">Phone Number</span>
              <span className="profile-info-value">
                {employee.phone || 'N/A'}
              </span>
            </div>

            <div className="profile-info-item">
              <span className="profile-info-label">Department</span>
              <span className="profile-info-value">
                {employee.department || 'N/A'}
              </span>
            </div>

            <div className="profile-info-item">
              <span className="profile-info-label">Designation</span>
              <span className="profile-info-value">
                {employee.designation || 'N/A'}
              </span>
            </div>

            <div className="profile-info-item">
              <span className="profile-info-label">Joining Date</span>
              <span className="profile-info-value">
                {formatDate(employee.joiningDate)}
              </span>
            </div>

            <div className="profile-info-item">
              <span className="profile-info-label">Status</span>
              <span className="profile-info-value">
                <span
                  className={`badge ${
                    employee.status === 'ACTIVE'
                      ? 'badge-success'
                      : 'badge-danger'
                  }`}
                >
                  {employee.status || 'ACTIVE'}
                </span>
              </span>
            </div>
          </div>
        </div>

        {/* 4. Face Enrollment Section */}
        <div className="profile-card">
          <div className="profile-card-header">
            <div className="profile-card-title-wrap">
              <h3 className="profile-card-title">
                <svg
                  width="18"
                  height="18"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  className="text-primary"
                >
                  <path d="M5 8V6a2 2 0 0 1 2-2h2" />
                  <path d="M15 4h2a2 2 0 0 1 2 2v2" />
                  <path d="M5 16v2a2 2 0 0 0 2 2h2" />
                  <path d="M15 20h2a2 2 0 0 0 2-2v-2" />
                  <path d="M9 10h.01" />
                  <path d="M15 10h.01" />
                  <path d="M12 14c-1.5 0-2.5-.5-2.5-.5" />
                </svg>
                Face Enrollment
              </h3>
              <span className="profile-card-subtitle">
                Face images used for camera-based attendance recognition.
              </span>
            </div>

            <div className="flex items-center gap-3">
              {isEnrolled ? (
                <span className="angle-status-badge badge-captured">
                  ✓ {capturedCount > 0 ? `${capturedCount}/3 face images captured` : 'Biometrics Active'}
                </span>
              ) : (
                <span className="angle-status-badge badge-pending">
                  Not Enrolled
                </span>
              )}

              {isEnrolled && enrollment?.id ? (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => navigate(`/face-enrollments/${enrollment.id}`)}
                >
                  Manage Face Enrollment
                </Button>
              ) : (
                <Button
                  className="btn-primary-gradient"
                  size="sm"
                  onClick={() => navigate('/face-enrollments/create')}
                >
                  Update Face Photos
                </Button>
              )}
            </div>
          </div>

          {/* 3 Face Angle Cards */}
          <div className="profile-face-grid">
            {ANGLES.map((angle) => {
              const photo = getAnglePhoto(angle);
              const usesDiskFallback = !imagesMap[angle.id] && !!employee.employeeCode;
              const isCaptured = hasAnglePhoto(angle);

              return (
                <div key={angle.id} className="profile-face-card">
                  <div className="profile-face-card-header">
                    <span className="profile-face-card-title">
                      {angle.label}
                    </span>
                    {isCaptured ? (
                      <span className="angle-status-badge badge-captured text-xs">
                        Captured ✓
                      </span>
                    ) : (
                      <span className="angle-status-badge badge-pending text-xs">
                        Not Captured
                      </span>
                    )}
                  </div>

                  <div className="profile-face-img-wrap">
                    {photo ? (
                      <AuthenticatedMediaImage
                        mediaKey={photo}
                        alt={`${angle.label} - ${fullName}`}
                        className="profile-face-img"
                        onLoad={usesDiskFallback ? () => setLoadedDiskPhotos((current) => ({ ...current, [angle.id]: true })) : undefined}
                        fallback={(
                          <div className="profile-face-placeholder">
                            <span className="profile-face-placeholder-text">Not Captured</span>
                            <span className="text-xs text-muted">{angle.hint}</span>
                          </div>
                        )}
                      />
                    ) : (
                      <div className="profile-face-placeholder">
                        <svg
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="1.5"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        >
                          <circle cx="12" cy="12" r="10" />
                          <circle cx="9" cy="10" r="1.5" />
                          <circle cx="15" cy="10" r="1.5" />
                          <path d="M9 16s1.5-1 3-1 3 1 3 1" />
                        </svg>
                        <span className="profile-face-placeholder-text">
                          Not Captured
                        </span>
                        <span className="text-xs text-muted">
                          {angle.hint}
                        </span>
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* Delete Confirmation Modal */}
      <Modal
        isOpen={deleteModalOpen}
        title="Confirm Delete"
        onClose={() => setDeleteModalOpen(false)}
        onConfirm={handleDelete}
        confirmText="Delete Employee"
        confirmVariant="danger"
        loading={deleteLoading}
      >
        <p>
          Are you sure you want to delete employee{' '}
          <strong>
            {fullName} ({employee.employeeCode})
          </strong>
          ?
        </p>
        <p className="text-sm text-muted mt-2">
          This will permanently remove the employee record and any associated face registry profiles from the system.
        </p>
      </Modal>

      <style>{`
        .emp-directory-page {
          max-width: 1400px;
          margin: 0 auto;
          padding: 24px 28px 48px;
          width: 100%;
          box-sizing: border-box;
          overflow-x: hidden;
        }

        .emp-hero-banner {
          background: linear-gradient(135deg, rgba(209, 250, 229, 0.75) 0%, rgba(236, 253, 245, 0.6) 55%, rgba(224, 242, 254, 0.45) 100%);
          border: 1px solid rgba(16, 185, 129, 0.25);
          border-radius: 16px;
          padding: 22px 28px;
          margin-bottom: 24px;
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 20px;
          box-shadow: 0 2px 8px rgba(5, 150, 105, 0.04);
        }

        .emp-hero-left {
          display: flex;
          align-items: center;
          gap: 18px;
        }

        .emp-hero-icon-box {
          width: 52px;
          height: 52px;
          border-radius: 14px;
          background: linear-gradient(135deg, #a7f3d0, #6ee7b7);
          display: flex;
          align-items: center;
          justify-content: center;
          color: #047857;
          flex-shrink: 0;
          box-shadow: 0 4px 12px rgba(16, 185, 129, 0.18);
        }

        .emp-hero-text {
          display: flex;
          flex-direction: column;
        }

        .emp-hero-title {
          font-size: 24px;
          font-weight: 800;
          color: #064e3b;
          letter-spacing: -0.01em;
          margin: 0 0 4px 0;
          line-height: 1.2;
        }

        .emp-hero-subtitle {
          font-size: 13.5px;
          color: #475569;
          margin: 0;
          font-weight: 500;
        }

        .emp-btn-back {
          height: 40px;
          padding: 0 16px;
          border-radius: 10px;
          background: #ffffff;
          color: #334155;
          border: 1px solid #cbd5e1;
          font-size: 13px;
          font-weight: 600;
          display: inline-flex;
          align-items: center;
          gap: 7px;
          cursor: pointer;
          transition: all 0.2s ease;
          box-shadow: 0 1px 3px rgba(0, 0, 0, 0.04);
        }

        .emp-btn-back:hover {
          background: #f8fafc;
          border-color: #94a3b8;
          color: #0f172a;
        }

        .emp-btn-edit-action {
          height: 40px;
          padding: 0 18px;
          border-radius: 10px;
          background: #ffffff;
          color: #d97706;
          border: 1px solid #fde68a;
          font-size: 13px;
          font-weight: 600;
          display: inline-flex;
          align-items: center;
          gap: 6px;
          cursor: pointer;
          transition: all 0.2s ease;
        }

        .emp-btn-edit-action:hover {
          background: #fffbeb;
          border-color: #f59e0b;
        }

        .emp-btn-delete-action {
          height: 40px;
          padding: 0 18px;
          border-radius: 10px;
          background: #ffffff;
          color: #dc2626;
          border: 1px solid #fecaca;
          font-size: 13px;
          font-weight: 600;
          display: inline-flex;
          align-items: center;
          gap: 6px;
          cursor: pointer;
          transition: all 0.2s ease;
        }

        .emp-btn-delete-action:hover {
          background: #fef2f2;
          border-color: #ef4444;
        }
      `}</style>
    </div>
  );
};

export default EmployeeDetails;

