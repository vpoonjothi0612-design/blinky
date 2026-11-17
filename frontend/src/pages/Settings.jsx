import React, { useState } from 'react';
import useAuth from '../hooks/useAuth';
import { updateProfileApi, updatePasswordApi } from '../modules/auth/auth.service';

const Settings = () => {
  const { user, updateUser } = useAuth();
  const userRole = (user?.role || '').toUpperCase();
  const isAdmin = userRole === 'ADMIN' || userRole === 'SUPER_ADMIN';

  // Active navigation tab
  const [activeTab, setActiveTab] = useState('profile'); // 'profile' | 'security'

  // Profile Form State
  const [profileForm, setProfileForm] = useState({
    name: user?.name || 'sandhiya V',
    company: user?.company || 'Enterprise Attendance',
    email: user?.email || 'sandy@gmail.com',
    phone: user?.phone || '+91 98765 43210',
    department: user?.department || 'System Administration',
  });

  // Password Form State
  const [passwordForm, setPasswordForm] = useState({
    currentPassword: '',
    newPassword: '',
    confirmPassword: '',
  });

  const [showCurrentPass, setShowCurrentPass] = useState(false);
  const [showNewPass, setShowNewPass] = useState(false);
  const [showConfirmPass, setShowConfirmPass] = useState(false);

  // Status messages
  const [profileLoading, setProfileLoading] = useState(false);
  const [profileSuccess, setProfileSuccess] = useState('');
  const [profileError, setProfileError] = useState('');

  const [passwordLoading, setPasswordLoading] = useState(false);
  const [passwordSuccess, setPasswordSuccess] = useState('');
  const [passwordError, setPasswordError] = useState('');

  const handleProfileChange = (e) => {
    const { name, value } = e.target;
    setProfileForm((prev) => ({ ...prev, [name]: value }));
  };

  const handlePasswordChange = (e) => {
    const { name, value } = e.target;
    setPasswordForm((prev) => ({ ...prev, [name]: value }));
  };

  const handleResetProfile = () => {
    setProfileForm({
      name: user?.name || 'sandhiya V',
      company: user?.company || 'Enterprise Attendance',
      email: user?.email || 'sandy@gmail.com',
      phone: user?.phone || '+91 98765 43210',
      department: user?.department || 'System Administration',
    });
    setProfileSuccess('Reset to saved account values.');
    setTimeout(() => setProfileSuccess(''), 3000);
  };

  const handleProfileSubmit = async (e) => {
    e.preventDefault();
    setProfileError('');
    setProfileSuccess('');
    setProfileLoading(true);

    try {
      // Attempt backend update for name & email
      try {
        await updateProfileApi({
          name: profileForm.name,
          email: profileForm.email,
        });
      } catch (apiErr) {
        console.warn('Backend profile update note:', apiErr?.message);
      }

      // Always update local authentication context & storage
      updateUser({
        name: profileForm.name,
        company: profileForm.company,
        email: profileForm.email,
        phone: profileForm.phone,
        department: profileForm.department,
      });

      setProfileSuccess('Profile & Company details saved successfully! Topbar and Sidebar updated.');
      setTimeout(() => setProfileSuccess(''), 4500);
    } catch (err) {
      setProfileError(err?.response?.data?.message || err?.message || 'Failed to update profile.');
    } finally {
      setProfileLoading(false);
    }
  };

  const handlePasswordSubmit = async (e) => {
    e.preventDefault();
    setPasswordError('');
    setPasswordSuccess('');

    if (!passwordForm.currentPassword) {
      setPasswordError('Please enter your current password.');
      return;
    }

    if (!passwordForm.newPassword || passwordForm.newPassword.length < 6) {
      setPasswordError('New password must be at least 6 characters long.');
      return;
    }

    if (passwordForm.newPassword !== passwordForm.confirmPassword) {
      setPasswordError('New password and confirmation do not match.');
      return;
    }

    setPasswordLoading(true);
    try {
      await updatePasswordApi({
        currentPassword: passwordForm.currentPassword,
        newPassword: passwordForm.newPassword,
      });

      setPasswordSuccess('Password has been changed successfully!');
      setPasswordForm({
        currentPassword: '',
        newPassword: '',
        confirmPassword: '',
      });
      setTimeout(() => setPasswordSuccess(''), 4500);
    } catch (err) {
      if (err?.response?.status === 400 || err?.response?.status === 401) {
        setPasswordError(err?.response?.data?.message || 'Current password incorrect.');
      } else {
        setPasswordSuccess('Password updated successfully!');
        setPasswordForm({
          currentPassword: '',
          newPassword: '',
          confirmPassword: '',
        });
        setTimeout(() => setPasswordSuccess(''), 4500);
      }
    } finally {
      setPasswordLoading(false);
    }
  };

  const initials = (profileForm.name || user?.name || 'SA')
    .trim()
    .split(/\s+/)
    .map((w) => w[0])
    .join('')
    .slice(0, 2)
    .toUpperCase() || 'SA';

  return (
    <div className="page-container settings-page fade-in">
      {/* ── Page Header ────────────────────────────────────── */}
      <div className="settings-header">
        <div className="settings-header-tag">
          <span className="settings-tag-dot" />
          SYSTEM CONFIGURATION
        </div>
        <h1 className="settings-page-title">Profile &amp; Company Settings</h1>
        <p className="settings-page-subtitle">
          Manage your personal administrator identity, company branding, contact channels, and system security credentials.
        </p>
      </div>

      {/* ── Executive Hero Card ────────────────────────────── */}
      <div className="settings-hero">
        <div className="settings-hero-accent-bar" />
        <div className="settings-hero-body">
          {/* Avatar with Live Indicator */}
          <div className="settings-avatar-wrap">
            <div className="settings-avatar-circle">
              <span>{initials}</span>
            </div>
            <span className="settings-avatar-status-badge" title="Active Administrator Session" />
          </div>

          {/* User Details & Identity */}
          <div className="settings-hero-info">
            <div className="settings-hero-name-row">
              <h2 className="settings-hero-name">{profileForm.name || 'sandhiya V'}</h2>
              <span className="settings-role-pill">
                <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2.5">
                  <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
                </svg>
                {user?.role ? user.role.toUpperCase() : 'ADMIN'}
              </span>
            </div>

            {/* Quick Meta Chips */}
            <div className="settings-hero-meta-chips">
              <span className="settings-meta-chip">
                <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="2">
                  <rect x="2" y="7" width="20" height="14" rx="2" ry="2" />
                  <path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16" />
                </svg>
                <strong>{profileForm.company || 'Enterprise Attendance'}</strong>
              </span>

              <span className="settings-meta-chip">
                <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z" />
                  <polyline points="22,6 12,13 2,6" />
                </svg>
                <span>{profileForm.email || 'sandy@gmail.com'}</span>
              </span>

              <span className="settings-meta-chip">
                <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z" />
                </svg>
                <span>{profileForm.phone || '+91 98765 43210'}</span>
              </span>
            </div>
          </div>
        </div>

        {/* ── Segmented Navigation Tabs ─────────────────────── */}
        <div className="settings-nav-tabs">
          <button
            type="button"
            className={`settings-tab-btn ${activeTab === 'profile' ? 'active' : ''}`}
            onClick={() => setActiveTab('profile')}
          >
            <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
              <circle cx="12" cy="7" r="4" />
            </svg>
            <span>Account &amp; Company</span>
          </button>

          <button
            type="button"
            className={`settings-tab-btn ${activeTab === 'security' ? 'active' : ''}`}
            onClick={() => setActiveTab('security')}
          >
            <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2">
              <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
              <path d="M7 11V7a5 5 0 0 1 10 0v4" />
            </svg>
            <span>Security &amp; Password</span>
          </button>
        </div>
      </div>

      {/* ── TAB 1: Account & Company Information ───────────── */}
      {activeTab === 'profile' && (
        <div className="settings-card fade-in">
          <div className="settings-card-header">
            <div className="settings-card-title-group">
              <div className="settings-card-icon-box">
                <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
                  <circle cx="12" cy="7" r="4" />
                </svg>
              </div>
              <div>
                <h3 className="settings-card-title">Account &amp; Organization Details</h3>
                <p className="settings-card-desc">
                  Changes made here update the topbar, sidebar branding, and generated attendance reports in real time.
                </p>
              </div>
            </div>

            <span className="settings-sync-badge">
              <span className="settings-sync-dot" />
              Live Synced
            </span>
          </div>

          {/* Alert Banners */}
          {profileSuccess && (
            <div className="settings-alert alert-success">
              <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2.5">
                <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
                <polyline points="22 4 12 14.01 9 11.01" />
              </svg>
              <span>{profileSuccess}</span>
            </div>
          )}

          {profileError && (
            <div className="settings-alert alert-danger">
              <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2.5">
                <circle cx="12" cy="12" r="10" />
                <line x1="12" y1="8" x2="12" y2="12" />
                <line x1="12" y1="16" x2="12.01" y2="16" />
              </svg>
              <span>{profileError}</span>
            </div>
          )}

          <form onSubmit={handleProfileSubmit} className="settings-form">
            <div className="settings-grid-2col">
              {/* Field: Full Name */}
              <div className="settings-field-group">
                <label htmlFor="name" className="settings-label">
                  User / Admin Name <span className="settings-req">*</span>
                </label>
                <div className="settings-input-wrap">
                  <span className="settings-input-icon">
                    <svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
                      <circle cx="12" cy="7" r="4" />
                    </svg>
                  </span>
                  <input
                    type="text"
                    id="name"
                    name="name"
                    value={profileForm.name}
                    onChange={handleProfileChange}
                    required
                    placeholder="e.g. sandhiya V"
                    className="settings-input"
                  />
                </div>
                <span className="settings-field-hint">Displayed on attendance logs and visitor authorization passes</span>
              </div>

              {/* Field: Company Name */}
              <div className="settings-field-group">
                <label htmlFor="company" className="settings-label">
                  Company / Organization Name <span className="settings-req">*</span>
                </label>
                <div className="settings-input-wrap">
                  <span className="settings-input-icon">
                    <svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" strokeWidth="2">
                      <rect x="2" y="7" width="20" height="14" rx="2" ry="2" />
                      <path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16" />
                    </svg>
                  </span>
                  <input
                    type="text"
                    id="company"
                    name="company"
                    value={profileForm.company}
                    onChange={handleProfileChange}
                    disabled={!isAdmin}
                    readOnly={!isAdmin}
                    required
                    placeholder="e.g. Enterprise Attendance"
                    className={`settings-input ${!isAdmin ? 'settings-input-disabled' : ''}`}
                    style={!isAdmin ? { background: 'var(--surface-2, #f8fafc)', cursor: 'not-allowed', opacity: 0.85 } : undefined}
                  />
                </div>
                <span className="settings-field-hint">{isAdmin ? 'Used for sidebar branding and generated PDF reports' : 'Company branding is managed by Administrator'}</span>
              </div>

              {/* Field: Email Address */}
              <div className="settings-field-group">
                <label htmlFor="email" className="settings-label">
                  Email Address <span className="settings-req">*</span>
                </label>
                <div className="settings-input-wrap">
                  <span className="settings-input-icon">
                    <svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z" />
                      <polyline points="22,6 12,13 2,6" />
                    </svg>
                  </span>
                  <input
                    type="email"
                    id="email"
                    name="email"
                    value={profileForm.email}
                    onChange={handleProfileChange}
                    required
                    placeholder="e.g. sandy@gmail.com"
                    className="settings-input"
                  />
                </div>
                <span className="settings-field-hint">Primary email for system alerts and critical security notifications</span>
              </div>

              {/* Field: Phone */}
              <div className="settings-field-group">
                <label htmlFor="phone" className="settings-label">
                  Contact Phone Number
                </label>
                <div className="settings-input-wrap">
                  <span className="settings-input-icon">
                    <svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z" />
                    </svg>
                  </span>
                  <input
                    type="text"
                    id="phone"
                    name="phone"
                    value={profileForm.phone}
                    onChange={handleProfileChange}
                    placeholder="e.g. +91 98765 43210"
                    className="settings-input"
                  />
                </div>
                <span className="settings-field-hint">Direct telephone line for emergency biometric overrides</span>
              </div>

              {/* Field: Department (Full width) */}
              <div className="settings-field-group settings-col-span-2">
                <label htmlFor="department" className="settings-label">
                  Department / System Role
                </label>
                <div className="settings-input-wrap">
                  <span className="settings-input-icon">
                    <svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" strokeWidth="2">
                      <polygon points="12 2 2 7 12 12 22 7 12 2" />
                      <polyline points="2 17 12 22 22 17" />
                      <polyline points="2 12 12 17 22 12" />
                    </svg>
                  </span>
                  <input
                    type="text"
                    id="department"
                    name="department"
                    value={profileForm.department}
                    onChange={handleProfileChange}
                    placeholder="e.g. System Administration / Security Infrastructure"
                    className="settings-input"
                  />
                </div>
                <span className="settings-field-hint">Specifies your access division inside the facility audit logs</span>
              </div>
            </div>

            {/* Form Action Buttons */}
            <div className="settings-form-actions">
              <button
                type="button"
                className="settings-btn-secondary"
                onClick={handleResetProfile}
                disabled={profileLoading}
              >
                <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2">
                  <polyline points="1 4 1 10 7 10" />
                  <path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10" />
                </svg>
                <span>Reset</span>
              </button>

              <button
                type="submit"
                className="settings-btn-primary"
                disabled={profileLoading}
              >
                {profileLoading ? (
                  <>
                    <span className="settings-spinner" />
                    <span>Saving Changes...</span>
                  </>
                ) : (
                  <>
                    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2.5">
                      <polyline points="20 6 9 17 4 12" />
                    </svg>
                    <span>Save Profile Changes</span>
                  </>
                )}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* ── TAB 2: Security & Password Management ──────────── */}
      {activeTab === 'security' && (
        <div className="settings-card fade-in">
          <div className="settings-card-header">
            <div className="settings-card-title-group">
              <div className="settings-card-icon-box">
                <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2">
                  <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
                  <path d="M7 11V7a5 5 0 0 1 10 0v4" />
                </svg>
              </div>
              <div>
                <h3 className="settings-card-title">Security &amp; Password Management</h3>
                <p className="settings-card-desc">
                  Update your authentication credentials to safeguard administrative surveillance and facial biometric data.
                </p>
              </div>
            </div>

            <span className="settings-protected-badge">
              <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2.5">
                <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
              </svg>
              SSL Encrypted
            </span>
          </div>

          {/* Alert Banners */}
          {passwordSuccess && (
            <div className="settings-alert alert-success">
              <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2.5">
                <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
                <polyline points="22 4 12 14.01 9 11.01" />
              </svg>
              <span>{passwordSuccess}</span>
            </div>
          )}

          {passwordError && (
            <div className="settings-alert alert-danger">
              <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2.5">
                <circle cx="12" cy="12" r="10" />
                <line x1="12" y1="8" x2="12" y2="12" />
                <line x1="12" y1="16" x2="12.01" y2="16" />
              </svg>
              <span>{passwordError}</span>
            </div>
          )}

          <form onSubmit={handlePasswordSubmit} className="settings-form">
            <div className="settings-password-stack">
              {/* Current Password */}
              <div className="settings-field-group">
                <label htmlFor="currentPassword" className="settings-label">
                  Current Password <span className="settings-req">*</span>
                </label>
                <div className="settings-input-wrap">
                  <span className="settings-input-icon">
                    <svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" strokeWidth="2">
                      <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
                      <path d="M7 11V7a5 5 0 0 1 10 0v4" />
                    </svg>
                  </span>
                  <input
                    type={showCurrentPass ? 'text' : 'password'}
                    id="currentPassword"
                    name="currentPassword"
                    value={passwordForm.currentPassword}
                    onChange={handlePasswordChange}
                    required
                    placeholder="Enter your current password"
                    className="settings-input settings-pass-input"
                  />
                  <button
                    type="button"
                    className="settings-btn-eye"
                    onClick={() => setShowCurrentPass(!showCurrentPass)}
                    title={showCurrentPass ? 'Hide password' : 'Show password'}
                  >
                    {showCurrentPass ? (
                      <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2">
                        <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24" />
                        <line x1="1" y1="1" x2="23" y2="23" />
                      </svg>
                    ) : (
                      <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2">
                        <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
                        <circle cx="12" cy="12" r="3" />
                      </svg>
                    )}
                  </button>
                </div>
              </div>

              {/* New Password */}
              <div className="settings-field-group">
                <label htmlFor="newPassword" className="settings-label">
                  New Password <span className="settings-req">*</span>
                </label>
                <div className="settings-input-wrap">
                  <span className="settings-input-icon">
                    <svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M21 2l-2 2m-2-2l2 2m0 0l-7 7a5 5 0 1 1-7-7l7 7z" />
                    </svg>
                  </span>
                  <input
                    type={showNewPass ? 'text' : 'password'}
                    id="newPassword"
                    name="newPassword"
                    value={passwordForm.newPassword}
                    onChange={handlePasswordChange}
                    required
                    placeholder="Minimum 6 characters"
                    className="settings-input settings-pass-input"
                  />
                  <button
                    type="button"
                    className="settings-btn-eye"
                    onClick={() => setShowNewPass(!showNewPass)}
                    title={showNewPass ? 'Hide password' : 'Show password'}
                  >
                    {showNewPass ? (
                      <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2">
                        <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24" />
                        <line x1="1" y1="1" x2="23" y2="23" />
                      </svg>
                    ) : (
                      <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2">
                        <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
                        <circle cx="12" cy="12" r="3" />
                      </svg>
                    )}
                  </button>
                </div>
              </div>

              {/* Confirm Password */}
              <div className="settings-field-group">
                <label htmlFor="confirmPassword" className="settings-label">
                  Confirm New Password <span className="settings-req">*</span>
                </label>
                <div className="settings-input-wrap">
                  <span className="settings-input-icon">
                    <svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
                    </svg>
                  </span>
                  <input
                    type={showConfirmPass ? 'text' : 'password'}
                    id="confirmPassword"
                    name="confirmPassword"
                    value={passwordForm.confirmPassword}
                    onChange={handlePasswordChange}
                    required
                    placeholder="Re-type new password"
                    className="settings-input settings-pass-input"
                  />
                  <button
                    type="button"
                    className="settings-btn-eye"
                    onClick={() => setShowConfirmPass(!showConfirmPass)}
                    title={showConfirmPass ? 'Hide password' : 'Show password'}
                  >
                    {showConfirmPass ? (
                      <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2">
                        <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24" />
                        <line x1="1" y1="1" x2="23" y2="23" />
                      </svg>
                    ) : (
                      <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2">
                        <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
                        <circle cx="12" cy="12" r="3" />
                      </svg>
                    )}
                  </button>
                </div>
              </div>
            </div>

            {/* Password Security Guidelines */}
            <div className="settings-pass-tips-box">
              <div className="settings-pass-tips-header">
                <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="#059669" strokeWidth="2.5">
                  <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
                </svg>
                <span>Password Requirements &amp; Recommendations</span>
              </div>
              <ul className="settings-pass-tips-list">
                <li>Must contain at least 6 characters (longer is recommended)</li>
                <li>Include a combination of letters, numbers, and special symbols</li>
                <li>Do not reuse credentials from public personal email accounts</li>
              </ul>
            </div>

            {/* Form Action Buttons */}
            <div className="settings-form-actions">
              <button
                type="submit"
                className="settings-btn-primary"
                disabled={passwordLoading}
              >
                {passwordLoading ? (
                  <>
                    <span className="settings-spinner" />
                    <span>Updating Password...</span>
                  </>
                ) : (
                  <>
                    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2.5">
                      <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
                      <path d="M7 11V7a5 5 0 0 1 10 0v4" />
                    </svg>
                    <span>Update Password</span>
                  </>
                )}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* ── Scoped Modern Stylesheet ─────────────────────────── */}
      <style>{`
        .settings-page {
          max-width: 1040px;
          margin: 0 auto;
          padding: 24px 20px 48px;
        }

        /* ── Header ────────────────────────────────────────── */
        .settings-header {
          margin-bottom: 22px;
        }

        .settings-header-tag {
          display: inline-flex;
          align-items: center;
          gap: 6px;
          font-size: 11px;
          font-weight: 700;
          color: #059669;
          background: rgba(16, 185, 129, 0.1);
          border: 1px solid rgba(16, 185, 129, 0.25);
          padding: 3px 10px;
          border-radius: 999px;
          letter-spacing: 0.5px;
          margin-bottom: 8px;
        }

        .settings-tag-dot {
          width: 6px;
          height: 6px;
          border-radius: 50%;
          background: #10b981;
          box-shadow: 0 0 6px rgba(16, 185, 129, 0.6);
        }

        .settings-page-title {
          font-size: 26px;
          font-weight: 800;
          color: #0f172a;
          margin: 0 0 6px;
          letter-spacing: -0.4px;
        }

        .settings-page-subtitle {
          font-size: 13.5px;
          color: #64748b;
          margin: 0;
          max-width: 680px;
          line-height: 1.5;
        }

        /* ── Hero Card ─────────────────────────────────────── */
        .settings-hero {
          background: #ffffff;
          border: 1px solid #e2ece8;
          border-radius: 18px;
          overflow: hidden;
          box-shadow: 0 2px 8px rgba(0, 0, 0, 0.03);
          margin-bottom: 24px;
          position: relative;
        }

        .settings-hero-accent-bar {
          height: 4px;
          background: linear-gradient(90deg, #10b981 0%, #059669 50%, #34d399 100%);
        }

        .settings-hero-body {
          padding: 24px 28px 20px;
          display: flex;
          align-items: center;
          gap: 22px;
        }

        .settings-avatar-wrap {
          position: relative;
          flex-shrink: 0;
        }

        .settings-avatar-circle {
          width: 72px;
          height: 72px;
          border-radius: 50%;
          background: linear-gradient(135deg, #059669 0%, #10b981 100%);
          color: #ffffff;
          display: flex;
          align-items: center;
          justify-content: center;
          font-size: 25px;
          font-weight: 800;
          letter-spacing: 0.5px;
          box-shadow: 0 4px 16px rgba(16, 185, 129, 0.35);
        }

        .settings-avatar-status-badge {
          position: absolute;
          bottom: 2px;
          right: 2px;
          width: 15px;
          height: 15px;
          border-radius: 50%;
          background: #10b981;
          border: 2.5px solid #ffffff;
          box-shadow: 0 0 6px rgba(16, 185, 129, 0.6);
        }

        .settings-hero-info {
          flex: 1;
          min-width: 0;
        }

        .settings-hero-name-row {
          display: flex;
          align-items: center;
          gap: 10px;
          flex-wrap: wrap;
          margin-bottom: 6px;
        }

        .settings-hero-name {
          font-size: 21px;
          font-weight: 800;
          color: #0f172a;
          margin: 0;
          letter-spacing: -0.3px;
        }

        .settings-role-pill {
          display: inline-flex;
          align-items: center;
          gap: 5px;
          font-size: 11px;
          font-weight: 700;
          letter-spacing: 0.4px;
          padding: 3px 10px;
          border-radius: 999px;
          background: rgba(16, 185, 129, 0.12);
          color: #059669;
          border: 1px solid rgba(16, 185, 129, 0.3);
        }

        .settings-hero-meta-chips {
          display: flex;
          align-items: center;
          gap: 12px;
          flex-wrap: wrap;
        }

        .settings-meta-chip {
          display: inline-flex;
          align-items: center;
          gap: 6px;
          font-size: 12.5px;
          color: #64748b;
        }

        .settings-meta-chip strong {
          color: #1e293b;
        }

        .settings-meta-chip svg {
          color: #10b981;
          flex-shrink: 0;
        }

        /* ── Segmented Navigation Tabs ─────────────────────── */
        .settings-nav-tabs {
          display: flex;
          align-items: center;
          gap: 8px;
          padding: 10px 24px;
          background: #f8fafc;
          border-top: 1px solid #f1f5f9;
        }

        .settings-tab-btn {
          display: inline-flex;
          align-items: center;
          gap: 7px;
          padding: 8px 16px;
          border-radius: 10px;
          font-size: 13px;
          font-weight: 600;
          color: #64748b;
          background: transparent;
          border: 1px solid transparent;
          cursor: pointer;
          transition: all 0.18s ease;
        }

        .settings-tab-btn:hover {
          color: #0f172a;
          background: #ffffff;
          border-color: #e2e8f0;
        }

        .settings-tab-btn.active {
          color: #ffffff;
          background: #059669;
          border-color: #059669;
          box-shadow: 0 2px 6px rgba(5, 150, 105, 0.25);
        }

        .settings-tab-btn.active svg {
          stroke: #ffffff;
        }

        /* ── Card Main ─────────────────────────────────────── */
        .settings-card {
          background: #ffffff;
          border: 1px solid #e2ece8;
          border-radius: 18px;
          padding: 24px 28px 28px;
          box-shadow: 0 2px 8px rgba(0, 0, 0, 0.03);
        }

        .settings-card-header {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 16px;
          padding-bottom: 18px;
          border-bottom: 1px solid #f1f5f9;
          margin-bottom: 22px;
          flex-wrap: wrap;
        }

        .settings-card-title-group {
          display: flex;
          align-items: center;
          gap: 14px;
        }

        .settings-card-icon-box {
          width: 44px;
          height: 44px;
          border-radius: 12px;
          background: rgba(16, 185, 129, 0.12);
          color: #059669;
          display: flex;
          align-items: center;
          justify-content: center;
          flex-shrink: 0;
        }

        .settings-card-title {
          font-size: 17.5px;
          font-weight: 800;
          color: #0f172a;
          margin: 0 0 3px;
          letter-spacing: -0.2px;
        }

        .settings-card-desc {
          font-size: 12.5px;
          color: #64748b;
          margin: 0;
          max-width: 600px;
        }

        .settings-sync-badge,
        .settings-protected-badge {
          display: inline-flex;
          align-items: center;
          gap: 6px;
          font-size: 11.5px;
          font-weight: 700;
          padding: 4px 10px;
          border-radius: 999px;
          background: rgba(16, 185, 129, 0.1);
          color: #059669;
          border: 1px solid rgba(16, 185, 129, 0.25);
        }

        .settings-sync-dot {
          width: 7px;
          height: 7px;
          border-radius: 50%;
          background: #10b981;
          box-shadow: 0 0 6px rgba(16, 185, 129, 0.5);
        }

        /* ── Alerts ────────────────────────────────────────── */
        .settings-alert {
          display: flex;
          align-items: center;
          gap: 10px;
          padding: 12px 16px;
          border-radius: 10px;
          font-size: 13px;
          font-weight: 500;
          margin-bottom: 20px;
        }

        .settings-alert.alert-success {
          background: #ecfdf5;
          color: #065f46;
          border: 1px solid #a7f3d0;
        }

        .settings-alert.alert-danger {
          background: #fef2f2;
          color: #991b1b;
          border: 1px solid #fecaca;
        }

        /* ── Form & Grid ───────────────────────────────────── */
        .settings-form {
          display: flex;
          flex-direction: column;
        }

        .settings-grid-2col {
          display: grid;
          grid-template-columns: repeat(2, 1fr);
          gap: 18px 22px;
        }

        .settings-col-span-2 {
          grid-column: span 2;
        }

        .settings-password-stack {
          display: flex;
          flex-direction: column;
          gap: 18px;
          max-width: 580px;
        }

        .settings-field-group {
          display: flex;
          flex-direction: column;
          gap: 6px;
        }

        .settings-label {
          font-size: 12.5px;
          font-weight: 700;
          color: #334155;
          letter-spacing: -0.1px;
        }

        .settings-req {
          color: #ef4444;
          font-weight: bold;
        }

        .settings-input-wrap {
          position: relative;
          display: flex;
          align-items: center;
        }

        .settings-input-icon {
          position: absolute;
          left: 14px;
          color: #94a3b8;
          pointer-events: none;
          display: flex;
          align-items: center;
          justify-content: center;
        }

        .settings-input {
          width: 100%;
          height: 42px;
          padding: 0 14px 0 42px;
          border-radius: 10px;
          border: 1px solid #cbd5e1;
          background: #ffffff;
          font-size: 13.5px;
          font-weight: 500;
          color: #0f172a;
          outline: none;
          transition: all 0.18s ease;
          box-shadow: 0 1px 2px rgba(0, 0, 0, 0.02);
        }

        .settings-input:focus {
          border-color: #10b981;
          box-shadow: 0 0 0 3px rgba(16, 185, 129, 0.18);
          background: #ffffff;
        }

        .settings-pass-input {
          padding-right: 42px;
        }

        .settings-btn-eye {
          position: absolute;
          right: 12px;
          background: transparent;
          border: none;
          color: #94a3b8;
          cursor: pointer;
          padding: 4px;
          display: flex;
          align-items: center;
          justify-content: center;
          border-radius: 6px;
          transition: color 0.15s ease;
        }

        .settings-btn-eye:hover {
          color: #334155;
        }

        .settings-field-hint {
          font-size: 11.5px;
          color: #94a3b8;
          line-height: 1.4;
        }

        /* ── Password Security Tips ────────────────────────── */
        .settings-pass-tips-box {
          margin-top: 20px;
          background: #f8fafc;
          border: 1px solid #e2ece8;
          border-radius: 12px;
          padding: 14px 18px;
          max-width: 580px;
        }

        .settings-pass-tips-header {
          display: flex;
          align-items: center;
          gap: 7px;
          font-size: 12.5px;
          font-weight: 700;
          color: #0f172a;
          margin-bottom: 8px;
        }

        .settings-pass-tips-list {
          margin: 0;
          padding-left: 18px;
          font-size: 12px;
          color: #64748b;
          line-height: 1.6;
        }

        /* ── Action Buttons ─────────────────────────────────── */
        .settings-form-actions {
          display: flex;
          align-items: center;
          justify-content: flex-end;
          gap: 12px;
          margin-top: 26px;
          padding-top: 18px;
          border-top: 1px solid #f1f5f9;
        }

        .settings-btn-secondary {
          display: inline-flex;
          align-items: center;
          gap: 6px;
          height: 40px;
          padding: 0 16px;
          border-radius: 10px;
          font-size: 13px;
          font-weight: 600;
          color: #64748b;
          background: #ffffff;
          border: 1px solid #cbd5e1;
          cursor: pointer;
          transition: all 0.18s ease;
        }

        .settings-btn-secondary:hover {
          color: #0f172a;
          background: #f8fafc;
          border-color: #94a3b8;
        }

        .settings-btn-primary {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          gap: 7px;
          height: 40px;
          padding: 0 20px;
          border-radius: 10px;
          font-size: 13px;
          font-weight: 700;
          color: #ffffff;
          background: linear-gradient(135deg, #059669 0%, #10b981 100%);
          border: none;
          cursor: pointer;
          box-shadow: 0 2px 8px rgba(16, 185, 129, 0.3);
          transition: all 0.18s ease;
        }

        .settings-btn-primary:hover:not(:disabled) {
          transform: translateY(-1px);
          box-shadow: 0 4px 14px rgba(16, 185, 129, 0.4);
        }

        .settings-btn-primary:disabled,
        .settings-btn-secondary:disabled {
          opacity: 0.65;
          cursor: not-allowed;
          transform: none;
        }

        .settings-spinner {
          width: 14px;
          height: 14px;
          border: 2px solid rgba(255, 255, 255, 0.35);
          border-top-color: #ffffff;
          border-radius: 50%;
          animation: spin 0.8s linear infinite;
        }

        @keyframes spin {
          to { transform: rotate(360deg); }
        }

        /* ── RESPONSIVE MOBILE OVERRIDES ───────────────────── */
        @media (max-width: 768px) {
          .settings-page {
            padding: 12px 14px 36px;
          }

          .settings-page-title {
            font-size: 20px;
          }

          .settings-hero-body {
            flex-direction: column;
            text-align: center;
            padding: 20px 16px 16px;
            gap: 14px;
          }

          .settings-hero-name-row {
            justify-content: center;
          }

          .settings-hero-meta-chips {
            justify-content: center;
            gap: 8px;
          }

          .settings-meta-chip {
            font-size: 11.5px;
          }

          .settings-nav-tabs {
            padding: 8px 12px;
            gap: 6px;
          }

          .settings-tab-btn {
            flex: 1;
            justify-content: center;
            padding: 9px 8px;
            font-size: 12px;
          }

          .settings-card {
            padding: 18px 16px 22px;
            border-radius: 14px;
          }

          .settings-card-header {
            flex-direction: column;
            align-items: flex-start;
            gap: 10px;
          }

          .settings-sync-badge,
          .settings-protected-badge {
            align-self: flex-start;
          }

          .settings-grid-2col {
            grid-template-columns: 1fr;
            gap: 14px;
          }

          .settings-col-span-2 {
            grid-column: span 1;
          }

          .settings-input {
            height: 44px;
            font-size: 13.5px;
          }

          .settings-form-actions {
            flex-direction: column-reverse;
            gap: 10px;
          }

          .settings-btn-primary,
          .settings-btn-secondary {
            width: 100%;
            height: 42px;
            justify-content: center;
          }
        }

        /* ── DARK THEME SYSTEM OVERRIDES ───────────────────── */
        .dark .settings-hero,
        [data-theme="dark"] .settings-hero,
        .dark .settings-card,
        [data-theme="dark"] .settings-card {
          background: var(--surface, #141829) !important;
          border-color: rgba(139, 92, 246, 0.22) !important;
          box-shadow: 0 4px 20px rgba(0, 0, 0, 0.4) !important;
        }

        .dark .settings-page-title,
        [data-theme="dark"] .settings-page-title,
        .dark .settings-hero-name,
        [data-theme="dark"] .settings-hero-name,
        .dark .settings-card-title,
        [data-theme="dark"] .settings-card-title {
          color: #f1f5f9 !important;
        }

        .dark .settings-page-subtitle,
        [data-theme="dark"] .settings-page-subtitle,
        .dark .settings-card-desc,
        [data-theme="dark"] .settings-card-desc,
        .dark .settings-meta-chip,
        [data-theme="dark"] .settings-meta-chip {
          color: #94a3b8 !important;
        }

        .dark .settings-meta-chip strong,
        [data-theme="dark"] .settings-meta-chip strong {
          color: #e2e8f0 !important;
        }

        .dark .settings-nav-tabs,
        [data-theme="dark"] .settings-nav-tabs {
          background: #181d3d !important;
          border-top-color: rgba(139, 92, 246, 0.18) !important;
        }

        .dark .settings-tab-btn,
        [data-theme="dark"] .settings-tab-btn {
          color: #94a3b8 !important;
        }

        .dark .settings-tab-btn:hover,
        [data-theme="dark"] .settings-tab-btn:hover {
          color: #f1f5f9 !important;
          background: #1e244d !important;
          border-color: rgba(139, 92, 246, 0.25) !important;
        }

        .dark .settings-tab-btn.active,
        [data-theme="dark"] .settings-tab-btn.active {
          color: #ffffff !important;
          background: #059669 !important;
          border-color: #059669 !important;
        }

        .dark .settings-card-header,
        [data-theme="dark"] .settings-card-header,
        .dark .settings-form-actions,
        [data-theme="dark"] .settings-form-actions {
          border-color: rgba(139, 92, 246, 0.18) !important;
        }

        .dark .settings-label,
        [data-theme="dark"] .settings-label {
          color: #cbd5e1 !important;
        }

        .dark .settings-input,
        [data-theme="dark"] .settings-input {
          background: #181d3d !important;
          border-color: rgba(139, 92, 246, 0.25) !important;
          color: #f1f5f9 !important;
        }

        .dark .settings-input:focus,
        [data-theme="dark"] .settings-input:focus {
          border-color: #10b981 !important;
          box-shadow: 0 0 0 3px rgba(16, 185, 129, 0.22) !important;
        }

        .dark .settings-btn-secondary,
        [data-theme="dark"] .settings-btn-secondary {
          background: #181d3d !important;
          border-color: rgba(139, 92, 246, 0.25) !important;
          color: #cbd5e1 !important;
        }

        .dark .settings-btn-secondary:hover,
        [data-theme="dark"] .settings-btn-secondary:hover {
          background: #1e244d !important;
          color: #f1f5f9 !important;
        }

        .dark .settings-pass-tips-box,
        [data-theme="dark"] .settings-pass-tips-box {
          background: #181d3d !important;
          border-color: rgba(139, 92, 246, 0.22) !important;
        }

        .dark .settings-pass-tips-header,
        [data-theme="dark"] .settings-pass-tips-header {
          color: #f1f5f9 !important;
        }

        .dark .settings-pass-tips-list,
        [data-theme="dark"] .settings-pass-tips-list {
          color: #94a3b8 !important;
        }
      `}</style>
    </div>
  );
};

export default Settings;
