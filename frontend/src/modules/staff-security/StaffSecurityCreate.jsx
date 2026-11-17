import React, { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { createStaffSecurityUser } from './staff-security.service';
import './staff-security.css';

const StaffSecurityCreate = () => {
  const navigate = useNavigate();

  const [formData, setFormData] = useState({
    name: '',
    email: '',
    role: 'STAFF', // Default to STAFF
    password: '',
    confirmPassword: '',
  });

  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  const handleChange = (e) => {
    const { name, value } = e.target;
    setFormData((prev) => ({
      ...prev,
      [name]: value,
    }));
    if (error) setError('');
  };

  const handleRoleSelect = (role) => {
    setFormData((prev) => ({
      ...prev,
      role,
    }));
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setSuccess('');

    // Validations
    if (!formData.name.trim()) {
      setError('Full Name is required.');
      return;
    }

    if (!formData.email.trim()) {
      setError('Work Email address is required.');
      return;
    }

    if (!formData.password) {
      setError('Password is required.');
      return;
    }

    if (formData.password.length < 3) {
      setError('Password must be at least 3 characters.');
      return;
    }

    if (formData.password !== formData.confirmPassword) {
      setError('Password confirmation does not match.');
      return;
    }

    setSubmitting(true);
    try {
      await createStaffSecurityUser({
        name: formData.name.trim(),
        email: formData.email.trim(),
        role: formData.role,
        password: formData.password,
      });

      setSuccess(`Account provisioned successfully with role: ${formData.role}!`);
      setTimeout(() => {
        navigate('/staff-security');
      }, 1200);
    } catch (err) {
      setError(
        err.response?.data?.message ||
        err.response?.data?.errors?.email?.[0] ||
        'Failed to provision user account. Please check credentials.'
      );
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="staff-sec-container">
      {/* Top Header */}
      <div className="staff-sec-header" style={{ marginBottom: '22px' }}>
        <div>
          <div className="staff-sec-eyebrow">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
              <path d="M16 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
              <circle cx="9" cy="7" r="4" />
              <line x1="19" y1="8" x2="19" y2="14" />
              <line x1="22" y1="11" x2="16" y2="11" />
            </svg>
            Provision System Credentials
          </div>
          <h1 className="staff-sec-title">Add New User</h1>
          <p className="staff-sec-subtitle">
            Create user account for Admin, Staff, or Security personnel.
          </p>
        </div>

        <div className="staff-sec-header-actions">
          <Link
            to="/staff-security"
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '6px',
              padding: '9px 16px',
              borderRadius: '8px',
              background: 'var(--surface-2, #f1f5f9)',
              border: '1px solid var(--border, #e2e8f0)',
              color: 'var(--text-primary, #0f172a)',
              fontSize: '13px',
              fontWeight: '600',
              textDecoration: 'none',
              transition: 'all 0.18s ease',
            }}
          >
            ← Back to Users
          </Link>
        </div>
      </div>

      {/* Main Card */}
      <div className="staff-sec-create-card">
        {/* Banner Alert if error / success */}
        {error && (
          <div
            style={{
              padding: '12px 16px',
              background: 'rgba(239, 68, 68, 0.12)',
              border: '1px solid rgba(239, 68, 68, 0.3)',
              color: '#ef4444',
              borderRadius: '10px',
              marginBottom: '20px',
              fontSize: '13.5px',
              display: 'flex',
              alignItems: 'center',
              gap: '10px',
            }}
          >
            <span>⚠️</span>
            <span>{error}</span>
          </div>
        )}

        {success && (
          <div
            style={{
              padding: '12px 16px',
              background: 'rgba(16, 185, 129, 0.12)',
              border: '1px solid rgba(16, 185, 129, 0.3)',
              color: '#10b981',
              borderRadius: '10px',
              marginBottom: '20px',
              fontSize: '13.5px',
              display: 'flex',
              alignItems: 'center',
              gap: '10px',
            }}
          >
            <span>✅</span>
            <span>{success}</span>
          </div>
        )}

        <form onSubmit={handleSubmit}>
          {/* Step 1: Role Selection Cards */}
          <div style={{ marginBottom: '26px' }}>
            <label
              style={{
                display: 'block',
                fontSize: '12.5px',
                fontWeight: '700',
                color: 'var(--text-primary, #0f172a)',
                marginBottom: '14px',
                textTransform: 'uppercase',
                letterSpacing: '0.04em',
              }}
            >
              1. Select Access Role
            </label>

            <div className="staff-sec-role-select-cards">
              {/* Option: Staff */}
              <div
                className={`staff-sec-role-card-opt ${
                  formData.role === 'STAFF' ? 'selected' : ''
                }`}
                onClick={() => handleRoleSelect('STAFF')}
              >
                <div
                  style={{
                    fontSize: '24px',
                    lineHeight: 1,
                    background: 'rgba(56, 189, 248, 0.14)',
                    padding: '10px',
                    borderRadius: '10px',
                    border: '1px solid rgba(56, 189, 248, 0.28)',
                  }}
                >
                  👤
                </div>
                <div style={{ flex: 1 }}>
                  <div
                    style={{
                      fontSize: '15px',
                      fontWeight: '700',
                      color: formData.role === 'STAFF' ? '#10b981' : 'var(--text-primary, #0f172a)',
                      marginBottom: '4px',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                    }}
                  >
                    <span>Staff Personnel</span>
                    {formData.role === 'STAFF' && (
                      <span style={{ fontSize: '12px', color: '#10b981', fontWeight: '700' }}>✓ Selected</span>
                    )}
                  </div>
                  <div style={{ fontSize: '12px', color: 'var(--text-muted, #64748b)', lineHeight: 1.45 }}>
                    Access to employee attendance, shift records, personal clock-in reports, and standard operational dashboards.
                  </div>
                </div>
              </div>

              {/* Option: Security */}
              <div
                className={`staff-sec-role-card-opt ${
                  formData.role === 'SECURITY' ? 'selected' : ''
                }`}
                onClick={() => handleRoleSelect('SECURITY')}
              >
                <div
                  style={{
                    fontSize: '24px',
                    lineHeight: 1,
                    background: 'rgba(245, 158, 11, 0.14)',
                    padding: '10px',
                    borderRadius: '10px',
                    border: '1px solid rgba(245, 158, 11, 0.28)',
                  }}
                >
                  🚨
                </div>
                <div style={{ flex: 1 }}>
                  <div
                    style={{
                      fontSize: '15px',
                      fontWeight: '700',
                      color: formData.role === 'SECURITY' ? '#10b981' : 'var(--text-primary, #0f172a)',
                      marginBottom: '4px',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                    }}
                  >
                    <span>Security Personnel</span>
                    {formData.role === 'SECURITY' && (
                      <span style={{ fontSize: '12px', color: '#10b981', fontWeight: '700' }}>✓ Selected</span>
                    )}
                  </div>
                  <div style={{ fontSize: '12px', color: 'var(--text-muted, #64748b)', lineHeight: 1.45 }}>
                    Real-time CCTV camera surveillance feeds, unrecognized faces alert triage, gate passes, and vehicle tracking.
                  </div>
                </div>
              </div>

              {/* Option: Admin */}
              <div
                className={`staff-sec-role-card-opt ${
                  formData.role === 'ADMIN' ? 'selected' : ''
                }`}
                onClick={() => handleRoleSelect('ADMIN')}
              >
                <div
                  style={{
                    fontSize: '24px',
                    lineHeight: 1,
                    background: 'rgba(168, 85, 247, 0.14)',
                    padding: '10px',
                    borderRadius: '10px',
                    border: '1px solid rgba(168, 85, 247, 0.28)',
                  }}
                >
                  🛡️
                </div>
                <div style={{ flex: 1 }}>
                  <div
                    style={{
                      fontSize: '15px',
                      fontWeight: '700',
                      color: formData.role === 'ADMIN' ? '#10b981' : 'var(--text-primary, #0f172a)',
                      marginBottom: '4px',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                    }}
                  >
                    <span>Administrator</span>
                    {formData.role === 'ADMIN' && (
                      <span style={{ fontSize: '12px', color: '#10b981', fontWeight: '700' }}>✓ Selected</span>
                    )}
                  </div>
                  <div style={{ fontSize: '12px', color: 'var(--text-muted, #64748b)', lineHeight: 1.45 }}>
                    Full administrative privileges across employees, face registry, cameras, attendance, reports, and security.
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Step 2: User Credentials */}
          <div style={{ marginBottom: '24px' }}>
            <label
              style={{
                display: 'block',
                fontSize: '12.5px',
                fontWeight: '700',
                color: 'var(--text-primary, #0f172a)',
                marginBottom: '14px',
                textTransform: 'uppercase',
                letterSpacing: '0.04em',
              }}
            >
              2. User Account Credentials
            </label>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: '16px', marginBottom: '16px' }}>
              <div>
                <label
                  style={{
                    display: 'block',
                    fontSize: '12px',
                    fontWeight: '600',
                    color: 'var(--text-secondary, #475569)',
                    marginBottom: '6px',
                  }}
                >
                  Full Name <span style={{ color: '#ef4444' }}>*</span>
                </label>
                <input
                  type="text"
                  name="name"
                  placeholder="e.g. John Doe or Officer Smith"
                  value={formData.name}
                  onChange={handleChange}
                  required
                  style={{
                    width: '100%',
                    height: '40px',
                    background: 'var(--surface-2, #f8fafc)',
                    border: '1px solid var(--border, #e2e8f0)',
                    borderRadius: '8px',
                    padding: '0 14px',
                    color: 'var(--text-primary, #0f172a)',
                    fontSize: '13.5px',
                    outline: 'none',
                    boxSizing: 'border-box',
                  }}
                />
              </div>

              <div>
                <label
                  style={{
                    display: 'block',
                    fontSize: '12px',
                    fontWeight: '600',
                    color: 'var(--text-secondary, #475569)',
                    marginBottom: '6px',
                  }}
                >
                  Work Email Address <span style={{ color: '#ef4444' }}>*</span>
                </label>
                <input
                  type="email"
                  name="email"
                  placeholder="e.g. staff.smith@company.com"
                  value={formData.email}
                  onChange={handleChange}
                  required
                  style={{
                    width: '100%',
                    height: '40px',
                    background: 'var(--surface-2, #f8fafc)',
                    border: '1px solid var(--border, #e2e8f0)',
                    borderRadius: '8px',
                    padding: '0 14px',
                    color: 'var(--text-primary, #0f172a)',
                    fontSize: '13.5px',
                    outline: 'none',
                    boxSizing: 'border-box',
                  }}
                />
              </div>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: '16px' }}>
              <div>
                <label
                  style={{
                    display: 'block',
                    fontSize: '12px',
                    fontWeight: '600',
                    color: 'var(--text-secondary, #475569)',
                    marginBottom: '6px',
                  }}
                >
                  Login Password <span style={{ color: '#ef4444' }}>*</span>
                </label>
                <div style={{ position: 'relative' }}>
                  <input
                    type={showPassword ? 'text' : 'password'}
                    name="password"
                    placeholder="Minimum 6 characters recommended"
                    value={formData.password}
                    onChange={handleChange}
                    required
                    style={{
                      width: '100%',
                      height: '40px',
                      background: 'var(--surface-2, #f8fafc)',
                      border: '1px solid var(--border, #e2e8f0)',
                      borderRadius: '8px',
                      padding: '0 40px 0 14px',
                      color: 'var(--text-primary, #0f172a)',
                      fontSize: '13.5px',
                      outline: 'none',
                      boxSizing: 'border-box',
                    }}
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    style={{
                      position: 'absolute',
                      right: '12px',
                      top: '50%',
                      transform: 'translateY(-50%)',
                      background: 'none',
                      border: 'none',
                      color: 'var(--text-muted, #64748b)',
                      cursor: 'pointer',
                      fontSize: '14px',
                      padding: '4px',
                    }}
                  >
                    {showPassword ? '👁️' : '👁️‍🗨️'}
                  </button>
                </div>
              </div>

              <div>
                <label
                  style={{
                    display: 'block',
                    fontSize: '12px',
                    fontWeight: '600',
                    color: 'var(--text-secondary, #475569)',
                    marginBottom: '6px',
                  }}
                >
                  Confirm Password <span style={{ color: '#ef4444' }}>*</span>
                </label>
                <div style={{ position: 'relative' }}>
                  <input
                    type={showConfirmPassword ? 'text' : 'password'}
                    name="confirmPassword"
                    placeholder="Re-enter password"
                    value={formData.confirmPassword}
                    onChange={handleChange}
                    required
                    style={{
                      width: '100%',
                      height: '40px',
                      background: 'var(--surface-2, #f8fafc)',
                      border: '1px solid var(--border, #e2e8f0)',
                      borderRadius: '8px',
                      padding: '0 40px 0 14px',
                      color: 'var(--text-primary, #0f172a)',
                      fontSize: '13.5px',
                      outline: 'none',
                      boxSizing: 'border-box',
                    }}
                  />
                  <button
                    type="button"
                    onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                    style={{
                      position: 'absolute',
                      right: '12px',
                      top: '50%',
                      transform: 'translateY(-50%)',
                      background: 'none',
                      border: 'none',
                      color: 'var(--text-muted, #64748b)',
                      cursor: 'pointer',
                      fontSize: '14px',
                      padding: '4px',
                    }}
                  >
                    {showConfirmPassword ? '👁️' : '👁️‍🗨️'}
                  </button>
                </div>
              </div>
            </div>
          </div>

          {/* Form Actions */}
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'flex-end',
              gap: '12px',
              paddingTop: '20px',
              borderTop: '1px solid var(--border, #e2e8f0)',
            }}
          >
            <Link
              to="/staff-security"
              style={{
                padding: '10px 18px',
                borderRadius: '8px',
                background: 'var(--surface-2, #f1f5f9)',
                border: '1px solid var(--border, #e2e8f0)',
                color: 'var(--text-secondary, #475569)',
                fontSize: '13px',
                fontWeight: '600',
                textDecoration: 'none',
              }}
            >
              Cancel
            </Link>
            <button
              type="submit"
              disabled={submitting}
              className="staff-sec-primary-btn"
              style={{ minWidth: '160px', justifyContent: 'center' }}
            >
              {submitting ? (
                <>Provisioning...</>
              ) : (
                <>
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                    <path d="M16 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
                    <circle cx="9" cy="7" r="4" />
                    <line x1="19" y1="8" x2="19" y2="14" />
                    <line x1="22" y1="11" x2="16" y2="11" />
                  </svg>
                  Provision {formData.role === 'SECURITY' ? 'Security' : 'Staff'}
                </>
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

export default StaffSecurityCreate;
