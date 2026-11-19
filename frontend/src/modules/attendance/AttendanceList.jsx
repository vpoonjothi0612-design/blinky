import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  getAttendance,
  createManualAttendance,
} from './attendance.service';
import { getEmployees } from '../employee/employee.service';
import { getCameras, getCameraStreamStatus } from '../camera/camera.service';
import Loader from '../../components/common/Loader';
import useAuth from '../../hooks/useAuth';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';

const isCameraNetworkReachable = (camera, streamStatus) => {
  const ipAddress = String(camera?.ipAddress || '').trim();
  const eventStreamMatches = Boolean(
    ipAddress &&
    streamStatus?.connected &&
    (streamStatus.cameraIp === ipAddress || streamStatus.configuredUrl?.includes(ipAddress))
  );
  return Boolean(camera?.isOnline || eventStreamMatches);
};

// ── Custom Attendance Calendar Popover ────────────────────────────────
const AttendanceCalendarPopover = ({ selectedDate, onSelectDate, onClose }) => {
  const popoverRef = useRef(null);

  // Parse initial date from selectedDate
  const initialDate = useMemo(() => {
    if (!selectedDate) return new Date();
    const d = new Date(selectedDate + 'T12:00:00');
    return isNaN(d.getTime()) ? new Date() : d;
  }, [selectedDate]);

  const [viewYear, setViewYear] = useState(() => initialDate.getFullYear());
  const [viewMonth, setViewMonth] = useState(() => initialDate.getMonth());

  // Close when clicking outside or pressing Escape
  useEffect(() => {
    const handleClickOutside = (e) => {
      if (popoverRef.current && !popoverRef.current.contains(e.target)) {
        onClose();
      }
    };
    const handleKeyDown = (e) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [onClose]);

  const monthNames = [
    'January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December'
  ];

  const handlePrevMonth = (e) => {
    e.stopPropagation();
    if (viewMonth === 0) {
      setViewMonth(11);
      setViewYear((y) => y - 1);
    } else {
      setViewMonth((m) => m - 1);
    }
  };

  const handleNextMonth = (e) => {
    e.stopPropagation();
    if (viewMonth === 11) {
      setViewMonth(0);
      setViewYear((y) => y + 1);
    } else {
      setViewMonth((m) => m + 1);
    }
  };

  const pad = (n) => String(n).padStart(2, '0');

  // Quick preset selections
  const handleQuickSelect = (type, e) => {
    e.stopPropagation();
    const now = new Date();
    if (type === 'today') {
      const dateStr = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
      onSelectDate(dateStr);
    } else if (type === 'yesterday') {
      const y = new Date(now);
      y.setDate(y.getDate() - 1);
      const dateStr = `${y.getFullYear()}-${pad(y.getMonth() + 1)}-${pad(y.getDate())}`;
      onSelectDate(dateStr);
    } else if (type === '2days') {
      const y = new Date(now);
      y.setDate(y.getDate() - 2);
      const dateStr = `${y.getFullYear()}-${pad(y.getMonth() + 1)}-${pad(y.getDate())}`;
      onSelectDate(dateStr);
    }
  };

  // Build calendar matrix (Monday start)
  const calendarCells = useMemo(() => {
    const cells = [];
    const firstDayIndex = (new Date(viewYear, viewMonth, 1).getDay() + 6) % 7;
    const daysInMonth = new Date(viewYear, viewMonth + 1, 0).getDate();
    const daysInPrevMonth = new Date(viewYear, viewMonth, 0).getDate();

    // Previous month trailing days
    for (let i = firstDayIndex - 1; i >= 0; i--) {
      const day = daysInPrevMonth - i;
      const prevM = viewMonth === 0 ? 11 : viewMonth - 1;
      const prevY = viewMonth === 0 ? viewYear - 1 : viewYear;
      cells.push({
        day,
        dateStr: `${prevY}-${pad(prevM + 1)}-${pad(day)}`,
        isCurrentMonth: false,
      });
    }

    // Current month days
    for (let day = 1; day <= daysInMonth; day++) {
      cells.push({
        day,
        dateStr: `${viewYear}-${pad(viewMonth + 1)}-${pad(day)}`,
        isCurrentMonth: true,
      });
    }

    // Next month leading days
    const totalCells = cells.length <= 35 ? 35 : 42;
    const remaining = totalCells - cells.length;
    for (let day = 1; day <= remaining; day++) {
      const nextM = viewMonth === 11 ? 0 : viewMonth + 1;
      const nextY = viewMonth === 11 ? viewYear + 1 : viewYear;
      cells.push({
        day,
        dateStr: `${nextY}-${pad(nextM + 1)}-${pad(day)}`,
        isCurrentMonth: false,
      });
    }

    return cells;
  }, [viewYear, viewMonth]);

  const now = new Date();
  const todayStr = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;

  // Formatted selected string for footer
  const selectedFormatted = useMemo(() => {
    if (!selectedDate) return '';
    const d = new Date(selectedDate + 'T12:00:00');
    if (isNaN(d.getTime())) return selectedDate;
    return d.toLocaleDateString('en-US', {
      weekday: 'short',
      day: 'numeric',
      month: 'short',
      year: 'numeric',
    });
  }, [selectedDate]);

  return (
    <div
      ref={popoverRef}
      className="att-cal-popover"
      onClick={(e) => e.stopPropagation()}
    >
      {/* Popover Header with Month & Year Navigation */}
      <div className="att-cal-header">
        <button
          type="button"
          className="att-cal-nav-btn"
          onClick={handlePrevMonth}
          title="Previous Month"
        >
          <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="15 18 9 12 15 6" />
          </svg>
        </button>
        <span className="att-cal-month-title">
          {monthNames[viewMonth]} {viewYear}
        </span>
        <button
          type="button"
          className="att-cal-nav-btn"
          onClick={handleNextMonth}
          title="Next Month"
        >
          <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="9 18 15 12 9 6" />
          </svg>
        </button>
      </div>

      {/* Quick Presets Strip */}
      <div className="att-cal-presets-strip">
        <button
          type="button"
          className={`att-cal-preset-chip ${selectedDate === todayStr ? 'active' : ''}`}
          onClick={(e) => handleQuickSelect('today', e)}
        >
          Today
        </button>
        <button
          type="button"
          className="att-cal-preset-chip"
          onClick={(e) => handleQuickSelect('yesterday', e)}
        >
          Yesterday
        </button>
        <button
          type="button"
          className="att-cal-preset-chip"
          onClick={(e) => handleQuickSelect('2days', e)}
        >
          2 Days Ago
        </button>
      </div>

      {/* Weekdays Grid */}
      <div className="att-cal-weekday-grid">
        <span>Mo</span>
        <span>Tu</span>
        <span>We</span>
        <span>Th</span>
        <span>Fr</span>
        <span>Sa</span>
        <span>Su</span>
      </div>

      {/* Days Matrix */}
      <div className="att-cal-days-grid">
        {calendarCells.map((cell) => {
          const isSelected = cell.dateStr === selectedDate;
          const isToday = cell.dateStr === todayStr;

          let cellClass = 'att-cal-day-cell';
          if (!cell.isCurrentMonth) cellClass += ' other-month';
          if (isToday) cellClass += ' is-today';
          if (isSelected) cellClass += ' selected';

          return (
            <button
              key={cell.dateStr}
              type="button"
              className={cellClass}
              onClick={(e) => {
                e.stopPropagation();
                onSelectDate(cell.dateStr);
              }}
            >
              <span>{cell.day}</span>
              {isToday && !isSelected && <span className="att-cal-today-dot" />}
            </button>
          );
        })}
      </div>

      {/* Footer Details & Action Buttons */}
      <div className="att-cal-footer">
        <div className="att-cal-footer-meta">
          <span className="att-cal-footer-label">Selected Date:</span>
          <span className="att-cal-footer-date">{selectedFormatted}</span>
        </div>
        <div className="att-cal-footer-actions">
          <button
            type="button"
            className="att-cal-btn-cancel"
            onClick={(e) => {
              e.stopPropagation();
              onClose();
            }}
          >
            Close
          </button>
          <button
            type="button"
            className="att-cal-btn-today"
            onClick={(e) => handleQuickSelect('today', e)}
          >
            Select Today
          </button>
        </div>
      </div>
    </div>
  );
};

const AttendanceList = () => {
  const { user } = useAuth();
  const userRole = (user?.role || '').toUpperCase();
  const isAdmin = userRole === 'ADMIN' || userRole === 'SUPER_ADMIN';
  const navigate = useNavigate();
  const dateInputRef = useRef(null);

  // Date Helpers
  const getLocalDateString = (d = new Date()) => {
    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  };

  const isDateMatching = (ts, targetDateStr) => {
    if (!ts) return false;
    const d = new Date(ts);
    const localStr = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    const utcStr = d.toISOString().split('T')[0];
    return localStr === targetDateStr || utcStr === targetDateStr;
  };

  // Selected Date State (Default: Today)
  const [selectedDate, setSelectedDate] = useState(() => getLocalDateString());
  const [isCalendarOpen, setIsCalendarOpen] = useState(false);

  // Data State
  const [employees, setEmployees] = useState([]);
  const [records, setRecords] = useState([]);
  const [cameras, setCameras] = useState([]);
  const [streamStatus, setStreamStatus] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [savingStatus, setSavingStatus] = useState(null);
  const [lastUpdated, setLastUpdated] = useState(() => new Date());
  const [isRefreshing, setIsRefreshing] = useState(false);
  const isFetchingRef = useRef(false);
  const isCameraFetchingRef = useRef(false);

  // Table selection & sorting
  const [selectedIds, setSelectedIds] = useState([]);

  // Filters
  const [employeeSearch, setEmployeeSearch] = useState('');
  const [selectedDept, setSelectedDept] = useState('ALL');
  const [selectedStatus, setSelectedStatus] = useState('ALL');
  const [deptDropdownOpen, setDeptDropdownOpen] = useState(false);
  const [statusDropdownOpen, setStatusDropdownOpen] = useState(false);

  // Manual Override Modal State
  const [overrideModal, setOverrideModal] = useState({
    isOpen: false,
    employeeRow: null,
    newStatus: '',
  });
  const [overrideReason, setOverrideReason] = useState('');
  const [overrideNotes, setOverrideNotes] = useState('');

  // Cutoff logic
  const cutoffSetting = import.meta.env.VITE_ATTENDANCE_CUTOFF_TIME || '18:00';
  const [cutoffHour, cutoffMinute] = cutoffSetting.split(':').map(Number);

  // Fetch data
  const fetchData = useCallback(async (isManual = false) => {
    if (isFetchingRef.current) return;
    isFetchingRef.current = true;
    if (isManual) setIsRefreshing(true);
    setError('');

    try {
      const attendanceRequest = getAttendance(1, 1000)
        .then((attRes) => {
          const filteredRecords = (attRes.data?.rows || []).filter((r) => {
            return isDateMatching(r.timestamp, selectedDate);
          });
          setRecords(filteredRecords);
          setLastUpdated(new Date());
        })
        .finally(() => {
          setLoading(false);
          if (isManual) setIsRefreshing(false);
        });

      const employeesRequest = getEmployees().then((empRes) => {
        const allEmps = empRes.data || [];
        setEmployees(allEmps.filter((e) => e.isActive !== false));
      });

      // Camera status is refreshed independently so it never delays attendance.
      if (isAdmin || userRole === 'SECURITY') {
        if (!isCameraFetchingRef.current) {
          isCameraFetchingRef.current = true;
          Promise.allSettled([getCameras(), getCameraStreamStatus()])
            .then(([camRes, streamRes]) => {
              if (camRes.status === 'fulfilled') {
                setCameras(camRes.value?.data || []);
              }
              if (streamRes.status === 'fulfilled') {
                setStreamStatus(streamRes.value);
              }
            })
            .finally(() => {
              isCameraFetchingRef.current = false;
            });
        }
      }

      const [attendanceResult, employeesResult] = await Promise.allSettled([
        attendanceRequest,
        employeesRequest,
      ]);
      const failedRequest = [attendanceResult, employeesResult].find(
        (result) => result.status === 'rejected'
      );
      if (failedRequest) throw failedRequest.reason;
    } catch (err) {
      console.error('Failed to fetch attendance data:', err);
      setError(
        err.response?.data?.message ||
        'Failed to fetch attendance data.'
      );
    } finally {
      isFetchingRef.current = false;
      if (isManual) setIsRefreshing(false);
    }
  }, [selectedDate, isAdmin, userRole]);

  useEffect(() => {
    fetchData();
    const interval = setInterval(() => {
      fetchData(false);
    }, 5000);
    return () => clearInterval(interval);
  }, [fetchData]);

  // Date Navigation
  const changeDate = (days) => {
    const d = new Date(selectedDate + 'T12:00:00');
    d.setDate(d.getDate() + days);
    setSelectedDate(getLocalDateString(d));
  };

  const getTodayString = () => getLocalDateString();
  const isToday = selectedDate === getTodayString();

  const formattedDateLong = useMemo(() => {
    if (!selectedDate) return '';
    try {
      const d = new Date(selectedDate + 'T12:00:00');
      if (isNaN(d.getTime())) return selectedDate;
      return d.toLocaleDateString('en-US', {
        month: 'long',
        day: 'numeric',
        year: 'numeric',
      });
    } catch {
      return selectedDate;
    }
  }, [selectedDate]);

  // Extract unique departments
  const departmentList = useMemo(() => {
    const set = new Set();
    employees.forEach((e) => {
      if (e.department && e.department.trim()) {
        set.add(e.department.trim());
      }
    });
    return Array.from(set).sort();
  }, [employees]);

  // Check Cutoff for Absent logic
  const isPastCutoff = useMemo(() => {
    const selDate = new Date(selectedDate + 'T00:00:00');
    const now = new Date();

    const selDateOnly = new Date(selDate).setHours(0, 0, 0, 0);
    const todayOnly = new Date(now).setHours(0, 0, 0, 0);

    if (selDateOnly < todayOnly) return true;
    if (selDateOnly > todayOnly) return false;

    const currentHour = now.getHours();
    const currentMinute = now.getMinutes();
    return (
      currentHour > cutoffHour ||
      (currentHour === cutoffHour && currentMinute >= cutoffMinute)
    );
  }, [selectedDate, cutoffHour, cutoffMinute]);

  // Process rows with dual-camera entry/exit timings, duration & incomplete flags
  const employeeRows = useMemo(() => {
    let filtered = employees;

    // 1. Department filter
    if (selectedDept !== 'ALL') {
      filtered = filtered.filter((e) => e.department === selectedDept);
    }

    // 2. Search query filter
    if (employeeSearch.trim()) {
      const q = employeeSearch.toLowerCase().trim();
      filtered = filtered.filter(
        (e) =>
          e.employeeCode?.toLowerCase().includes(q) ||
          e.firstName?.toLowerCase().includes(q) ||
          e.lastName?.toLowerCase().includes(q) ||
          e.department?.toLowerCase().includes(q)
      );
    }

    const processed = filtered.map((emp) => {
      const empRecords = records
        .filter((r) => r.employee?.id === emp.id || r.employeeId === emp.id)
        .sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));

      const inRecords = empRecords.filter((r) => r.eventType === 'IN');
      const outRecords = empRecords.filter((r) => r.eventType === 'OUT');

      const firstIn = inRecords.length > 0 ? inRecords[0] : null;
      const lastOut = outRecords.length > 0 ? outRecords[outRecords.length - 1] : null;

      const hasPresent = empRecords.some((r) =>
        ['PRESENT', 'LATE', 'OVERTIME', 'HALF_DAY'].includes(r.status)
      );
      const hasLeave = empRecords.some((r) => r.status === 'LEAVE');
      const hasOD = empRecords.some((r) => r.status === 'OD' || r.status === 'OFFICIAL_DUTY');
      const isLate = inRecords.some((r) => r.status === 'LATE');

      let effectiveStatus = '';
      if (hasPresent) effectiveStatus = isLate ? 'LATE' : 'PRESENT';
      else if (hasLeave) effectiveStatus = 'LEAVE';
      else if (hasOD) effectiveStatus = 'OD';
      else if (isPastCutoff) effectiveStatus = 'ABSENT';
      else effectiveStatus = 'PENDING';

      const inTimeStr = firstIn
        ? new Date(firstIn.timestamp).toLocaleTimeString([], {
            hour: '2-digit',
            minute: '2-digit',
          })
        : '—';
      const inCamera = firstIn ? firstIn.camera?.name || 'CAM-02' : null;

      const outTimeStr = lastOut
        ? new Date(lastOut.timestamp).toLocaleTimeString([], {
            hour: '2-digit',
            minute: '2-digit',
          })
        : '—';
      const outCamera = lastOut ? lastOut.camera?.name || 'CAM-01' : null;

      let workingDurationStr = '—';
      if (firstIn && lastOut) {
        const inMs = new Date(firstIn.timestamp).getTime();
        const outMs = new Date(lastOut.timestamp).getTime();
        if (outMs > inMs) {
          const diffMins = Math.round((outMs - inMs) / 60000);
          const hrs = Math.floor(diffMins / 60);
          const mins = diffMins % 60;
          workingDurationStr = `${hrs}h ${mins}m`;
        }
      }

      const isIncomplete = Boolean((firstIn && !lastOut) || (!firstIn && lastOut));
      const incompleteReason =
        firstIn && !lastOut ? 'Missing OUT' : !firstIn && lastOut ? 'Missing IN' : null;

      return {
        employee: emp,
        records: empRecords,
        status: effectiveStatus,
        isLate,
        firstIn,
        lastOut,
        inTimeStr,
        inCamera,
        outTimeStr,
        outCamera,
        workingDurationStr,
        isIncomplete,
        incompleteReason,
      };
    });

    // 3. Status filter
    if (selectedStatus !== 'ALL') {
      return processed.filter((r) => {
        if (selectedStatus === 'PRESENT') return r.status === 'PRESENT' || r.status === 'LATE';
        return r.status === selectedStatus;
      });
    }

    return processed;
  }, [employees, records, employeeSearch, selectedDept, selectedStatus, isPastCutoff]);

  // Overall counts for Stat Cards (based on all active employees for this date)
  const summary = useMemo(() => {
    // If there are no attendance records for today, the counts are 0
    let presentCount = 0;
    let absentCount = 0;
    let leaveCount = 0;
    let odCount = 0;

    employees.forEach((emp) => {
      const empRecords = records.filter(
        (r) => r.employee?.id === emp.id || r.employeeId === emp.id
      );
      if (empRecords.length === 0) {
        if (isPastCutoff) absentCount++;
        return;
      }
      const hasPresent = empRecords.some((r) =>
        ['PRESENT', 'LATE', 'OVERTIME', 'HALF_DAY'].includes(r.status)
      );
      const hasLeave = empRecords.some((r) => r.status === 'LEAVE');
      const hasOD = empRecords.some((r) => r.status === 'OD' || r.status === 'OFFICIAL_DUTY');

      if (hasPresent) presentCount++;
      else if (hasLeave) leaveCount++;
      else if (hasOD) odCount++;
      else if (isPastCutoff) absentCount++;
    });

    return {
      P: presentCount,
      A: absentCount,
      L: leaveCount,
      OD: odCount,
    };
  }, [employees, records, isPastCutoff]);

  // Checkbox handlers
  const handleSelectAll = (e) => {
    if (e.target.checked) {
      setSelectedIds(employeeRows.map((r) => r.employee.id));
    } else {
      setSelectedIds([]);
    }
  };

  const handleSelectRow = (id) => {
    setSelectedIds((prev) =>
      prev.includes(id) ? prev.filter((rowId) => rowId !== id) : [...prev, id]
    );
  };

  // Handle Manual Status Click (Opens Modal)
  const handleStatusClick = (row, newStatus) => {
    if (row.status === newStatus) return;
    setOverrideModal({
      isOpen: true,
      employeeRow: row,
      newStatus,
    });
    setOverrideReason('');
    setOverrideNotes('');
  };

  const submitManualOverride = async () => {
    const { employeeRow, newStatus } = overrideModal;
    if (!employeeRow) return;

    try {
      setSavingStatus(employeeRow.employee.id);
      setOverrideModal({ isOpen: false, employeeRow: null, newStatus: '' });
      await createManualAttendance({
        employeeId: employeeRow.employee.id,
        date: selectedDate,
        checkInTime: '09:00',
        status: newStatus,
        source: 'MANUAL',
        reason: overrideReason,
        notes: overrideNotes,
      });
      fetchData(true);
    } catch (err) {
      alert('Unable to update attendance. Please try again.');
    } finally {
      setSavingStatus(null);
    }
  };

  // Export to PDF (Exact Replica of Executive Attendance UI Mockup)
  const handleExportPDF = () => {
    if (employeeRows.length === 0) {
      alert('No attendance records available to export for this date.');
      return;
    }

    // Standard A4 Portrait (210mm x 297mm)
    const doc = new jsPDF({
      orientation: 'portrait',
      unit: 'mm',
      format: 'a4',
    });

    const pageWidth = doc.internal.pageSize.getWidth(); // 210mm
    const pageHeight = doc.internal.pageSize.getHeight(); // 297mm

    // Formatted Human Date (e.g. "Monday, October 26, 2026")
    let formattedDateStr = selectedDate;
    try {
      const [yr, mo, da] = selectedDate.split('-');
      const dObj = new Date(Number(yr), Number(mo) - 1, Number(da));
      formattedDateStr = dObj.toLocaleDateString('en-US', {
        weekday: 'long',
        year: 'numeric',
        month: 'long',
        day: 'numeric',
      });
    } catch {}

    const now = new Date();
    const genDateStr = now.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
    const genTimeStr = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

    // ── Wave Drawing Helper for Bottom Background ──
    const drawWaveLayer = (points, rgb) => {
      doc.setFillColor(rgb[0], rgb[1], rgb[2]);
      const lineDeltas = [];
      for (let i = 1; i < points.length; i++) {
        lineDeltas.push([points[i][0] - points[i - 1][0], points[i][1] - points[i - 1][1]]);
      }
      doc.lines(lineDeltas, points[0][0], points[0][1], [1, 1], 'F', true);
    };

    const drawFooterWaves = () => {
      // Wave 1: Softest Mint Background Wave
      const w1 = [
        [0, 297], [0, 280],
        [35, 278], [75, 275], [115, 274], [155, 277], [185, 281], [210, 278],
        [210, 297]
      ];
      drawWaveLayer(w1, [240, 253, 244]);

      // Wave 2: Middle Mint Wave
      const w2 = [
        [0, 297], [0, 288],
        [40, 285], [80, 279], [125, 278], [165, 282], [195, 286], [210, 284],
        [210, 297]
      ];
      drawWaveLayer(w2, [220, 252, 231]);

      // Wave 3: Foreground Emerald Wave
      const w3 = [
        [0, 297], [0, 292],
        [45, 290], [90, 285], [135, 282], [175, 284], [210, 289],
        [210, 297]
      ];
      drawWaveLayer(w3, [187, 247, 208]);
    };

    // ── Draw Calendar Vector Icon Helper ──
    const drawCalendarIcon = (x, y) => {
      doc.setDrawColor(5, 150, 105);
      doc.setLineWidth(0.35);
      doc.roundedRect(x, y + 0.5, 4.8, 4.8, 0.8, 0.8, 'S');
      doc.setFillColor(5, 150, 105);
      doc.rect(x, y + 0.5, 4.8, 1.4, 'F');
      // Rings
      doc.setLineWidth(0.35);
      doc.line(x + 1.2, y, x + 1.2, y + 0.9);
      doc.line(x + 3.6, y, x + 3.6, y + 0.9);
      // Grid dots
      doc.setFillColor(5, 150, 105);
      doc.rect(x + 1.1, y + 2.6, 0.65, 0.65, 'F');
      doc.rect(x + 2.1, y + 2.6, 0.65, 0.65, 'F');
      doc.rect(x + 3.1, y + 2.6, 0.65, 0.65, 'F');
      doc.rect(x + 1.1, y + 3.6, 0.65, 0.65, 'F');
      doc.rect(x + 2.1, y + 3.6, 0.65, 0.65, 'F');
      doc.rect(x + 3.1, y + 3.6, 0.65, 0.65, 'F');
    };

    // ── 1. Top Header (Brand, Logo & Document Meta) ──
    // FD Emerald Logo Badge
    doc.setFillColor(4, 120, 87); // #047857
    doc.roundedRect(14, 13, 13, 13, 2.5, 2.5, 'F');
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(9.5);
    doc.setTextColor(255, 255, 255);
    doc.text('FD', 20.5, 21.2, { align: 'center' });

    // Vertical Divider Line next to Logo
    doc.setDrawColor(203, 213, 225);
    doc.setLineWidth(0.35);
    doc.line(31.5, 13, 31.5, 26);

    // Company & Platform Text
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(13);
    doc.setTextColor(15, 23, 42); // #0f172a
    doc.text('ABIRAMI TECHNOLOGIES', 35, 18.5);

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7.5);
    doc.setTextColor(100, 116, 139); // #64748b
    doc.text('FaceDetect™ Biometric AI Surveillance & Attendance Platform', 35, 23.5);

    // Vertical Divider Line on Right
    doc.setDrawColor(203, 213, 225);
    doc.line(138, 13, 138, 26);

    // Right-aligned Document Meta
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(7.8);
    doc.setTextColor(4, 120, 87); // #047857
    doc.text('OFFICIAL ATTENDANCE REPORT', pageWidth - 14, 16.5, { align: 'right' });

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(6.8);
    doc.setTextColor(100, 116, 139);
    doc.text(`Doc Ref: ATT-${selectedDate.replace(/-/g, '')}`, pageWidth - 14, 20.5, { align: 'right' });
    doc.text(`Generated: ${genDateStr}, ${genTimeStr}`, pageWidth - 14, 24.5, { align: 'right' });

    // Horizontal Divider Line below Header
    doc.setDrawColor(167, 243, 208); // #a7f3d0 Soft emerald
    doc.setLineWidth(0.4);
    doc.line(14, 32, pageWidth - 14, 32);

    // ── 2. Title & Date Row ──
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(12);
    doc.setTextColor(15, 23, 42);
    doc.text('DAILY ATTENDANCE & BIOMETRIC VERIFICATION LOG', 14, 40.5);

    // Calendar Icon & Date
    drawCalendarIcon(14, 43.5);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8.2);
    doc.setTextColor(100, 116, 139);
    doc.text('Attendance Date: ', 21.5, 47.8);

    doc.setFont('helvetica', 'bold');
    doc.setTextColor(6, 95, 70); // #065f46 Deep Green
    doc.text(formattedDateStr, 48, 47.8);

    // Live CCTV Sync Pill on Right
    doc.setFillColor(236, 253, 245);
    doc.setDrawColor(134, 239, 172); // #86efac
    doc.setLineWidth(0.25);
    doc.roundedRect(pageWidth - 64, 43.5, 50, 6.4, 1.5, 1.5, 'FD');

    // Solid Green Dot
    doc.setFillColor(16, 185, 129);
    doc.circle(pageWidth - 60, 46.7, 1.1, 'F');

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(6.5);
    doc.setTextColor(4, 120, 87);
    doc.text('LIVE CCTV SYNC VERIFIED', pageWidth - 57, 47.6);

    // ── 3. 5 KPI Stat Cards (Full 182mm Width Symmetrical) ──
    const totalEmp = employeeRows.length;
    const attRate = totalEmp > 0 ? Math.round((summary.P / totalEmp) * 100) : 0;
    const stats = [
      {
        label: 'TOTAL STAFF',
        count: totalEmp,
        sub: '100% Roster',
        color: [15, 23, 42],
        accent: [5, 150, 105],
        iconBg: [236, 253, 245],
        type: 'team',
      },
      {
        label: 'PRESENT',
        count: summary.P,
        sub: `${attRate}% Rate`,
        color: [15, 23, 42],
        accent: [5, 150, 105],
        iconBg: [236, 253, 245],
        type: 'user',
      },
      {
        label: 'ABSENT',
        count: summary.A,
        sub: `${totalEmp > 0 ? Math.round((summary.A / totalEmp) * 100) : 0}% Rate`,
        color: [15, 23, 42],
        accent: [239, 68, 68],
        iconBg: [254, 242, 242],
        type: 'absent',
      },
      {
        label: 'ON LEAVE',
        count: summary.L,
        sub: 'Approved',
        color: [15, 23, 42],
        accent: [245, 158, 11],
        iconBg: [255, 251, 235],
        type: 'leave',
      },
      {
        label: 'OFF. DUTY',
        count: summary.OD,
        sub: 'On-Field',
        color: [15, 23, 42],
        accent: [139, 92, 246],
        iconBg: [245, 243, 255],
        type: 'od',
      },
    ];

    const cardW = 33.6; // (182 - 4 * 3.5) / 5 = 33.6mm
    const cardH = 16;
    const cardY = 53.5;
    const gap = 3.5;
    const startX = 14;

    stats.forEach((s, idx) => {
      const x = startX + idx * (cardW + gap);

      // Card Base
      doc.setFillColor(255, 255, 255);
      doc.setDrawColor(226, 232, 240);
      doc.setLineWidth(0.25);
      doc.roundedRect(x, cardY, cardW, cardH, 2, 2, 'FD');

      // Left Accent Strip (2.4mm)
      doc.setFillColor(s.accent[0], s.accent[1], s.accent[2]);
      doc.roundedRect(x, cardY, 2.4, cardH, 1, 1, 'F');
      doc.rect(x + 1.2, cardY, 1.2, cardH, 'F');

      // Card Icon Box
      const iconX = x + 3.8;
      const iconY = cardY + 3.8;
      doc.setFillColor(s.iconBg[0], s.iconBg[1], s.iconBg[2]);
      doc.roundedRect(iconX, iconY, 7.5, 8.2, 1.4, 1.4, 'F');

      // Draw Icon Primitives inside Icon Box
      if (s.type === 'team') {
        doc.setFillColor(5, 150, 105);
        doc.circle(iconX + 3.75, iconY + 2.5, 1, 'F');
        doc.roundedRect(iconX + 2.25, iconY + 4, 3, 2.7, 0.8, 0.8, 'F');
        doc.circle(iconX + 1.8, iconY + 3.2, 0.75, 'F');
        doc.circle(iconX + 5.7, iconY + 3.2, 0.75, 'F');
      } else if (s.type === 'user') {
        doc.setFillColor(5, 150, 105);
        doc.circle(iconX + 3.75, iconY + 2.7, 1.2, 'F');
        doc.roundedRect(iconX + 1.9, iconY + 4.3, 3.7, 2.7, 1, 1, 'F');
      } else if (s.type === 'absent') {
        doc.setFillColor(239, 68, 68);
        doc.circle(iconX + 3, iconY + 2.7, 1.1, 'F');
        doc.roundedRect(iconX + 1.5, iconY + 4.3, 3.2, 2.7, 0.8, 0.8, 'F');
        doc.setDrawColor(239, 68, 68);
        doc.setLineWidth(0.4);
        doc.line(iconX + 5.2, iconY + 3.2, iconX + 6.6, iconY + 4.6);
        doc.line(iconX + 6.6, iconY + 3.2, iconX + 5.2, iconY + 4.6);
      } else if (s.type === 'leave') {
        doc.setDrawColor(245, 158, 11);
        doc.setLineWidth(0.35);
        doc.roundedRect(iconX + 1.6, iconY + 2.2, 4.3, 4.2, 0.6, 0.6, 'S');
        doc.setFillColor(245, 158, 11);
        doc.rect(iconX + 1.6, iconY + 2.2, 4.3, 1.2, 'F');
      } else if (s.type === 'od') {
        doc.setDrawColor(139, 92, 246);
        doc.setLineWidth(0.35);
        doc.roundedRect(iconX + 1.5, iconY + 2.8, 4.5, 3.6, 0.8, 0.8, 'S');
        doc.rect(iconX + 2.6, iconY + 1.8, 2.3, 1.2, 'S');
      }

      // Card Text
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(5.8);
      doc.setTextColor(100, 116, 139);
      doc.text(s.label, x + 13.5, cardY + 5.8);

      doc.setFont('helvetica', 'bold');
      doc.setFontSize(11);
      doc.setTextColor(15, 23, 42);
      doc.text(String(s.count), x + 13.5, cardY + 10.8);

      doc.setFont('helvetica', 'normal');
      doc.setFontSize(5.5);
      doc.setTextColor(148, 163, 184);
      doc.text(s.sub, x + 13.5, cardY + 14.2);
    });

    // ── 4. Table Data Mapping ──
    const tableData = employeeRows.map((r, i) => {
      const code = r.employee?.employeeCode || '—';
      const name = `${r.employee?.firstName || ''} ${r.employee?.lastName || ''}`.trim() || 'Unknown';
      const dept = r.employee?.department || 'General';
      const inTime = r.inTimeStr && r.inTimeStr !== '—' ? r.inTimeStr : '—';
      const outTime = r.outTimeStr && r.outTimeStr !== '—' ? r.outTimeStr : '—';
      const duration = r.workingDurationStr || '—';
      const status = r.status || 'PENDING';

      return [i + 1, code, name, dept, inTime, outTime, duration, status];
    });

    // ── 5. Full-Width Portrait Data Table (Exact 182mm Width) ──
    autoTable(doc, {
      startY: 74,
      head: [['#', 'EMP CODE', 'EMPLOYEE NAME', 'DEPARTMENT', 'ENTRY (IN)', 'EXIT (OUT)', 'DURATION', 'STATUS']],
      body: tableData,
      theme: 'grid',
      styles: {
        font: 'helvetica',
        fontSize: 7.8,
        cellPadding: { top: 3.2, bottom: 3.2, left: 2.5, right: 2.5 },
        textColor: [30, 41, 59],
        lineColor: [226, 232, 240], // #e2e8f0 soft borders
        lineWidth: 0.25,
        valign: 'middle',
      },
      headStyles: {
        fillColor: [6, 78, 59], // #064e3b Deep Forest Emerald Header
        textColor: [255, 255, 255],
        fontStyle: 'bold',
        fontSize: 7.2,
        halign: 'left',
        cellPadding: { top: 3.8, bottom: 3.8, left: 2.5, right: 2.5 },
      },
      alternateRowStyles: {
        fillColor: [255, 255, 255],
      },
      columnStyles: {
        0: { cellWidth: 10, halign: 'center' },
        1: { cellWidth: 22, fontStyle: 'bold' },
        2: { cellWidth: 42, fontStyle: 'bold' },
        3: { cellWidth: 28 },
        4: { cellWidth: 24, halign: 'center' },
        5: { cellWidth: 24, halign: 'center' },
        6: { cellWidth: 16, halign: 'center' },
        7: { cellWidth: 16, halign: 'center' },
      },
      didParseCell: function (data) {
        if (data.section === 'head') {
          if (data.column.index === 0 || data.column.index === 4 || data.column.index === 5 || data.column.index === 6 || data.column.index === 7) {
            data.cell.styles.halign = 'center';
          }
        }
        if (data.section === 'body' && data.column.index === 7) {
          // Clear default text to draw custom rounded pill badge
          data.cell.text = [];
        }
      },
      didDrawCell: function (data) {
        if (data.section === 'body' && data.column.index === 7) {
          const val = String(data.cell.raw || 'PENDING').trim().toUpperCase();
          const cell = data.cell;
          const badgeW = 14.5;
          const badgeH = 4.8;
          const badgeX = cell.x + (cell.width - badgeW) / 2;
          const badgeY = cell.y + (cell.height - badgeH) / 2;

          let bg = [236, 253, 245]; // #ecfdf5
          let text = [5, 150, 105];  // #059669
          let border = [167, 243, 208]; // #a7f3d0

          if (val === 'PRESENT') {
            bg = [220, 252, 231];
            text = [21, 128, 61];
            border = [134, 239, 172];
          } else if (val === 'ABSENT') {
            bg = [254, 226, 226];
            text = [185, 28, 28];
            border = [252, 165, 165];
          } else if (val === 'LEAVE') {
            bg = [254, 243, 199];
            text = [180, 83, 9];
            border = [252, 211, 77];
          } else if (val === 'OD' || val === 'OFFICIAL_DUTY') {
            bg = [243, 232, 255];
            text = [126, 34, 206];
            border = [216, 180, 254];
          } else if (val === 'LATE') {
            bg = [255, 237, 213];
            text = [194, 65, 12];
            border = [253, 186, 116];
          }

          doc.setFillColor(bg[0], bg[1], bg[2]);
          doc.setDrawColor(border[0], border[1], border[2]);
          doc.setLineWidth(0.2);
          doc.roundedRect(badgeX, badgeY, badgeW, badgeH, 1.8, 1.8, 'FD');

          doc.setFont('helvetica', 'bold');
          doc.setFontSize(6.2);
          doc.setTextColor(text[0], text[1], text[2]);
          doc.text(val, badgeX + badgeW / 2, badgeY + 3.3, { align: 'center' });
        }
      },
      didDrawPage: function () {
        // ── 6. Bottom Footer Section (Matches Mockup) ──
        // Clean Divider Line above Footer
        doc.setDrawColor(226, 232, 240);
        doc.setLineWidth(0.35);
        doc.line(14, pageHeight - 38, pageWidth - 14, pageHeight - 38);

        // Left Side Footer Branding
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(10.5);
        doc.setTextColor(15, 23, 42);
        doc.text('ABIRAMI TECHNOLOGIES', 14, pageHeight - 29);

        doc.setFont('helvetica', 'normal');
        doc.setFontSize(7.2);
        doc.setTextColor(100, 116, 139);
        doc.text('FaceDetect™ Biometric AI Surveillance & Attendance Platform', 14, pageHeight - 24.5);

        // Emerald Underline Bar
        doc.setFillColor(5, 150, 105);
        doc.rect(14, pageHeight - 21.5, 18, 1.3, 'F');

        // Right Side Divider
        doc.setDrawColor(203, 213, 225);
        doc.setLineWidth(0.35);
        doc.line(140, pageHeight - 32, 140, pageHeight - 20);

        // Right Side Calendar Icon & Report Date
        drawCalendarIcon(144, pageHeight - 31);

        doc.setFont('helvetica', 'normal');
        doc.setFontSize(7.2);
        doc.setTextColor(100, 116, 139);
        doc.text('Report Date', 153, pageHeight - 28.5);

        doc.setFont('helvetica', 'bold');
        doc.setFontSize(8.2);
        doc.setTextColor(15, 23, 42);
        doc.text(formattedDateStr, 153, pageHeight - 24);

        // Decorative Mint Waves at the very bottom
        drawFooterWaves();
      },
      margin: { top: 20, left: 14, right: 14, bottom: 44 },
    });

    doc.save(`Attendance_Log_${selectedDate}.pdf`);
  };

  // Avatar helper
  const getInitials = (first, last) => {
    const f = first ? first.charAt(0).toUpperCase() : '';
    const l = last ? last.charAt(0).toUpperCase() : '';
    return f + l || '?';
  };

  // Trigger date picker popup
  const openDatePicker = () => {
    if (dateInputRef.current) {
      try {
        dateInputRef.current.showPicker();
      } catch (e) {
        dateInputRef.current.focus();
      }
    }
  };

  return (
    <div className="attendance-log-page fade-in">
      {/* ── 1. HEADER SECTION ────────────────────────────────────────── */}
      <div className="att-header-row">
        <div className="att-header-left">
          <div className="att-icon-box">
            <svg
              viewBox="0 0 24 24"
              width="26"
              height="26"
              fill="none"
              stroke="#059669"
              strokeWidth="2.2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <rect x="3" y="4" width="18" height="18" rx="3" ry="3" />
              <line x1="16" y1="2" x2="16" y2="6" />
              <line x1="8" y1="2" x2="8" y2="6" />
              <line x1="3" y1="10" x2="21" y2="10" />
              <polyline points="9 16 12 13 15 16" />
            </svg>
          </div>
          <div className="att-header-text">
            <h1 className="att-title">
              {userRole === 'STAFF' ? 'My Attendance Log' : 'Attendance Log'}
            </h1>
            <p className="att-subtitle">
              {userRole === 'STAFF'
                ? 'View and track your daily attendance status and punch logs'
                : 'Daily employee attendance status and camera logs'}
            </p>
          </div>
        </div>
      </div>

      {error && <div className="alert alert-danger" style={{ marginBottom: '20px' }}>{error}</div>}

      {/* ── 2. DATE NAVIGATION & DUAL-CAMERA SYSTEM TOOLBAR ─────────── */}
      <div className="att-date-status-bar">
        {/* Left: Date controls */}
        <div className="att-date-controls-group">
          <button
            type="button"
            className="att-date-btn-nav"
            onClick={() => changeDate(-1)}
            title="Previous Day"
          >
            <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="15 18 9 12 15 6" />
            </svg>
          </button>
          <button
            type="button"
            className={`att-date-btn-today ${isToday ? 'active' : ''}`}
            onClick={() => setSelectedDate(getTodayString())}
          >
            Today
          </button>
          <button
            type="button"
            className="att-date-btn-nav"
            onClick={() => changeDate(1)}
            title="Next Day"
          >
            <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="9 18 15 12 9 6" />
            </svg>
          </button>

          {/* Date Selector Pill */}
          <div
            className={`att-date-display-pill ${isCalendarOpen ? 'active' : ''}`}
            onClick={() => setIsCalendarOpen((prev) => !prev)}
            title="Click to select date"
          >
            <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
              <line x1="16" y1="2" x2="16" y2="6" />
              <line x1="8" y1="2" x2="8" y2="6" />
              <line x1="3" y1="10" x2="21" y2="10" />
            </svg>
            <span className="att-date-display-text">{formattedDateLong}</span>
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
                transform: isCalendarOpen ? 'rotate(180deg)' : 'none',
                transition: 'transform 0.2s ease',
              }}
            >
              <polyline points="6 9 12 15 18 9" />
            </svg>

            {/* Modern Custom Themed Calendar Popover */}
            {isCalendarOpen && (
              <AttendanceCalendarPopover
                selectedDate={selectedDate}
                onSelectDate={(newDate) => {
                  setSelectedDate(newDate);
                  setIsCalendarOpen(false);
                }}
                onClose={() => setIsCalendarOpen(false)}
              />
            )}
          </div>
        </div>

        {/* Camera network reachability is separate from RTSP frame-decode status. */}
        {(isAdmin || userRole === 'SECURITY') && (() => {
          const hasCameras = cameras.length > 0;
          const anyReachable = cameras.some((camera) => isCameraNetworkReachable(camera, streamStatus));
          const isReconnecting = streamStatus?.status === 'RECONNECTING' || streamStatus?.status === 'CONNECTING';

          return (
            <div className={`att-camera-system-pill ${anyReachable ? 'sys-online' : 'sys-offline'}`}>
              <div className="camera-system-left">
                {anyReachable ? (
                  <span className="att-live-dot-pulse" title="Camera network reachable; RTSP decode not verified here." />
                ) : isReconnecting ? (
                  <span className="att-dot-amber" title="Camera event API reconnecting..." />
                ) : (
                  <span className="att-dot-offline" title="Camera network is not reachable." />
                )}
                <span className="camera-system-title">
                  {anyReachable
                    ? 'Camera Network'
                    : isReconnecting
                    ? 'Camera Event API (Reconnecting)'
                    : 'Camera Network (Unavailable)'}
                </span>
              </div>

              {!hasCameras ? (
                <div className="camera-badge-offline">
                  <span className="camera-badge-dot dot-red" />
                  <span className="badge-offline-text">No Cameras Configured</span>
                </div>
              ) : (
                cameras.map((cam) => {
                  const isReachable = isCameraNetworkReachable(cam, streamStatus);
                  const isEntrance = (cam.location || '').toLowerCase().includes('in') || (cam.name || '').includes('02');
                  const roleLabel = isEntrance ? 'IN' : 'OUT';

                  return (
                    <div
                      key={cam.id || cam.name}
                      className={isReachable ? (isEntrance ? 'camera-badge-in' : 'camera-badge-out') : 'camera-badge-offline'}
                      title={`IP: ${cam.ipAddress || '—'} | Network: ${isReachable ? 'Reachable' : 'Unreachable'}. RTSP decode is tested separately.`}
                    >
                      <span className={`camera-badge-dot ${isReachable ? (isEntrance ? 'dot-green' : 'dot-blue') : 'dot-red'}`} />
                      <span>{cam.name} ({roleLabel})</span>
                      <span className={isReachable ? 'badge-online-text' : 'badge-offline-text'}>
                        {isReachable ? 'Reachable' : 'Unreachable'}
                      </span>
                    </div>
                  );
                })
              )}
            </div>
          );
        })()}

        {/* Right: Live Status Button */}
        <div className="att-live-status-wrap">
          <button
            type="button"
            className="att-btn-live-status"
            onClick={() => fetchData(true)}
            title="Click to refresh live attendance feed"
          >
            <svg
              viewBox="0 0 24 24"
              width="15"
              height="15"
              fill="none"
              stroke="#059669"
              strokeWidth="2.2"
              strokeLinecap="round"
              strokeLinejoin="round"
              style={{ animation: isRefreshing ? 'spin 1s linear infinite' : 'none' }}
            >
              <path d="M5 12.55a11 11 0 0 1 14.08 0" />
              <path d="M1.42 9a16 16 0 0 1 21.16 0" />
              <path d="M8.53 16.11a6 6 0 0 1 6.95 0" />
              <line x1="12" y1="20" x2="12.01" y2="20" />
            </svg>
            <span>{isRefreshing ? 'Refreshing...' : 'Live Status'}</span>
          </button>
        </div>
      </div>

      {/* ── 4. SEARCH & FILTER CONTROLS BAR ─────────────────────────── */}
      <div className="att-search-filter-bar">
        {/* Search Field */}
        <div className="att-search-input-wrap">
          <svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="#64748b" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="11" cy="11" r="8" />
            <line x1="21" y1="21" x2="16.65" y2="16.65" />
          </svg>
          <input
            type="text"
            className="att-search-field"
            placeholder="Search employee name, code, department..."
            value={employeeSearch}
            onChange={(e) => setEmployeeSearch(e.target.value)}
          />
          {employeeSearch && (
            <button
              type="button"
              className="att-search-clear-btn"
              onClick={() => setEmployeeSearch('')}
            >
              <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <line x1="18" y1="6" x2="6" y2="18" />
                <line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button>
          )}
        </div>

        {/* Action Controls */}
        <div className="att-filter-actions-group">
          {/* Department Filter Dropdown */}
          <div className="att-dropdown-relative">
            <button
              type="button"
              className={`att-filter-dropdown-btn ${selectedDept !== 'ALL' ? 'active-filter' : ''}`}
              onClick={() => {
                setDeptDropdownOpen(!deptDropdownOpen);
                setStatusDropdownOpen(false);
              }}
            >
              <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <rect x="3" y="3" width="7" height="7" />
                <rect x="14" y="3" width="7" height="7" />
                <rect x="14" y="14" width="7" height="7" />
                <rect x="3" y="14" width="7" height="7" />
              </svg>
              <span>{selectedDept === 'ALL' ? 'All Departments' : selectedDept}</span>
              <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="6 9 12 15 18 9" />
              </svg>
            </button>

            {deptDropdownOpen && (
              <div className="att-dropdown-menu">
                <div
                  className={`att-dropdown-item ${selectedDept === 'ALL' ? 'selected' : ''}`}
                  onClick={() => {
                    setSelectedDept('ALL');
                    setDeptDropdownOpen(false);
                  }}
                >
                  All Departments
                </div>
                {departmentList.map((dept) => (
                  <div
                    key={dept}
                    className={`att-dropdown-item ${selectedDept === dept ? 'selected' : ''}`}
                    onClick={() => {
                      setSelectedDept(dept);
                      setDeptDropdownOpen(false);
                    }}
                  >
                    {dept}
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Status Filter Dropdown */}
          <div className="att-dropdown-relative">
            <button
              type="button"
              className={`att-filter-dropdown-btn ${selectedStatus !== 'ALL' ? 'active-filter' : ''}`}
              onClick={() => {
                setStatusDropdownOpen(!statusDropdownOpen);
                setDeptDropdownOpen(false);
              }}
            >
              <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z" />
                <line x1="7" y1="7" x2="7.01" y2="7" />
              </svg>
              <span>
                {selectedStatus === 'ALL'
                  ? 'All Status'
                  : selectedStatus === 'OD'
                  ? 'Official Duty'
                  : selectedStatus}
              </span>
              <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="6 9 12 15 18 9" />
              </svg>
            </button>

            {statusDropdownOpen && (
              <div className="att-dropdown-menu">
                <div
                  className={`att-dropdown-item ${selectedStatus === 'ALL' ? 'selected' : ''}`}
                  onClick={() => {
                    setSelectedStatus('ALL');
                    setStatusDropdownOpen(false);
                  }}
                >
                  All Status
                </div>
                <div
                  className={`att-dropdown-item ${selectedStatus === 'PRESENT' ? 'selected' : ''}`}
                  onClick={() => {
                    setSelectedStatus('PRESENT');
                    setStatusDropdownOpen(false);
                  }}
                >
                  Present
                </div>
                <div
                  className={`att-dropdown-item ${selectedStatus === 'ABSENT' ? 'selected' : ''}`}
                  onClick={() => {
                    setSelectedStatus('ABSENT');
                    setStatusDropdownOpen(false);
                  }}
                >
                  Absent
                </div>
                <div
                  className={`att-dropdown-item ${selectedStatus === 'LEAVE' ? 'selected' : ''}`}
                  onClick={() => {
                    setSelectedStatus('LEAVE');
                    setStatusDropdownOpen(false);
                  }}
                >
                  Leave
                </div>
                <div
                  className={`att-dropdown-item ${selectedStatus === 'OD' ? 'selected' : ''}`}
                  onClick={() => {
                    setSelectedStatus('OD');
                    setStatusDropdownOpen(false);
                  }}
                >
                  Official Duty (OD)
                </div>
              </div>
            )}
          </div>

          {/* Filters Toggle / Reset */}
          <button
            type="button"
            className="att-filter-dropdown-btn"
            onClick={() => {
              setSelectedDept('ALL');
              setSelectedStatus('ALL');
              setEmployeeSearch('');
            }}
            title="Reset Filters"
          >
            <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3" />
            </svg>
            <span>Filters</span>
          </button>

          {/* Export Button */}
          <button
            type="button"
            className="att-btn-export"
            onClick={handleExportPDF}
            title="Export attendance table to PDF"
          >
            <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
              <polyline points="7 10 12 15 17 10" />
              <line x1="12" y1="15" x2="12" y2="3" />
            </svg>
            <span>Export PDF</span>
          </button>
        </div>
      </div>

      {/* ── 5. ATTENDANCE TABLE CARD ─────────────────────────────────── */}
      <div className="att-table-card">
        {loading && records.length === 0 ? (
          <div style={{ padding: '60px 0' }}>
            <Loader message="Loading attendance logs..." />
          </div>
        ) : (
          <div className="table-responsive" style={{ overflowX: 'auto', width: '100%' }}>
            <table className="att-custom-table">
              <thead>
                <tr>
                  <th style={{ width: '40px', textAlign: 'center' }}>
                    <input
                      type="checkbox"
                      className="att-checkbox"
                      checked={
                        employeeRows.length > 0 &&
                        selectedIds.length === employeeRows.length
                      }
                      onChange={handleSelectAll}
                    />
                  </th>
                  <th style={{ width: '4%' }}>S.No</th>
                  <th style={{ width: '22%' }}>EMPLOYEE</th>
                  <th style={{ width: '13%' }}>DEPARTMENT</th>
                  <th style={{ width: '11%' }}>ENTRY (IN)</th>
                  <th style={{ width: '11%' }}>EXIT (OUT)</th>
                  <th style={{ width: '10%' }}>DURATION</th>
                  <th style={{ width: '11%', textAlign: 'center' }}>STATUS</th>
                  {isAdmin && <th style={{ width: '11%', textAlign: 'center' }}>MANUAL</th>}
                  <th style={{ width: '7%', textAlign: 'center' }}>ACTION</th>
                </tr>
              </thead>
              <tbody>
                {employeeRows.length === 0 ? (
                  <tr>
                    <td colSpan={isAdmin ? 10 : 9} style={{ padding: 0 }}>
                      <div className="att-empty-wrap">
                        {/* Empty Illustration with Soft Radiance, Document, & Sparkles */}
                        <div className="att-empty-icon">
                          <svg width="84" height="84" viewBox="0 0 90 90" fill="none">
                            {/* Star sparkles */}
                            <path d="M22 36 L24 38 L22 40 L20 38 Z" fill="#34d399" />
                            <circle cx="28" cy="24" r="1.5" fill="#10b981" />
                            <circle cx="68" cy="24" r="1.5" fill="#10b981" />
                            <path d="M72 36 L74 38 L72 40 L70 38 Z" fill="#34d399" />

                            {/* Soft glowing ellipse */}
                            <ellipse cx="45" cy="45" rx="36" ry="26" fill="#ecfdf5" />

                            {/* Document Card with Lines */}
                            <rect
                              x="29"
                              y="16"
                              width="32"
                              height="44"
                              rx="6"
                              stroke="#059669"
                              strokeWidth="2.2"
                              fill="#ffffff"
                            />
                            {/* Checkmark circle or lines */}
                            <line x1="36" y1="26" x2="54" y2="26" stroke="#059669" strokeWidth="2" strokeLinecap="round" />
                            <line x1="36" y1="33" x2="54" y2="33" stroke="#059669" strokeWidth="2" strokeLinecap="round" />
                            <line x1="36" y1="40" x2="48" y2="40" stroke="#059669" strokeWidth="2" strokeLinecap="round" />
                            <circle cx="53" cy="47" r="1.5" fill="#059669" />
                          </svg>
                        </div>
                        <h3 className="att-empty-title">
                          No attendance records found for the selected date.
                        </h3>
                        <p className="att-empty-desc">
                          Try selecting a different date or adjust the filters.
                        </p>
                        <button
                          type="button"
                          className="att-empty-cta-btn"
                          onClick={openDatePicker}
                        >
                          <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
                            <line x1="16" y1="2" x2="16" y2="6" />
                            <line x1="8" y1="2" x2="8" y2="6" />
                            <line x1="3" y1="10" x2="21" y2="10" />
                          </svg>
                          <span>View Another Date</span>
                        </button>
                      </div>
                    </td>
                  </tr>
                ) : (
                  employeeRows.map((row, idx) => {
                    const emp = row.employee;
                    const empName = `${emp.firstName || ''} ${emp.lastName || ''}`.trim() || '—';
                    const isSelected = selectedIds.includes(emp.id);

                    return (
                      <tr key={emp.id || idx} className={isSelected ? 'row-selected' : ''}>
                        {/* Checkbox */}
                        <td style={{ textAlign: 'center' }}>
                          <input
                            type="checkbox"
                            className="att-checkbox"
                            checked={isSelected}
                            onChange={() => handleSelectRow(emp.id)}
                          />
                        </td>

                        {/* Number # */}
                        <td>
                          <span className="att-index-text">{idx + 1}</span>
                        </td>

                        {/* Employee */}
                        <td>
                          <div className="att-emp-cell">
                            {emp.photoUrl ? (
                              <img
                                className="att-emp-avatar"
                                src={(emp.photoUrl?.startsWith('http') ? emp.photoUrl : `/employee-images/${emp.photoUrl}`)}
                                alt={empName}
                                onError={(e) => {
                                  e.target.style.display = 'none';
                                  if (e.target.nextSibling) {
                                    e.target.nextSibling.style.display = 'flex';
                                  }
                                }}
                              />
                            ) : null}
                            <div
                              className="att-emp-fallback"
                              style={{ display: emp.photoUrl ? 'none' : 'flex' }}
                            >
                              {getInitials(emp.firstName, emp.lastName)}
                            </div>
                            <div className="att-emp-meta">
                              <span className="att-emp-name">{empName}</span>
                              <div className="att-emp-subline">
                                <span className="att-emp-code">{emp.employeeCode || '—'}</span>
                                {row.isLate && (
                                  <span className="att-badge-late">LATE</span>
                                )}
                              </div>
                            </div>
                          </div>
                        </td>

                        {/* Department */}
                        <td>
                          <span className="att-dept-pill">{emp.department || '—'}</span>
                        </td>

                        {/* Entry (IN) */}
                        <td>
                          <div className="att-time-cell">
                            <span className="att-time-val">{row.inTimeStr}</span>
                            {row.firstIn && (
                              <span className="att-cam-tag cam-in">
                                {row.inCamera || 'CAM-02'} [IN]
                              </span>
                            )}
                          </div>
                        </td>

                        {/* Exit (OUT) */}
                        <td>
                          <div className="att-time-cell">
                            <span className="att-time-val">{row.outTimeStr}</span>
                            {row.lastOut && (
                              <span className="att-cam-tag cam-out">
                                {row.outCamera || 'CAM-01'} [OUT]
                              </span>
                            )}
                          </div>
                        </td>

                        {/* Duration */}
                        <td>
                          <div className="att-duration-cell">
                            <span className="att-duration-val">{row.workingDurationStr}</span>
                            {row.incompleteReason && (
                              <span className="att-incomplete-tag">
                                {row.incompleteReason}
                              </span>
                            )}
                          </div>
                        </td>

                        {/* Status */}
                        <td style={{ textAlign: 'center' }}>
                          <span
                            className={`att-status-pill ${
                              row.status === 'PRESENT'
                                ? 'status-present'
                                : row.status === 'LATE'
                                ? 'status-late'
                                : row.status === 'ABSENT'
                                ? 'status-absent'
                                : row.status === 'LEAVE'
                                ? 'status-leave'
                                : row.status === 'OD'
                                ? 'status-od'
                                : 'status-pending'
                            }`}
                          >
                            <span className="att-status-dot" />
                            <span>{row.status || 'PENDING'}</span>
                          </span>
                        </td>

                        {/* Manual Action Controls */}
                        {isAdmin && (
                          <td style={{ textAlign: 'center' }}>
                            <div className="att-manual-toggles">
                            <button
                              type="button"
                              className={`att-manual-btn btn-p ${row.status === 'PRESENT' ? 'active-p' : ''} ${savingStatus === emp.id ? 'loading' : ''}`}
                              onClick={() => handleStatusClick(row, 'PRESENT')}
                              title="Mark PRESENT"
                            >
                              P
                            </button>
                            <button
                              type="button"
                              className={`att-manual-btn btn-a ${row.status === 'ABSENT' ? 'active-a' : ''} ${savingStatus === emp.id ? 'loading' : ''}`}
                              onClick={() => handleStatusClick(row, 'ABSENT')}
                              title="Mark ABSENT"
                            >
                              A
                            </button>
                            <button
                              type="button"
                              className={`att-manual-btn btn-l ${row.status === 'LEAVE' ? 'active-l' : ''} ${savingStatus === emp.id ? 'loading' : ''}`}
                              onClick={() => handleStatusClick(row, 'LEAVE')}
                              title="Mark LEAVE"
                            >
                              L
                            </button>
                            <button
                              type="button"
                              className={`att-manual-btn btn-od ${row.status === 'OD' ? 'active-od' : ''} ${savingStatus === emp.id ? 'loading' : ''}`}
                              onClick={() => handleStatusClick(row, 'OD')}
                              title="Mark Official Duty (OD)"
                            >
                              OD
                            </button>
                          </div>
                        </td>
                        )}

                        {/* Action */}
                        <td style={{ textAlign: 'center' }}>
                          {row.records.length > 0 ? (
                            <button
                              type="button"
                              className="att-action-view-btn"
                              onClick={() =>
                                navigate(`/attendance/${row.records[0].id}`, {
                                  state: { records: row.records },
                                })
                              }
                              title="View Camera Scan Logs"
                            >
                              <span>View</span>
                              <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                                <line x1="5" y1="12" x2="19" y2="12" />
                                <polyline points="12 5 19 12 12 19" />
                              </svg>
                            </button>
                          ) : (
                            <span className="att-no-action">—</span>
                          )}
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
        <div className="att-table-footer">
          <span className="att-footer-count">
            Showing {employeeRows.length} of {employeeRows.length} records
          </span>

          <div className="att-pagination">
            <button type="button" className="att-page-arrow" disabled>
              <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="15 18 9 12 15 6" />
              </svg>
            </button>
            <button type="button" className="att-page-num active">
              1
            </button>
            <button type="button" className="att-page-arrow" disabled>
              <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="9 18 15 12 9 6" />
              </svg>
            </button>
          </div>
        </div>
      </div>

      {/* ── 6. MANUAL OVERRIDE MODAL ─────────────────────────────────── */}
      {overrideModal.isOpen && (
        <div className="att-modal-backdrop">
          <div className="att-modal-card fade-in">
            <h3 className="att-modal-title">Change Attendance Status</h3>
            <p className="att-modal-subtitle">
              Manual override for {formattedDateLong}
            </p>

            <div className="att-modal-body">
              <div className="att-modal-field">
                <label>Employee</label>
                <div className="att-modal-value-box">
                  <strong>
                    {overrideModal.employeeRow.employee.firstName}{' '}
                    {overrideModal.employeeRow.employee.lastName}
                  </strong>
                  <span className="att-modal-subtext">
                    ({overrideModal.employeeRow.employee.employeeCode})
                  </span>
                </div>
              </div>

              <div className="att-modal-row">
                <div className="att-modal-field">
                  <label>Current Status</label>
                  <div className="att-modal-value-box current-status">
                    {overrideModal.employeeRow.status || 'No Record'}
                  </div>
                </div>
                <div className="att-modal-field">
                  <label>New Status</label>
                  <div
                    className={`att-modal-value-box new-status ${overrideModal.newStatus.toLowerCase()}`}
                  >
                    {overrideModal.newStatus === 'OD'
                      ? 'OFFICIAL DUTY'
                      : overrideModal.newStatus}
                  </div>
                </div>
              </div>

              <div className="att-modal-field">
                <label>Reason (Required for Leave / OD / Absent)</label>
                <input
                  type="text"
                  className="att-modal-input"
                  placeholder="e.g., Client Visit, Sick Leave, Not Available"
                  value={overrideReason}
                  onChange={(e) => setOverrideReason(e.target.value)}
                  autoFocus
                />
              </div>

              <div className="att-modal-field">
                <label>Notes (Optional)</label>
                <textarea
                  className="att-modal-input"
                  placeholder="Additional context..."
                  value={overrideNotes}
                  onChange={(e) => setOverrideNotes(e.target.value)}
                  rows="3"
                />
              </div>
            </div>

            <div className="att-modal-footer">
              <button
                type="button"
                className="att-btn-cancel"
                onClick={() =>
                  setOverrideModal({ isOpen: false, employeeRow: null, newStatus: '' })
                }
              >
                Cancel
              </button>
              <button
                type="button"
                className="att-btn-save"
                onClick={submitManualOverride}
                disabled={
                  !overrideReason.trim() &&
                  ['LEAVE', 'OD', 'ABSENT'].includes(overrideModal.newStatus)
                }
              >
                Save Changes
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── 7. SCOPED MODERN CSS ────────────────────────────────────── */}
      <style>{`
        .attendance-log-page {
          width: 100%;
          padding: 24px 28px 48px;
          color: #0f172a;
          box-sizing: border-box;
          background: #f4fbf7;
          min-height: calc(100vh - 70px);
        }

        /* ── Header ── */
        .att-header-row {
          display: flex;
          align-items: center;
          justify-content: space-between;
          margin-bottom: 22px;
        }

        .att-header-left {
          display: flex;
          align-items: center;
          gap: 16px;
        }

        .att-icon-box {
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

        .att-header-text {
          display: flex;
          flex-direction: column;
        }

        .att-title {
          font-size: 26px;
          font-weight: 800;
          color: #0f172a;
          letter-spacing: -0.01em;
          margin: 0 0 4px 0;
          line-height: 1.2;
        }

        .att-subtitle {
          font-size: 14px;
          color: #475569;
          margin: 0;
          font-weight: 500;
        }

        /* ── 4 Executive Stat Cards ── */
        .att-stat-cards-grid {
          display: grid;
          grid-template-columns: repeat(4, 1fr);
          gap: 16px;
          margin-bottom: 22px;
        }

        .att-stat-card {
          background: #ffffff;
          border: 1px solid #e2ece8;
          border-radius: 16px;
          padding: 18px 20px 14px;
          box-shadow: 0 1px 3px rgba(0, 0, 0, 0.02);
          display: flex;
          flex-direction: column;
          justify-content: space-between;
          position: relative;
          overflow: hidden;
          transition: all 0.2s ease;
        }

        .att-stat-card:hover {
          border-color: #10b981;
          box-shadow: 0 4px 12px rgba(5, 150, 105, 0.06);
          transform: translateY(-1px);
        }

        .att-stat-card-top {
          display: flex;
          align-items: flex-start;
          gap: 14px;
        }

        .att-stat-icon-wrap {
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

        .icon-rose {
          background: #ffe4e6;
        }

        .icon-amber {
          background: #fef3c7;
        }

        .icon-purple {
          background: #ede9fe;
        }

        .att-stat-card-meta {
          flex: 1;
        }

        .att-stat-label {
          font-size: 11px;
          font-weight: 700;
          letter-spacing: 0.05em;
          color: #64748b;
          text-transform: uppercase;
          display: block;
        }

        .att-stat-number {
          font-size: 28px;
          font-weight: 800;
          color: #0f172a;
          line-height: 1.1;
          margin-top: 4px;
          display: block;
        }

        .att-stat-card-bottom {
          display: flex;
          align-items: flex-end;
          justify-content: space-between;
          margin-top: 14px;
          position: relative;
        }

        .att-stat-trend {
          display: inline-flex;
          align-items: center;
          gap: 4px;
          font-size: 12px;
          font-weight: 700;
          z-index: 2;
        }

        .trend-green {
          color: #059669;
        }

        .trend-red {
          color: #ef4444;
        }

        .trend-amber {
          color: #d97706;
        }

        .trend-purple {
          color: #7c3aed;
        }

        .trend-vs {
          color: #94a3b8;
          font-weight: 500;
          margin-left: 2px;
        }

        .att-stat-wave-wrap {
          width: 105px;
          height: 34px;
          position: absolute;
          right: -10px;
          bottom: -4px;
          z-index: 1;
          pointer-events: none;
        }

        .att-stat-wave-svg {
          width: 100%;
          height: 100%;
        }

        /* ── Date Navigation & Status Bar ── */
        .att-date-status-bar {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 16px;
          margin-bottom: 18px;
          flex-wrap: wrap;
        }

        .att-date-controls-group {
          display: flex;
          align-items: center;
          gap: 8px;
        }

        .att-date-btn-nav {
          width: 36px;
          height: 36px;
          border-radius: 8px;
          border: 1px solid #e2e8f0;
          background: #ffffff;
          color: #334155;
          display: flex;
          align-items: center;
          justify-content: center;
          cursor: pointer;
          transition: all 0.2s ease;
        }

        .att-date-btn-nav:hover {
          background: #f8fafc;
          border-color: #cbd5e1;
        }

        .att-date-btn-today {
          height: 36px;
          padding: 0 16px;
          border-radius: 8px;
          border: 1px solid #e2e8f0;
          background: #ffffff;
          color: #334155;
          font-size: 13px;
          font-weight: 600;
          cursor: pointer;
          transition: all 0.2s ease;
        }

        .att-date-btn-today:hover {
          background: #f8fafc;
          border-color: #cbd5e1;
        }

        .att-date-btn-today.active {
          background: #ecfdf5;
          border-color: #10b981;
          color: #059669;
        }

        .att-date-display-pill {
          height: 36px;
          padding: 0 14px;
          border-radius: 8px;
          border: 1px solid #e2e8f0;
          background: #ffffff;
          display: flex;
          align-items: center;
          gap: 8px;
          cursor: pointer;
          position: relative;
          user-select: none;
          transition: all 0.2s ease;
        }

        .att-date-display-pill:hover,
        .att-date-display-pill.active {
          border-color: #10b981;
          box-shadow: 0 0 0 3px rgba(16, 185, 129, 0.12);
        }

        .att-date-display-text {
          font-size: 13px;
          font-weight: 700;
          color: #0f172a;
        }

        /* ── Modern Custom Calendar Popover ── */
        .att-cal-popover {
          position: absolute;
          top: calc(100% + 8px);
          left: 0;
          width: 320px;
          background: #ffffff;
          border: 1px solid #e2e8f0;
          border-radius: 14px;
          box-shadow: 0 16px 40px rgba(15, 23, 42, 0.16), 0 2px 10px rgba(15, 23, 42, 0.08);
          padding: 14px;
          z-index: 1000;
          box-sizing: border-box;
          animation: attCalFadeIn 0.18s cubic-bezier(0.16, 1, 0.3, 1);
          cursor: default;
        }

        @keyframes attCalFadeIn {
          from {
            opacity: 0;
            transform: translateY(-6px) scale(0.98);
          }
          to {
            opacity: 1;
            transform: translateY(0) scale(1);
          }
        }

        .att-cal-header {
          display: flex;
          align-items: center;
          justify-content: space-between;
          margin-bottom: 12px;
        }

        .att-cal-month-title {
          font-size: 14px;
          font-weight: 800;
          color: #0f172a;
          letter-spacing: -0.01em;
        }

        .att-cal-nav-btn {
          width: 30px;
          height: 30px;
          border-radius: 7px;
          border: 1px solid #e2e8f0;
          background: #f8fafc;
          color: #475569;
          display: flex;
          align-items: center;
          justify-content: center;
          cursor: pointer;
          transition: all 0.15s ease;
        }

        .att-cal-nav-btn:hover {
          background: #e2e8f0;
          color: #0f172a;
          border-color: #cbd5e1;
        }

        .att-cal-presets-strip {
          display: flex;
          gap: 6px;
          margin-bottom: 12px;
        }

        .att-cal-preset-chip {
          flex: 1;
          height: 28px;
          border-radius: 6px;
          border: 1px solid #e2e8f0;
          background: #f1f5f9;
          color: #475569;
          font-size: 11.5px;
          font-weight: 700;
          cursor: pointer;
          transition: all 0.15s ease;
          display: flex;
          align-items: center;
          justify-content: center;
        }

        .att-cal-preset-chip:hover {
          background: #e2e8f0;
          color: #0f172a;
        }

        .att-cal-preset-chip.active {
          background: #059669;
          border-color: #059669;
          color: #ffffff;
        }

        .att-cal-weekday-grid {
          display: grid;
          grid-template-columns: repeat(7, 1fr);
          text-align: center;
          font-size: 11px;
          font-weight: 700;
          color: #94a3b8;
          margin-bottom: 6px;
        }

        .att-cal-days-grid {
          display: grid;
          grid-template-columns: repeat(7, 1fr);
          gap: 3px;
        }

        .att-cal-day-cell {
          height: 34px;
          border-radius: 8px;
          border: none;
          background: transparent;
          font-size: 12px;
          font-weight: 600;
          color: #1e293b;
          cursor: pointer;
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          position: relative;
          transition: all 0.12s ease;
        }

        .att-cal-day-cell:hover:not(.selected) {
          background: #f1f5f9;
          color: #0f172a;
        }

        .att-cal-day-cell.other-month {
          color: #cbd5e1;
          opacity: 0.55;
        }

        .att-cal-day-cell.selected {
          background: linear-gradient(135deg, #059669 0%, #10b981 100%) !important;
          color: #ffffff !important;
          font-weight: 800 !important;
          box-shadow: 0 4px 12px rgba(16, 185, 129, 0.35) !important;
        }

        .att-cal-today-dot {
          width: 4px;
          height: 4px;
          border-radius: 50%;
          background: #10b981;
          position: absolute;
          bottom: 3px;
        }

        .att-cal-footer {
          display: flex;
          align-items: center;
          justify-content: space-between;
          margin-top: 12px;
          padding-top: 10px;
          border-top: 1px solid #f1f5f9;
        }

        .att-cal-footer-meta {
          display: flex;
          flex-direction: column;
          gap: 1px;
        }

        .att-cal-footer-label {
          font-size: 9.5px;
          color: #94a3b8;
          font-weight: 700;
          text-transform: uppercase;
          letter-spacing: 0.04em;
        }

        .att-cal-footer-date {
          font-size: 12px;
          font-weight: 700;
          color: #059669;
        }

        .att-cal-footer-actions {
          display: flex;
          align-items: center;
          gap: 6px;
        }

        .att-cal-btn-cancel {
          height: 28px;
          padding: 0 10px;
          border-radius: 6px;
          border: 1px solid #e2e8f0;
          background: #ffffff;
          color: #475569;
          font-size: 11.5px;
          font-weight: 600;
          cursor: pointer;
          transition: all 0.15s ease;
        }

        .att-cal-btn-cancel:hover {
          background: #f1f5f9;
          color: #0f172a;
        }

        .att-cal-btn-today {
          height: 28px;
          padding: 0 12px;
          border-radius: 6px;
          border: none;
          background: #059669;
          color: #ffffff;
          font-size: 11.5px;
          font-weight: 700;
          cursor: pointer;
          transition: all 0.15s ease;
        }

        .att-cal-btn-today:hover {
          background: #047857;
        }

        /* Dual Camera System Pill */
        .att-camera-system-pill {
          display: inline-flex;
          align-items: center;
          gap: 10px;
          background: #ffffff;
          border: 1px solid #e2ece8;
          border-radius: 9999px;
          padding: 5px 12px;
          box-shadow: 0 1px 3px rgba(0, 0, 0, 0.02);
        }

        .camera-system-left {
          display: flex;
          align-items: center;
          gap: 8px;
          margin-right: 4px;
        }

        .camera-system-title {
          font-size: 12.5px;
          font-weight: 700;
          color: #064e3b;
        }

        .att-live-dot-pulse {
          width: 9px;
          height: 9px;
          border-radius: 50%;
          background: #10b981;
          box-shadow: 0 0 0 0 rgba(16, 185, 129, 0.7);
          animation: pulseGreen 2s infinite;
        }

        @keyframes pulseGreen {
          0% {
            transform: scale(0.95);
            box-shadow: 0 0 0 0 rgba(16, 185, 129, 0.7);
          }
          70% {
            transform: scale(1);
            box-shadow: 0 0 0 6px rgba(16, 185, 129, 0);
          }
          100% {
            transform: scale(0.95);
            box-shadow: 0 0 0 0 rgba(16, 185, 129, 0);
          }
        }

        .camera-badge-in {
          display: inline-flex;
          align-items: center;
          gap: 6px;
          background: #ecfdf5;
          color: #047857;
          border-radius: 9999px;
          padding: 3px 9px;
          font-size: 11.5px;
          font-weight: 600;
        }

        .camera-badge-out {
          display: inline-flex;
          align-items: center;
          gap: 6px;
          background: #f0f9ff;
          color: #0369a1;
          border-radius: 9999px;
          padding: 3px 9px;
          font-size: 11.5px;
          font-weight: 600;
        }

        .camera-badge-offline {
          display: inline-flex;
          align-items: center;
          gap: 6px;
          background: #fef2f2;
          color: #dc2626;
          border-radius: 9999px;
          padding: 3px 9px;
          font-size: 11.5px;
          font-weight: 600;
        }

        .camera-badge-dot {
          width: 6px;
          height: 6px;
          border-radius: 50%;
        }

        .dot-green {
          background: #10b981;
        }

        .dot-blue {
          background: #0284c7;
        }

        .dot-red {
          background: #ef4444;
        }

        .dot-amber {
          background: #f59e0b;
        }

        .badge-online-text {
          font-weight: 700;
          margin-left: 2px;
        }

        .badge-offline-text {
          font-weight: 700;
          margin-left: 2px;
          color: #dc2626;
        }

        .att-dot-offline {
          width: 9px;
          height: 9px;
          border-radius: 50%;
          background: #ef4444;
          box-shadow: 0 0 0 2px rgba(239, 68, 68, 0.2);
        }

        .att-dot-amber {
          width: 9px;
          height: 9px;
          border-radius: 50%;
          background: #f59e0b;
          animation: pulseAmber 2s infinite;
        }

        @keyframes pulseAmber {
          0% {
            transform: scale(0.95);
            box-shadow: 0 0 0 0 rgba(245, 158, 11, 0.7);
          }
          70% {
            transform: scale(1);
            box-shadow: 0 0 0 6px rgba(245, 158, 11, 0);
          }
          100% {
            transform: scale(0.95);
            box-shadow: 0 0 0 0 rgba(245, 158, 11, 0);
          }
        }


        .att-btn-live-status {
          height: 36px;
          padding: 0 16px;
          border-radius: 8px;
          border: 1px solid #e2e8f0;
          background: #ffffff;
          color: #059669;
          font-size: 13px;
          font-weight: 700;
          display: inline-flex;
          align-items: center;
          gap: 8px;
          cursor: pointer;
          transition: all 0.2s ease;
        }

        .att-btn-live-status:hover {
          background: #ecfdf5;
          border-color: #a7f3d0;
        }

        /* ── Search & Filter Controls Bar ── */
        .att-search-filter-bar {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 16px;
          margin-bottom: 18px;
          flex-wrap: wrap;
        }

        .att-search-input-wrap {
          background: #ffffff;
          border: 1px solid #e2e8f0;
          border-radius: 10px;
          padding: 7px 14px;
          display: flex;
          align-items: center;
          gap: 10px;
          flex: 1;
          max-width: 540px;
          min-width: 260px;
          box-shadow: 0 1px 2px rgba(0, 0, 0, 0.02);
        }

        .att-search-field {
          background: transparent;
          border: none;
          outline: none;
          font-size: 13.5px;
          color: #0f172a;
          width: 100%;
          padding: 2px 0;
        }

        .att-search-field::placeholder {
          color: #94a3b8;
        }

        .att-search-clear-btn {
          background: none;
          border: none;
          color: #94a3b8;
          cursor: pointer;
          padding: 2px;
          display: flex;
          align-items: center;
        }

        .att-filter-actions-group {
          display: flex;
          align-items: center;
          gap: 10px;
          flex-wrap: wrap;
        }

        .att-dropdown-relative {
          position: relative;
        }

        .att-filter-dropdown-btn {
          height: 38px;
          padding: 0 14px;
          border-radius: 8px;
          font-size: 12.5px;
          font-weight: 600;
          border: 1px solid #e2e8f0;
          background: #ffffff;
          color: #334155;
          cursor: pointer;
          display: inline-flex;
          align-items: center;
          gap: 8px;
          transition: all 0.18s ease;
        }

        .att-filter-dropdown-btn:hover {
          background: #f8fafc;
          border-color: #cbd5e1;
        }

        .att-filter-dropdown-btn.active-filter {
          border-color: #10b981;
          color: #059669;
          background: #ecfdf5;
        }

        .att-dropdown-menu {
          position: absolute;
          top: calc(100% + 6px);
          left: 0;
          min-width: 190px;
          background: #ffffff;
          border: 1px solid #e2e8f0;
          border-radius: 10px;
          box-shadow: 0 10px 25px rgba(0, 0, 0, 0.08);
          padding: 6px;
          z-index: 50;
        }

        .att-dropdown-item {
          padding: 8px 12px;
          font-size: 13px;
          color: #334155;
          border-radius: 6px;
          cursor: pointer;
          transition: background 0.15s ease;
        }

        .att-dropdown-item:hover {
          background: #f1f5f9;
        }

        .att-dropdown-item.selected {
          background: #ecfdf5;
          color: #059669;
          font-weight: 700;
        }

        .att-btn-export {
          height: 38px;
          padding: 0 18px;
          border-radius: 8px;
          background: linear-gradient(135deg, #059669 0%, #10b981 100%);
          color: #ffffff;
          border: none;
          font-size: 13px;
          font-weight: 700;
          display: inline-flex;
          align-items: center;
          gap: 8px;
          cursor: pointer;
          transition: all 0.2s ease;
          box-shadow: 0 3px 8px rgba(16, 185, 129, 0.25);
        }

        .att-btn-export:hover {
          opacity: 0.95;
          transform: translateY(-1px);
          box-shadow: 0 5px 12px rgba(16, 185, 129, 0.35);
        }

        /* ── Attendance Table Card ── */
        .att-table-card {
          background: #ffffff;
          border: 1px solid #e2ece8;
          border-radius: 18px;
          padding: 16px 20px 20px;
          box-shadow: 0 1px 4px rgba(0, 0, 0, 0.02);
        }

        .att-table-card .table-responsive {
          overflow-x: auto !important;
          -webkit-overflow-scrolling: touch !important;
          width: 100% !important;
          max-width: 100% !important;
          display: block !important;
        }

        .att-custom-table {
          width: 100%;
          min-width: 920px;
          border-collapse: separate;
          border-spacing: 0;
          text-align: left;
        }

        .att-custom-table th {
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

        .att-custom-table th:first-child {
          border-top-left-radius: 12px;
          border-bottom-left-radius: 12px;
        }

        .att-custom-table th:last-child {
          border-top-right-radius: 12px;
          border-bottom-right-radius: 12px;
        }

        .att-custom-table td {
          padding: 13px 14px;
          font-size: 13px;
          color: #0f172a;
          border-bottom: 1px solid #f1f5f9;
          vertical-align: middle;
        }

        .att-custom-table tr:hover td {
          background-color: #f8fafc;
        }

        .att-checkbox {
          width: 16px;
          height: 16px;
          border-radius: 4px;
          border: 1.5px solid #cbd5e1;
          cursor: pointer;
          accent-color: #059669;
        }

        .att-index-text {
          font-size: 12px;
          font-weight: 600;
          color: #64748b;
        }

        .att-emp-cell {
          display: flex;
          align-items: center;
          gap: 12px;
        }

        .att-emp-avatar {
          width: 36px;
          height: 36px;
          border-radius: 50%;
          object-fit: cover;
          border: 1.5px solid #a7f3d0;
          flex-shrink: 0;
        }

        .att-emp-fallback {
          width: 36px;
          height: 36px;
          border-radius: 50%;
          background: #ecfdf5;
          color: #059669;
          display: flex;
          align-items: center;
          justify-content: center;
          font-weight: 700;
          font-size: 12px;
          flex-shrink: 0;
          border: 1.5px solid #a7f3d0;
        }

        .att-emp-meta {
          display: flex;
          flex-direction: column;
        }

        .att-emp-name {
          font-size: 13.5px;
          font-weight: 600;
          color: #0f172a;
        }

        .att-emp-subline {
          display: flex;
          align-items: center;
          gap: 6px;
          margin-top: 2px;
        }

        .att-emp-code {
          font-family: 'JetBrains Mono', monospace;
          font-size: 11px;
          color: #64748b;
          font-weight: 600;
        }

        .att-badge-late {
          font-size: 9.5px;
          font-weight: 700;
          padding: 1px 5px;
          border-radius: 4px;
          background: #fef3c7;
          color: #d97706;
          letter-spacing: 0.02em;
        }

        .att-dept-pill {
          display: inline-block;
          padding: 3px 9px;
          border-radius: 6px;
          background: #f8fafc;
          border: 1px solid #e2e8f0;
          font-size: 12px;
          font-weight: 500;
          color: #334155;
        }

        .att-time-cell {
          display: flex;
          flex-direction: column;
          gap: 2px;
        }

        .att-time-val {
          font-weight: 600;
          font-size: 13px;
          color: #0f172a;
        }

        .att-cam-tag {
          font-size: 10.5px;
          font-weight: 600;
        }

        .cam-in {
          color: #16a34a;
        }

        .cam-out {
          color: #059669;
        }

        .att-duration-cell {
          display: flex;
          flex-direction: column;
          gap: 2px;
        }

        .att-duration-val {
          font-weight: 600;
          font-size: 13px;
          color: #0f172a;
        }

        .att-incomplete-tag {
          font-size: 9.5px;
          padding: 1px 5px;
          border-radius: 4px;
          background: #fee2e2;
          color: #ef4444;
          font-weight: 700;
          width: fit-content;
        }

        .att-status-pill {
          display: inline-flex;
          align-items: center;
          gap: 6px;
          padding: 4px 10px;
          border-radius: 9999px;
          font-size: 11.5px;
          font-weight: 700;
          letter-spacing: 0.02em;
        }

        .att-status-dot {
          width: 6px;
          height: 6px;
          border-radius: 50%;
        }

        .status-present {
          background: #ecfdf5;
          color: #059669;
        }
        .status-present .att-status-dot {
          background: #10b981;
        }

        .status-late {
          background: #fffbeb;
          color: #d97706;
        }
        .status-late .att-status-dot {
          background: #f59e0b;
        }

        .status-absent {
          background: #fef2f2;
          color: #dc2626;
        }
        .status-absent .att-status-dot {
          background: #ef4444;
        }

        .status-leave {
          background: #fff7ed;
          color: #ea580c;
        }
        .status-leave .att-status-dot {
          background: #f97316;
        }

        .status-od {
          background: #f5f3ff;
          color: #7c3aed;
        }
        .status-od .att-status-dot {
          background: #8b5cf6;
        }

        .status-pending {
          background: #f1f5f9;
          color: #64748b;
        }
        .status-pending .att-status-dot {
          background: #94a3b8;
        }

        /* Manual assignment toggle pills */
        .att-manual-toggles {
          display: inline-flex;
          align-items: center;
          gap: 4px;
        }

        .att-manual-btn {
          width: 26px;
          height: 24px;
          border-radius: 5px;
          border: 1px solid #e2e8f0;
          background: #ffffff;
          font-size: 11px;
          font-weight: 700;
          color: #64748b;
          cursor: pointer;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          transition: all 0.15s ease;
        }

        .att-manual-btn:hover {
          border-color: #cbd5e1;
          color: #0f172a;
        }

        .att-manual-btn.btn-p.active-p {
          background: #ecfdf5;
          border-color: #10b981;
          color: #059669;
        }

        .att-manual-btn.btn-a.active-a {
          background: #fee2e2;
          border-color: #f87171;
          color: #dc2626;
        }

        .att-manual-btn.btn-l.active-l {
          background: #fef3c7;
          border-color: #fbbf24;
          color: #d97706;
        }

        .att-manual-btn.btn-od.active-od {
          background: #ede9fe;
          border-color: #a78bfa;
          color: #7c3aed;
          width: 30px;
        }

        .att-action-view-btn {
          display: inline-flex;
          align-items: center;
          gap: 5px;
          padding: 5px 12px;
          border-radius: 6px;
          border: 1px solid #e2e8f0;
          background: #ffffff;
          color: #059669;
          font-size: 12px;
          font-weight: 700;
          cursor: pointer;
          transition: all 0.18s ease;
        }

        .att-action-view-btn:hover {
          background: #ecfdf5;
          border-color: #10b981;
        }

        .att-no-action {
          color: #94a3b8;
        }

        /* ── Empty State ── */
        .att-empty-wrap {
          padding: 60px 20px 70px;
          display: flex;
          flex-direction: column;
          align-items: center;
          text-align: center;
        }

        .att-empty-icon {
          margin-bottom: 16px;
          display: flex;
          align-items: center;
          justify-content: center;
        }

        .att-empty-title {
          font-size: 17px;
          font-weight: 800;
          color: #0f172a;
          margin: 0 0 6px 0;
        }

        .att-empty-desc {
          font-size: 13.5px;
          color: #64748b;
          margin: 0 0 20px 0;
        }

        .att-empty-cta-btn {
          height: 38px;
          padding: 0 18px;
          border-radius: 8px;
          background: #ffffff;
          color: #059669;
          border: 1.5px solid #10b981;
          font-size: 13px;
          font-weight: 700;
          display: inline-flex;
          align-items: center;
          gap: 8px;
          cursor: pointer;
          transition: all 0.2s ease;
        }

        .att-empty-cta-btn:hover {
          background: #ecfdf5;
          transform: translateY(-1px);
        }

        /* ── Table Footer ── */
        .att-table-footer {
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding-top: 18px;
          border-top: 1px solid #f1f5f9;
          margin-top: 6px;
        }

        .att-footer-count {
          font-size: 12.5px;
          color: #64748b;
          font-weight: 500;
        }

        .att-pagination {
          display: flex;
          align-items: center;
          gap: 6px;
        }

        .att-page-arrow {
          width: 32px;
          height: 32px;
          border-radius: 8px;
          border: 1px solid #e2e8f0;
          background: #ffffff;
          color: #94a3b8;
          display: flex;
          align-items: center;
          justify-content: center;
          cursor: pointer;
        }

        .att-page-num {
          min-width: 32px;
          height: 32px;
          border-radius: 8px;
          border: 1px solid transparent;
          font-size: 13px;
          font-weight: 700;
          cursor: pointer;
          display: flex;
          align-items: center;
          justify-content: center;
          background: #ffffff;
          color: #334155;
        }

        .att-page-num.active {
          background: #059669;
          color: #ffffff;
        }

        /* ── Override Modal ── */
        .att-modal-backdrop {
          position: fixed;
          top: 0;
          left: 0;
          width: 100%;
          height: 100%;
          background: rgba(15, 23, 42, 0.45);
          backdrop-filter: blur(4px);
          display: flex;
          align-items: center;
          justify-content: center;
          z-index: 1000;
        }

        .att-modal-card {
          background: #ffffff;
          border-radius: 16px;
          width: 90%;
          max-width: 480px;
          padding: 24px;
          box-shadow: 0 20px 40px rgba(0, 0, 0, 0.15);
        }

        .att-modal-title {
          font-size: 18px;
          font-weight: 800;
          color: #0f172a;
          margin: 0 0 4px 0;
        }

        .att-modal-subtitle {
          font-size: 13px;
          color: #64748b;
          margin: 0 0 18px 0;
        }

        .att-modal-body {
          display: flex;
          flex-direction: column;
          gap: 14px;
        }

        .att-modal-field label {
          font-size: 12px;
          font-weight: 700;
          color: #475569;
          display: block;
          margin-bottom: 5px;
        }

        .att-modal-value-box {
          background: #f8fafc;
          border: 1px solid #e2e8f0;
          border-radius: 8px;
          padding: 9px 12px;
          font-size: 13.5px;
          display: flex;
          align-items: center;
          gap: 8px;
        }

        .att-modal-subtext {
          font-size: 12px;
          color: #64748b;
        }

        .att-modal-row {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 12px;
        }

        .att-modal-input {
          width: 100%;
          box-sizing: border-box;
          border: 1px solid #cbd5e1;
          border-radius: 8px;
          padding: 9px 12px;
          font-size: 13px;
          outline: none;
          transition: border 0.2s ease;
        }

        .att-modal-input:focus {
          border-color: #059669;
        }

        .att-modal-footer {
          display: flex;
          align-items: center;
          justify-content: flex-end;
          gap: 10px;
          margin-top: 22px;
        }

        .att-btn-cancel {
          height: 38px;
          padding: 0 16px;
          border-radius: 8px;
          background: #f1f5f9;
          color: #475569;
          border: none;
          font-size: 13px;
          font-weight: 600;
          cursor: pointer;
        }

        .att-btn-save {
          height: 38px;
          padding: 0 20px;
          border-radius: 8px;
          background: #059669;
          color: #ffffff;
          border: none;
          font-size: 13px;
          font-weight: 700;
          cursor: pointer;
          transition: background 0.2s ease;
        }

        .att-btn-save:hover:not(:disabled) {
          background: #047857;
        }

        .att-btn-save:disabled {
          opacity: 0.5;
          cursor: not-allowed;
        }

        /* ── Dark Mode Overrides for Modal ── */
        [data-theme="dark"] .att-modal-backdrop,
        .dark .att-modal-backdrop {
          background: rgba(3, 7, 18, 0.75);
          backdrop-filter: blur(8px);
        }

        [data-theme="dark"] .att-modal-card,
        .dark .att-modal-card {
          background: #14172e;
          border: 1px solid rgba(139, 92, 246, 0.28);
          box-shadow: 0 24px 50px rgba(0, 0, 0, 0.7);
        }

        [data-theme="dark"] .att-modal-title,
        .dark .att-modal-title {
          color: #ffffff;
        }

        [data-theme="dark"] .att-modal-subtitle,
        .dark .att-modal-subtitle {
          color: #94a3b8;
        }

        [data-theme="dark"] .att-modal-field label,
        .dark .att-modal-field label {
          color: #cbd5e1;
        }

        [data-theme="dark"] .att-modal-value-box,
        .dark .att-modal-value-box {
          background: #171b38;
          border-color: rgba(139, 92, 246, 0.22);
          color: #e2e8f0;
        }

        [data-theme="dark"] .att-modal-value-box strong,
        .dark .att-modal-value-box strong {
          color: #ffffff;
        }

        [data-theme="dark"] .att-modal-subtext,
        .dark .att-modal-subtext {
          color: #94a3b8;
        }

        [data-theme="dark"] .att-modal-value-box.current-status,
        .dark .att-modal-value-box.current-status {
          background: #1a2238;
          border-color: rgba(148, 163, 184, 0.25);
          color: #94a3b8;
          font-weight: 700;
        }

        [data-theme="dark"] .att-modal-value-box.new-status,
        .dark .att-modal-value-box.new-status {
          background: rgba(16, 185, 129, 0.12);
          border-color: rgba(16, 185, 129, 0.35);
          color: #34d399;
          font-weight: 800;
        }

        [data-theme="dark"] .att-modal-value-box.new-status.present,
        .dark .att-modal-value-box.new-status.present {
          background: rgba(16, 185, 129, 0.16);
          border-color: rgba(16, 185, 129, 0.4);
          color: #34d399;
        }

        [data-theme="dark"] .att-modal-value-box.new-status.absent,
        .dark .att-modal-value-box.new-status.absent {
          background: rgba(239, 68, 68, 0.16);
          border-color: rgba(239, 68, 68, 0.4);
          color: #f87171;
        }

        [data-theme="dark"] .att-modal-value-box.new-status.leave,
        .dark .att-modal-value-box.new-status.leave {
          background: rgba(245, 158, 11, 0.16);
          border-color: rgba(245, 158, 11, 0.4);
          color: #fbbf24;
        }

        [data-theme="dark"] .att-modal-value-box.new-status.od,
        .dark .att-modal-value-box.new-status.od {
          background: rgba(139, 92, 246, 0.16);
          border-color: rgba(139, 92, 246, 0.4);
          color: #c084fc;
        }

        [data-theme="dark"] .att-modal-input,
        .dark .att-modal-input {
          background: #171b38;
          border-color: rgba(139, 92, 246, 0.25);
          color: #ffffff;
        }

        [data-theme="dark"] .att-modal-input:focus,
        .dark .att-modal-input:focus {
          border-color: #10b981;
          box-shadow: 0 0 0 3px rgba(16, 185, 129, 0.2);
        }

        [data-theme="dark"] .att-modal-input::placeholder,
        .dark .att-modal-input::placeholder {
          color: #64748b;
        }

        [data-theme="dark"] .att-btn-cancel,
        .dark .att-btn-cancel {
          background: #1e2640;
          border: 1px solid rgba(148, 163, 184, 0.2);
          color: #cbd5e1;
        }

        [data-theme="dark"] .att-btn-cancel:hover,
        .dark .att-btn-cancel:hover {
          background: #273352;
          color: #ffffff;
        }

        [data-theme="dark"] .att-btn-save,
        .dark .att-btn-save {
          background: #059669;
          border: 1px solid #10b981;
          color: #ffffff;
        }

        [data-theme="dark"] .att-btn-save:hover:not(:disabled),
        .dark .att-btn-save:hover:not(:disabled) {
          background: #047857;
        }

        /* ── Dark Theme Overrides for Attendance Page & Controls ── */
        [data-theme="dark"] .att-table-card,
        .dark .att-table-card {
          background: #111528 !important;
          border-color: rgba(139, 92, 246, 0.25) !important;
        }
        [data-theme="dark"] .att-stat-card,
        .dark .att-stat-card {
          background: #111528 !important;
          border-color: rgba(139, 92, 246, 0.25) !important;
        }
        [data-theme="dark"] .att-stat-number,
        .dark .att-stat-number {
          color: #ffffff !important;
        }
        [data-theme="dark"] .att-stat-label,
        .dark .att-stat-label {
          color: #94a3b8 !important;
        }
        [data-theme="dark"] .att-date-btn-nav,
        .dark .att-date-btn-nav {
          background: #171b38 !important;
          border-color: rgba(139, 92, 246, 0.25) !important;
          color: #cbd5e1 !important;
        }
        [data-theme="dark"] .att-date-btn-nav:hover,
        .dark .att-date-btn-nav:hover {
          background: #23284f !important;
          color: #ffffff !important;
        }
        [data-theme="dark"] .att-date-btn-today,
        .dark .att-date-btn-today {
          background: #171b38 !important;
          border-color: rgba(139, 92, 246, 0.25) !important;
          color: #cbd5e1 !important;
        }
        [data-theme="dark"] .att-date-btn-today:hover,
        .dark .att-date-btn-today:hover {
          background: #23284f !important;
          color: #ffffff !important;
        }
        [data-theme="dark"] .att-date-btn-today.active,
        .dark .att-date-btn-today.active {
          background: rgba(16, 185, 129, 0.16) !important;
          border-color: #10b981 !important;
          color: #34d399 !important;
        }
        [data-theme="dark"] .att-date-display-pill,
        .dark .att-date-display-pill {
          background: #171b38 !important;
          border-color: rgba(139, 92, 246, 0.25) !important;
          color: #cbd5e1 !important;
        }
        [data-theme="dark"] .att-date-display-text,
        .dark .att-date-display-text {
          color: #f1f5f9 !important;
        }
        [data-theme="dark"] .att-camera-system-pill,
        .dark .att-camera-system-pill {
          background: #171b38 !important;
          border-color: rgba(139, 92, 246, 0.25) !important;
        }
        [data-theme="dark"] .camera-system-title,
        .dark .camera-system-title {
          color: #f1f5f9 !important;
        }
        [data-theme="dark"] .camera-badge-in,
        .dark .camera-badge-in {
          background: rgba(16, 185, 129, 0.16) !important;
          color: #34d399 !important;
        }
        [data-theme="dark"] .camera-badge-out,
        .dark .camera-badge-out {
          background: rgba(16, 185, 129, 0.16) !important;
          color: #34d399 !important;
        }
        [data-theme="dark"] .camera-badge-offline,
        .dark .camera-badge-offline {
          background: rgba(239, 68, 68, 0.16) !important;
          color: #f87171 !important;
        }
        [data-theme="dark"] .badge-offline-text,
        .dark .badge-offline-text {
          color: #f87171 !important;
        }
        [data-theme="dark"] .att-btn-live-status,
        .dark .att-btn-live-status {
          background: #171b38 !important;
          border-color: rgba(139, 92, 246, 0.25) !important;
          color: #34d399 !important;
        }
        [data-theme="dark"] .att-btn-live-status:hover,
        .dark .att-btn-live-status:hover {
          background: #23284f !important;
          color: #10b981 !important;
        }
        [data-theme="dark"] .att-search-input-wrap,
        .dark .att-search-input-wrap {
          background: #171b38 !important;
          border-color: rgba(139, 92, 246, 0.25) !important;
        }
        [data-theme="dark"] .att-search-field,
        .dark .att-search-field {
          color: #f1f5f9 !important;
        }
        [data-theme="dark"] .att-filter-dropdown-btn,
        .dark .att-filter-dropdown-btn {
          background: #171b38 !important;
          border-color: rgba(139, 92, 246, 0.25) !important;
          color: #cbd5e1 !important;
        }
        [data-theme="dark"] .att-filter-dropdown-btn:hover,
        .dark .att-filter-dropdown-btn:hover {
          background: #23284f !important;
          color: #ffffff !important;
        }
        [data-theme="dark"] .att-dropdown-menu,
        .dark .att-dropdown-menu {
          background: #171b38 !important;
          border-color: rgba(139, 92, 246, 0.25) !important;
          box-shadow: 0 10px 25px rgba(0, 0, 0, 0.5) !important;
        }
        [data-theme="dark"] .att-dropdown-item,
        .dark .att-dropdown-item {
          color: #cbd5e1 !important;
        }
        [data-theme="dark"] .att-dropdown-item:hover,
        .dark .att-dropdown-item:hover {
          background: rgba(255, 255, 255, 0.05) !important;
          color: #ffffff !important;
        }
        [data-theme="dark"] .att-custom-table th,
        .dark .att-custom-table th {
          background-color: #171b38 !important;
          color: #34d399 !important;
        }
        [data-theme="dark"] .att-custom-table td,
        .dark .att-custom-table td {
          color: #cbd5e1 !important;
          border-bottom-color: rgba(255, 255, 255, 0.06) !important;
        }
        [data-theme="dark"] .att-custom-table tr:hover td,
        .dark .att-custom-table tr:hover td {
          background-color: rgba(255, 255, 255, 0.03) !important;
        }
        [data-theme="dark"] .att-duration-val,
        .dark .att-duration-val {
          color: #f1f5f9 !important;
        }
        [data-theme="dark"] .att-manual-btn,
        .dark .att-manual-btn {
          background: #171b38 !important;
          border-color: rgba(139, 92, 246, 0.25) !important;
          color: #94a3b8 !important;
        }
        [data-theme="dark"] .att-manual-btn:hover,
        .dark .att-manual-btn:hover {
          background: #23284f !important;
          color: #ffffff !important;
        }
        [data-theme="dark"] .att-action-view-btn,
        .dark .att-action-view-btn {
          background: #171b38 !important;
          border-color: rgba(139, 92, 246, 0.25) !important;
          color: #34d399 !important;
        }
        [data-theme="dark"] .att-action-view-btn:hover,
        .dark .att-action-view-btn:hover {
          background: #23284f !important;
        }
        [data-theme="dark"] .att-table-footer,
        .dark .att-table-footer {
          border-top-color: rgba(255, 255, 255, 0.06) !important;
        }
        [data-theme="dark"] .att-page-arrow,
        .dark .att-page-arrow {
          background: #171b38 !important;
          border-color: rgba(139, 92, 246, 0.25) !important;
          color: #cbd5e1 !important;
        }
        [data-theme="dark"] .att-page-num,
        .dark .att-page-num {
          background: #171b38 !important;
          border-color: rgba(139, 92, 246, 0.25) !important;
          color: #cbd5e1 !important;
        }
        [data-theme="dark"] .att-page-num.active,
        .dark .att-page-num.active {
          background: #059669 !important;
          color: #ffffff !important;
          border-color: #059669 !important;
        }

        /* ── Employee Avatar, Details & Status Pills in Dark Mode ── */
        [data-theme="dark"] .att-emp-fallback,
        .dark .att-emp-fallback {
          background: #1e2648 !important;
          color: #34d399 !important;
          border-color: rgba(16, 185, 129, 0.35) !important;
        }

        [data-theme="dark"] .att-emp-avatar,
        .dark .att-emp-avatar {
          background: #171b38 !important;
          border-color: rgba(16, 185, 129, 0.35) !important;
        }

        [data-theme="dark"] .att-emp-name,
        .dark .att-emp-name {
          color: #f1f5f9 !important;
        }

        [data-theme="dark"] .att-emp-code,
        .dark .att-emp-code {
          color: #94a3b8 !important;
        }

        [data-theme="dark"] .att-dept-pill,
        .dark .att-dept-pill {
          background: #171b38 !important;
          border-color: rgba(139, 92, 246, 0.25) !important;
          color: #34d399 !important;
        }

        [data-theme="dark"] .att-time-val,
        .dark .att-time-val {
          color: #f1f5f9 !important;
        }

        [data-theme="dark"] .status-pending,
        .dark .status-pending {
          background: #1c223c !important;
          color: #cbd5e1 !important;
          border: 1px solid rgba(148, 163, 184, 0.25) !important;
        }

        [data-theme="dark"] .status-pending .att-status-dot,
        .dark .status-pending .att-status-dot {
          background: #94a3b8 !important;
        }

        [data-theme="dark"] .status-present,
        .dark .status-present {
          background: rgba(16, 185, 129, 0.16) !important;
          color: #34d399 !important;
          border: 1px solid rgba(16, 185, 129, 0.35) !important;
        }

        [data-theme="dark"] .status-absent,
        .dark .status-absent {
          background: rgba(239, 68, 68, 0.16) !important;
          color: #f87171 !important;
          border: 1px solid rgba(239, 68, 68, 0.35) !important;
        }

        [data-theme="dark"] .status-leave,
        .dark .status-leave {
          background: rgba(245, 158, 11, 0.16) !important;
          color: #fbbf24 !important;
          border: 1px solid rgba(245, 158, 11, 0.35) !important;
        }

        [data-theme="dark"] .status-od,
        .dark .status-od {
          background: rgba(139, 92, 246, 0.16) !important;
          color: #c084fc !important;
          border: 1px solid rgba(139, 92, 246, 0.35) !important;
        }

        [data-theme="dark"] .status-late,
        .dark .status-late {
          background: rgba(245, 158, 11, 0.16) !important;
          color: #fbbf24 !important;
          border: 1px solid rgba(245, 158, 11, 0.35) !important;
        }

        /* ── Dark Mode Calendar Popover ── */
        [data-theme="dark"] .att-cal-popover,
        .dark .att-cal-popover {
          background: #141829 !important;
          border: 1px solid rgba(139, 92, 246, 0.28) !important;
          box-shadow: 0 20px 50px rgba(0, 0, 0, 0.65), 0 0 0 1px rgba(255, 255, 255, 0.06) !important;
        }

        [data-theme="dark"] .att-cal-month-title,
        .dark .att-cal-month-title {
          color: #ffffff !important;
        }

        [data-theme="dark"] .att-cal-nav-btn,
        .dark .att-cal-nav-btn {
          background: #181d38 !important;
          border-color: rgba(139, 92, 246, 0.25) !important;
          color: #cbd5e1 !important;
        }

        [data-theme="dark"] .att-cal-nav-btn:hover,
        .dark .att-cal-nav-btn:hover {
          background: #23284f !important;
          color: #ffffff !important;
        }

        [data-theme="dark"] .att-cal-preset-chip,
        .dark .att-cal-preset-chip {
          background: #181d38 !important;
          border-color: rgba(139, 92, 246, 0.25) !important;
          color: #cbd5e1 !important;
        }

        [data-theme="dark"] .att-cal-preset-chip:hover,
        .dark .att-cal-preset-chip:hover {
          background: #23284f !important;
          color: #ffffff !important;
        }

        [data-theme="dark"] .att-cal-preset-chip.active,
        .dark .att-cal-preset-chip.active {
          background: #059669 !important;
          border-color: #059669 !important;
          color: #ffffff !important;
        }

        [data-theme="dark"] .att-cal-weekday-grid,
        .dark .att-cal-weekday-grid {
          color: #94a3b8 !important;
        }

        [data-theme="dark"] .att-cal-day-cell,
        .dark .att-cal-day-cell {
          color: #cbd5e1 !important;
        }

        [data-theme="dark"] .att-cal-day-cell:hover:not(.selected),
        .dark .att-cal-day-cell:hover:not(.selected) {
          background: #23284f !important;
          color: #ffffff !important;
        }

        [data-theme="dark"] .att-cal-day-cell.other-month,
        .dark .att-cal-day-cell.other-month {
          color: #64748b !important;
          opacity: 0.45;
        }

        [data-theme="dark"] .att-cal-footer,
        .dark .att-cal-footer {
          border-top-color: rgba(139, 92, 246, 0.2) !important;
        }

        [data-theme="dark"] .att-cal-footer-date,
        .dark .att-cal-footer-date {
          color: #34d399 !important;
        }

        [data-theme="dark"] .att-cal-btn-cancel,
        .dark .att-cal-btn-cancel {
          background: #181d38 !important;
          border-color: rgba(139, 92, 246, 0.25) !important;
          color: #cbd5e1 !important;
        }

        [data-theme="dark"] .att-cal-btn-cancel:hover,
        .dark .att-cal-btn-cancel:hover {
          background: #23284f !important;
          color: #ffffff !important;
        }


        @media (max-width: 1024px) {
          .att-stat-cards-grid {
            grid-template-columns: repeat(2, 1fr);
          }
        }

        @media (max-width: 768px) {
          .att-title {
            font-size: 20px !important;
          }
          .att-subtitle {
            font-size: 12px !important;
          }
          .att-header-icon {
            width: 36px !important;
            height: 36px !important;
            min-width: 36px !important;
            border-radius: 10px !important;
          }
          .att-header-icon svg {
            width: 18px !important;
            height: 18px !important;
          }
          .att-stat-cards-grid {
            grid-template-columns: repeat(2, 1fr) !important;
            gap: 8px !important;
            margin-bottom: 14px !important;
          }
          .att-stat-card {
            padding: 8px 10px !important;
            min-height: 54px !important;
            max-height: 64px !important;
            border-radius: 10px !important;
            display: flex !important;
            flex-direction: row !important;
            align-items: center !important;
            justify-content: flex-start !important;
            box-sizing: border-box !important;
          }
          .att-stat-card-top {
            display: flex !important;
            align-items: center !important;
            gap: 8px !important;
            width: 100% !important;
          }
          .att-stat-icon-wrap {
            width: 30px !important;
            height: 30px !important;
            min-width: 30px !important;
            border-radius: 8px !important;
          }
          .att-stat-icon-wrap svg {
            width: 15px !important;
            height: 15px !important;
          }
          .att-stat-card-meta {
            display: flex !important;
            flex-direction: column !important;
            min-width: 0 !important;
            flex: 1 !important;
          }
          .att-stat-label {
            font-size: 9.5px !important;
            font-weight: 700 !important;
            letter-spacing: 0.03em !important;
            margin-bottom: 1px !important;
            white-space: nowrap !important;
            overflow: hidden !important;
            text-overflow: ellipsis !important;
          }
          .att-stat-number {
            font-size: 18px !important;
            font-weight: 800 !important;
            line-height: 1.1 !important;
            margin: 0 !important;
          }
          .att-stat-card-bottom,
          .att-stat-wave-wrap,
          .att-stat-trend {
            display: none !important;
          }
          .att-date-status-bar {
            flex-direction: column !important;
            align-items: stretch !important;
            gap: 10px !important;
          }
          .att-date-stepper {
            width: 100% !important;
            display: flex !important;
            justify-content: space-between !important;
          }
          .att-date-btn-nav {
            width: 30px !important;
            height: 30px !important;
          }
          .att-date-btn-today {
            font-size: 11.5px !important;
            height: 30px !important;
            padding: 3px 10px !important;
          }
          .att-date-display-btn {
            flex: 1 !important;
            justify-content: center !important;
            font-size: 12px !important;
            height: 30px !important;
            padding: 3px 10px !important;
          }
          .att-cam-status-row {
            width: 100% !important;
            flex-wrap: wrap !important;
            gap: 6px !important;
          }
          .att-live-status-wrap {
            width: 100% !important;
          }
          .att-btn-live-status {
            width: 100% !important;
            justify-content: center !important;
            font-size: 12px !important;
            padding: 6px 12px !important;
          }
          .att-search-filter-bar {
            flex-direction: column !important;
            align-items: stretch !important;
            gap: 8px !important;
          }
          .att-search-input-wrap {
            max-width: 100% !important;
            width: 100% !important;
          }
          .att-search-input {
            height: 36px !important;
            font-size: 12.5px !important;
          }
          .att-filter-actions-group {
            width: 100% !important;
            display: grid !important;
            grid-template-columns: 1fr 1fr !important;
            gap: 8px !important;
          }
          .att-filter-dropdown-btn,
          .att-btn-export {
            width: 100% !important;
            justify-content: center !important;
            height: 34px !important;
            font-size: 12px !important;
          }
          .att-table-card {
            padding: 10px 8px 14px !important;
            border-radius: 12px !important;
          }
          .att-table-footer {
            flex-direction: column !important;
            align-items: center !important;
            gap: 10px !important;
          }
          .att-custom-table th {
            font-size: 10px !important;
            padding: 8px 10px !important;
          }
          .att-custom-table td {
            font-size: 12px !important;
            padding: 8px 10px !important;
          }
          .att-emp-avatar {
            width: 28px !important;
            height: 28px !important;
            font-size: 11px !important;
          }
          .att-emp-name {
            font-size: 12px !important;
          }
          .att-emp-code {
            font-size: 10px !important;
          }
        }

        @media (max-width: 480px) {
          .att-filter-actions-group {
            grid-template-columns: 1fr 1fr !important;
          }
        }

        @media (max-width: 360px) {
          .att-stat-cards-grid {
            grid-template-columns: repeat(2, 1fr) !important;
            gap: 6px !important;
          }

          .att-stat-card {
            padding: 6px 8px !important;
            border-radius: 8px !important;
            min-height: 50px !important;
          }
          .att-stat-number {
            font-size: 16px !important;
          }
          .att-stat-label {
            font-size: 9px !important;
          }
        }

          .att-stat-card {
            padding: 10px 12px !important;
            border-radius: 12px !important;
          }
        }
      `}</style>
    </div>
  );
};

export default AttendanceList;
