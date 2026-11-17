import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { getAllEnrollments, deleteEnrollment } from './face-enrollment.service';
import { getEmployees } from '../employee/employee.service';
import Loader from '../../components/common/Loader';
import Modal from '../../components/common/Modal';

const FaceEnrollmentList = () => {
  const navigate = useNavigate();
  const [enrollments, setEnrollments] = useState([]);
  const [allEmployees, setAllEmployees] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [activeTab, setActiveTab] = useState('ALL'); // 'ALL' | 'REGISTERED' | 'NOT_REGISTERED' | 'PENDING'
  const [isFilterDropdownOpen, setIsFilterDropdownOpen] = useState(false);
  const filterDropdownRef = useRef(null);
  const [selectedIds, setSelectedIds] = useState([]);
  const [sortField, setSortField] = useState('ID');
  const [sortAsc, setSortAsc] = useState(true);
  const enrollmentFetchInProgress = useRef(false);

  // Close filter dropdown on click outside
  useEffect(() => {
    const handleClickOutside = (event) => {
      if (filterDropdownRef.current && !filterDropdownRef.current.contains(event.target)) {
        setIsFilterDropdownOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Scan Logs Modal State (Grid Box View)
  const [logsModal, setLogsModal] = useState({
    isOpen: false,
    enrollment: null,
  });
  const [scanFilter, setScanFilter] = useState('ALL'); // 'ALL' | 'IN' | 'OUT'

  // Delete Confirmation Modal State
  const [deleteModal, setDeleteModal] = useState({
    isOpen: false,
    enrollment: null,
    loading: false,
  });

  const fetchEnrollments = useCallback(async (isInitial = false) => {
    if (enrollmentFetchInProgress.current) return;
    enrollmentFetchInProgress.current = true;
    if (isInitial) setLoading(true);
    if (isInitial) setError('');
    try {
      const enrollRes = await getAllEnrollments();
      setEnrollments(enrollRes.data || []);
    } catch (err) {
      if (isInitial) {
        setError(err.response?.data?.message || 'Failed to fetch face enrollments.');
      }
    } finally {
      enrollmentFetchInProgress.current = false;
      if (isInitial) setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchEnrollments(true);
    let mounted = true;
    getEmployees()
      .then((response) => {
        if (mounted) setAllEmployees(response.data || []);
      })
      .catch(() => {});
    // Real-time polling so camera detections immediately reflect in scans count and recent detections
    const interval = setInterval(() => {
      fetchEnrollments(false);
    }, 5000);
    return () => {
      mounted = false;
      clearInterval(interval);
    };
  }, [fetchEnrollments]);

  // Format Helpers
  const formatDate = (dateStr) => {
    if (!dateStr) return '—';
    try {
      const d = new Date(dateStr);
      if (isNaN(d.getTime())) return '—';
      return d.toLocaleDateString('en-GB', {
        day: '2-digit',
        month: 'short',
        year: 'numeric',
      });
    } catch (e) {
      return '—';
    }
  };

  const formatTime = (dateStr) => {
    if (!dateStr) return '—';
    try {
      const d = new Date(dateStr);
      if (isNaN(d.getTime())) return '—';
      return d.toLocaleTimeString('en-US', {
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: true,
      });
    } catch (e) {
      return '—';
    }
  };

  const formatDateTime = (dateStr) => {
    if (!dateStr) return 'Never Scanned';
    try {
      const d = new Date(dateStr);
      if (isNaN(d.getTime())) return 'Never Scanned';
      const isToday = new Date().toDateString() === d.toDateString();
      const time = d.toLocaleTimeString('en-US', {
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: true,
      });
      if (isToday) return `Today, ${time}`;
      return `${formatDate(dateStr)}, ${time}`;
    } catch (e) {
      return '—';
    }
  };

  // Helper: check if employee scanned today
  const isScannedToday = (enrollment) => {
    const latest = enrollment.employee?.attendances?.[0];
    if (!latest || !latest.timestamp) return false;
    const d = new Date(latest.timestamp);
    return new Date().toDateString() === d.toDateString();
  };

  // Metrics & Derived Sets
  const enrolledEmpIds = useMemo(() => {
    return new Set(enrollments.map((e) => e.employeeId || e.employee?.id).filter(Boolean));
  }, [enrollments]);

  const unregisteredEmployees = useMemo(() => {
    return allEmployees.filter((emp) => !enrolledEmpIds.has(emp.id));
  }, [allEmployees, enrolledEmpIds]);

  const totalRegistered = enrollments.length;
  const totalUnregistered = unregisteredEmployees.length;
  const totalAllCount = allEmployees.length > 0 ? allEmployees.length : totalRegistered;
  const scannedTodayCount = enrollments.filter(isScannedToday).length;
  const notScannedTodayCount = totalRegistered - scannedTodayCount;
  const totalScansCount = enrollments.reduce(
    (acc, e) => acc + (e.employee?.attendances?.length || 0),
    0
  );

  // Sorting and Filtering
  const handleSort = (field) => {
    if (sortField === field) {
      setSortAsc(!sortAsc);
    } else {
      setSortField(field);
      setSortAsc(true);
    }
  };

  const filteredEnrollments = useMemo(() => {
    let baseList = [];
    if (activeTab === 'NOT_REGISTERED') {
      baseList = unregisteredEmployees.map((emp) => ({
        id: `unreg-${emp.id}`,
        isUnregistered: true,
        employeeId: emp.id,
        employee: emp,
        createdAt: null,
        images: null,
      }));
    } else if (activeTab === 'REGISTERED') {
      baseList = enrollments;
    } else if (activeTab === 'PENDING') {
      baseList = enrollments.filter((item) => !isScannedToday(item));
    } else {
      // 'ALL'
      baseList = enrollments;
    }

    return baseList.filter((item) => {
      // Search query filter
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase().trim();
        const code = (item.employee?.employeeCode || '').toLowerCase();
        const firstName = (item.employee?.firstName || '').toLowerCase();
        const lastName = (item.employee?.lastName || '').toLowerCase();
        const fullName = `${firstName} ${lastName}`.trim();
        const dept = (item.employee?.department || '').toLowerCase();
        const desig = (item.employee?.designation || '').toLowerCase();
        return (
          code.includes(q) ||
          fullName.includes(q) ||
          dept.includes(q) ||
          desig.includes(q)
        );
      }
      return true;
    }).sort((a, b) => {
      let valA = '';
      let valB = '';

      switch (sortField) {
        case 'ID':
          valA = a.employee?.employeeCode || '';
          valB = b.employee?.employeeCode || '';
          break;
        case 'NAME':
          valA = `${a.employee?.firstName || ''} ${a.employee?.lastName || ''}`;
          valB = `${b.employee?.firstName || ''} ${b.employee?.lastName || ''}`;
          break;
        case 'DEPT':
          valA = a.employee?.department || '';
          valB = b.employee?.department || '';
          break;
        case 'DESIG':
          valA = a.employee?.designation || '';
          valB = b.employee?.designation || '';
          break;
        case 'SCANS':
          valA = a.employee?.attendances?.length || 0;
          valB = b.employee?.attendances?.length || 0;
          return sortAsc ? valA - valB : valB - valA;
        case 'LAST_SEEN':
          valA = a.employee?.attendances?.[0]?.timestamp || '';
          valB = b.employee?.attendances?.[0]?.timestamp || '';
          break;
        case 'DATE':
          valA = a.createdAt || '';
          valB = b.createdAt || '';
          break;
        default:
          break;
      }

      if (valA < valB) return sortAsc ? -1 : 1;
      if (valA > valB) return sortAsc ? 1 : -1;
      return 0;
    });
  }, [enrollments, unregisteredEmployees, activeTab, searchQuery, sortField, sortAsc]);

  // Checkbox handlers
  const handleSelectAll = (e) => {
    if (e.target.checked) {
      setSelectedIds(filteredEnrollments.map((item) => item.id));
    } else {
      setSelectedIds([]);
    }
  };

  const handleSelectRow = (id) => {
    setSelectedIds((prev) =>
      prev.includes(id) ? prev.filter((rowId) => rowId !== id) : [...prev, id]
    );
  };

  // Open & Close Logs Modal
  const openLogsModal = (enrollment) => {
    setLogsModal({ isOpen: true, enrollment });
    setScanFilter('ALL');
  };

  const closeLogsModal = () => {
    setLogsModal({ isOpen: false, enrollment: null });
  };

  // Open & Close Delete Modal
  const openDeleteModal = (enrollment) => {
    setDeleteModal({ isOpen: true, enrollment, loading: false });
  };

  const closeDeleteModal = () => {
    setDeleteModal({ isOpen: false, enrollment: null, loading: false });
  };

  const handleDeleteConfirm = async () => {
    if (!deleteModal.enrollment) return;
    setDeleteModal((prev) => ({ ...prev, loading: true }));
    try {
      await deleteEnrollment(deleteModal.enrollment.id);
      closeDeleteModal();
      fetchEnrollments(false);
    } catch (err) {
      alert(err.response?.data?.message || 'Failed to delete face enrollment.');
      setDeleteModal((prev) => ({ ...prev, loading: false }));
    }
  };

  // Active Logs Modal Target Details
  const activeEmp = logsModal.enrollment?.employee;
  const activeEmpName = activeEmp
    ? `${activeEmp.firstName} ${activeEmp.lastName || ''}`.trim()
    : 'Employee';
  const activeScans = activeEmp?.attendances || [];
  const inScans = activeScans.filter((s) => s.eventType === 'IN' || (!s.eventType && s.camera?.location?.toUpperCase().includes('IN')));
  const outScans = activeScans.filter((s) => s.eventType === 'OUT' || (!s.eventType && s.camera?.location?.toUpperCase().includes('OUT')));
  const displayedScans =
    scanFilter === 'IN' ? inScans : scanFilter === 'OUT' ? outScans : activeScans;

  return (
    <div className="face-registry-page fade-in">
      {/* ── 1. PAGE HEADER ─────────────────────────────────────────────── */}
      <div className="face-reg-header">
        <div className="face-reg-header-left">
          <div className="face-reg-icon-box">
            <svg viewBox="0 0 24 24" width="26" height="26" fill="none" stroke="#059669" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M4 8V5a1 1 0 0 1 1-1h3" />
              <path d="M16 4h3a1 1 0 0 1 1 1v3" />
              <path d="M4 16v3a1 1 0 0 0 1 1h3" />
              <path d="M16 20h3a1 1 0 0 0 1-1v-3" />
              <circle cx="12" cy="11" r="3" />
              <path d="M8.5 17c.8-1.5 2.1-2 3.5-2s2.7.5 3.5 2" />
            </svg>
          </div>
          <div className="face-reg-header-text">
            <h1 className="face-reg-title">Face Registry</h1>
            <p className="face-reg-subtitle">
              Manage registered employee face profiles.
            </p>
          </div>
        </div>

        </div>

      {error && <div className="alert alert-danger" style={{ marginBottom: '20px' }}>{error}</div>}

      {/* ── 2. SEARCH BAR & FILTER BUTTONS ROW ───────────────────────── */}
      <div className="face-search-filters-bar">
        {/* Search Field */}
        <div className="face-search-input-wrap">
          <svg className="face-search-icon" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="#64748b" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="11" cy="11" r="8" />
            <line x1="21" y1="21" x2="16.65" y2="16.65" />
          </svg>
          <input
            type="text"
            placeholder="Search by employee name, code, department or designation..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="face-search-field"
          />
          {searchQuery && (
            <button
              type="button"
              className="face-search-clear-btn"
              onClick={() => setSearchQuery('')}
            >
              <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <line x1="18" y1="6" x2="6" y2="18" />
                <line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button>
          )}
        </div>

        {/* Right Filter Actions: All, Registered, Unregistered, Pending under the Filters dropdown */}
        <div className="face-filter-dropdown-container" ref={filterDropdownRef}>
          {activeTab !== 'ALL' && (
            <div className="face-active-filter-chip">
              <span className="active-chip-dot" />
              <span>
                {activeTab === 'REGISTERED' && `Registered (${totalRegistered})`}
                {activeTab === 'NOT_REGISTERED' && `Unregistered (${totalUnregistered})`}
                {activeTab === 'PENDING' && `Pending (${notScannedTodayCount})`}
              </span>
              <button
                type="button"
                className="chip-clear-btn"
                onClick={() => setActiveTab('ALL')}
                title="Reset filter to All"
              >
                ✕
              </button>
            </div>
          )}

          <button
            type="button"
            className={`face-filter-dropdown-btn ${isFilterDropdownOpen ? 'open' : ''} ${activeTab !== 'ALL' ? 'active-filter' : ''}`}
            onClick={() => setIsFilterDropdownOpen(!isFilterDropdownOpen)}
            title="Filter by status"
          >
            <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3" />
            </svg>
            <span>
              {activeTab === 'ALL' && 'Filters'}
              {activeTab === 'REGISTERED' && 'Registered'}
              {activeTab === 'NOT_REGISTERED' && 'Unregistered'}
              {activeTab === 'PENDING' && 'Pending'}
            </span>
            <svg
              viewBox="0 0 24 24"
              width="13"
              height="13"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.5"
              strokeLinecap="round"
              strokeLinejoin="round"
              style={{
                transform: isFilterDropdownOpen ? 'rotate(180deg)' : 'rotate(0deg)',
                transition: 'transform 0.18s ease',
              }}
            >
              <polyline points="6 9 12 15 18 9" />
            </svg>
          </button>

          {/* Floating Dropdown Menu Placed Directly Under the Filter Button */}
          {isFilterDropdownOpen && (
            <div className="face-filter-menu-popover fade-in">
              <div className="filter-menu-header">
                <span className="filter-menu-title">STATUS FILTERS</span>
                {activeTab !== 'ALL' && (
                  <button
                    type="button"
                    className="filter-menu-reset-btn"
                    onClick={() => {
                      setActiveTab('ALL');
                      setIsFilterDropdownOpen(false);
                    }}
                  >
                    Reset
                  </button>
                )}
              </div>

              <div className="filter-menu-options-list">
                {/* 1. All */}
                <button
                  type="button"
                  className={`filter-menu-option-item ${activeTab === 'ALL' ? 'selected' : ''}`}
                  onClick={() => {
                    setActiveTab('ALL');
                    setIsFilterDropdownOpen(false);
                  }}
                >
                  <div className="option-item-left">
                    <span className="filter-option-dot dot-all" />
                    <span className="filter-option-name">All Employees</span>
                  </div>
                  <span className="filter-option-badge badge-all">{totalAllCount}</span>
                </button>

                {/* 2. Registered */}
                <button
                  type="button"
                  className={`filter-menu-option-item ${activeTab === 'REGISTERED' ? 'selected' : ''}`}
                  onClick={() => {
                    setActiveTab('REGISTERED');
                    setIsFilterDropdownOpen(false);
                  }}
                >
                  <div className="option-item-left">
                    <span className="filter-option-dot dot-registered" />
                    <span className="filter-option-name">Registered</span>
                  </div>
                  <span className="filter-option-badge badge-registered">{totalRegistered}</span>
                </button>

                {/* 3. Unregistered */}
                <button
                  type="button"
                  className={`filter-menu-option-item ${activeTab === 'NOT_REGISTERED' ? 'selected' : ''}`}
                  onClick={() => {
                    setActiveTab('NOT_REGISTERED');
                    setIsFilterDropdownOpen(false);
                  }}
                >
                  <div className="option-item-left">
                    <span className="filter-option-dot dot-unregistered" />
                    <span className="filter-option-name">Unregistered</span>
                  </div>
                  <span className="filter-option-badge badge-unregistered">{totalUnregistered}</span>
                </button>

                {/* 4. Pending */}
                <button
                  type="button"
                  className={`filter-menu-option-item ${activeTab === 'PENDING' ? 'selected' : ''}`}
                  onClick={() => {
                    setActiveTab('PENDING');
                    setIsFilterDropdownOpen(false);
                  }}
                >
                  <div className="option-item-left">
                    <span className="filter-option-dot dot-pending" />
                    <span className="filter-option-name">Pending Today</span>
                  </div>
                  <span className="filter-option-badge badge-pending">{notScannedTodayCount}</span>
                </button>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* ── 4. TABLE CARD CONTAINER ───────────────────────────────────── */}
      <div className="face-table-card">
        {loading && enrollments.length === 0 ? (
          <div style={{ padding: '60px 0' }}>
            <Loader message="Loading face registry records..." />
          </div>
        ) : (
          <div className="table-responsive" style={{ overflowX: 'auto', width: '100%' }}>
            <table className="face-custom-table">
              <thead>
                <tr>
                  <th onClick={() => handleSort('ID')} style={{ cursor: 'pointer', width: '13%' }}>
                    <div className="face-th-content">
                      <span>ID</span>
                      <svg width="10" height="12" viewBox="0 0 10 12" fill="none" className="sort-arrows">
                        <path d="M5 2L2 5h6L5 2z" fill="#047857" opacity={sortField === 'ID' && sortAsc ? 1 : 0.4} />
                        <path d="M5 10l3-3H2l3 3z" fill="#047857" opacity={sortField === 'ID' && !sortAsc ? 1 : 0.4} />
                      </svg>
                    </div>
                  </th>
                  <th onClick={() => handleSort('NAME')} style={{ cursor: 'pointer', width: '25%' }}>
                    <div className="face-th-content">
                      <span>EMPLOYEE NAME</span>
                      <svg width="10" height="12" viewBox="0 0 10 12" fill="none" className="sort-arrows">
                        <path d="M5 2L2 5h6L5 2z" fill="#047857" opacity={sortField === 'NAME' && sortAsc ? 1 : 0.4} />
                        <path d="M5 10l3-3H2l3 3z" fill="#047857" opacity={sortField === 'NAME' && !sortAsc ? 1 : 0.4} />
                      </svg>
                    </div>
                  </th>
                  <th onClick={() => handleSort('DEPT')} style={{ cursor: 'pointer', width: '18%' }}>
                    <div className="face-th-content">
                      <span>DEPARTMENT</span>
                      <svg width="10" height="12" viewBox="0 0 10 12" fill="none" className="sort-arrows">
                        <path d="M5 2L2 5h6L5 2z" fill="#047857" opacity={sortField === 'DEPT' && sortAsc ? 1 : 0.4} />
                        <path d="M5 10l3-3H2l3 3z" fill="#047857" opacity={sortField === 'DEPT' && !sortAsc ? 1 : 0.4} />
                      </svg>
                    </div>
                  </th>
                  <th onClick={() => handleSort('DESIG')} style={{ cursor: 'pointer', width: '18%' }}>
                    <div className="face-th-content">
                      <span>DESIGNATION</span>
                      <svg width="10" height="12" viewBox="0 0 10 12" fill="none" className="sort-arrows">
                        <path d="M5 2L2 5h6L5 2z" fill="#047857" opacity={sortField === 'DESIG' && sortAsc ? 1 : 0.4} />
                        <path d="M5 10l3-3H2l3 3z" fill="#047857" opacity={sortField === 'DESIG' && !sortAsc ? 1 : 0.4} />
                      </svg>
                    </div>
                  </th>
                  <th onClick={() => handleSort('DATE')} style={{ cursor: 'pointer', width: '14%' }}>
                    <div className="face-th-content">
                      <span>REGISTERED ON</span>
                      <svg width="10" height="12" viewBox="0 0 10 12" fill="none" className="sort-arrows">
                        <path d="M5 2L2 5h6L5 2z" fill="#047857" opacity={sortField === 'DATE' && sortAsc ? 1 : 0.4} />
                        <path d="M5 10l3-3H2l3 3z" fill="#047857" opacity={sortField === 'DATE' && !sortAsc ? 1 : 0.4} />
                      </svg>
                    </div>
                  </th>
                  <th style={{ width: '12%' }}>
                    <div className="face-th-content">
                      <span>STATUS</span>
                    </div>
                  </th>
                  <th style={{ width: '10%', textAlign: 'center' }}>ACTIONS</th>
                </tr>
              </thead>
              <tbody>
                {filteredEnrollments.length === 0 ? (
                  <tr>
                    <td colSpan={7} style={{ padding: 0 }}>
                      <div className="face-empty-wrap">
                        <div className="face-empty-icon">
                          <svg width="60" height="60" viewBox="0 0 24 24" fill="none" stroke="#10b981" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
                            <path d="M4 8V5a1 1 0 0 1 1-1h3" />
                            <path d="M16 4h3a1 1 0 0 1 1 1v3" />
                            <path d="M4 16v3a1 1 0 0 0 1 1h3" />
                            <path d="M16 20h3a1 1 0 0 0 1-1v-3" />
                            <circle cx="12" cy="11" r="3" />
                            <path d="M8.5 17c.8-1.5 2.1-2 3.5-2s2.7.5 3.5 2" />
                          </svg>
                        </div>
                        <h3 className="face-empty-title">
                          {searchQuery || activeTab !== 'ALL'
                            ? 'No face enrollments match your criteria.'
                            : 'No employee face enrollments registered yet.'}
                        </h3>
                        <p className="face-empty-desc">
                          {searchQuery || activeTab !== 'ALL'
                            ? 'Try clearing the search query or changing your filter.'
                            : 'Registered employee face profiles will appear here.'}
                        </p>
                      </div>
                    </td>
                  </tr>
                ) : (
                  filteredEnrollments.map((row, idx) => {
                    const emp = row.employee;
                    const empName = emp
                      ? `${emp.firstName} ${emp.lastName || ''}`.trim()
                      : '—';
                    const initials = emp?.firstName?.[0] || 'E';

                    const avatarColorStyles = [
                      { bg: '#eff6ff', color: '#2563eb' },
                      { bg: '#fef2f2', color: '#dc2626' },
                      { bg: '#fffbeb', color: '#d97706' },
                      { bg: '#f5f3ff', color: '#7c3aed' },
                    ];
                    const avStyle = avatarColorStyles[idx % avatarColorStyles.length];

                    return (
                      <tr key={row.id || idx}>
                        <td>
                          <span className="face-code-badge">{emp?.employeeCode || '—'}</span>
                        </td>
                        <td>
                          <div
                            className="face-name-cell"
                            onClick={() => !row.isUnregistered && navigate(`/face-enrollments/${row.id}`)}
                            title={row.isUnregistered ? empName : "Click to view face profile"}
                            style={{ cursor: row.isUnregistered ? 'default' : 'pointer' }}
                          >
                            {row.images?.front ? (
                              <img
                                src={row.images.front}
                                alt={empName}
                                className="face-avatar-img"
                              />
                            ) : (
                              <div
                                className="face-avatar-circle"
                                style={{ backgroundColor: avStyle.bg, color: avStyle.color }}
                              >
                                {initials}
                              </div>
                            )}
                            <div className="face-name-meta">
                              <span className="face-name-text">{empName}</span>
                            </div>
                          </div>
                        </td>
                        <td>
                          <span className="face-dept-pill">{emp?.department || '—'}</span>
                        </td>
                        <td>
                          <span className="face-desig-text">{emp?.designation || '—'}</span>
                        </td>
                        <td>
                          <span className="face-date-text">
                            {row.isUnregistered ? '—' : formatDate(row.createdAt)}
                          </span>
                        </td>
                        <td>
                          {row.isUnregistered ? (
                            <span className="face-status-pill status-unregistered">
                              <span className="face-status-dot dot-unreg" />
                              <span>Not Enrolled</span>
                            </span>
                          ) : (
                            <span className="face-status-pill status-active">
                              <span className="face-status-dot" />
                              <span>Active</span>
                            </span>
                          )}
                        </td>
                        <td>
                          <div className="face-actions-wrap" style={{ justifyContent: 'center' }}>
                            {row.isUnregistered ? (
                              <span style={{ color: '#94a3b8', fontSize: '13px' }}>—</span>
                            ) : (
                              <>
                                <button
                                  className="face-action-btn details-action"
                                  title="View Face Profile"
                                  onClick={() => navigate(`/face-enrollments/${row.id}`)}
                                >
                                  <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                    <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
                                    <circle cx="12" cy="12" r="3" />
                                  </svg>
                                </button>
                                <button
                                  className="face-action-btn delete-action"
                                  title="Delete Face Enrollment"
                                  onClick={() => openDeleteModal(row)}
                                >
                                  <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
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
        )}

        {/* Table Footer */}
        <div className="face-table-footer">
          <span className="face-footer-count">
            Showing {filteredEnrollments.length} of {filteredEnrollments.length} records
          </span>

          <div className="face-pagination">
            <button type="button" className="face-page-arrow" disabled>
              <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="15 18 9 12 15 6" />
              </svg>
            </button>
            <button type="button" className="face-page-num active">
              1
            </button>
            <button type="button" className="face-page-arrow" disabled>
              <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="9 18 15 12 9 6" />
              </svg>
            </button>
          </div>
        </div>
      </div>

      {/* ── 5. CAMERA SCAN LOGS MODAL (GRID BOX VIEW) ──────────────────── */}
      <Modal
        isOpen={logsModal.isOpen}
        title={`Camera Scan Logs — ${activeEmpName} (${activeEmp?.employeeCode || 'N/A'})`}
        onClose={closeLogsModal}
        cancelText="Close"
        className="scan-modal-dialog modal-lg"
      >
        <div className="scan-modal-container">
          {/* 1. Header Summary Banner */}
          <div className="scan-logs-summary">
            <div className="scan-summary-info">
              <div className="scan-summary-label">Camera Detections Overview</div>
              <div className="scan-summary-value">
                {activeScans.length} {activeScans.length === 1 ? 'Scan Recorded' : 'Scans Recorded'}
              </div>
              <div className="scan-summary-chips">
                <span className="scan-chip chip-in">
                  <span className="scan-chip-dot in" />
                  <span>{inScans.length} IN (Entry)</span>
                </span>
                <span className="scan-chip chip-out">
                  <span className="scan-chip-dot out" />
                  <span>{outScans.length} OUT (Exit)</span>
                </span>
              </div>
            </div>

            {activeScans[0] && (
              <div className="scan-summary-latest">
                <div className="scan-summary-label">Latest Detection Event</div>
                <div className="scan-summary-time">{formatDateTime(activeScans[0].timestamp)}</div>
                <div className="scan-summary-sub">
                  <span className={`scan-type-tag ${activeScans[0].eventType === 'OUT' ? 'tag-out' : 'tag-in'}`}>
                    {activeScans[0].eventType === 'OUT' ? '↑ OUT' : '↓ IN'}
                  </span>
                  <span>{activeScans[0].camera?.name || (activeScans[0].eventType === 'OUT' ? 'CAM-02' : 'CAM-01')}</span>
                  {activeScans[0].camera?.location && <span>({activeScans[0].camera.location})</span>}
                </div>
              </div>
            )}

            <div className="scan-summary-badge-wrap">
              <span className="face-status-pill status-active">
                <span className="face-status-dot" />
                <span>RECOGNITION ACTIVE</span>
              </span>
            </div>
          </div>

          {/* 2. Separate IN / OUT Filter Tabs */}
          <div className="scan-tabs-bar">
            <button
              type="button"
              className={`scan-tab-btn ${scanFilter === 'ALL' ? 'active' : ''}`}
              onClick={() => setScanFilter('ALL')}
            >
              <span>All Scans</span>
              <span className="scan-tab-count">{activeScans.length}</span>
            </button>
            <button
              type="button"
              className={`scan-tab-btn tab-in ${scanFilter === 'IN' ? 'active' : ''}`}
              onClick={() => setScanFilter('IN')}
            >
              <span className="scan-tab-arrow">↓</span>
              <span>IN / Entry</span>
              <span className="scan-tab-count count-in">{inScans.length}</span>
            </button>
            <button
              type="button"
              className={`scan-tab-btn tab-out ${scanFilter === 'OUT' ? 'active' : ''}`}
              onClick={() => setScanFilter('OUT')}
            >
              <span className="scan-tab-arrow">↑</span>
              <span>OUT / Exit</span>
              <span className="scan-tab-count count-out">{outScans.length}</span>
            </button>
          </div>

          {/* 3. Clean Table Format */}
          {displayedScans.length === 0 ? (
            <div className="scan-empty-state">
              <h4>No {scanFilter === 'IN' ? 'IN (Entry)' : scanFilter === 'OUT' ? 'OUT (Exit)' : 'Camera'} Scans Found</h4>
              <p>No detection records match the current filter for this employee.</p>
            </div>
          ) : (
            <div className="scan-table-wrapper">
              <table className="scan-table">
                <thead>
                  <tr>
                    <th style={{ width: '50px', textAlign: 'center' }}>S.No</th>
                    <th style={{ width: '140px' }}>Direction</th>
                    <th>Date</th>
                    <th>Time</th>
                    <th>Camera / Location</th>
                    <th>Match</th>
                    <th style={{ textAlign: 'center' }}>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {displayedScans.map((scan, idx) => {
                    const scanNumber = activeScans.length - activeScans.indexOf(scan);
                    const isExit =
                      scan.eventType === 'OUT' ||
                      (!scan.eventType && scan.camera?.location?.toUpperCase().includes('OUT'));

                    return (
                      <tr key={scan.id || idx} className={isExit ? 'row-out' : 'row-in'}>
                        <td style={{ textAlign: 'center' }}>
                          <span className="scan-row-index">{scanNumber}</span>
                        </td>
                        <td>
                          <span className={`scan-dir-pill ${isExit ? 'pill-out' : 'pill-in'}`}>
                            <span className="scan-dir-arrow">{isExit ? '↑' : '↓'}</span>
                            <span>{isExit ? 'OUT (EXIT)' : 'IN (ENTRY)'}</span>
                          </span>
                        </td>
                        <td>
                          <span className="scan-cell-date">{formatDate(scan.timestamp)}</span>
                        </td>
                        <td>
                          <span className={`scan-cell-time ${isExit ? 'time-out' : 'time-in'}`}>
                            {formatTime(scan.timestamp)}
                          </span>
                        </td>
                        <td>
                          <div className="scan-cell-cam">
                            <span className="scan-cam-name">
                              {scan.camera?.name || (isExit ? 'CAM-02' : 'CAM-01')}
                            </span>
                            <span className="scan-cam-loc">
                              {scan.camera?.location || (isExit ? 'Exit Gate' : 'Entrance Gate')}
                            </span>
                          </div>
                        </td>
                        <td>
                          <span className="scan-cell-match">
                            {Math.round((scan.similarity || 0.75) * 100)}%
                          </span>
                        </td>
                        <td style={{ textAlign: 'center' }}>
                          <span className="scan-status-pill status-present">
                            <span className="scan-status-dot" />
                            <span>{scan.status || 'PRESENT'}</span>
                          </span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </Modal>

      {/* ── 6. DELETE CONFIRMATION MODAL ──────────────────────────────── */}
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
          Are you sure you want to delete the face enrollment record for{' '}
          <strong>
            {deleteModal.enrollment?.employee?.firstName} {deleteModal.enrollment?.employee?.lastName} (
            {deleteModal.enrollment?.employee?.employeeCode})
          </strong>
          ?
        </p>
      </Modal>

      {/* ── 7. SCOPED STYLES ──────────────────────────────────────────── */}
      <style>{`
        .face-registry-page {
          max-width: 1400px;
          margin: 0 auto;
          padding: 24px 28px 48px;
          width: 100%;
          box-sizing: border-box;
          overflow-x: hidden;
        }

        /* ── Header ── */
        .face-reg-header {
          display: flex;
          align-items: center;
          justify-content: space-between;
          margin-bottom: 24px;
          gap: 16px;
          flex-wrap: wrap;
        }

        .face-reg-header-left {
          display: flex;
          align-items: center;
          gap: 18px;
        }

        .face-reg-icon-box {
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

        .face-reg-header-text {
          display: flex;
          flex-direction: column;
        }

        .face-reg-title {
          font-size: 26px;
          font-weight: 800;
          color: #0f172a;
          letter-spacing: -0.01em;
          margin: 0 0 4px 0;
          line-height: 1.2;
        }

        .face-reg-subtitle {
          font-size: 14px;
          color: #475569;
          margin: 0;
          font-weight: 500;
        }

        .face-reg-header-right {
          display: flex;
          align-items: center;
          gap: 12px;
          flex-wrap: wrap;
        }

        .face-reg-btn-refresh {
          height: 42px;
          padding: 0 18px;
          border-radius: 10px;
          background: #ffffff;
          color: #334155;
          border: 1px solid #e2e8f0;
          font-size: 13.5px;
          font-weight: 600;
          display: inline-flex;
          align-items: center;
          gap: 8px;
          cursor: pointer;
          transition: all 0.2s ease;
          box-shadow: 0 1px 3px rgba(0, 0, 0, 0.04);
        }

        .face-reg-btn-refresh:hover:not(:disabled) {
          background: #f8fafc;
          border-color: #cbd5e1;
          transform: translateY(-1px);
        }

        .face-reg-btn-enroll {
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

        .face-reg-btn-enroll:hover {
          opacity: 0.95;
          transform: translateY(-1px);
          box-shadow: 0 6px 16px rgba(16, 185, 129, 0.38);
        }

        /* ── 4 Executive Stat Cards ── */
        .face-stat-cards-grid {
          display: grid;
          grid-template-columns: repeat(4, 1fr);
          gap: 16px;
          margin-bottom: 24px;
        }

        .face-stat-card {
          background: #ffffff;
          border: 1px solid #e2ece8;
          border-radius: 16px;
          padding: 18px 20px;
          box-shadow: 0 1px 3px rgba(0, 0, 0, 0.02);
          display: flex;
          flex-direction: column;
          justify-content: space-between;
          transition: all 0.2s ease;
        }

        .face-stat-card:hover {
          border-color: #10b981;
          box-shadow: 0 4px 12px rgba(5, 150, 105, 0.06);
          transform: translateY(-1px);
        }

        .face-stat-card-top {
          display: flex;
          align-items: flex-start;
          gap: 14px;
        }

        .face-stat-icon-wrap {
          width: 48px;
          height: 48px;
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

        .icon-purple {
          background: #ede9fe;
        }

        .face-stat-card-meta {
          flex: 1;
          min-width: 0;
        }

        .face-stat-label {
          font-size: 11px;
          font-weight: 700;
          letter-spacing: 0.05em;
          color: #64748b;
          text-transform: uppercase;
          display: block;
        }

        .face-stat-value-row {
          display: flex;
          align-items: center;
          justify-content: space-between;
          margin-top: 4px;
        }

        .face-stat-number {
          font-size: 28px;
          font-weight: 800;
          color: #0f172a;
          line-height: 1.1;
        }

        .face-stat-trend {
          display: inline-flex;
          align-items: center;
        }

        .trend-green {
          color: #10b981;
        }

        .trend-blue {
          color: #3b82f6;
        }

        .trend-amber {
          color: #f59e0b;
        }

        .trend-purple {
          color: #8b5cf6;
        }

        .face-stat-desc {
          font-size: 12px;
          color: #64748b;
          font-weight: 500;
          margin-top: 10px;
        }

        /* ── Search Bar & Filter Buttons ── */
        .face-search-filters-bar {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 16px;
          margin-bottom: 20px;
          flex-wrap: wrap;
        }

        .face-search-input-wrap {
          background: #f8fafc;
          border: 1px solid #e2e8f0;
          border-radius: 12px;
          padding: 8px 14px;
          display: flex;
          align-items: center;
          gap: 10px;
          flex: 1;
          max-width: 580px;
          min-width: 280px;
        }

        .face-search-icon {
          color: #64748b;
          flex-shrink: 0;
        }

        .face-search-field {
          background: transparent;
          border: none;
          outline: none;
          font-size: 13.5px;
          color: #0f172a;
          width: 100%;
          padding: 4px 0;
        }

        .face-search-field::placeholder {
          color: #94a3b8;
        }

        .face-search-clear-btn {
          background: none;
          border: none;
          color: #94a3b8;
          cursor: pointer;
          padding: 4px;
          display: flex;
          align-items: center;
          justify-content: center;
        }

        /* ── Filter Dropdown Container & Menu Popover ── */
        .face-filter-dropdown-container {
          position: relative;
          display: flex;
          align-items: center;
          gap: 10px;
        }

        .face-active-filter-chip {
          display: inline-flex;
          align-items: center;
          gap: 6px;
          background: #ecfdf5;
          border: 1px solid #a7f3d0;
          color: #065f46;
          font-size: 12px;
          font-weight: 600;
          padding: 5px 10px;
          border-radius: 9999px;
          box-shadow: 0 1px 2px rgba(16, 185, 129, 0.08);
          animation: popoverFadeIn 0.15s ease-out;
        }

        .active-chip-dot {
          width: 6px;
          height: 6px;
          border-radius: 50%;
          background: #10b981;
        }

        .chip-clear-btn {
          background: none;
          border: none;
          color: #059669;
          font-size: 11px;
          font-weight: 700;
          cursor: pointer;
          padding: 1px 3px;
          border-radius: 4px;
          line-height: 1;
          display: flex;
          align-items: center;
          justify-content: center;
        }

        .chip-clear-btn:hover {
          background: #d1fae5;
          color: #047857;
        }

        .face-filter-dropdown-btn {
          height: 38px;
          padding: 0 16px;
          border-radius: 10px;
          font-size: 13px;
          font-weight: 600;
          border: 1px solid #cbd5e1;
          background: #ffffff;
          color: #334155;
          cursor: pointer;
          display: inline-flex;
          align-items: center;
          gap: 8px;
          box-shadow: 0 1px 3px rgba(0, 0, 0, 0.04);
          transition: all 0.18s ease;
        }

        .face-filter-dropdown-btn:hover,
        .face-filter-dropdown-btn.open {
          border-color: #10b981;
          color: #047857;
          background: #f0fdf4;
        }

        .face-filter-dropdown-btn.active-filter {
          border-color: #059669;
          background: #ecfdf5;
          color: #047857;
          box-shadow: 0 0 0 3px rgba(16, 185, 129, 0.12);
        }

        /* Floating Dropdown Menu Placed Directly Under the Filter Button */
        .face-filter-menu-popover {
          position: absolute;
          top: calc(100% + 8px);
          right: 0;
          z-index: 1000;
          width: 250px;
          background: #ffffff;
          border: 1px solid #e2e8f0;
          border-radius: 14px;
          box-shadow: 0 10px 25px -5px rgba(0, 0, 0, 0.1), 0 8px 10px -6px rgba(0, 0, 0, 0.08);
          padding: 10px;
          box-sizing: border-box;
          animation: popoverFadeIn 0.18s ease-out;
        }

        .filter-menu-header {
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding: 4px 8px 8px;
          border-bottom: 1px solid #f1f5f9;
          margin-bottom: 6px;
        }

        .filter-menu-title {
          font-size: 10.5px;
          font-weight: 800;
          color: #94a3b8;
          letter-spacing: 0.06em;
          text-transform: uppercase;
        }

        .filter-menu-reset-btn {
          background: none;
          border: none;
          color: #ef4444;
          font-size: 11px;
          font-weight: 600;
          cursor: pointer;
          padding: 2px 4px;
        }

        .filter-menu-reset-btn:hover {
          text-decoration: underline;
        }

        .filter-menu-options-list {
          display: flex;
          flex-direction: column;
          gap: 3px;
        }

        .filter-menu-option-item {
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding: 8px 10px;
          border-radius: 8px;
          border: 1px solid transparent;
          background: transparent;
          cursor: pointer;
          transition: all 0.15s ease;
          width: 100%;
          text-align: left;
        }

        .filter-menu-option-item:hover {
          background: #f8fafc;
        }

        .filter-menu-option-item.selected {
          background: #ecfdf5;
          border-color: #a7f3d0;
        }

        .option-item-left {
          display: flex;
          align-items: center;
          gap: 10px;
        }

        .filter-option-dot {
          width: 8px;
          height: 8px;
          border-radius: 50%;
          flex-shrink: 0;
        }

        .dot-all {
          background: #3b82f6;
        }

        .dot-registered {
          background: #10b981;
        }

        .dot-unregistered {
          background: #94a3b8;
        }

        .dot-pending {
          background: #f59e0b;
        }

        .filter-option-name {
          font-size: 12.5px;
          font-weight: 600;
          color: #1e293b;
        }

        .filter-menu-option-item.selected .filter-option-name {
          color: #047857;
          font-weight: 700;
        }

        .filter-option-badge {
          font-size: 11px;
          font-weight: 700;
          padding: 2px 7px;
          border-radius: 9999px;
        }

        .badge-all {
          background: #eff6ff;
          color: #2563eb;
        }

        .badge-registered {
          background: #d1fae5;
          color: #047857;
        }

        .badge-unregistered {
          background: #f1f5f9;
          color: #64748b;
        }

        .badge-pending {
          background: #fef3c7;
          color: #d97706;
        }

        /* Unregistered Status Pill & Quick Enroll Button */
        .status-unregistered {
          background: #f1f5f9;
          color: #64748b;
          border: 1px solid #e2e8f0;
        }

        .dot-unreg {
          background: #94a3b8;
        }

        .face-action-btn-quick-enroll {
          height: 28px;
          padding: 0 10px;
          border-radius: 6px;
          background: #ecfdf5;
          color: #047857;
          border: 1px solid #a7f3d0;
          font-size: 11.5px;
          font-weight: 600;
          display: inline-flex;
          align-items: center;
          gap: 4px;
          cursor: pointer;
          transition: all 0.15s ease;
        }

        .face-action-btn-quick-enroll:hover {
          background: #059669;
          color: #ffffff;
          border-color: #059669;
        }

        /* ── Table Card ── */
        .face-table-card {
          background: #ffffff;
          border: 1px solid #e2ece8;
          border-radius: 18px;
          padding: 16px 20px 20px;
          box-shadow: 0 1px 4px rgba(0, 0, 0, 0.02);
        }

        .face-custom-table {
          width: 100%;
          border-collapse: separate;
          border-spacing: 0;
          text-align: left;
        }

        .face-custom-table th {
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

        .face-custom-table th:first-child {
          border-top-left-radius: 12px;
          border-bottom-left-radius: 12px;
        }

        .face-custom-table th:last-child {
          border-top-right-radius: 12px;
          border-bottom-right-radius: 12px;
        }

        .face-th-content {
          display: inline-flex;
          align-items: center;
          gap: 6px;
        }

        .sort-arrows {
          flex-shrink: 0;
        }

        .face-custom-table td {
          padding: 14px 14px;
          font-size: 13px;
          color: #0f172a;
          border-bottom: 1px solid #f1f5f9;
          vertical-align: middle;
        }

        .face-custom-table tr:hover td {
          background-color: #f8fafc;
        }

        .face-checkbox {
          width: 16px;
          height: 16px;
          border-radius: 4px;
          border: 1.5px solid #cbd5e1;
          cursor: pointer;
          accent-color: #059669;
        }

        .face-code-badge {
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

        .face-name-cell {
          display: flex;
          align-items: center;
          gap: 12px;
          cursor: pointer;
        }

        .face-avatar-img {
          width: 34px;
          height: 34px;
          border-radius: 50%;
          object-fit: cover;
          border: 1.5px solid #a7f3d0;
          flex-shrink: 0;
        }

        .face-avatar-circle {
          width: 34px;
          height: 34px;
          border-radius: 50%;
          display: flex;
          align-items: center;
          justify-content: center;
          font-weight: 700;
          font-size: 12px;
          flex-shrink: 0;
        }

        .face-name-text {
          font-weight: 600;
          color: #0f172a;
          font-size: 13.5px;
        }

        .face-dept-pill {
          display: inline-block;
          padding: 3px 8px;
          border-radius: 6px;
          background: #f8fafc;
          border: 1px solid #e2e8f0;
          font-size: 12px;
          font-weight: 500;
          color: #334155;
        }

        .face-desig-text {
          color: #475569;
          font-size: 13px;
        }

        .face-scans-badge {
          display: inline-block;
          padding: 3px 10px;
          border-radius: 9999px;
          font-size: 11.5px;
          font-weight: 600;
          cursor: pointer;
        }

        .scans-has {
          background: #ecfdf5;
          color: #059669;
          border: 1px solid #a7f3d0;
        }

        .scans-zero {
          background: #f1f5f9;
          color: #64748b;
          border: 1px solid #e2e8f0;
        }

        .face-seen-text {
          font-size: 12.5px;
          color: #475569;
        }

        .face-date-text {
          font-size: 12.5px;
          color: #64748b;
        }

        .face-status-pill {
          display: inline-flex;
          align-items: center;
          gap: 6px;
          padding: 3px 10px;
          border-radius: 9999px;
          font-size: 11.5px;
          font-weight: 600;
        }

        .face-status-dot {
          width: 6px;
          height: 6px;
          border-radius: 50%;
        }

        .status-active {
          background: #ecfdf5;
          color: #059669;
          border: 1px solid #a7f3d0;
        }

        .status-active .face-status-dot {
          background-color: #059669;
        }

        .face-actions-wrap {
          display: flex;
          align-items: center;
          gap: 6px;
        }

        .face-action-btn {
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

        .face-action-btn.view-action:hover {
          border-color: #059669;
          color: #059669;
          background: #ecfdf5;
        }

        .face-action-btn.details-action:hover {
          border-color: #3b82f6;
          color: #3b82f6;
          background: #eff6ff;
        }

        .face-action-btn.delete-action:hover {
          border-color: #dc2626;
          color: #dc2626;
          background: #fef2f2;
        }

        /* ── Empty State ── */
        .face-empty-wrap {
          padding: 68px 20px;
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          text-align: center;
        }

        .face-empty-icon {
          margin-bottom: 8px;
        }

        .face-empty-title {
          font-size: 18px;
          font-weight: 700;
          color: #0f172a;
          margin: 16px 0 6px 0;
        }

        .face-empty-desc {
          font-size: 13.5px;
          color: #475569;
          margin: 0 0 20px 0;
          max-width: 440px;
        }

        .face-empty-cta-btn {
          height: 42px;
          padding: 0 22px;
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

        .face-empty-cta-btn:hover {
          opacity: 0.95;
          transform: translateY(-1px);
          box-shadow: 0 6px 16px rgba(16, 185, 129, 0.38);
        }

        /* ── Footer & Pagination ── */
        .face-table-footer {
          padding: 16px 4px 4px;
          background: transparent;
          border-top: none;
          display: flex;
          align-items: center;
          justify-content: space-between;
        }

        .face-footer-count {
          font-size: 13px;
          color: #64748b;
          font-weight: 500;
        }

        .face-pagination {
          display: flex;
          align-items: center;
          gap: 6px;
        }

        .face-page-arrow {
          width: 32px;
          height: 32px;
          border-radius: 8px;
          border: 1px solid #e2e8f0;
          background: #ffffff;
          color: #64748b;
          display: flex;
          align-items: center;
          justify-content: center;
          cursor: pointer;
          transition: all 0.15s ease;
        }

        .face-page-arrow:disabled {
          opacity: 0.4;
          cursor: not-allowed;
        }

        .face-page-arrow:not(:disabled):hover {
          border-color: #cbd5e1;
          color: #0f172a;
        }

        .face-page-num {
          width: 32px;
          height: 32px;
          border-radius: 8px;
          border: none;
          background: #ffffff;
          color: #334155;
          font-size: 13px;
          font-weight: 600;
          display: flex;
          align-items: center;
          justify-content: center;
          cursor: pointer;
        }

        .face-page-num.active {
          background: #059669;
          color: #ffffff;
        }

        @media (max-width: 1024px) {
          .face-stat-cards-grid {
            grid-template-columns: repeat(2, 1fr);
          }
        }

        @media (max-width: 768px) {
          .face-registry-page {
            padding: 16px;
          }

          .face-stat-cards-grid {
            grid-template-columns: repeat(2, 1fr) !important;
            gap: 10px !important;
          }

          .face-stat-card {
            padding: 10px 12px !important;
            border-radius: 12px !important;
          }

          .face-stat-icon-wrap {
            width: 32px !important;
            height: 32px !important;
            border-radius: 8px !important;
          }

          .face-stat-label {
            font-size: 10px !important;
          }

          .face-stat-val {
            font-size: 19px !important;
          }

          .face-stat-sub,
          .face-stat-desc,
          .face-stat-trend,
          .face-reg-header p {
            display: none !important;
          }

          .face-search-filters-bar {
            flex-direction: column;
            align-items: stretch;
          }

          .face-search-input-wrap {
            max-width: 100%;
          }

          .face-filter-pills-wrap {
            overflow-x: auto;
            padding-bottom: 6px;
          }
        }

        /* ── Scan Logs Modal (Clean Table Format) ── */
        .modal-content.scan-modal-dialog {
          max-width: 860px !important;
          width: 95% !important;
        }

        .scan-modal-container {
          display: flex;
          flex-direction: column;
          gap: 14px;
        }

        .scan-logs-summary {
          display: flex;
          flex-wrap: wrap;
          gap: 14px;
          padding: 14px 18px;
          background: #ecfdf5;
          border-radius: 12px;
          border: 1px solid #a7f3d0;
          justify-content: space-between;
          align-items: center;
        }

        .scan-summary-info {
          display: flex;
          flex-direction: column;
          gap: 3px;
        }

        .scan-summary-label {
          font-size: 11px;
          color: #047857;
          font-weight: 700;
          text-transform: uppercase;
          letter-spacing: 0.04em;
        }

        .scan-summary-value {
          font-size: 18px;
          font-weight: 800;
          color: #064e3b;
        }

        .scan-summary-chips {
          display: flex;
          align-items: center;
          gap: 8px;
          margin-top: 2px;
        }

        .scan-chip {
          display: inline-flex;
          align-items: center;
          gap: 5px;
          padding: 2px 8px;
          border-radius: 20px;
          font-size: 11px;
          font-weight: 700;
        }

        .scan-chip.chip-in {
          background: #d1fae5;
          color: #065f46;
          border: 1px solid #a7f3d0;
        }

        .scan-chip.chip-out {
          background: #fef3c7;
          color: #92400e;
          border: 1px solid #fde68a;
        }

        .scan-chip-dot {
          width: 6px;
          height: 6px;
          border-radius: 50%;
        }

        .scan-chip-dot.in {
          background: #10b981;
        }

        .scan-chip-dot.out {
          background: #f59e0b;
        }

        .scan-summary-latest {
          display: flex;
          flex-direction: column;
          gap: 3px;
        }

        .scan-summary-time {
          font-size: 13.5px;
          font-weight: 700;
          color: #064e3b;
        }

        .scan-summary-sub {
          display: flex;
          align-items: center;
          gap: 6px;
          font-size: 11.5px;
          color: #047857;
        }

        .scan-type-tag {
          font-size: 9.5px;
          font-weight: 800;
          padding: 1px 5px;
          border-radius: 4px;
        }

        .scan-type-tag.tag-in {
          background: #d1fae5;
          color: #047857;
        }

        .scan-type-tag.tag-out {
          background: #fef3c7;
          color: #b45309;
        }

        /* Tabs Bar */
        .scan-tabs-bar {
          display: flex;
          align-items: center;
          gap: 6px;
          padding: 4px;
          background: #f1f5f9;
          border-radius: 8px;
        }

        .scan-tab-btn {
          display: inline-flex;
          align-items: center;
          gap: 6px;
          padding: 6px 14px;
          border-radius: 6px;
          border: none;
          background: transparent;
          color: #64748b;
          font-size: 12.5px;
          font-weight: 600;
          cursor: pointer;
          transition: all 0.15s ease;
        }

        .scan-tab-btn:hover {
          color: #0f172a;
          background: rgba(255, 255, 255, 0.7);
        }

        .scan-tab-btn.active {
          background: #ffffff;
          color: #0f172a;
          box-shadow: 0 1px 3px rgba(0, 0, 0, 0.08);
          font-weight: 700;
        }

        .scan-tab-btn.tab-in.active {
          color: #059669;
        }

        .scan-tab-btn.tab-out.active {
          color: #d97706;
        }

        .scan-tab-arrow {
          font-weight: 800;
        }

        .scan-tab-count {
          padding: 1px 6px;
          border-radius: 10px;
          background: #e2e8f0;
          font-size: 11px;
          font-weight: 700;
        }

        .scan-tab-btn.active .scan-tab-count {
          background: #f1f5f9;
        }

        .scan-tab-btn.tab-in.active .scan-tab-count {
          background: #d1fae5;
          color: #047857;
        }

        .scan-tab-btn.tab-out.active .scan-tab-count {
          background: #fef3c7;
          color: #b45309;
        }

        /* Clean Table Styles */
        .scan-table-wrapper {
          width: 100%;
          max-height: 440px;
          overflow-y: auto;
          overflow-x: auto;
          border: 1px solid #e2e8f0;
          border-radius: 10px;
          background: #ffffff;
        }

        .scan-table {
          width: 100%;
          border-collapse: separate;
          border-spacing: 0;
          font-size: 13px;
          text-align: left;
        }

        .scan-table thead th {
          position: sticky;
          top: 0;
          background: #f8fafc;
          color: #475569;
          font-size: 11.5px;
          font-weight: 700;
          text-transform: uppercase;
          letter-spacing: 0.04em;
          padding: 11px 14px;
          border-bottom: 1.5px solid #e2e8f0;
          z-index: 2;
        }

        .scan-table tbody tr {
          transition: background-color 0.15s ease;
        }

        .scan-table tbody td {
          padding: 12px 14px;
          border-bottom: 1px solid #f1f5f9;
          vertical-align: middle;
          color: #0f172a;
        }

        .scan-table tbody tr:hover td {
          background-color: #f8fafc;
        }

        .scan-table tbody tr:last-child td {
          border-bottom: none;
        }

        .scan-row-index {
          display: inline-block;
          font-size: 11px;
          font-weight: 700;
          color: #64748b;
          background: #f1f5f9;
          padding: 2px 6px;
          border-radius: 4px;
        }

        .scan-dir-pill {
          display: inline-flex;
          align-items: center;
          gap: 5px;
          padding: 3px 9px;
          border-radius: 6px;
          font-size: 11px;
          font-weight: 800;
          letter-spacing: 0.02em;
        }

        .scan-dir-pill.pill-in {
          background: #ecfdf5;
          color: #059669;
          border: 1px solid #a7f3d0;
        }

        .scan-dir-pill.pill-out {
          background: #fffbeb;
          color: #d97706;
          border: 1px solid #fde68a;
        }

        .scan-dir-arrow {
          font-size: 12px;
          font-weight: 800;
        }

        .scan-cell-date {
          font-weight: 500;
          color: #334155;
          font-size: 12.5px;
        }

        .scan-cell-time {
          font-weight: 800;
          font-size: 13px;
        }

        .scan-cell-time.time-in {
          color: #059669;
        }

        .scan-cell-time.time-out {
          color: #d97706;
        }

        .scan-cell-cam {
          display: flex;
          align-items: center;
          gap: 6px;
        }

        .scan-cam-name {
          font-weight: 700;
          color: #1e293b;
        }

        .scan-cam-loc {
          font-size: 11px;
          color: #64748b;
          background: #f1f5f9;
          padding: 1px 6px;
          border-radius: 4px;
          border: 1px solid #e2e8f0;
        }

        .scan-cell-match {
          font-weight: 700;
          font-size: 12px;
          color: #059669;
        }

        .scan-status-pill {
          display: inline-flex;
          align-items: center;
          gap: 5px;
          padding: 3px 8px;
          border-radius: 6px;
          font-size: 11px;
          font-weight: 700;
        }

        .scan-status-pill.status-present {
          background: #ecfdf5;
          color: #059669;
          border: 1px solid #a7f3d0;
        }

        .scan-status-dot {
          width: 6px;
          height: 6px;
          border-radius: 50%;
          background: #10b981;
        }

        .scan-empty-state {
          padding: 40px 20px;
          text-align: center;
          background: #f8fafc;
          border-radius: 10px;
          border: 1px dashed #cbd5e1;
          color: #64748b;
        }

        .scan-empty-state h4 {
          margin: 0 0 6px 0;
          font-size: 14px;
          color: #0f172a;
        }

        .scan-empty-state p {
          margin: 0;
          font-size: 12.5px;
        }

        /* ── Dark Mode Overrides ── */
        [data-theme="dark"] .scan-logs-summary,
        .dark .scan-logs-summary {
          background: linear-gradient(135deg, #131733 0%, #1a223f 100%) !important;
          border: 1px solid rgba(139, 92, 246, 0.28) !important;
          box-shadow: 0 4px 18px rgba(0, 0, 0, 0.45) !important;
        }

        [data-theme="dark"] .scan-summary-label,
        .dark .scan-summary-label {
          color: #94a3b8 !important;
        }

        [data-theme="dark"] .scan-summary-value,
        .dark .scan-summary-value {
          color: #ffffff !important;
        }

        [data-theme="dark"] .scan-summary-time,
        .dark .scan-summary-time {
          color: #f1f5f9 !important;
        }

        [data-theme="dark"] .scan-summary-sub,
        .dark .scan-summary-sub {
          color: #94a3b8 !important;
        }

        [data-theme="dark"] .scan-chip.chip-in,
        .dark .scan-chip.chip-in {
          background: rgba(16, 185, 129, 0.16) !important;
          color: #34d399 !important;
          border-color: rgba(16, 185, 129, 0.35) !important;
        }

        [data-theme="dark"] .scan-chip.chip-out,
        .dark .scan-chip.chip-out {
          background: rgba(245, 158, 11, 0.16) !important;
          color: #fbbf24 !important;
          border-color: rgba(245, 158, 11, 0.35) !important;
        }

        [data-theme="dark"] .scan-type-tag.tag-in,
        .dark .scan-type-tag.tag-in {
          background: rgba(16, 185, 129, 0.2) !important;
          color: #34d399 !important;
        }

        [data-theme="dark"] .scan-type-tag.tag-out,
        .dark .scan-type-tag.tag-out {
          background: rgba(245, 158, 11, 0.2) !important;
          color: #fbbf24 !important;
        }

        [data-theme="dark"] .scan-tabs-bar,
        .dark .scan-tabs-bar {
          background: #11142a !important;
          border: 1px solid rgba(139, 92, 246, 0.2) !important;
        }

        [data-theme="dark"] .scan-tab-btn,
        .dark .scan-tab-btn {
          color: #94a3b8 !important;
        }

        [data-theme="dark"] .scan-tab-btn:hover,
        .dark .scan-tab-btn:hover {
          color: #f1f5f9 !important;
          background: rgba(139, 92, 246, 0.12) !important;
        }

        [data-theme="dark"] .scan-tab-btn.active,
        .dark .scan-tab-btn.active {
          background: #1e2648 !important;
          color: #ffffff !important;
          box-shadow: 0 2px 8px rgba(0, 0, 0, 0.4) !important;
        }

        [data-theme="dark"] .scan-tab-btn.tab-in.active,
        .dark .scan-tab-btn.tab-in.active {
          background: rgba(16, 185, 129, 0.2) !important;
          color: #34d399 !important;
          border: 1px solid rgba(16, 185, 129, 0.35) !important;
        }

        [data-theme="dark"] .scan-tab-btn.tab-out.active,
        .dark .scan-tab-btn.tab-out.active {
          background: rgba(245, 158, 11, 0.2) !important;
          color: #fbbf24 !important;
          border: 1px solid rgba(245, 158, 11, 0.35) !important;
        }

        [data-theme="dark"] .scan-tab-count,
        .dark .scan-tab-count {
          background: #171b38 !important;
          color: #cbd5e1 !important;
        }

        [data-theme="dark"] .scan-table-wrapper,
        .dark .scan-table-wrapper {
          background: #14172e !important;
          border-color: rgba(139, 92, 246, 0.25) !important;
        }

        [data-theme="dark"] .scan-table thead th,
        .dark .scan-table thead th {
          background: #171b38 !important;
          color: #94a3b8 !important;
          border-bottom-color: rgba(139, 92, 246, 0.25) !important;
        }

        [data-theme="dark"] .scan-table tbody td,
        .dark .scan-table tbody td {
          color: #f1f5f9 !important;
          border-bottom-color: rgba(139, 92, 246, 0.12) !important;
        }

        [data-theme="dark"] .scan-table tbody tr:hover td,
        .dark .scan-table tbody tr:hover td {
          background-color: rgba(139, 92, 246, 0.08) !important;
        }

        [data-theme="dark"] .scan-row-index,
        .dark .scan-row-index {
          background: #1a223f !important;
          color: #94a3b8 !important;
        }

        [data-theme="dark"] .scan-dir-pill.pill-in,
        .dark .scan-dir-pill.pill-in {
          background: rgba(16, 185, 129, 0.16) !important;
          color: #34d399 !important;
          border-color: rgba(16, 185, 129, 0.35) !important;
        }

        [data-theme="dark"] .scan-dir-pill.pill-out,
        .dark .scan-dir-pill.pill-out {
          background: rgba(245, 158, 11, 0.16) !important;
          color: #fbbf24 !important;
          border-color: rgba(245, 158, 11, 0.35) !important;
        }

        [data-theme="dark"] .scan-cell-date,
        .dark .scan-cell-date {
          color: #cbd5e1 !important;
        }

        [data-theme="dark"] .scan-cell-time.time-in,
        .dark .scan-cell-time.time-in {
          color: #34d399 !important;
        }

        [data-theme="dark"] .scan-cell-time.time-out,
        .dark .scan-cell-time.time-out {
          color: #fbbf24 !important;
        }

        [data-theme="dark"] .scan-cam-name,
        .dark .scan-cam-name {
          color: #f1f5f9 !important;
        }

        [data-theme="dark"] .scan-cam-loc,
        .dark .scan-cam-loc {
          background: #1a223f !important;
          color: #cbd5e1 !important;
          border-color: rgba(139, 92, 246, 0.2) !important;
        }

        [data-theme="dark"] .scan-cell-match,
        .dark .scan-cell-match {
          color: #34d399 !important;
        }

        [data-theme="dark"] .scan-status-pill.status-present,
        .dark .scan-status-pill.status-present {
          background: rgba(16, 185, 129, 0.16) !important;
          color: #34d399 !important;
          border-color: rgba(16, 185, 129, 0.35) !important;
        }

        [data-theme="dark"] .scan-empty-state,
        .dark .scan-empty-state {
          background: #14172e !important;
          border-color: rgba(139, 92, 246, 0.3) !important;
        }

        [data-theme="dark"] .scan-empty-state h4,
        .dark .scan-empty-state h4 {
          color: #ffffff !important;
        }

        [data-theme="dark"] .scan-empty-state p,
        .dark .scan-empty-state p {
          color: #94a3b8 !important;
        }

        /* ── Face Registry Page Dark Mode Overrides ── */
        [data-theme="dark"] .face-reg-btn-refresh,
        .dark .face-reg-btn-refresh {
          background: #171b38 !important;
          border-color: rgba(139, 92, 246, 0.25) !important;
          color: #cbd5e1 !important;
        }
        [data-theme="dark"] .face-reg-btn-refresh:hover:not(:disabled),
        .dark .face-reg-btn-refresh:hover:not(:disabled) {
          background: #23284f !important;
          color: #ffffff !important;
        }
        [data-theme="dark"] .face-filter-dropdown-btn,
        .dark .face-filter-dropdown-btn {
          background: #171b38 !important;
          border-color: rgba(139, 92, 246, 0.25) !important;
          color: #cbd5e1 !important;
        }
        [data-theme="dark"] .face-filter-dropdown-btn:hover,
        .dark .face-filter-dropdown-btn:hover,
        [data-theme="dark"] .face-filter-dropdown-btn.open,
        .dark .face-filter-dropdown-btn.open {
          background: #23284f !important;
          border-color: #10b981 !important;
          color: #34d399 !important;
        }
        [data-theme="dark"] .face-filter-dropdown-btn.active-filter,
        .dark .face-filter-dropdown-btn.active-filter {
          background: rgba(16, 185, 129, 0.18) !important;
          border-color: #10b981 !important;
          color: #34d399 !important;
        }
        [data-theme="dark"] .face-filter-menu-popover,
        .dark .face-filter-menu-popover {
          background: #111528 !important;
          border-color: rgba(139, 92, 246, 0.28) !important;
          box-shadow: 0 10px 30px rgba(0, 0, 0, 0.6) !important;
        }
        [data-theme="dark"] .filter-menu-header,
        .dark .filter-menu-header {
          border-bottom-color: rgba(255, 255, 255, 0.08) !important;
        }
        [data-theme="dark"] .filter-menu-title,
        .dark .filter-menu-title {
          color: #94a3b8 !important;
        }
        [data-theme="dark"] .filter-menu-option-item:hover,
        .dark .filter-menu-option-item:hover {
          background: #171b38 !important;
        }
        [data-theme="dark"] .filter-menu-option-item.selected,
        .dark .filter-menu-option-item.selected {
          background: rgba(16, 185, 129, 0.16) !important;
          border-color: rgba(16, 185, 129, 0.3) !important;
        }
        [data-theme="dark"] .filter-option-name,
        .dark .filter-option-name {
          color: #f1f5f9 !important;
        }
        [data-theme="dark"] .filter-menu-option-item.selected .filter-option-name,
        .dark .filter-menu-option-item.selected .filter-option-name {
          color: #34d399 !important;
        }
        [data-theme="dark"] .badge-unregistered,
        .dark .badge-unregistered {
          background: #23284f !important;
          color: #94a3b8 !important;
        }
        [data-theme="dark"] .face-active-filter-chip,
        .dark .face-active-filter-chip {
          background: rgba(16, 185, 129, 0.16) !important;
          border-color: rgba(16, 185, 129, 0.35) !important;
          color: #34d399 !important;
        }
        [data-theme="dark"] .chip-clear-btn,
        .dark .chip-clear-btn {
          color: #34d399 !important;
        }
        [data-theme="dark"] .chip-clear-btn:hover,
        .dark .chip-clear-btn:hover {
          background: rgba(16, 185, 129, 0.3) !important;
        }
        [data-theme="dark"] .face-stat-card,
        .dark .face-stat-card {
          background: #111528 !important;
          border-color: rgba(139, 92, 246, 0.22) !important;
        }
        [data-theme="dark"] .face-stat-card:hover,
        .dark .face-stat-card:hover {
          border-color: #10b981 !important;
        }
        [data-theme="dark"] .face-stat-number,
        .dark .face-stat-number {
          color: #ffffff !important;
        }
        [data-theme="dark"] .face-stat-label,
        .dark .face-stat-label {
          color: #94a3b8 !important;
        }
        [data-theme="dark"] .face-stat-desc,
        .dark .face-stat-desc {
          color: #64748b !important;
        }
        [data-theme="dark"] .face-search-input-wrap,
        .dark .face-search-input-wrap {
          background: #171b38 !important;
          border-color: rgba(139, 92, 246, 0.25) !important;
        }
        [data-theme="dark"] .face-search-field,
        .dark .face-search-field {
          color: #ffffff !important;
        }
        [data-theme="dark"] .face-search-field::placeholder,
        .dark .face-search-field::placeholder {
          color: #64748b !important;
        }
        [data-theme="dark"] .face-table-card,
        .dark .face-table-card {
          background: #111528 !important;
          border-color: rgba(139, 92, 246, 0.22) !important;
        }
        [data-theme="dark"] .face-custom-table th,
        .dark .face-custom-table th {
          background-color: #1a1e3a !important;
          color: #34d399 !important;
        }
        [data-theme="dark"] .face-custom-table td,
        .dark .face-custom-table td {
          color: #f1f5f9 !important;
          border-bottom-color: rgba(255, 255, 255, 0.05) !important;
        }
        [data-theme="dark"] .face-custom-table tr:hover td,
        .dark .face-custom-table tr:hover td {
          background-color: #171b38 !important;
        }
        [data-theme="dark"] .face-name-text,
        .dark .face-name-text {
          color: #ffffff !important;
        }
        [data-theme="dark"] .face-code-badge,
        .dark .face-code-badge {
          background: #171b38 !important;
          border-color: rgba(139, 92, 246, 0.25) !important;
          color: #cbd5e1 !important;
        }
        [data-theme="dark"] .face-dept-pill,
        .dark .face-dept-pill {
          background: #171b38 !important;
          color: #cbd5e1 !important;
          border-color: rgba(139, 92, 246, 0.2) !important;
        }
        [data-theme="dark"] .face-desig-text,
        .dark .face-desig-text {
          color: #94a3b8 !important;
        }
        [data-theme="dark"] .face-seen-text,
        .dark .face-seen-text {
          color: #94a3b8 !important;
        }
        [data-theme="dark"] .face-date-text,
        .dark .face-date-text {
          color: #94a3b8 !important;
        }
        [data-theme="dark"] .face-action-btn,
        .dark .face-action-btn {
          background: #171b38 !important;
          border-color: rgba(139, 92, 246, 0.2) !important;
          color: #cbd5e1 !important;
        }
        [data-theme="dark"] .face-action-btn:hover,
        .dark .face-action-btn:hover {
          background: #23284f !important;
          color: #ffffff !important;
        }
        [data-theme="dark"] .face-action-btn.delete-action:hover,
        .dark .face-action-btn.delete-action:hover {
          background: rgba(239, 68, 68, 0.2) !important;
          color: #f87171 !important;
        }
        [data-theme="dark"] .face-page-num,
        .dark .face-page-num,
        [data-theme="dark"] .face-page-arrow,
        .dark .face-page-arrow {
          background: #171b38 !important;
          border-color: rgba(139, 92, 246, 0.25) !important;
          color: #94a3b8 !important;
        }
        [data-theme="dark"] .face-page-num:hover,
        .dark .face-page-num:hover,
        [data-theme="dark"] .face-page-arrow:hover:not(:disabled),
        .dark .face-page-arrow:hover:not(:disabled) {
          background: #23284f !important;
          color: #ffffff !important;
        }
        [data-theme="dark"] .face-page-num.active,
        .dark .face-page-num.active {
          background: #059669 !important;
          color: #ffffff !important;
        }
        [data-theme="dark"] .status-unregistered,
        .dark .status-unregistered {
          background: #23284f !important;
          color: #94a3b8 !important;
          border-color: rgba(139, 92, 246, 0.2) !important;
        }
        [data-theme="dark"] .face-action-btn-quick-enroll,
        .dark .face-action-btn-quick-enroll {
          background: rgba(16, 185, 129, 0.16) !important;
          color: #34d399 !important;
          border-color: rgba(16, 185, 129, 0.35) !important;
        }
        [data-theme="dark"] .face-action-btn-quick-enroll:hover,
        .dark .face-action-btn-quick-enroll:hover {
          background: #059669 !important;
          color: #ffffff !important;
        }
        [data-theme="dark"] .face-table-footer,
        .dark .face-table-footer {
          border-color: rgba(255, 255, 255, 0.08) !important;
          color: #94a3b8 !important;
        }
      `}</style>
    </div>
  );
};

export default FaceEnrollmentList;
