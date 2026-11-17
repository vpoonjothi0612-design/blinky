import React, { useState, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import useAuth from '../../hooks/useAuth';
import { getEmployees, deleteEmployee, bulkDeleteEmployees } from './employee.service';
import Loader from '../../components/common/Loader';
import Modal from '../../components/common/Modal';
import employeeBannerArt from '../../assets/employee_banner_art_perfect.png';

const EmployeeList = () => {
  const navigate = useNavigate();
  const { user } = useAuth();
  const isAdmin = (user?.role || '').toUpperCase() === 'ADMIN' || (user?.role || '').toUpperCase() === 'SUPER_ADMIN';

  const [employees, setEmployees] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const initialFetchStartedRef = React.useRef(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [searching, setSearching] = useState(false);
  const [statusFilter, setStatusFilter] = useState('ALL'); // 'ALL' | 'ACTIVE' | 'INACTIVE'

  // Pagination State
  const [currentPage, setCurrentPage] = useState(1);
  const [rowsPerPage, setRowsPerPage] = useState(10);

  // Selection & Bulk Delete State
  const [selectedIds, setSelectedIds] = useState([]);
  const [bulkDeleteModalOpen, setBulkDeleteModalOpen] = useState(false);
  const [bulkDeleting, setBulkDeleting] = useState(false);

  // Modal State for Single Delete Confirmation
  const [deleteModal, setDeleteModal] = useState({
    isOpen: false,
    employee: null,
    loading: false,
  });

  const fetchEmployees = async () => {
    setLoading(true);
    setError('');
    try {
      const response = await getEmployees();
      setEmployees(response.data || []);
    } catch (err) {
      setError(err.response?.data?.message || 'Failed to fetch employees.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (initialFetchStartedRef.current) return;
    initialFetchStartedRef.current = true;
    fetchEmployees();
  }, []);

  // Filtered employees across Code, First/Last Name, Full Name, Email, Phone, Department, Designation
  const filteredEmployees = useMemo(() => {
    let list = employees;
    if (statusFilter !== 'ALL') {
      list = list.filter((emp) => (emp.status || 'ACTIVE').toUpperCase() === statusFilter);
    }
    if (!searchTerm.trim()) return list;
    const q = searchTerm.trim().toLowerCase();
    return list.filter((emp) => {
      const code = (emp.employeeCode || '').toLowerCase();
      const fName = (emp.firstName || '').toLowerCase();
      const lName = (emp.lastName || '').toLowerCase();
      const fullName = `${fName} ${lName}`.trim();
      const email = (emp.email || '').toLowerCase();
      const phone = (emp.phone || '').toLowerCase();
      const dept = (emp.department || '').toLowerCase();
      const desig = (emp.designation || '').toLowerCase();

      return (
        code.includes(q) ||
        fName.includes(q) ||
        lName.includes(q) ||
        fullName.includes(q) ||
        email.includes(q) ||
        phone.includes(q) ||
        dept.includes(q) ||
        desig.includes(q)
      );
    });
  }, [employees, searchTerm, statusFilter]);

  const activeCount = useMemo(
    () => employees.filter((e) => (e.status || 'ACTIVE').toUpperCase() === 'ACTIVE').length,
    [employees]
  );
  const inactiveCount = useMemo(
    () => employees.filter((e) => (e.status || '').toUpperCase() === 'INACTIVE').length,
    [employees]
  );

  const handleSearchSubmit = (e) => {
    if (e && e.preventDefault) e.preventDefault();
    setCurrentPage(1);
    setSearching(true);
    setTimeout(() => setSearching(false), 200);
  };

  // Pagination Math
  const totalRecords = filteredEmployees.length;
  const totalPages = Math.ceil(totalRecords / rowsPerPage) || 1;

  useEffect(() => {
    if (currentPage > totalPages) {
      setCurrentPage(totalPages);
    }
  }, [totalPages, currentPage]);

  const startIndex = (currentPage - 1) * rowsPerPage;
  const endIndex = Math.min(startIndex + rowsPerPage, totalRecords);
  const paginatedEmployees = filteredEmployees.slice(startIndex, endIndex);

  // Selection Logic
  const isAllSelected =
    paginatedEmployees.length > 0 &&
    paginatedEmployees.every((emp) => selectedIds.includes(emp.id));

  const isIndeterminate =
    paginatedEmployees.some((emp) => selectedIds.includes(emp.id)) && !isAllSelected;

  const handleToggleSelect = (id) => {
    setSelectedIds((prev) =>
      prev.includes(id) ? prev.filter((item) => item !== id) : [...prev, id]
    );
  };

  const handleSelectAll = () => {
    if (isAllSelected) {
      const pageIds = new Set(paginatedEmployees.map((e) => e.id));
      setSelectedIds((prev) => prev.filter((id) => !pageIds.has(id)));
    } else {
      const pageIds = paginatedEmployees.map((e) => e.id);
      setSelectedIds((prev) => Array.from(new Set([...prev, ...pageIds])));
    }
  };

  const handleDeselectAll = () => {
    setSelectedIds([]);
  };

  const executeBulkDelete = async () => {
    if (selectedIds.length === 0) return;
    setBulkDeleting(true);
    try {
      await bulkDeleteEmployees(selectedIds);
      setSelectedIds([]);
      setBulkDeleteModalOpen(false);
      fetchEmployees();
    } catch (err) {
      alert(err.response?.data?.message || 'Failed to bulk delete employees.');
    } finally {
      setBulkDeleting(false);
    }
  };

  // Single Delete
  const openDeleteModal = (employee) => {
    setDeleteModal({ isOpen: true, employee, loading: false });
  };

  const closeDeleteModal = () => {
    setDeleteModal({ isOpen: false, employee: null, loading: false });
  };

  const handleDeleteConfirm = async () => {
    if (!deleteModal.employee) return;
    setDeleteModal((prev) => ({ ...prev, loading: true }));
    try {
      await deleteEmployee(deleteModal.employee.id);
      closeDeleteModal();
      setSelectedIds((prev) => prev.filter((id) => id !== deleteModal.employee.id));
      fetchEmployees();
    } catch (err) {
      alert(err.response?.data?.message || 'Failed to delete employee.');
      setDeleteModal((prev) => ({ ...prev, loading: false }));
    }
  };

  return (
    <div className="emp-directory-page fade-in">
      {/* ── 1. HERO BANNER ─────────────────────────────────────────────── */}
      <div className="emp-hero-banner">
        <div className="emp-hero-left">
          <div className="emp-hero-icon-box">
            <svg viewBox="0 0 24 24" width="28" height="28" fill="#047857">
              <path d="M16 11c1.66 0 2.99-1.34 2.99-3S17.66 5 16 5c-1.66 0-3 1.34-3 3s1.34 3 3 3zm-8 0c1.66 0 2.99-1.34 2.99-3S9.66 5 8 5C6.34 5 5 6.34 5 8s1.34 3 3 3zm0 2c-2.33 0-7 1.17-7 3.5V19h14v-2.5c0-2.33-4.67-3.5-7-3.5zm8 0c-.29 0-.62.02-.97.05 1.16.84 1.97 1.97 1.97 3.45V19h6v-2.5c0-2.33-4.67-3.5-7-3.5z" />
            </svg>
          </div>
          <div className="emp-hero-text">
            <h1 className="emp-hero-title">
              {isAdmin ? 'Employee Directory' : 'Personnel Verification Directory'}
            </h1>
            <p className="emp-hero-subtitle">
              {isAdmin
                ? 'Manage personnel records, biometric profiles, and employee access details.'
                : 'Lookup employee identity, department details, and gate clearance status.'}
            </p>
          </div>
        </div>

        {/* Center Illustration with Botanical Branch */}
        <div className="emp-hero-center">
          <img
            src={employeeBannerArt}
            alt="Employee Directory illustration"
            className="emp-hero-img"
          />
        </div>

        {/* Right Action Button - ADMIN Only */}
        {isAdmin && (
          <div className="emp-hero-right">
            <button
              className="emp-btn-add"
              onClick={() => navigate('/employees/create')}
            >
              <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <line x1="12" y1="5" x2="12" y2="19" />
                <line x1="5" y1="12" x2="19" y2="12" />
              </svg>
              <span>Add Employee</span>
            </button>
          </div>
        )}
      </div>

      {/* ── 2. SEARCH BAR BOX ─────────────────────────────────────────── */}
      <div className="emp-search-container">
        <form onSubmit={handleSearchSubmit} className="emp-search-form">
          <div className="emp-search-input-wrap">
            <svg className="emp-search-icon" viewBox="0 0 24 24" width="19" height="19" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="11" cy="11" r="8" />
              <line x1="21" y1="21" x2="16.65" y2="16.65" />
            </svg>
            <input
              type="text"
              placeholder="Search by Employee Code, Name, Department, Email..."
              value={searchTerm}
              onChange={(e) => {
                setSearchTerm(e.target.value);
                setCurrentPage(1);
              }}
              className="emp-search-field"
            />
            {searchTerm && (
              <button
                type="button"
                className="emp-search-clear-btn"
                title="Clear Search"
                onClick={() => {
                  setSearchTerm('');
                  setCurrentPage(1);
                }}
              >
                <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <line x1="18" y1="6" x2="6" y2="18" />
                  <line x1="6" y1="6" x2="18" y2="18" />
                </svg>
              </button>
            )}
          </div>
          <button type="submit" disabled={searching} className="emp-btn-search">
            <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="#ffffff" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="11" cy="11" r="8" />
              <line x1="21" y1="21" x2="16.65" y2="16.65" />
            </svg>
            <span>{searching ? 'Searching...' : 'Search'}</span>
          </button>
        </form>

        {/* Quick Filter Tabs */}
        <div className="emp-filter-tabs-row">
          <button
            type="button"
            className={`emp-filter-tab ${statusFilter === 'ALL' ? 'active' : ''}`}
            onClick={() => {
              setStatusFilter('ALL');
              setCurrentPage(1);
            }}
          >
            All <span className="tab-count">{employees.length}</span>
          </button>
          <button
            type="button"
            className={`emp-filter-tab ${statusFilter === 'ACTIVE' ? 'active' : ''}`}
            onClick={() => {
              setStatusFilter('ACTIVE');
              setCurrentPage(1);
            }}
          >
            Active <span className="tab-count">{activeCount}</span>
          </button>
          <button
            type="button"
            className={`emp-filter-tab ${statusFilter === 'INACTIVE' ? 'active' : ''}`}
            onClick={() => {
              setStatusFilter('INACTIVE');
              setCurrentPage(1);
            }}
          >
            Inactive <span className="tab-count">{inactiveCount}</span>
          </button>
        </div>
      </div>

      {error && <div className="alert alert-danger" style={{ marginBottom: '20px' }}>{error}</div>}

      {/* ── 3. EMPLOYEES TABLE CARD ─────────────────────────────────────── */}
      <div className="emp-table-card">
        {/* Selection Banner */}
        {isAdmin && selectedIds.length > 0 && (
          <div className="emp-selection-banner">
            <div className="emp-selection-left">
              <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2.5">
                <polyline points="20 6 9 17 4 12" />
              </svg>
              <span className="emp-selection-count">
                <strong>{selectedIds.length}</strong> employee{selectedIds.length === 1 ? '' : 's'} selected
              </span>
              <button
                type="button"
                className="emp-btn-deselect"
                onClick={handleDeselectAll}
              >
                Deselect All
              </button>
            </div>
            <button
              type="button"
              className="emp-btn-bulk-delete"
              onClick={() => setBulkDeleteModalOpen(true)}
            >
              <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="2">
                <polyline points="3 6 5 6 21 6" />
                <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                <line x1="10" y1="11" x2="10" y2="17" />
                <line x1="14" y1="11" x2="14" y2="17" />
              </svg>
              <span>Delete Selected ({selectedIds.length})</span>
            </button>
          </div>
        )}

        {/* Top Header Count & Status */}
        <div className="emp-count-header">
          <span className="emp-count-text">
            {filteredEmployees.length} {filteredEmployees.length === 1 ? 'employee' : 'employees'} shown
            {searchTerm && ` (filtered from ${employees.length})`}
          </span>
        </div>

        {loading ? (
          <div style={{ padding: '60px 0' }}>
            <Loader message="Loading employee directory..." />
          </div>
        ) : (
          <>
            <div className="emp-desktop-table">
              <div className="table-responsive" style={{ overflowX: 'auto', width: '100%' }}>
                <table className="emp-custom-table">
                  <thead>
                    <tr>
                      {isAdmin && (
                        <th style={{ width: '46px', textAlign: 'center' }}>
                          <input
                            type="checkbox"
                            className="emp-checkbox"
                            checked={isAllSelected}
                            ref={(el) => {
                              if (el) el.indeterminate = isIndeterminate;
                            }}
                            onChange={handleSelectAll}
                            title="Select All on this page"
                          />
                        </th>
                      )}
                      <th style={{ width: '60px' }}>S.NO</th>
                      <th style={{ width: '11%' }}>CODE</th>
                      <th style={{ width: '18%' }}>NAME</th>
                      <th style={{ width: '18%' }}>EMAIL</th>
                      <th style={{ width: '11%' }}>PHONE</th>
                      <th style={{ width: '13%' }}>DEPARTMENT</th>
                      <th style={{ width: '12%' }}>DESIGNATION</th>
                      <th style={{ width: '8%' }}>STATUS</th>
                      <th style={{ width: '9%' }}>ACTIONS</th>
                    </tr>
                  </thead>
                  <tbody>
                    {paginatedEmployees.length === 0 ? (
                      <tr>
                        <td colSpan={10} style={{ padding: 0 }}>
                          <div className="emp-empty-wrap">
                            <div className="emp-empty-icon">
                              <svg width="84" height="84" viewBox="0 0 84 84" fill="none">
                                <line x1="20" y1="36" x2="28" y2="34" stroke="#10b981" strokeWidth="2.5" strokeLinecap="round" />
                                <line x1="18" y1="46" x2="27" y2="44" stroke="#10b981" strokeWidth="2.5" strokeLinecap="round" />
                                <ellipse cx="46" cy="40" rx="30" ry="20" fill="#e8fbf2" />
                                <rect x="28" y="16" width="34" height="46" rx="7" stroke="#10b981" strokeWidth="2.2" fill="#ffffff" />
                                <circle cx="45" cy="27" r="4.5" fill="#10b981" />
                                <path d="M38 39 C 38 34, 52 34, 52 39" stroke="#10b981" strokeWidth="2" strokeLinecap="round" fill="none" />
                                <line x1="36" y1="46" x2="48" y2="46" stroke="#a7f3d0" strokeWidth="2" strokeLinecap="round" />
                                <circle cx="56" cy="51" r="9.5" stroke="#059669" strokeWidth="2.6" fill="#f0fdf4" />
                                <line x1="63" y1="58" x2="73" y2="68" stroke="#059669" strokeWidth="3.6" strokeLinecap="round" />
                              </svg>
                            </div>
                            <h3 className="emp-empty-title">
                              {searchTerm ? `No employees found matching "${searchTerm}".` : 'No employees registered yet.'}
                            </h3>
                            <p className="emp-empty-desc">
                              {searchTerm ? 'Try searching for a different keyword or clear the search field.' : 'Add employees to manage their attendance and access details.'}
                            </p>
                          </div>
                        </td>
                      </tr>
                    ) : (
                      paginatedEmployees.map((row, idx) => {
                        const isSelected = selectedIds.includes(row.id);
                        const serialNumber = startIndex + idx + 1;
                        const initials = (
                          (row.firstName ? row.firstName[0] : '') +
                          (row.lastName ? row.lastName[0] : '')
                        ).toUpperCase() || 'E';

                        const avatarColorStyles = [
                          { bg: '#eff6ff', color: '#2563eb', darkBg: 'rgba(59, 130, 246, 0.22)', darkColor: '#93c5fd' },
                          { bg: '#fef2f2', color: '#dc2626', darkBg: 'rgba(239, 68, 68, 0.22)', darkColor: '#fca5a5' },
                          { bg: '#fffbeb', color: '#d97706', darkBg: 'rgba(245, 158, 11, 0.22)', darkColor: '#fde68a' },
                          { bg: '#f5f3ff', color: '#7c3aed', darkBg: 'rgba(139, 92, 246, 0.22)', darkColor: '#c4b5fd' },
                        ];
                        const avStyle = avatarColorStyles[idx % avatarColorStyles.length];

                        const isActive = (row.status || 'ACTIVE').toUpperCase() === 'ACTIVE';

                        return (
                          <tr key={row.id || idx} className={isSelected ? 'selected-row' : ''}>
                            {isAdmin && (
                              <td style={{ textAlign: 'center' }}>
                                <input
                                  type="checkbox"
                                  className="emp-checkbox"
                                  checked={isSelected}
                                  onChange={() => handleToggleSelect(row.id)}
                                />
                              </td>
                            )}
                            <td>
                              <span className="emp-sno-text">{serialNumber}</span>
                            </td>
                            <td>
                              <span className="emp-code-badge">{row.employeeCode}</span>
                            </td>
                            <td>
                              <div className="emp-name-cell">
                                <div
                                  className="emp-avatar-circle"
                                  style={{
                                    '--av-bg': avStyle.bg,
                                    '--av-color': avStyle.color,
                                    '--av-dark-bg': avStyle.darkBg,
                                    '--av-dark-color': avStyle.darkColor,
                                  }}
                                >
                                  {initials}
                                </div>
                                <span className="emp-name-text">
                                  {`${row.firstName} ${row.lastName || ''}`.trim()}
                                </span>
                              </div>
                            </td>
                            <td>
                              <span className="emp-email-text">{row.email || '—'}</span>
                            </td>
                            <td>
                              <span className="emp-phone-text">{row.phone || '—'}</span>
                            </td>
                            <td>
                              <span className="emp-dept-pill">{row.department || '—'}</span>
                            </td>
                            <td>
                              <span className="emp-desig-text">{row.designation || '—'}</span>
                            </td>
                            <td>
                              <span className={`emp-status-pill ${isActive ? 'status-active' : 'status-inactive'}`}>
                                <span className="emp-status-dot"></span>
                                <span>{isActive ? 'Active' : 'Inactive'}</span>
                              </span>
                            </td>
                            <td>
                              <div className="emp-actions-wrap">
                                <button
                                  className="emp-action-btn view-action"
                                  title="View Details"
                                  onClick={() => navigate(`/employees/${row.id}`)}
                                >
                                  <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                    <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
                                    <circle cx="12" cy="12" r="3" />
                                  </svg>
                                </button>
                                {isAdmin && (
                                  <>
                                    <button
                                      className="emp-action-btn edit-action"
                                      title="Edit Employee"
                                      onClick={() => navigate(`/employees/${row.id}/edit`)}
                                    >
                                      <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                        <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
                                        <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
                                      </svg>
                                    </button>
                                    <button
                                      className="emp-action-btn delete-action"
                                      title="Delete Employee"
                                      onClick={() => openDeleteModal(row)}
                                    >
                                      <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                        <polyline points="3 6 5 6 21 6" />
                                        <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                                      </svg>
                                    </button>
                                  </>
                                )}
                              </div>
                            </td>
                          </tr>
                        );
                      })
                    )}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Mobile View: High-end Contact Profile Cards */}
            <div className="emp-mobile-cards">
              {paginatedEmployees.length === 0 ? (
                <div className="emp-empty-wrap" style={{ padding: '36px 16px' }}>
                  <h3 className="emp-empty-title" style={{ fontSize: '15px' }}>
                    {searchTerm ? `No employees found matching "${searchTerm}".` : 'No employees registered yet.'}
                  </h3>
                  <p className="emp-empty-desc" style={{ fontSize: '12.5px' }}>
                    {searchTerm ? 'Try adjusting your search query.' : 'Click Add Employee to create your first employee.'}
                  </p>
                </div>
              ) : (
                paginatedEmployees.map((row, idx) => {
                  const initials = (
                    (row.firstName ? row.firstName[0] : '') +
                    (row.lastName ? row.lastName[0] : '')
                  ).toUpperCase() || 'E';

                  const avatarColorStyles = [
                    { bg: '#eff6ff', color: '#2563eb' },
                    { bg: '#fef2f2', color: '#dc2626' },
                    { bg: '#fffbeb', color: '#d97706' },
                    { bg: '#f5f3ff', color: '#7c3aed' },
                  ];
                  const avStyle = avatarColorStyles[idx % avatarColorStyles.length];
                  const isActive = (row.status || 'ACTIVE').toUpperCase() === 'ACTIVE';

                  return (
                    <div className="emp-m-card" key={`m-${row.id || idx}`}>
                      <div className="emp-m-card-header">
                        <div className="emp-m-card-user">
                          <div
                            className="emp-m-avatar"
                            style={{ backgroundColor: avStyle.bg, color: avStyle.color }}
                          >
                            {initials}
                          </div>
                          <div className="emp-m-user-info">
                            <span className="emp-m-name">
                              {`${row.firstName} ${row.lastName || ''}`.trim()}
                            </span>
                            <div className="emp-m-meta-row">
                              <span className="emp-m-code">{row.employeeCode}</span>
                              {row.designation && (
                                <span className="emp-m-desig">{row.designation}</span>
                              )}
                            </div>
                          </div>
                        </div>

                        <span className={`emp-status-pill ${isActive ? 'status-active' : 'status-inactive'}`}>
                          <span className="emp-status-dot"></span>
                          <span>{isActive ? 'Active' : 'Inactive'}</span>
                        </span>
                      </div>

                      <div className="emp-m-card-details">
                        {row.department && (
                          <div className="emp-m-detail-item">
                            <span className="emp-m-detail-lbl">Department</span>
                            <span className="emp-m-detail-val emp-m-dept">{row.department}</span>
                          </div>
                        )}
                        {row.email && (
                          <div className="emp-m-detail-item">
                            <span className="emp-m-detail-lbl">Email</span>
                            <span className="emp-m-detail-val">{row.email}</span>
                          </div>
                        )}
                        {row.phone && (
                          <div className="emp-m-detail-item">
                            <span className="emp-m-detail-lbl">Phone</span>
                            <span className="emp-m-detail-val">{row.phone}</span>
                          </div>
                        )}
                      </div>

                      <div className="emp-m-card-actions">
                        <button
                          type="button"
                          className="emp-m-btn emp-m-btn-view"
                          onClick={() => navigate(`/employees/${row.id}`)}
                          title="View Profile"
                        >
                          <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2">
                            <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
                            <circle cx="12" cy="12" r="3" />
                          </svg>
                          <span>View</span>
                        </button>

                        {isAdmin && (
                          <>
                            <button
                              type="button"
                              className="emp-m-btn emp-m-btn-edit"
                              onClick={() => navigate(`/employees/${row.id}/edit`)}
                              title="Edit Employee"
                            >
                              <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2">
                                <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
                                <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
                              </svg>
                              <span>Edit</span>
                            </button>

                            <button
                              type="button"
                              className="emp-m-btn emp-m-btn-delete"
                              onClick={() => openDeleteModal(row)}
                              title="Delete Employee"
                            >
                              <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2">
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

        {/* Table Footer with Pagination Controls */}
        <div className="emp-table-footer">
          <div className="emp-footer-left">
            <span className="emp-footer-count">
              {totalRecords > 0
                ? `Showing ${startIndex + 1} - ${endIndex} of ${totalRecords} records`
                : 'Showing 0 records'}
            </span>
            {totalRecords > 10 && (
              <div className="emp-rows-per-page">
                <label htmlFor="emp-per-page">Rows per page:</label>
                <select
                  id="emp-per-page"
                  value={rowsPerPage}
                  onChange={(e) => {
                    setRowsPerPage(Number(e.target.value));
                    setCurrentPage(1);
                  }}
                  className="emp-per-page-select"
                >
                  <option value={10}>10</option>
                  <option value={25}>25</option>
                  <option value={50}>50</option>
                  <option value={100}>100</option>
                </select>
              </div>
            )}
          </div>

          {totalPages > 1 && (
            <div className="emp-pagination-controls">
              <button
                type="button"
                className="emp-page-arrow"
                disabled={currentPage === 1}
                onClick={() => setCurrentPage((p) => Math.max(p - 1, 1))}
                title="Previous Page"
              >
                <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="2">
                  <polyline points="15 18 9 12 15 6" />
                </svg>
              </button>

              <div className="emp-page-numbers">
                {Array.from({ length: totalPages }, (_, i) => i + 1)
                  .filter((page) => {
                    if (totalPages <= 7) return true;
                    if (page === 1 || page === totalPages) return true;
                    return Math.abs(page - currentPage) <= 1;
                  })
                  .map((page, i, arr) => {
                    const showEllipsis = i > 0 && page - arr[i - 1] > 1;
                    return (
                      <React.Fragment key={page}>
                        {showEllipsis && <span className="emp-page-ellipsis">…</span>}
                        <button
                          type="button"
                          className={`emp-page-num ${currentPage === page ? 'active' : ''}`}
                          onClick={() => setCurrentPage(page)}
                        >
                          {page}
                        </button>
                      </React.Fragment>
                    );
                  })}
              </div>

              <button
                type="button"
                className="emp-page-arrow"
                disabled={currentPage === totalPages}
                onClick={() => setCurrentPage((p) => Math.min(p + 1, totalPages))}
                title="Next Page"
              >
                <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="2">
                  <polyline points="9 18 15 12 9 6" />
                </svg>
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Single Delete Confirmation Modal */}
      <Modal
        isOpen={deleteModal.isOpen}
        title="Confirm Delete"
        onClose={closeDeleteModal}
        onConfirm={handleDeleteConfirm}
        confirmText="Delete"
        confirmVariant="danger"
        loading={deleteModal.loading}
      >
        <p>
          Are you sure you want to delete employee{' '}
          <strong>
            {deleteModal.employee?.firstName} {deleteModal.employee?.lastName} (
            {deleteModal.employee?.employeeCode})
          </strong>
          ?
        </p>
      </Modal>

      {/* Bulk Delete Confirmation Modal */}
      <Modal
        isOpen={bulkDeleteModalOpen}
        title={`Bulk Delete (${selectedIds.length} Selected)`}
        onClose={() => setBulkDeleteModalOpen(false)}
        confirmText={bulkDeleting ? 'Deleting...' : `Delete ${selectedIds.length} Employees`}
        confirmVariant="danger"
        onConfirm={executeBulkDelete}
      >
        <p style={{ margin: 0 }}>
          Are you sure you want to permanently delete <strong>{selectedIds.length}</strong> selected employee(s)? This will also clean up any associated biometric profile and attendance logs. This action cannot be undone.
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

        /* ── Hero Banner ── */
        .emp-hero-banner {
          background: linear-gradient(135deg, #e5f7ed 0%, #edf9f3 50%, #e8f8f0 100%);
          border: 1px solid rgba(16, 185, 129, 0.22);
          border-radius: 16px;
          padding: 22px 28px;
          margin-bottom: 24px;
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 20px;
          box-shadow: 0 2px 8px rgba(5, 150, 105, 0.04);
          position: relative;
          overflow: hidden;
        }

        .emp-hero-left {
          display: flex;
          align-items: center;
          gap: 18px;
          z-index: 2;
          flex: 1.2;
          min-width: 280px;
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

        .emp-hero-center {
          display: flex;
          align-items: flex-end;
          justify-content: center;
          z-index: 2;
          flex: 1;
          margin-bottom: -22px;
          user-select: none;
          pointer-events: none;
        }

        .emp-hero-img {
          height: 104px;
          width: auto;
          max-width: 320px;
          object-fit: contain;
          display: block;
        }

        .emp-hero-right {
          display: flex;
          align-items: center;
          z-index: 2;
          flex-shrink: 0;
        }

        .emp-btn-add {
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
          box-shadow: 0 4px 12px rgba(16, 185, 129, 0.3);
          white-space: nowrap;
        }

        .emp-btn-add:hover {
          opacity: 0.95;
          transform: translateY(-1px);
          box-shadow: 0 6px 16px rgba(16, 185, 129, 0.4);
        }

        /* ── Search Container ── */
        .emp-search-container {
          background: #ffffff;
          border: 1px solid #e2e8f0;
          border-radius: 14px;
          padding: 8px 10px 8px 18px;
          margin-bottom: 24px;
          box-shadow: 0 1px 3px rgba(0, 0, 0, 0.02);
        }

        .emp-search-form {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 12px;
          width: 100%;
        }

        .emp-search-input-wrap {
          display: flex;
          align-items: center;
          gap: 12px;
          flex: 1;
          position: relative;
        }

        .emp-search-icon {
          color: #94a3b8;
          flex-shrink: 0;
        }

        .emp-search-field {
          width: 100%;
          border: none;
          outline: none;
          background: transparent;
          font-size: 14px;
          color: #0f172a;
          padding: 6px 0;
        }

        .emp-search-field::placeholder {
          color: #94a3b8;
          font-weight: 400;
        }

        .emp-search-clear-btn {
          background: none;
          border: none;
          color: #94a3b8;
          cursor: pointer;
          padding: 4px;
          display: flex;
          align-items: center;
          justify-content: center;
        }

        .emp-search-clear-btn:hover {
          color: #0f172a;
        }

        .emp-btn-search {
          height: 40px;
          padding: 0 22px;
          border-radius: 8px;
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
          box-shadow: 0 2px 8px rgba(16, 185, 129, 0.3);
          flex-shrink: 0;
        }

        .emp-btn-search:hover:not(:disabled) {
          opacity: 0.95;
          box-shadow: 0 4px 12px rgba(16, 185, 129, 0.4);
        }

        .emp-btn-search:disabled {
          opacity: 0.6;
          cursor: not-allowed;
        }

        /* ── Table Card ── */
        .emp-table-card {
          background: #ffffff;
          border: 1px solid #e2ece8;
          border-radius: 18px;
          padding: 16px 20px 20px;
          box-shadow: 0 1px 4px rgba(0, 0, 0, 0.02);
        }

        .emp-count-header {
          padding: 0 4px 12px;
          text-align: right;
        }

        .emp-count-text {
          font-size: 13px;
          color: #64748b;
          font-weight: 500;
        }

        .emp-custom-table {
          width: 100%;
          border-collapse: separate;
          border-spacing: 0;
          text-align: left;
        }

        .emp-custom-table th {
          background-color: #dff5ea;
          color: #064e3b;
          font-size: 11.5px;
          font-weight: 700;
          letter-spacing: 0.05em;
          text-transform: uppercase;
          padding: 13px 18px;
          border: none;
          white-space: nowrap;
        }

        .emp-custom-table th:first-child {
          border-top-left-radius: 12px;
          border-bottom-left-radius: 12px;
        }

        .emp-custom-table th:last-child {
          border-top-right-radius: 12px;
          border-bottom-right-radius: 12px;
        }

        .emp-custom-table td {
          padding: 14px 18px;
          font-size: 13px;
          color: #0f172a;
          border-bottom: 1px solid #f1f5f9;
          vertical-align: middle;
        }

        .emp-custom-table tr:hover td {
          background-color: #f8fafc;
        }

        .emp-custom-table tr.selected-row td {
          background-color: #f0fdf4 !important;
        }

        .emp-checkbox {
          width: 17px;
          height: 17px;
          cursor: pointer;
          accent-color: #10b981;
          vertical-align: middle;
        }

        .emp-sno-text {
          font-size: 12.5px;
          font-weight: 600;
          color: #64748b;
        }

        /* ── Selection Banner ── */
        .emp-selection-banner {
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding: 10px 16px;
          margin-bottom: 14px;
          border-radius: 10px;
          background: #ecfdf5;
          border: 1px solid #a7f3d0;
          color: #065f46;
          animation: fadeIn 0.2s ease-in-out;
        }

        .emp-selection-left {
          display: flex;
          align-items: center;
          gap: 12px;
          font-size: 13px;
        }

        .emp-btn-deselect {
          background: none;
          border: none;
          color: #059669;
          font-size: 12.5px;
          font-weight: 600;
          cursor: pointer;
          text-decoration: underline;
          padding: 0;
        }

        .emp-btn-deselect:hover {
          color: #047857;
        }

        .emp-btn-bulk-delete {
          display: inline-flex;
          align-items: center;
          gap: 6px;
          padding: 7px 14px;
          border-radius: 8px;
          background: #ef4444;
          color: #ffffff;
          border: none;
          font-size: 12.5px;
          font-weight: 600;
          cursor: pointer;
          transition: all 0.2s ease;
          box-shadow: 0 2px 6px rgba(239, 68, 68, 0.25);
        }

        .emp-btn-bulk-delete:hover {
          background: #dc2626;
          transform: translateY(-1px);
        }

        .emp-code-badge {
          display: inline-block;
          font-family: 'JetBrains Mono', monospace;
          font-size: 12px;
          font-weight: 600;
          color: #0f172a;
          background: #f1f5f9;
          padding: 3px 8px;
          border-radius: 6px;
          border: 1px solid #e2e8f0;
        }

        .emp-name-cell {
          display: flex;
          align-items: center;
          gap: 12px;
        }

        .emp-avatar-circle {
          width: 32px;
          height: 32px;
          border-radius: 50%;
          display: flex;
          align-items: center;
          justify-content: center;
          font-weight: 700;
          font-size: 11.5px;
          flex-shrink: 0;
          background-color: var(--av-bg, #eff6ff);
          color: var(--av-color, #2563eb);
        }

        .emp-name-text {
          font-weight: 600;
          color: #0f172a;
          font-size: 13.5px;
        }

        .emp-email-text,
        .emp-phone-text,
        .emp-desig-text {
          color: #475569;
          font-size: 13px;
        }

        .emp-dept-pill {
          display: inline-block;
          padding: 3px 8px;
          border-radius: 6px;
          background: #f8fafc;
          border: 1px solid #e2e8f0;
          font-size: 12px;
          font-weight: 500;
          color: #334155;
        }

        .emp-status-pill {
          display: inline-flex;
          align-items: center;
          gap: 6px;
          padding: 3px 10px;
          border-radius: 9999px;
          font-size: 11.5px;
          font-weight: 600;
        }

        .emp-status-dot {
          width: 6px;
          height: 6px;
          border-radius: 50%;
        }

        .status-active {
          background: #ecfdf5;
          color: #059669;
          border: 1px solid #a7f3d0;
        }

        .status-active .emp-status-dot {
          background-color: #059669;
        }

        .status-inactive {
          background: #fef2f2;
          color: #dc2626;
          border: 1px solid #fecaca;
        }

        .status-inactive .emp-status-dot {
          background-color: #dc2626;
        }

        .emp-actions-wrap {
          display: flex;
          align-items: center;
          gap: 8px;
        }

        .emp-action-btn {
          width: 32px;
          height: 32px;
          border-radius: 6px;
          border: 1px solid #e2e8f0;
          background: #ffffff;
          display: flex;
          align-items: center;
          justify-content: center;
          cursor: pointer;
          transition: all 0.15s ease;
          color: #64748b;
        }

        .emp-action-btn.view-action:hover {
          border-color: #059669;
          color: #059669;
          background: #ecfdf5;
        }

        .emp-action-btn.edit-action:hover {
          border-color: #d97706;
          color: #d97706;
          background: #fffbeb;
        }

        .emp-action-btn.delete-action:hover {
          border-color: #dc2626;
          color: #dc2626;
          background: #fef2f2;
        }

        /* ── Empty State ── */
        .emp-empty-wrap {
          padding: 64px 20px;
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          text-align: center;
        }

        .emp-empty-icon {
          margin-bottom: 8px;
        }

        .emp-empty-title {
          font-size: 18px;
          font-weight: 700;
          color: #0f172a;
          margin: 8px 0 6px 0;
        }

        .emp-empty-desc {
          font-size: 13.5px;
          color: #64748b;
          margin: 0;
          max-width: 400px;
        }

        /* ── Table Footer & Pagination ── */
        .emp-table-footer {
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding: 16px 4px 4px;
          border-top: 1px solid #f1f5f9;
          margin-top: 8px;
          gap: 12px;
          flex-wrap: wrap;
        }

        .emp-footer-left {
          display: flex;
          align-items: center;
          gap: 16px;
          flex-wrap: wrap;
        }

        .emp-footer-count {
          font-size: 13px;
          color: #64748b;
          font-weight: 500;
        }

        .emp-rows-per-page {
          display: flex;
          align-items: center;
          gap: 8px;
          font-size: 12.5px;
          color: #64748b;
        }

        .emp-per-page-select {
          padding: 4px 8px;
          border-radius: 6px;
          border: 1px solid #cbd5e1;
          background: #ffffff;
          font-size: 12.5px;
          color: #0f172a;
          cursor: pointer;
          outline: none;
        }

        .emp-pagination-controls {
          display: flex;
          align-items: center;
          gap: 6px;
        }

        .emp-page-arrow {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          width: 32px;
          height: 32px;
          border-radius: 8px;
          border: 1px solid #e2e8f0;
          background: #ffffff;
          color: #64748b;
          cursor: pointer;
          transition: all 0.15s ease;
        }

        .emp-page-arrow:hover:not(:disabled) {
          border-color: #059669;
          color: #059669;
          background: #f0fdf4;
        }

        .emp-page-arrow:disabled {
          opacity: 0.4;
          cursor: not-allowed;
        }

        .emp-page-numbers {
          display: flex;
          align-items: center;
          gap: 4px;
        }

        .emp-page-num {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          min-width: 32px;
          height: 32px;
          padding: 0 6px;
          border-radius: 8px;
          border: 1px solid #e2e8f0;
          background: #ffffff;
          color: #334155;
          font-size: 13px;
          font-weight: 600;
          cursor: pointer;
          transition: all 0.15s ease;
        }

        .emp-page-num:hover:not(.active) {
          background: #f8fafc;
          border-color: #cbd5e1;
        }

        .emp-page-num.active {
          background: #059669;
          color: #ffffff;
          border-color: #059669;
          box-shadow: 0 2px 6px rgba(5, 150, 105, 0.25);
        }

        .emp-page-ellipsis {
          padding: 0 4px;
          color: #94a3b8;
          font-size: 14px;
        }

        /* ── Dark Mode Overrides ── */
        .dark .emp-hero-icon-box,
        [data-theme="dark"] .emp-hero-icon-box {
          background: rgba(16, 185, 129, 0.18) !important;
          color: #34d399 !important;
          border: 1px solid rgba(16, 185, 129, 0.35) !important;
          box-shadow: 0 4px 14px rgba(16, 185, 129, 0.25) !important;
        }

        .dark .emp-hero-icon-box svg,
        [data-theme="dark"] .emp-hero-icon-box svg {
          fill: #34d399 !important;
          color: #34d399 !important;
        }

        .dark .emp-search-container,
        [data-theme="dark"] .emp-search-container {
          background: #171b38 !important;
          border-color: rgba(139, 92, 246, 0.25) !important;
        }

        .dark .emp-search-field,
        [data-theme="dark"] .emp-search-field {
          color: #f1f5f9 !important;
        }

        .dark .emp-table-card,
        [data-theme="dark"] .emp-table-card {
          background: #111528 !important;
          border-color: rgba(139, 92, 246, 0.2) !important;
        }

        .dark .emp-custom-table th,
        [data-theme="dark"] .emp-custom-table th {
          background-color: #171b38 !important;
          color: #34d399 !important;
        }

        .dark .emp-custom-table td,
        [data-theme="dark"] .emp-custom-table td {
          border-bottom-color: rgba(139, 92, 246, 0.12) !important;
          color: #cbd5e1 !important;
        }

        .dark .emp-custom-table tr:hover td,
        [data-theme="dark"] .emp-custom-table tr:hover td {
          background-color: #171b38 !important;
        }

        .dark .emp-custom-table tr.selected-row td,
        [data-theme="dark"] .emp-custom-table tr.selected-row td {
          background-color: rgba(16, 185, 129, 0.14) !important;
        }

        .dark .emp-selection-banner,
        [data-theme="dark"] .emp-selection-banner {
          background: rgba(16, 185, 129, 0.12) !important;
          border-color: rgba(16, 185, 129, 0.3) !important;
          color: #34d399 !important;
        }

        .dark .emp-btn-deselect,
        [data-theme="dark"] .emp-btn-deselect {
          color: #34d399 !important;
        }

        .dark .emp-code-badge,
        [data-theme="dark"] .emp-code-badge {
          background: #171b38 !important;
          border-color: rgba(139, 92, 246, 0.25) !important;
          color: #f1f5f9 !important;
        }

        .dark .emp-name-text,
        [data-theme="dark"] .emp-name-text {
          color: #f1f5f9 !important;
        }

        .dark .emp-email-text,
        .dark .emp-phone-text,
        .dark .emp-desig-text,
        [data-theme="dark"] .emp-email-text,
        [data-theme="dark"] .emp-phone-text,
        [data-theme="dark"] .emp-desig-text {
          color: #94a3b8 !important;
        }

        .dark .emp-dept-pill,
        [data-theme="dark"] .emp-dept-pill {
          background: #171b38 !important;
          border-color: rgba(139, 92, 246, 0.25) !important;
          color: #cbd5e1 !important;
        }

        .dark .emp-action-btn,
        [data-theme="dark"] .emp-action-btn {
          background: #171b38 !important;
          border-color: rgba(139, 92, 246, 0.25) !important;
          color: #94a3b8 !important;
        }

        .dark .emp-table-footer,
        [data-theme="dark"] .emp-table-footer {
          border-top-color: rgba(139, 92, 246, 0.16) !important;
        }

        .dark .emp-per-page-select,
        [data-theme="dark"] .emp-per-page-select {
          background: #171b38 !important;
          border-color: rgba(139, 92, 246, 0.25) !important;
          color: #cbd5e1 !important;
        }

        .dark .emp-page-arrow,
        .dark .emp-page-num,
        [data-theme="dark"] .emp-page-arrow,
        [data-theme="dark"] .emp-page-num {
          background: #171b38 !important;
          border-color: rgba(139, 92, 246, 0.25) !important;
          color: #cbd5e1 !important;
        }

        .dark .emp-page-arrow:hover:not(:disabled),
        .dark .emp-page-num:hover:not(.active),
        [data-theme="dark"] .emp-page-arrow:hover:not(:disabled),
        [data-theme="dark"] .emp-page-num:hover:not(.active) {
          background: #23284f !important;
          color: #ffffff !important;
        }

        .dark .emp-page-num.active,
        [data-theme="dark"] .emp-page-num.active {
          background: #059669 !important;
          color: #ffffff !important;
          border-color: #059669 !important;
        }

        .dark .emp-avatar-circle,
        [data-theme="dark"] .emp-avatar-circle {
          background-color: var(--av-dark-bg, #23284f) !important;
          color: var(--av-dark-color, #a7f3d0) !important;
          border: 1px solid rgba(255, 255, 255, 0.14) !important;
        }

        .dark .status-active,
        [data-theme="dark"] .status-active {
          background: rgba(16, 185, 129, 0.16) !important;
          color: #34d399 !important;
          border-color: rgba(16, 185, 129, 0.35) !important;
        }

        .dark .status-inactive,
        [data-theme="dark"] .status-inactive {
          background: rgba(239, 68, 68, 0.16) !important;
          color: #f87171 !important;
          border-color: rgba(239, 68, 68, 0.35) !important;
        }

        .dark select option,
        [data-theme="dark"] select option,
        .dark .emp-per-page-select option,
        [data-theme="dark"] .emp-per-page-select option {
          background-color: #171b38 !important;
          color: #f1f5f9 !important;
        }

        /* ── Quick Filter Tabs (Base) ── */
        .emp-filter-tabs-row {
          display: flex;
          align-items: center;
          gap: 8px;
          margin-top: 12px;
          overflow-x: auto;
          -webkit-overflow-scrolling: touch;
        }

        .emp-filter-tab {
          padding: 6px 14px;
          border-radius: 20px;
          font-size: 12.5px;
          font-weight: 600;
          color: #475569;
          background: #f1f5f9;
          border: 1px solid transparent;
          cursor: pointer;
          display: inline-flex;
          align-items: center;
          gap: 6px;
          transition: all 0.15s ease;
          white-space: nowrap;
        }

        .emp-filter-tab:hover {
          background: #e2e8f0;
          color: #0f172a;
        }

        .emp-filter-tab.active {
          background: #d1fae5;
          color: #047857;
          border-color: #a7f3d0;
          font-weight: 700;
        }

        .emp-filter-tab .tab-count {
          font-size: 11px;
          padding: 1px 7px;
          border-radius: 10px;
          background: rgba(0, 0, 0, 0.06);
        }

        .emp-filter-tab.active .tab-count {
          background: #059669;
          color: #ffffff;
        }

        /* ── Mobile Cards (Base Hidden on Desktop) ── */
        .emp-mobile-cards {
          display: none;
        }

        @media (max-width: 768px) {
          .emp-directory-page {
            padding: 10px 10px 32px !important;
          }

          /* Compact Header Banner */
          .emp-hero-banner {
            padding: 10px 12px !important;
            margin-bottom: 12px !important;
            border-radius: 12px !important;
            flex-direction: row !important;
            align-items: center !important;
            justify-content: space-between !important;
            gap: 10px !important;
          }

          .emp-hero-left {
            display: flex !important;
            flex-direction: row !important;
            align-items: center !important;
            gap: 10px !important;
            min-width: 0 !important;
            flex: 1 !important;
          }

          .emp-hero-icon-box {
            width: 36px !important;
            height: 36px !important;
            border-radius: 10px !important;
          }

          .emp-hero-icon-box svg {
            width: 18px !important;
            height: 18px !important;
          }

          .emp-hero-title {
            font-size: 16px !important;
            margin: 0 !important;
          }

          .emp-hero-subtitle {
            display: none !important;
          }

          .emp-hero-center {
            display: none !important;
          }

          .emp-hero-right {
            width: auto !important;
            flex-shrink: 0 !important;
          }

          .emp-btn-add {
            height: 34px !important;
            padding: 0 12px !important;
            font-size: 12px !important;
            border-radius: 8px !important;
            width: auto !important;
            gap: 5px !important;
          }

          /* Compact Inline Search Form */
          .emp-search-container {
            padding: 10px 12px !important;
            margin-bottom: 12px !important;
            border-radius: 12px !important;
          }

          .emp-search-form {
            display: flex !important;
            flex-direction: row !important;
            align-items: center !important;
            gap: 8px !important;
            width: 100% !important;
          }

          .emp-search-input-wrap {
            flex: 1 !important;
            height: 38px !important;
          }

          .emp-search-field {
            font-size: 12.5px !important;
            padding-left: 36px !important;
          }

          .emp-search-icon {
            width: 16px !important;
            height: 16px !important;
            left: 10px !important;
          }

          .emp-btn-search {
            height: 38px !important;
            padding: 0 12px !important;
            font-size: 12px !important;
            border-radius: 8px !important;
            width: auto !important;
            white-space: nowrap !important;
            flex-shrink: 0 !important;
          }

          /* Filter Tabs */
          .emp-filter-tabs-row {
            display: flex !important;
            align-items: center !important;
            gap: 6px !important;
            margin-top: 8px !important;
            overflow-x: auto !important;
            -webkit-overflow-scrolling: touch !important;
            padding-bottom: 2px !important;
          }

          .emp-filter-tab {
            padding: 4px 10px !important;
            font-size: 11.5px !important;
            border-radius: 16px !important;
          }

          /* Table Card */
          .emp-table-card {
            border-radius: 12px !important;
            padding: 0 !important;
          }

          .emp-count-header {
            padding: 10px 12px !important;
            font-size: 11.5px !important;
          }

          /* Switch Table to Mobile Cards */
          .emp-desktop-table {
            display: none !important;
          }

          .emp-mobile-cards {
            display: flex !important;
            flex-direction: column !important;
            gap: 10px !important;
            padding: 0 12px 12px !important;
          }

          .emp-m-card {
            background: #ffffff;
            border: 1px solid #e2e8f0;
            border-radius: 12px;
            padding: 12px;
            display: flex;
            flex-direction: column;
            gap: 10px;
            box-shadow: 0 1px 3px rgba(0, 0, 0, 0.03);
          }

          .emp-m-card-header {
            display: flex;
            align-items: center;
            justify-content: space-between;
            gap: 10px;
          }

          .emp-m-card-user {
            display: flex;
            align-items: center;
            gap: 10px;
            min-width: 0;
            flex: 1;
          }

          .emp-m-avatar {
            width: 38px;
            height: 38px;
            border-radius: 10px;
            display: flex;
            align-items: center;
            justify-content: center;
            font-size: 13.5px;
            font-weight: 700;
            flex-shrink: 0;
          }

          .emp-m-user-info {
            display: flex;
            flex-direction: column;
            min-width: 0;
            gap: 2px;
          }

          .emp-m-name {
            font-size: 13.5px;
            font-weight: 700;
            color: #0f172a;
            white-space: nowrap;
            overflow: hidden;
            text-overflow: ellipsis;
          }

          .emp-m-meta-row {
            display: flex;
            align-items: center;
            gap: 6px;
            flex-wrap: wrap;
          }

          .emp-m-code {
            font-size: 10.5px;
            font-family: 'JetBrains Mono', monospace;
            font-weight: 700;
            color: #059669;
            background: #d1fae5;
            padding: 1px 5px;
            border-radius: 4px;
          }

          .emp-m-desig {
            font-size: 11px;
            color: #64748b;
            font-weight: 500;
          }

          .emp-m-card-details {
            display: flex;
            flex-direction: column;
            gap: 6px;
            background: #f8fafc;
            border-radius: 8px;
            padding: 8px 10px;
          }

          .emp-m-detail-item {
            display: flex;
            align-items: center;
            justify-content: space-between;
            gap: 8px;
            font-size: 12px;
          }

          .emp-m-detail-lbl {
            color: #64748b;
            font-weight: 600;
            font-size: 10.5px;
            text-transform: uppercase;
            letter-spacing: 0.02em;
          }

          .emp-m-detail-val {
            color: #1e293b;
            font-weight: 500;
            white-space: nowrap;
            overflow: hidden;
            text-overflow: ellipsis;
            max-width: 200px;
          }

          .emp-m-dept {
            background: #eff6ff;
            color: #2563eb;
            font-weight: 600;
            padding: 1px 6px;
            border-radius: 4px;
            font-size: 11px;
          }

          .emp-m-card-actions {
            display: grid;
            grid-template-columns: repeat(3, 1fr);
            gap: 8px;
            padding-top: 4px;
            border-top: 1px solid #f1f5f9;
          }

          .emp-m-btn {
            height: 32px;
            border-radius: 6px;
            font-size: 12px;
            font-weight: 600;
            display: inline-flex;
            align-items: center;
            justify-content: center;
            gap: 5px;
            cursor: pointer;
            transition: all 0.15s ease;
          }

          .emp-m-btn-view {
            background: #f0fdf4;
            border: 1px solid #bbf7d0;
            color: #059669;
          }

          .emp-m-btn-edit {
            background: #eff6ff;
            border: 1px solid #bfdbfe;
            color: #2563eb;
          }

          .emp-m-btn-delete {
            background: #fef2f2;
            border: 1px solid #fecaca;
            color: #dc2626;
          }

          .emp-table-footer {
            padding: 10px 12px !important;
            flex-direction: column !important;
            gap: 8px !important;
            align-items: center !important;
          }
        }

        /* Dark Theme Support for Mobile Cards & Tabs */
        [data-theme="dark"] .emp-m-card,
        .dark .emp-m-card {
          background: #111528 !important;
          border-color: rgba(139, 92, 246, 0.22) !important;
        }

        [data-theme="dark"] .emp-m-name,
        .dark .emp-m-name {
          color: #ffffff !important;
        }

        [data-theme="dark"] .emp-m-card-details,
        .dark .emp-m-card-details {
          background: #171b38 !important;
          border: 1px solid rgba(139, 92, 246, 0.15) !important;
        }

        [data-theme="dark"] .emp-m-detail-lbl,
        .dark .emp-m-detail-lbl {
          color: #94a3b8 !important;
        }

        [data-theme="dark"] .emp-m-detail-val,
        .dark .emp-m-detail-val {
          color: #f1f5f9 !important;
        }

        [data-theme="dark"] .emp-m-dept,
        .dark .emp-m-dept {
          background: rgba(59, 130, 246, 0.2) !important;
          color: #93c5fd !important;
        }

        [data-theme="dark"] .emp-m-card-actions,
        .dark .emp-m-card-actions {
          border-top-color: rgba(255, 255, 255, 0.08) !important;
        }

        [data-theme="dark"] .emp-m-btn-view,
        .dark .emp-m-btn-view {
          background: rgba(16, 185, 129, 0.15) !important;
          border-color: rgba(16, 185, 129, 0.3) !important;
          color: #34d399 !important;
        }

        [data-theme="dark"] .emp-m-btn-edit,
        .dark .emp-m-btn-edit {
          background: rgba(59, 130, 246, 0.15) !important;
          border-color: rgba(59, 130, 246, 0.3) !important;
          color: #60a5fa !important;
        }

        [data-theme="dark"] .emp-m-btn-delete,
        .dark .emp-m-btn-delete {
          background: rgba(239, 68, 68, 0.15) !important;
          border-color: rgba(239, 68, 68, 0.3) !important;
          color: #fca5a5 !important;
        }

        [data-theme="dark"] .emp-filter-tab,
        .dark .emp-filter-tab {
          background: #171b38 !important;
          color: #94a3b8 !important;
        }

        [data-theme="dark"] .emp-filter-tab.active,
        .dark .emp-filter-tab.active {
          background: rgba(16, 185, 129, 0.2) !important;
          border-color: rgba(16, 185, 129, 0.35) !important;
          color: #34d399 !important;
        }
      `}</style>
    </div>
  );
};

export default EmployeeList;
