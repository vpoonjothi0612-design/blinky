import React, { useState, useEffect, useMemo } from 'react';
import { Link } from 'react-router-dom';
import {
  getStaffSecurityUsers,
  updateStaffSecurityUser,
  deleteStaffSecurityUser,
} from './staff-security.service';
import Modal from '../../components/common/Modal';
import Loader from '../../components/common/Loader';
import useAuth from '../../hooks/useAuth';
import './staff-security.css';

const StaffSecurityList = () => {
  const { user: currentUser } = useAuth();

  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedRoleFilter, setSelectedRoleFilter] = useState('ALL');

  // Track revealed passwords per user ID (admin peek)
  const [revealedPasswords, setRevealedPasswords] = useState({});

  // View User Modal State
  const [viewModal, setViewModal] = useState({
    isOpen: false,
    user: null,
    showPassword: false,
    copied: false,
  });

  // Edit User Modal State
  const [editModal, setEditModal] = useState({
    isOpen: false,
    user: null,
    formData: {
      name: '',
      email: '',
      role: 'STAFF',
      isActive: true,
      password: '',
    },
    showPassword: false,
    loading: false,
    error: '',
    success: '',
  });

  // Delete Confirmation Modal State
  const [deleteModal, setDeleteModal] = useState({
    isOpen: false,
    user: null,
    loading: false,
  });

  // Fetch all staff, security, admin users
  const fetchUsers = async () => {
    setLoading(true);
    setError('');
    try {
      const response = await getStaffSecurityUsers();
      const userList = response.data || [];
      setUsers(userList);
    } catch (err) {
      setError(err.response?.data?.message || 'Failed to fetch user accounts.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchUsers();
  }, []);

  // Filtered Users by Search Term and Role Filter
  const filteredUsers = useMemo(() => {
    return users.filter((u) => {
      let role = (u.role || '').toUpperCase();
      if (role === 'SUPER_ADMIN') role = 'ADMIN';
      if (role === 'USER') role = 'STAFF';

      if (selectedRoleFilter !== 'ALL' && role !== selectedRoleFilter) {
        return false;
      }
      if (!searchTerm.trim()) return true;
      const term = searchTerm.trim().toLowerCase();
      const name = (u.name || '').toLowerCase();
      const email = (u.email || '').toLowerCase();
      return name.includes(term) || email.includes(term);
    });
  }, [users, searchTerm, selectedRoleFilter]);

  // Statistics
  const stats = useMemo(() => {
    let total = users.length;
    let staffCount = 0;
    let securityCount = 0;
    let adminCount = 0;

    users.forEach((u) => {
      let r = (u.role || '').toUpperCase();
      if (r === 'SUPER_ADMIN') r = 'ADMIN';
      if (r === 'USER') r = 'STAFF';

      if (r === 'STAFF') staffCount++;
      else if (r === 'SECURITY') securityCount++;
      else if (r === 'ADMIN') adminCount++;
    });

    return { total, staffCount, securityCount, adminCount };
  }, [users]);

  // Toggle reveal password in row / card
  const toggleRowPassword = (userId) => {
    setRevealedPasswords((prev) => ({
      ...prev,
      [userId]: !prev[userId],
    }));
  };

  // Open View Modal
  const handleOpenView = (user) => {
    setViewModal({
      isOpen: true,
      user,
      showPassword: false,
      copied: false,
    });
  };

  // Open Edit Modal
  const handleOpenEdit = (user) => {
    setEditModal({
      isOpen: true,
      user,
      formData: {
        name: user.name || '',
        email: user.email || '',
        role: (user.role || 'STAFF').toUpperCase(),
        isActive: user.isActive !== false,
        password: user.rawPassword || '',
      },
      showPassword: false,
      loading: false,
      error: '',
      success: '',
    });
  };

  // Save Edit User
  const handleSaveEdit = async (e) => {
    if (e) e.preventDefault();
    if (!editModal.user) return;

    setEditModal((prev) => ({ ...prev, loading: true, error: '', success: '' }));

    try {
      const payload = {
        name: editModal.formData.name.trim(),
        email: editModal.formData.email.trim(),
        role: editModal.formData.role,
        isActive: editModal.formData.isActive,
      };

      if (editModal.formData.password && editModal.formData.password.trim().length > 0) {
        payload.password = editModal.formData.password.trim();
      }

      const res = await updateStaffSecurityUser(editModal.user.id, payload);
      const updatedUser = res.data;

      setUsers((prev) =>
        prev.map((u) => (u.id === updatedUser.id ? { ...u, ...updatedUser } : u))
      );

      setEditModal((prev) => ({
        ...prev,
        loading: false,
        success: 'Account details updated successfully!',
      }));

      setTimeout(() => {
        setEditModal({
          isOpen: false,
          user: null,
          formData: { name: '', email: '', role: 'STAFF', isActive: true, password: '' },
          showPassword: false,
          loading: false,
          error: '',
          success: '',
        });
      }, 900);
    } catch (err) {
      setEditModal((prev) => ({
        ...prev,
        loading: false,
        error: err.response?.data?.message || 'Failed to update user account.',
      }));
    }
  };

  // Handle Delete Confirmation
  const handleConfirmDelete = async () => {
    if (!deleteModal.user) return;
    setDeleteModal((prev) => ({ ...prev, loading: true }));
    try {
      await deleteStaffSecurityUser(deleteModal.user.id);
      setUsers((prev) => prev.filter((u) => u.id !== deleteModal.user.id));
      setDeleteModal({ isOpen: false, user: null, loading: false });
    } catch (err) {
      alert(err.response?.data?.message || 'Failed to delete user account.');
      setDeleteModal((prev) => ({ ...prev, loading: false }));
    }
  };

  const copyToClipboard = (text) => {
    if (!text) return;
    navigator.clipboard.writeText(text);
    setViewModal((prev) => ({ ...prev, copied: true }));
    setTimeout(() => {
      setViewModal((prev) => ({ ...prev, copied: false }));
    }, 2000);
  };

  const getRoleBadge = (role) => {
    let r = (role || '').toUpperCase();
    if (r === 'SUPER_ADMIN') r = 'ADMIN';
    if (r === 'USER') r = 'STAFF';

    if (r === 'ADMIN') {
      return (
        <span className="staff-sec-badge-role badge-role-admin">
          <span>🛡️</span> ADMIN
        </span>
      );
    }
    if (r === 'SECURITY') {
      return (
        <span className="staff-sec-badge-role badge-role-security">
          <span>🚨</span> SECURITY
        </span>
      );
    }
    return (
      <span className="staff-sec-badge-role badge-role-staff">
        <span>👤</span> STAFF
      </span>
    );
  };

  const formatDate = (dateStr) => {
    if (!dateStr) return '—';
    try {
      const d = new Date(dateStr);
      return d.toLocaleDateString('en-US', {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
      });
    } catch {
      return dateStr;
    }
  };

  return (
    <div className="staff-sec-container">
      {/* Top Header */}
      <div className="staff-sec-header">
        <div className="staff-sec-header-left">
          <div className="staff-sec-header-icon-box">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#059669" strokeWidth="2.2">
              <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
              <path d="m9 12 2 2 4-4" />
            </svg>
          </div>
          <div className="staff-sec-header-text">
            <div className="staff-sec-eyebrow">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
                <path d="m9 12 2 2 4-4" />
              </svg>
              Access Control & Roles
            </div>
            <h1 className="staff-sec-title">Staff & Security Management</h1>
            <p className="staff-sec-subtitle">
              Dedicated module to provision, inspect credentials, and manage system privileges.
            </p>
          </div>
        </div>

        <div className="staff-sec-header-actions">
          <Link to="/staff-security/create" className="staff-sec-primary-btn">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
              <line x1="12" y1="5" x2="12" y2="19" />
              <line x1="5" y1="12" x2="19" y2="12" />
            </svg>
            <span>Add New User</span>
          </Link>
        </div>
      </div>

      {/* Filter and Search Bar */}
      <div className="staff-sec-filter-bar">
        <div className="staff-sec-search-wrap">
          <svg className="staff-sec-search-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <circle cx="11" cy="11" r="8" />
            <line x1="21" y1="21" x2="16.65" y2="16.65" />
          </svg>
          <input
            type="text"
            className="staff-sec-search-input"
            placeholder="Search by name or email address..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
          />
        </div>

        <div className="staff-sec-role-tabs">
          <button
            type="button"
            className={`staff-sec-role-tab ${selectedRoleFilter === 'ALL' ? 'active' : ''}`}
            onClick={() => setSelectedRoleFilter('ALL')}
          >
            All Roles ({users.length})
          </button>
          <button
            type="button"
            className={`staff-sec-role-tab ${selectedRoleFilter === 'STAFF' ? 'active' : ''}`}
            onClick={() => setSelectedRoleFilter('STAFF')}
          >
            Staff ({stats.staffCount})
          </button>
          <button
            type="button"
            className={`staff-sec-role-tab ${selectedRoleFilter === 'SECURITY' ? 'active' : ''}`}
            onClick={() => setSelectedRoleFilter('SECURITY')}
          >
            Security ({stats.securityCount})
          </button>
          <button
            type="button"
            className={`staff-sec-role-tab ${selectedRoleFilter === 'ADMIN' ? 'active' : ''}`}
            onClick={() => setSelectedRoleFilter('ADMIN')}
          >
            Admin ({stats.adminCount})
          </button>
        </div>
      </div>

      {/* Error state */}
      {error && (
        <div style={{
          padding: '12px 16px',
          background: 'rgba(239, 68, 68, 0.12)',
          border: '1px solid rgba(239, 68, 68, 0.3)',
          color: '#ef4444',
          borderRadius: '10px',
          marginBottom: '20px',
          fontSize: '13.5px'
        }}>
          ⚠️ {error}
        </div>
      )}

      {/* Table & Cards Container */}
      <div className="staff-sec-table-card">
        {loading ? (
          <div style={{ padding: '60px 20px', textAlign: 'center' }}>
            <Loader message="Loading accounts..." />
          </div>
        ) : filteredUsers.length === 0 ? (
          <div style={{ padding: '50px 20px', textAlign: 'center', color: 'var(--text-muted)' }}>
            <div style={{ fontSize: '36px', marginBottom: '10px' }}>🔍</div>
            <div style={{ fontSize: '15px', fontWeight: '700', color: 'var(--text-primary)', marginBottom: '4px' }}>
              No User Accounts Found
            </div>
            <p style={{ fontSize: '13px', margin: 0 }}>
              {searchTerm
                ? `No accounts matching "${searchTerm}". Try a different search term or role filter.`
                : 'No users have been provisioned in this category yet.'}
            </p>
          </div>
        ) : (
          <>
            {/* 1. DESKTOP TABLE VIEW (> 768px) */}
            <div className="staff-sec-desktop-table" style={{ overflowX: 'auto' }}>
              <table className="staff-sec-table">
                <thead>
                  <tr>
                    <th>User Details</th>
                    <th>Assigned Role</th>
                    <th>Password (Admin Peek)</th>
                    <th>Status</th>
                    <th>Created Date</th>
                    <th style={{ textAlign: 'right' }}>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredUsers.map((u) => {
                    const initials = (u.name || u.email || 'U').slice(0, 2).toUpperCase();
                    const isCurrent = currentUser?.id && currentUser.id === u.id;
                    const isRevealed = Boolean(revealedPasswords[u.id]);

                    return (
                      <tr key={u.id}>
                        <td>
                          <div className="staff-sec-user-cell">
                            <div className="staff-sec-user-avatar">{initials}</div>
                            <div>
                              <div className="staff-sec-user-name">
                                {u.name || 'Unnamed User'}{' '}
                                {isCurrent && (
                                  <span style={{
                                    fontSize: '10px',
                                    padding: '1px 6px',
                                    borderRadius: '4px',
                                    background: 'rgba(16, 185, 129, 0.15)',
                                    color: '#10b981',
                                    fontWeight: 700,
                                    marginLeft: '4px'
                                  }}>
                                    You
                                  </span>
                                )}
                              </div>
                              <div className="staff-sec-user-email">{u.email}</div>
                            </div>
                          </div>
                        </td>

                        <td>{getRoleBadge(u.role)}</td>

                        {/* Password Column with Eye Peek Toggle */}
                        <td>
                          <div className="staff-sec-password-cell">
                            <span style={{ letterSpacing: isRevealed ? 'normal' : '0.15em' }}>
                              {isRevealed
                                ? (u.rawPassword ? u.rawPassword : '(Hashed in DB)')
                                : '••••••••'}
                            </span>
                            <button
                              type="button"
                              className="staff-sec-pwd-peek-btn"
                              title={isRevealed ? 'Hide Password' : 'Click to View Password'}
                              onClick={() => toggleRowPassword(u.id)}
                            >
                              {isRevealed ? (
                                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                  <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24" />
                                  <line x1="1" y1="1" x2="23" y2="23" />
                                </svg>
                              ) : (
                                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                  <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
                                  <circle cx="12" cy="12" r="3" />
                                </svg>
                              )}
                            </button>
                          </div>
                        </td>

                        <td>
                          <span style={{
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: '6px',
                            fontSize: '12px',
                            fontWeight: '600',
                            color: u.isActive !== false ? '#10b981' : 'var(--text-muted)'
                          }}>
                            <span style={{
                              width: '7px',
                              height: '7px',
                              borderRadius: '50%',
                              background: u.isActive !== false ? '#10b981' : 'var(--text-muted)',
                              boxShadow: u.isActive !== false ? '0 0 8px rgba(16, 185, 129, 0.4)' : 'none'
                            }} />
                            {u.isActive !== false ? 'ACTIVE' : 'INACTIVE'}
                          </span>
                        </td>

                        <td>{formatDate(u.created_at || u.createdAt)}</td>

                        {/* Action Buttons: VIEW, EDIT, DELETE */}
                        <td style={{ textAlign: 'right' }}>
                          <div className="staff-sec-action-btns">
                            <button
                              type="button"
                              className="staff-sec-action-btn btn-action-view"
                              onClick={() => handleOpenView(u)}
                              title="View Full Profile & Password"
                            >
                              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
                                <circle cx="12" cy="12" r="3" />
                              </svg>
                              View
                            </button>

                            <button
                              type="button"
                              className="staff-sec-action-btn btn-action-edit"
                              onClick={() => handleOpenEdit(u)}
                              title="Edit User & Reset Password"
                            >
                              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
                                <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
                              </svg>
                              Edit
                            </button>

                            {isCurrent ? (
                              <span style={{ fontSize: '11px', color: 'var(--text-muted)', fontStyle: 'italic', padding: '4px 8px' }}>
                                Logged In
                              </span>
                            ) : (
                              <button
                                type="button"
                                className="staff-sec-action-btn btn-action-delete"
                                onClick={() => setDeleteModal({ isOpen: true, user: u, loading: false })}
                                title="Delete Account"
                              >
                                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                  <polyline points="3 6 5 6 21 6" />
                                  <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                                </svg>
                                Delete
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {/* 2. MOBILE RESPONSIVE CARDS VIEW (<= 768px) */}
            <div className="staff-sec-mobile-cards">
              {filteredUsers.map((u) => {
                const initials = (u.name || u.email || 'U').slice(0, 2).toUpperCase();
                const isCurrent = currentUser?.id && currentUser.id === u.id;
                const isRevealed = Boolean(revealedPasswords[u.id]);

                return (
                  <div className="staff-sec-user-card" key={u.id}>
                    {/* Top Header of Card */}
                    <div className="staff-sec-card-header">
                      <div className="staff-sec-card-user">
                        <div className="staff-sec-avatar-wrap">
                          <div className="staff-sec-user-avatar">{initials}</div>
                          <span
                            className={`staff-sec-avatar-dot ${u.isActive !== false ? 'dot-active' : 'dot-inactive'}`}
                            title={u.isActive !== false ? 'Active Account' : 'Inactive Account'}
                          />
                        </div>
                        <div className="staff-sec-user-meta">
                          <div className="staff-sec-card-name">
                            <span>{u.name || 'Unnamed User'}</span>
                            {isCurrent && (
                              <span className="staff-sec-current-badge">You</span>
                            )}
                          </div>
                          <div className="staff-sec-card-email">{u.email}</div>
                        </div>
                      </div>
                      <div className="staff-sec-card-role-wrap">
                        {getRoleBadge(u.role)}
                      </div>
                    </div>

                    {/* Compact 2-Column Info Matrix */}
                    <div className="staff-sec-card-info-grid">
                      <div className="staff-sec-card-info-item">
                        <span className="staff-sec-card-info-label">STATUS</span>
                        <div className="staff-sec-card-info-val">
                          <span className={`staff-sec-status-dot ${u.isActive !== false ? 'dot-active' : 'dot-inactive'}`} />
                          <span className={u.isActive !== false ? 'text-active' : 'text-inactive'}>
                            {u.isActive !== false ? 'Active' : 'Inactive'}
                          </span>
                        </div>
                      </div>

                      <div className="staff-sec-card-info-item">
                        <span className="staff-sec-card-info-label">JOINED</span>
                        <div className="staff-sec-card-info-val staff-sec-date-val">
                          {formatDate(u.created_at || u.createdAt)}
                        </div>
                      </div>

                      {/* Sleek 1-Line Credential Strip */}
                      <div className="staff-sec-card-info-item full-width staff-sec-card-pwd-row">
                        <div className="staff-sec-pwd-strip">
                          <div className="staff-sec-pwd-left">
                            <span className="staff-sec-pwd-tag-label">Password:</span>
                            <span className="staff-sec-pwd-code">
                              {isRevealed
                                ? (u.rawPassword ? u.rawPassword : '(Hashed in DB)')
                                : '••••••••'}
                            </span>
                          </div>
                          <button
                            type="button"
                            className="staff-sec-pwd-toggle-btn"
                            onClick={() => toggleRowPassword(u.id)}
                            title={isRevealed ? 'Hide Password' : 'Peek Password'}
                          >
                            {isRevealed ? (
                              <>
                                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                  <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24" />
                                  <line x1="1" y1="1" x2="23" y2="23" />
                                </svg>
                                <span>Hide</span>
                              </>
                            ) : (
                              <>
                                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                  <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
                                  <circle cx="12" cy="12" r="3" />
                                </svg>
                                <span>Peek</span>
                              </>
                            )}
                          </button>
                        </div>
                      </div>
                    </div>

                    {/* Action Buttons Row */}
                    <div className="staff-sec-card-actions">
                      <button
                        type="button"
                        className="staff-sec-m-btn staff-sec-m-btn-view"
                        onClick={() => handleOpenView(u)}
                      >
                        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                          <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
                          <circle cx="12" cy="12" r="3" />
                        </svg>
                        <span>View</span>
                      </button>

                      <button
                        type="button"
                        className="staff-sec-m-btn staff-sec-m-btn-edit"
                        onClick={() => handleOpenEdit(u)}
                      >
                        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                          <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
                          <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
                        </svg>
                        <span>Edit</span>
                      </button>

                      {isCurrent ? (
                        <span className="staff-sec-m-current-pill">
                          Current User
                        </span>
                      ) : (
                        <button
                          type="button"
                          className="staff-sec-m-btn staff-sec-m-btn-del"
                          onClick={() => setDeleteModal({ isOpen: true, user: u, loading: false })}
                          title="Delete Account"
                        >
                          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                            <polyline points="3 6 5 6 21 6" />
                            <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                          </svg>
                          <span>Delete</span>
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </>
        )}
      </div>

      {/* =======================================================
          VIEW USER MODAL (With Password Credential & Eye Toggle)
          ======================================================= */}
      <Modal
        isOpen={viewModal.isOpen}
        title="User Account Details"
        onClose={() => setViewModal({ isOpen: false, user: null, showPassword: false, copied: false })}
        confirmText="Edit Account"
        confirmVariant="primary"
        cancelText="Close"
        onConfirm={() => {
          const userToEdit = viewModal.user;
          setViewModal({ isOpen: false, user: null, showPassword: false, copied: false });
          if (userToEdit) handleOpenEdit(userToEdit);
        }}
      >
        {viewModal.user && (
          <div>
            {/* Header info */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '14px', marginBottom: '18px' }}>
              <div className="staff-sec-user-avatar" style={{ width: '46px', height: '46px', fontSize: '17px' }}>
                {(viewModal.user.name || viewModal.user.email || 'U').slice(0, 2).toUpperCase()}
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: '17px', fontWeight: '800', color: 'var(--text-primary)' }}>
                  {viewModal.user.name}
                </div>
                <div style={{ fontSize: '13px', color: 'var(--text-muted)' }}>
                  {viewModal.user.email}
                </div>
              </div>
              <div>{getRoleBadge(viewModal.user.role)}</div>
            </div>

            {/* Password Credentials Box (Admin Exclusive) */}
            <div style={{ marginBottom: '16px' }}>
              <div style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                marginBottom: '6px'
              }}>
                <span style={{ fontSize: '11px', fontWeight: '700', textTransform: 'uppercase', color: '#0284c7', letterSpacing: '0.04em' }}>
                  🔑 Login Password (Admin Visibility)
                </span>
                <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>
                  Click eye to view
                </span>
              </div>

              <div className="staff-sec-pwd-display-card">
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                  <span style={{
                    fontFamily: 'monospace',
                    fontSize: '14.5px',
                    fontWeight: '700',
                    color: viewModal.showPassword ? '#10b981' : 'var(--text-primary)',
                    letterSpacing: viewModal.showPassword ? 'normal' : '0.2em'
                  }}>
                    {viewModal.showPassword
                      ? (viewModal.user.rawPassword || '•••••••• (Encrypted Hash - use Edit to change)')
                      : '••••••••••••'}
                  </span>
                </div>

                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <button
                    type="button"
                    onClick={() => setViewModal((prev) => ({ ...prev, showPassword: !prev.showPassword }))}
                    style={{
                      background: 'rgba(2, 132, 199, 0.1)',
                      border: '1px solid rgba(2, 132, 199, 0.25)',
                      color: '#0284c7',
                      borderRadius: '6px',
                      padding: '5px 10px',
                      cursor: 'pointer',
                      fontSize: '12px',
                      fontWeight: '600',
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: '5px',
                    }}
                  >
                    {viewModal.showPassword ? '🙈 Hide' : '👁️ View Password'}
                  </button>

                  {viewModal.user.rawPassword && (
                    <button
                      type="button"
                      onClick={() => copyToClipboard(viewModal.user.rawPassword)}
                      style={{
                        background: 'var(--surface)',
                        border: '1px solid var(--border)',
                        color: viewModal.copied ? '#10b981' : 'var(--text-primary)',
                        borderRadius: '6px',
                        padding: '5px 10px',
                        cursor: 'pointer',
                        fontSize: '12px',
                        fontWeight: '600',
                      }}
                    >
                      {viewModal.copied ? '✓ Copied' : '📋 Copy'}
                    </button>
                  )}
                </div>
              </div>
            </div>

            {/* Profile Fields List */}
            <div className="staff-sec-detail-box">
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '14px', fontSize: '13px' }}>
                <div>
                  <span style={{ color: 'var(--text-muted)', display: 'block', fontSize: '11px', textTransform: 'uppercase', marginBottom: '2px' }}>
                    Account Status
                  </span>
                  <span style={{ color: viewModal.user.isActive !== false ? '#10b981' : '#ef4444', fontWeight: '700' }}>
                    {viewModal.user.isActive !== false ? '● ACTIVE' : '○ INACTIVE'}
                  </span>
                </div>

                <div>
                  <span style={{ color: 'var(--text-muted)', display: 'block', fontSize: '11px', textTransform: 'uppercase', marginBottom: '2px' }}>
                    Registered On
                  </span>
                  <span style={{ color: 'var(--text-primary)', fontWeight: '600' }}>
                    {formatDate(viewModal.user.created_at || viewModal.user.createdAt)}
                  </span>
                </div>

                <div>
                  <span style={{ color: 'var(--text-muted)', display: 'block', fontSize: '11px', textTransform: 'uppercase', marginBottom: '2px' }}>
                    User ID
                  </span>
                  <span style={{ color: 'var(--text-secondary)', fontFamily: 'monospace', fontSize: '11px' }}>
                    {viewModal.user.id}
                  </span>
                </div>

                <div>
                  <span style={{ color: 'var(--text-muted)', display: 'block', fontSize: '11px', textTransform: 'uppercase', marginBottom: '2px' }}>
                    Role Clearance
                  </span>
                  <span style={{ color: 'var(--text-primary)', fontWeight: '600' }}>
                    {viewModal.user.role === 'SECURITY'
                      ? 'Surveillance, CCTV & Vehicle Access'
                      : viewModal.user.role === 'STAFF'
                      ? 'Attendance, Shift & Employee Log Access'
                      : 'Full Administrative Privilege'}
                  </span>
                </div>
              </div>
            </div>
          </div>
        )}
      </Modal>

      {/* =======================================================
          EDIT USER MODAL (Update Name, Email, Role, Password)
          ======================================================= */}
      <Modal
        isOpen={editModal.isOpen}
        title="Edit User Account"
        onClose={() =>
          setEditModal({
            isOpen: false,
            user: null,
            formData: { name: '', email: '', role: 'STAFF', isActive: true, password: '' },
            showPassword: false,
            loading: false,
            error: '',
            success: '',
          })
        }
        confirmText={editModal.loading ? 'Saving...' : 'Save Changes'}
        confirmVariant="primary"
        loading={editModal.loading}
        onConfirm={handleSaveEdit}
      >
        {editModal.user && (
          <form onSubmit={handleSaveEdit}>
            {editModal.error && (
              <div style={{
                padding: '10px 14px',
                background: 'rgba(239, 68, 68, 0.12)',
                border: '1px solid rgba(239, 68, 68, 0.3)',
                color: '#ef4444',
                borderRadius: '8px',
                marginBottom: '14px',
                fontSize: '13px'
              }}>
                ⚠️ {editModal.error}
              </div>
            )}

            {editModal.success && (
              <div style={{
                padding: '10px 14px',
                background: 'rgba(16, 185, 129, 0.12)',
                border: '1px solid rgba(16, 185, 129, 0.3)',
                color: '#10b981',
                borderRadius: '8px',
                marginBottom: '14px',
                fontSize: '13px'
              }}>
                ✅ {editModal.success}
              </div>
            )}

            {/* Full Name */}
            <div style={{ marginBottom: '14px' }}>
              <label style={{ display: 'block', fontSize: '12px', fontWeight: '600', color: 'var(--text-secondary)', marginBottom: '5px' }}>
                Full Name
              </label>
              <input
                type="text"
                value={editModal.formData.name}
                onChange={(e) =>
                  setEditModal((prev) => ({
                    ...prev,
                    formData: { ...prev.formData, name: e.target.value },
                  }))
                }
                style={{
                  width: '100%',
                  height: '38px',
                  background: 'var(--surface-2, #f8fafc)',
                  border: '1px solid var(--border, #e2e8f0)',
                  borderRadius: '8px',
                  padding: '0 12px',
                  color: 'var(--text-primary)',
                  fontSize: '13px',
                  outline: 'none',
                  boxSizing: 'border-box',
                }}
              />
            </div>

            {/* Email Address */}
            <div style={{ marginBottom: '14px' }}>
              <label style={{ display: 'block', fontSize: '12px', fontWeight: '600', color: 'var(--text-secondary)', marginBottom: '5px' }}>
                Work Email Address
              </label>
              <input
                type="email"
                value={editModal.formData.email}
                onChange={(e) =>
                  setEditModal((prev) => ({
                    ...prev,
                    formData: { ...prev.formData, email: e.target.value },
                  }))
                }
                style={{
                  width: '100%',
                  height: '38px',
                  background: 'var(--surface-2, #f8fafc)',
                  border: '1px solid var(--border, #e2e8f0)',
                  borderRadius: '8px',
                  padding: '0 12px',
                  color: 'var(--text-primary)',
                  fontSize: '13px',
                  outline: 'none',
                  boxSizing: 'border-box',
                }}
              />
            </div>

            {/* Role & Status Row */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '14px', marginBottom: '14px' }}>
              <div>
                <label style={{ display: 'block', fontSize: '12px', fontWeight: '600', color: 'var(--text-secondary)', marginBottom: '5px' }}>
                  Assigned Role
                </label>
                <select
                  value={editModal.formData.role}
                  onChange={(e) =>
                    setEditModal((prev) => ({
                      ...prev,
                      formData: { ...prev.formData, role: e.target.value },
                    }))
                  }
                  style={{
                    width: '100%',
                    height: '38px',
                    background: 'var(--surface-2, #f8fafc)',
                    border: '1px solid var(--border, #e2e8f0)',
                    borderRadius: '8px',
                    padding: '0 10px',
                    color: 'var(--text-primary)',
                    fontSize: '13px',
                    outline: 'none',
                    boxSizing: 'border-box',
                  }}
                >
                  <option value="STAFF">Staff (Employee & Attendance)</option>
                  <option value="SECURITY">Security (Surveillance & CCTV)</option>
                  <option value="ADMIN">Admin (Full Control)</option>
                </select>
              </div>

              <div>
                <label style={{ display: 'block', fontSize: '12px', fontWeight: '600', color: 'var(--text-secondary)', marginBottom: '5px' }}>
                  Account Status
                </label>
                <select
                  value={editModal.formData.isActive ? 'true' : 'false'}
                  onChange={(e) =>
                    setEditModal((prev) => ({
                      ...prev,
                      formData: { ...prev.formData, isActive: e.target.value === 'true' },
                    }))
                  }
                  style={{
                    width: '100%',
                    height: '38px',
                    background: 'var(--surface-2, #f8fafc)',
                    border: '1px solid var(--border, #e2e8f0)',
                    borderRadius: '8px',
                    padding: '0 10px',
                    color: 'var(--text-primary)',
                    fontSize: '13px',
                    outline: 'none',
                    boxSizing: 'border-box',
                  }}
                >
                  <option value="true">Active</option>
                  <option value="false">Inactive / Suspended</option>
                </select>
              </div>
            </div>

            {/* Password (Admin Can View and Reset) */}
            <div style={{ marginBottom: '10px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '5px' }}>
                <label style={{ fontSize: '12px', fontWeight: '600', color: '#0284c7' }}>
                  🔑 Password (View or Set New Password)
                </label>
                <button
                  type="button"
                  onClick={() => setEditModal((prev) => ({ ...prev, showPassword: !prev.showPassword }))}
                  style={{
                    background: 'none',
                    border: 'none',
                    color: '#0284c7',
                    cursor: 'pointer',
                    fontSize: '11.5px',
                    fontWeight: '600',
                  }}
                >
                  {editModal.showPassword ? 'Hide Password' : 'Show Password'}
                </button>
              </div>
              <input
                type={editModal.showPassword ? 'text' : 'password'}
                placeholder="Enter new password to reset"
                value={editModal.formData.password}
                onChange={(e) =>
                  setEditModal((prev) => ({
                    ...prev,
                    formData: { ...prev.formData, password: e.target.value },
                  }))
                }
                style={{
                  width: '100%',
                  height: '38px',
                  background: 'var(--surface-2, #f8fafc)',
                  border: '1px solid var(--border, #e2e8f0)',
                  borderRadius: '8px',
                  padding: '0 12px',
                  color: 'var(--text-primary)',
                  fontSize: '13px',
                  outline: 'none',
                  boxSizing: 'border-box',
                }}
              />
              <p style={{ margin: '5px 0 0', fontSize: '11px', color: 'var(--text-muted)' }}>
                Admin can directly update and view credentials for this user account.
              </p>
            </div>
          </form>
        )}
      </Modal>

      {/* =======================================================
          DELETE CONFIRMATION MODAL
          ======================================================= */}
      <Modal
        isOpen={deleteModal.isOpen}
        title="Delete User Account"
        onClose={() => setDeleteModal({ isOpen: false, user: null, loading: false })}
        onConfirm={handleConfirmDelete}
        confirmText="Yes, Delete Account"
        confirmVariant="danger"
        loading={deleteModal.loading}
      >
        <div style={{ color: 'var(--text-secondary)', fontSize: '14px', lineHeight: 1.6 }}>
          Are you sure you want to permanently delete{' '}
          <strong style={{ color: 'var(--text-primary)' }}>
            {deleteModal.user?.name} ({deleteModal.user?.email})
          </strong>
          ?
          <p style={{ marginTop: '10px', color: '#ef4444', fontSize: '13px' }}>
            ⚠️ This will revoke their system access and completely remove their credentials from the database.
          </p>
        </div>
      </Modal>
    </div>
  );
};

export default StaffSecurityList;
