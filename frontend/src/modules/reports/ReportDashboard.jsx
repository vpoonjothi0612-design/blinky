import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { getAttendanceReport, getSummaryReport } from './report.service';
import { getEmployees } from '../employee/employee.service';
import Loader from '../../components/common/Loader';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import * as XLSX from 'xlsx';

// ── Date Helpers ─────────────────────────────────────────────────────────────
const todayStr = () => new Date().toISOString().split('T')[0];

const formatDisplayDate = (dateStr) => {
  if (!dateStr) return '';
  try {
    const [y, m, d] = dateStr.split('-');
    if (!y || !m || !d) return dateStr;
    const date = new Date(Number(y), Number(m) - 1, Number(d));
    return date.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
  } catch {
    return dateStr;
  }
};

const formatPeriodDisplay = (from, to) => {
  if (!from && !to) return '';
  if (from === to) return formatDisplayDate(from);
  return `${formatDisplayDate(from)} → ${formatDisplayDate(to)}`;
};

const getPresetDates = (presetKey) => {
  const now = new Date();
  const format = (d) => {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  };

  const today = format(now);

  if (presetKey === 'today') {
    return { from: today, to: today };
  }
  if (presetKey === 'yesterday') {
    const yest = new Date(now);
    yest.setDate(yest.getDate() - 1);
    const yestStr = format(yest);
    return { from: yestStr, to: yestStr };
  }
  if (presetKey === 'week') {
    const weekAgo = new Date(now);
    weekAgo.setDate(weekAgo.getDate() - 6);
    return { from: format(weekAgo), to: today };
  }
  if (presetKey === 'month') {
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    return { from: format(monthStart), to: today };
  }
  return { from: today, to: today };
};

// ── Status Badge ─────────────────────────────────────────────────────────────
const StatusBadge = ({ status }) => {
  if (!status) return <span>—</span>;
  
  const map = {
    PRESENT: { label: 'PRESENT', color: '#10b981', bg: 'rgba(16, 185, 129, 0.1)', border: 'rgba(16, 185, 129, 0.25)' },
    ABSENT: { label: 'ABSENT', color: '#ef4444', bg: 'rgba(239, 68, 68, 0.1)', border: 'rgba(239, 68, 68, 0.25)' },
    LEAVE: { label: 'LEAVE', color: '#f59e0b', bg: 'rgba(245, 158, 11, 0.1)', border: 'rgba(245, 158, 11, 0.25)' },
    OD: { label: 'OFFICIAL DUTY', color: '#8b5cf6', bg: 'rgba(139, 92, 246, 0.1)', border: 'rgba(139, 92, 246, 0.25)' },
    OFFICIAL_DUTY: { label: 'OFFICIAL DUTY', color: '#8b5cf6', bg: 'rgba(139, 92, 246, 0.1)', border: 'rgba(139, 92, 246, 0.25)' },
    PENDING: { label: 'PENDING', color: '#64748b', bg: 'rgba(100, 116, 139, 0.1)', border: 'rgba(100, 116, 139, 0.25)' },
    LATE: { label: 'LATE', color: '#f97316', bg: 'rgba(249, 115, 22, 0.1)', border: 'rgba(249, 115, 22, 0.25)' },
  };
  
  const s = map[status] || { label: status, color: '#64748b', bg: 'rgba(100, 116, 139, 0.08)', border: 'rgba(100, 116, 139, 0.2)' };
  
  return (
    <span style={{
      display: 'inline-flex',
      alignItems: 'center',
      gap: '6px',
      fontSize: '11.5px',
      fontWeight: 700,
      color: s.color,
      backgroundColor: s.bg,
      border: `1px solid ${s.border}`,
      padding: '3px 9px',
      borderRadius: '999px',
      letterSpacing: '0.02em',
      whiteSpace: 'nowrap'
    }}>
      <span style={{ width: '6px', height: '6px', borderRadius: '50%', backgroundColor: s.color }}></span>
      {s.label}
    </span>
  );
};

// ── Source Badge ─────────────────────────────────────────────────────────────
const SourceBadge = ({ source }) => {
  if (!source) return <span style={{ color: 'var(--text-muted)' }}>—</span>;
  
  let label = source;
  let icon = '📸';
  if (source === 'AI_CAMERA') { label = 'Camera'; icon = '📷'; }
  if (source === 'MANUAL') { label = 'Manual'; icon = '✍️'; }
  if (source === 'SYSTEM') { label = 'System'; icon = '⚙️'; }
  
  return (
    <span style={{ fontSize: '12.5px', fontWeight: 500, color: 'var(--text-secondary)', display: 'inline-flex', alignItems: 'center', gap: '5px' }}>
      <span style={{ fontSize: '11px' }}>{icon}</span>
      {label}
    </span>
  );
};

// ── Summary Metrics Strip ────────────────────────────────────────────────────
const SummaryCards = ({ summary }) => {
  const totalEmps = summary?.totalEmployees || 0;
  const totalPres = summary?.totalPresent || 0;
  const totalAbs = summary?.totalAbsent || 0;
  const totalLeave = summary?.totalLeave || 0;
  const totalOD = summary?.totalOD || 0;

  const presPct = totalEmps > 0 ? Math.round((totalPres / totalEmps) * 100) : 0;

  const metrics = [
    { label: 'Total Records', value: totalEmps, color: '#3b82f6', bg: '#eff6ff', icon: '👥' },
    { label: 'Present', value: totalPres, sub: `${presPct}%`, color: '#10b981', bg: '#ecfdf5', icon: '✓' },
    { label: 'Absent', value: totalAbs, color: '#ef4444', bg: '#fef2f2', icon: '✕' },
    { label: 'Leave', value: totalLeave, color: '#f59e0b', bg: '#fffbeb', icon: '🌴' },
    { label: 'Official Duty', value: totalOD, color: '#8b5cf6', bg: '#f5f3ff', icon: '💼' },
  ];

  return (
    <div className="report-summary-strip">
      {metrics.map((m, idx) => (
        <div key={m.label} className={`report-metric-box metric-idx-${idx}`}>
          <span className="metric-icon" style={{ '--metric-bg': m.bg, color: m.color }}>{m.icon}</span>
          <div className="metric-content">
            <div className="metric-val-wrap">
              <span className="metric-value" style={{ color: m.color }}>
                {String(m.value).padStart(2, '0')}
              </span>
              {m.sub && <span className="metric-sub-pill">{m.sub}</span>}
            </div>
            <span className="metric-label">{m.label}</span>
          </div>
        </div>
      ))}
    </div>
  );
};

// ── Custom Styled Select Component ───────────────────────────────────────────
const CustomSelect = ({
  value,
  onChange,
  options,
  placeholder = 'Select option',
  disabled = false,
  highlight = false,
  ariaLabel,
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const dropdownRef = useRef(null);

  // Close on outside click or Escape key
  useEffect(() => {
    if (!isOpen) return;

    const handleOutsideClick = (e) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target)) {
        setIsOpen(false);
      }
    };

    const handleKeyDown = (e) => {
      if (e.key === 'Escape') {
        setIsOpen(false);
      }
    };

    document.addEventListener('mousedown', handleOutsideClick);
    document.addEventListener('touchstart', handleOutsideClick);
    document.addEventListener('keydown', handleKeyDown);

    return () => {
      document.removeEventListener('mousedown', handleOutsideClick);
      document.removeEventListener('touchstart', handleOutsideClick);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [isOpen]);

  const selectedOption = options.find((opt) => String(opt.value) === String(value)) || options[0];

  return (
    <div className="custom-select-wrap" ref={dropdownRef}>
      <button
        type="button"
        className={`custom-select-trigger ${isOpen ? 'active-picker is-open' : ''} ${highlight ? 'highlight-select' : ''}`}
        onClick={() => !disabled && setIsOpen((prev) => !prev)}
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={isOpen}
        aria-label={ariaLabel}
      >
        <div className="custom-select-trigger-content">
          {selectedOption?.dotColor && (
            <span
              className="custom-select-dot"
              style={{ backgroundColor: selectedOption.dotColor }}
            />
          )}
          {selectedOption?.icon && (
            <span className="custom-select-opt-icon">{selectedOption.icon}</span>
          )}
          <span className="custom-select-trigger-text">
            {selectedOption ? selectedOption.label : placeholder}
          </span>
          {selectedOption?.code && (
            <span className="custom-select-trigger-code">{selectedOption.code}</span>
          )}
        </div>

        <svg
          className={`custom-select-chevron ${isOpen ? 'rotate' : ''}`}
          viewBox="0 0 24 24"
          width="13"
          height="13"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <polyline points="6 9 12 15 18 9" />
        </svg>
      </button>

      {isOpen && (
        <div className="custom-select-popover" role="listbox">
          <div className="custom-select-list">
            {options.map((opt) => {
              const isSelected = String(opt.value) === String(value);
              return (
                <div
                  key={String(opt.value)}
                  className={`custom-select-item ${isSelected ? 'selected' : ''} ${opt.disabled ? 'disabled' : ''}`}
                  onClick={() => {
                    if (opt.disabled) return;
                    onChange(opt.value);
                    setIsOpen(false);
                  }}
                  role="option"
                  aria-selected={isSelected}
                >
                  <div className="custom-select-item-left">
                    {opt.dotColor && (
                      <span
                        className="custom-select-dot"
                        style={{ backgroundColor: opt.dotColor }}
                      />
                    )}
                    {opt.icon && <span className="custom-select-opt-icon">{opt.icon}</span>}
                    <span className="custom-select-item-label">{opt.label}</span>
                  </div>
                  {opt.code && <span className="custom-select-item-code">{opt.code}</span>}
                  {isSelected && (
                    <svg
                      className="custom-select-check"
                      viewBox="0 0 24 24"
                      width="14"
                      height="14"
                      fill="none"
                      stroke="#059669"
                      strokeWidth="2.6"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    >
                      <polyline points="20 6 9 17 4 12" />
                    </svg>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
};

// ── Custom In-App Calendar Component ─────────────────────────────────────────
const CustomCalendar = ({ startDate, endDate, onApply, onClose }) => {
  const [viewDate, setViewDate] = useState(() => {
    const [y, m] = (startDate || todayStr()).split('-').map(Number);
    return new Date(y, m - 1, 1);
  });

  const [rangeStart, setRangeStart] = useState(startDate || todayStr());
  const [rangeEnd, setRangeEnd] = useState(endDate || startDate || todayStr());
  const [selectingEnd, setSelectingEnd] = useState(false);
  const [hoverDate, setHoverDate] = useState(null);

  const viewYear = viewDate.getFullYear();
  const viewMonth = viewDate.getMonth();

  const monthNames = [
    'January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December',
  ];

  const handlePrevMonth = (e) => {
    e.stopPropagation();
    setViewDate(new Date(viewYear, viewMonth - 1, 1));
  };

  const handleNextMonth = (e) => {
    e.stopPropagation();
    setViewDate(new Date(viewYear, viewMonth + 1, 1));
  };

  const handleDateClick = (dateStr) => {
    if (!selectingEnd) {
      setRangeStart(dateStr);
      setRangeEnd(dateStr);
      setSelectingEnd(true);
    } else {
      if (dateStr < rangeStart) {
        setRangeStart(dateStr);
        setRangeEnd(rangeStart);
      } else {
        setRangeEnd(dateStr);
      }
      setSelectingEnd(false);
      setHoverDate(null);
    }
  };

  const handlePresetClick = (presetKey) => {
    const { from, to } = getPresetDates(presetKey);
    setRangeStart(from);
    setRangeEnd(to);
    setSelectingEnd(false);
    const [y, m] = to.split('-').map(Number);
    setViewDate(new Date(y, m - 1, 1));
  };

  // Generate calendar days
  const calendarCells = useMemo(() => {
    const firstDayIndex = new Date(viewYear, viewMonth, 1).getDay();
    // Monday = 0, Sunday = 6
    const startDayOffset = (firstDayIndex + 6) % 7;
    const daysInCurrentMonth = new Date(viewYear, viewMonth + 1, 0).getDate();
    const daysInPrevMonth = new Date(viewYear, viewMonth, 0).getDate();

    const cells = [];
    const pad = (n) => String(n).padStart(2, '0');

    // Previous month filler days
    for (let i = startDayOffset - 1; i >= 0; i--) {
      const day = daysInPrevMonth - i;
      const prevDate = new Date(viewYear, viewMonth - 1, day);
      const dateStr = `${prevDate.getFullYear()}-${pad(prevDate.getMonth() + 1)}-${pad(day)}`;
      cells.push({
        day,
        dateStr,
        isCurrentMonth: false,
      });
    }

    // Current month days
    for (let day = 1; day <= daysInCurrentMonth; day++) {
      const dateStr = `${viewYear}-${pad(viewMonth + 1)}-${pad(day)}`;
      cells.push({
        day,
        dateStr,
        isCurrentMonth: true,
      });
    }

    // Next month filler days to complete grid
    const totalCells = cells.length <= 35 ? 35 : 42;
    const nextDaysNeeded = totalCells - cells.length;
    for (let day = 1; day <= nextDaysNeeded; day++) {
      const nextDate = new Date(viewYear, viewMonth + 1, day);
      const dateStr = `${nextDate.getFullYear()}-${pad(nextDate.getMonth() + 1)}-${pad(day)}`;
      cells.push({
        day,
        dateStr,
        isCurrentMonth: false,
      });
    }

    return cells;
  }, [viewYear, viewMonth]);

  const activeEnd = selectingEnd && hoverDate ? (hoverDate >= rangeStart ? hoverDate : rangeStart) : rangeEnd;
  const activeStart = selectingEnd && hoverDate && hoverDate < rangeStart ? hoverDate : rangeStart;
  const today = todayStr();

  return (
    <div className="custom-calendar-popover fade-in" onClick={(e) => e.stopPropagation()}>
      {/* Calendar Header with Navigation */}
      <div className="calendar-popover-header">
        <button type="button" className="cal-nav-btn" onClick={handlePrevMonth} title="Previous Month">
          &larr;
        </button>
        <span className="cal-month-title">
          {monthNames[viewMonth]} {viewYear}
        </span>
        <button type="button" className="cal-nav-btn" onClick={handleNextMonth} title="Next Month">
          &rarr;
        </button>
      </div>

      {/* Quick Presets Strip inside the Calendar */}
      <div className="cal-presets-strip">
        <button type="button" className="cal-mini-preset" onClick={() => handlePresetClick('today')}>Today</button>
        <button type="button" className="cal-mini-preset" onClick={() => handlePresetClick('yesterday')}>Yesterday</button>
        <button type="button" className="cal-mini-preset" onClick={() => handlePresetClick('week')}>Last 7D</button>
        <button type="button" className="cal-mini-preset" onClick={() => handlePresetClick('month')}>This Month</button>
      </div>

      {/* Interactive Step-by-Step Range Hint */}
      <div className="cal-instruction-banner">
        {selectingEnd ? (
          <span className="cal-instruction-text active">
            👉 <strong>Step 2:</strong> Click <strong>End Date</strong> (or click same date for 1 day)
          </span>
        ) : (
          <span className="cal-instruction-text">
            💡 Click <strong>Start Date</strong>, then click <strong>End Date</strong>
          </span>
        )}
      </div>

      {/* Weekday Names Header */}
      <div className="cal-weekday-grid">
        <span>Mo</span>
        <span>Tu</span>
        <span>We</span>
        <span>Th</span>
        <span>Fr</span>
        <span>Sa</span>
        <span>Su</span>
      </div>

      {/* Days Matrix */}
      <div className="cal-days-grid">
        {calendarCells.map((cell) => {
          const isStart = cell.dateStr === activeStart;
          const isEnd = cell.dateStr === activeEnd;
          const isInRange = cell.dateStr > activeStart && cell.dateStr < activeEnd;
          const isToday = cell.dateStr === today;

          let cellClass = 'cal-day-cell';
          if (!cell.isCurrentMonth) cellClass += ' other-month';
          if (isToday) cellClass += ' is-today';
          if (isStart) cellClass += ' range-start';
          if (isEnd) cellClass += ' range-end';
          if (isInRange) cellClass += ' in-range';

          return (
            <button
              key={cell.dateStr}
              type="button"
              className={cellClass}
              onClick={() => handleDateClick(cell.dateStr)}
              onMouseEnter={() => {
                if (selectingEnd) setHoverDate(cell.dateStr);
              }}
            >
              <span>{cell.day}</span>
            </button>
          );
        })}
      </div>

      {/* Footer Info & Action Buttons */}
      <div className="cal-popover-footer">
        <div className="cal-selected-summary">
          <span className="cal-summary-label">Selected:</span>
          <span className="cal-summary-val">{formatPeriodDisplay(activeStart, activeEnd)}</span>
        </div>
        <div className="cal-footer-actions">
          <button type="button" className="cal-btn-cancel" onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            className="cal-btn-apply"
            onClick={() => onApply(activeStart, activeEnd)}
          >
            Apply Range
          </button>
        </div>
      </div>
    </div>
  );
};

// ── Main Report Dashboard ────────────────────────────────────────────────────
const ReportDashboard = () => {
  const navigate = useNavigate();

  // ── Employees ────────────────────────────────────────────────────────────
  const [employees, setEmployees]     = useState([]);
  const [loadingEmps, setLoadingEmps] = useState(true);

  // ── Target Scope: 'ALL' or 'INDIVIDUAL' ──────────────────────────────────
  const [reportScope, setReportScope] = useState('ALL'); // 'ALL' | 'INDIVIDUAL'

  // ── Date Filters & Presets ───────────────────────────────────────────────
  const [activePreset, setActivePreset]   = useState('today'); // 'today' | 'yesterday' | 'week' | 'month' | 'custom'
  const [fromDate, setFromDate]           = useState(todayStr());
  const [toDate, setToDate]               = useState(todayStr());
  const [isCalendarOpen, setIsCalendarOpen] = useState(false);

  // ── Other Filters ────────────────────────────────────────────────────────
  const [selectedEmpId, setSelectedEmpId] = useState('');
  const [filterStatus, setFilterStatus]   = useState('');
  const [filterSource, setFilterSource]   = useState('');
  const [searchQuery, setSearchQuery]     = useState('');

  // ── Data & Status ────────────────────────────────────────────────────────
  const [reportData, setReportData]       = useState([]);
  const [summaryData, setSummaryData]     = useState(null);
  const [loading, setLoading]             = useState(false);
  const [error, setError]                 = useState('');
  const [generatedInfo, setGeneratedInfo] = useState(null);

  const calendarContainerRef = useRef(null);

  // Close calendar popover on click outside
  useEffect(() => {
    const handleOutsideClick = (e) => {
      if (calendarContainerRef.current && !calendarContainerRef.current.contains(e.target)) {
        setIsCalendarOpen(false);
      }
    };
    if (isCalendarOpen) {
      document.addEventListener('mousedown', handleOutsideClick);
    }
    return () => {
      document.removeEventListener('mousedown', handleOutsideClick);
    };
  }, [isCalendarOpen]);

  // ── Load Employees ───────────────────────────────────────────────────────
  useEffect(() => {
    const fetchEmps = async () => {
      try {
        const res = await getEmployees();
        setEmployees(res.data || []);
      } catch {
        // fail silently
      } finally {
        setLoadingEmps(false);
      }
    };
    fetchEmps();
  }, []);

  // ── Preset Selection Handler ─────────────────────────────────────────────
  const applyPreset = (presetKey) => {
    setActivePreset(presetKey);
    const { from, to } = getPresetDates(presetKey);
    setFromDate(from);
    setToDate(to);
  };

  // ── Date Shifter (-1 day / +1 day) ───────────────────────────────────────
  const shiftDates = (deltaDays) => {
    const parse = (str) => {
      const [y, m, d] = str.split('-').map(Number);
      return new Date(y, m - 1, d);
    };
    const format = (d) => {
      const y = d.getFullYear();
      const m = String(d.getMonth() + 1).padStart(2, '0');
      const day = String(d.getDate()).padStart(2, '0');
      return `${y}-${m}-${day}`;
    };

    const dFrom = parse(fromDate);
    const dTo = parse(toDate);
    dFrom.setDate(dFrom.getDate() + deltaDays);
    dTo.setDate(dTo.getDate() + deltaDays);

    setFromDate(format(dFrom));
    setToDate(format(dTo));
    setActivePreset('custom');
  };

  // ── Currently Selected Employee Object ───────────────────────────────────
  const currentEmployee = useMemo(() => {
    if (!selectedEmpId) return null;
    return employees.find((e) => String(e.id) === String(selectedEmpId)) || null;
  }, [employees, selectedEmpId]);

  // ── Dropdown Options ─────────────────────────────────────────────────────
  const statusOptions = useMemo(
    () => [
      { value: '', label: 'All Statuses', dotColor: '#94a3b8' },
      { value: 'PRESENT', label: 'Present', dotColor: '#10b981' },
      { value: 'ABSENT', label: 'Absent', dotColor: '#ef4444' },
      { value: 'LEAVE', label: 'Leave', dotColor: '#f59e0b' },
      { value: 'OD', label: 'Official Duty', dotColor: '#8b5cf6' },
    ],
    []
  );

  const sourceOptions = useMemo(
    () => [
      {
        value: '',
        label: 'All Sources',
        icon: (
          <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="2">
            <circle cx="12" cy="12" r="10" />
            <path d="M12 6v6l4 2" />
          </svg>
        ),
      },
      {
        value: 'AI_CAMERA',
        label: 'Camera',
        icon: (
          <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="#059669" strokeWidth="2">
            <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z" />
            <circle cx="12" cy="13" r="4" />
          </svg>
        ),
      },
      {
        value: 'MANUAL',
        label: 'Manual',
        icon: (
          <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="#3b82f6" strokeWidth="2">
            <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
            <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
          </svg>
        ),
      },
    ],
    []
  );

  const employeeOptions = useMemo(() => {
    const list = [
      {
        value: '',
        label: reportScope === 'INDIVIDUAL' ? '— All Employees (Disabled) —' : 'All Employees',
        disabled: reportScope === 'INDIVIDUAL',
      },
    ];
    employees.forEach((emp) => {
      list.push({
        value: String(emp.id),
        label: `${emp.firstName} ${emp.lastName || ''}`.trim(),
        code: emp.employeeCode,
      });
    });
    return list;
  }, [employees, reportScope]);

  // ── Fetch Report from API ────────────────────────────────────────────────
  const fetchReport = useCallback(async () => {
    setLoading(true);
    setError('');

    try {
      const params = {
        startDate: fromDate,
        endDate: toDate,
      };

      if (reportScope === 'INDIVIDUAL' && selectedEmpId) {
        params.employeeId = selectedEmpId;
      } else if (reportScope === 'ALL' && selectedEmpId) {
        params.employeeId = selectedEmpId;
      }

      if (filterStatus) params.status = filterStatus;

      const res = await getAttendanceReport(params);
      const data = res.data || [];
      setReportData(data);

      const sumRes = await getSummaryReport(params);
      setSummaryData(sumRes.data);

      // Save what was generated for user clarity
      const empLabel = currentEmployee
        ? `${currentEmployee.firstName} ${currentEmployee.lastName || ''} (${currentEmployee.employeeCode})`
        : 'All Employees';
      setGeneratedInfo({
        scope: reportScope === 'INDIVIDUAL' ? 'Individual Employee' : 'Organization',
        target: empLabel,
        period: formatPeriodDisplay(fromDate, toDate),
        count: data.length,
        timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      });
    } catch (err) {
      setError('Unable to load report data. Please check your date range and filters.');
    } finally {
      setLoading(false);
    }
  }, [fromDate, toDate, reportScope, selectedEmpId, filterStatus, currentEmployee]);

  // Auto load on initial render
  useEffect(() => {
    fetchReport();
  }, [fetchReport]);

  const handleGenerate = (e) => {
    if (e && e.preventDefault) e.preventDefault();
    fetchReport();
  };

  const handleResetFilters = () => {
    applyPreset('today');
    setSelectedEmpId('');
    setFilterStatus('');
    setFilterSource('');
    setSearchQuery('');
  };

  // ── Filtered Rows in View ────────────────────────────────────────────────
  const filteredData = useMemo(() => {
    return reportData.filter((row) => {
      if (filterSource && row.source !== filterSource) return false;
      if (searchQuery) {
        const q = searchQuery.toLowerCase();
        return (
          row.employeeName?.toLowerCase().includes(q) ||
          row.employeeCode?.toLowerCase().includes(q) ||
          row.date?.includes(q) ||
          row.status?.toLowerCase().includes(q)
        );
      }
      return true;
    });
  }, [reportData, filterSource, searchQuery]);

  // ── Individual Employee Attendance Stats ─────────────────────────────────
  const individualStats = useMemo(() => {
    if (!currentEmployee) return null;
    const empRecords = reportData.filter((r) => r.employeeId === currentEmployee.id);
    const total = empRecords.length;
    const present = empRecords.filter((r) => r.status === 'PRESENT' || r.status === 'OVERTIME').length;
    const absent = empRecords.filter((r) => r.status === 'ABSENT').length;
    const leave = empRecords.filter((r) => r.status === 'LEAVE' || r.status === 'OD' || r.status === 'OFFICIAL_DUTY').length;
    const rate = total > 0 ? Math.round((present / total) * 100) : 0;
    return { total, present, absent, leave, rate };
  }, [currentEmployee, reportData]);

  // ── Download Individual Employee PDF (Executive Corporate Format) ────────
  const handleDownloadEmployeePDF = (empObj, customRows = null) => {
    const emp = empObj || currentEmployee;
    if (!emp) return;

    const empName = `${emp.firstName} ${emp.lastName || ''}`.trim();
    const empCode = emp.employeeCode || '—';
    const rows = customRows || filteredData.filter((r) => r.employeeId === emp.id);

    const doc = new jsPDF('p', 'mm', 'a4');
    const pageWidth = 210;
    const pageHeight = 297;
    const margin = 14;
    const contentWidth = pageWidth - margin * 2; // 182mm

    // ── 1. Top Corporate Letterhead ──────────────────────────────────────────
    doc.setTextColor(15, 23, 42); // slate-900
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(15);
    doc.text('FACEDETECT SYSTEMS', margin, 18);

    doc.setTextColor(5, 150, 105); // emerald-600
    doc.setFontSize(8);
    doc.setFont('helvetica', 'bold');
    doc.text('ENTERPRISE AI BIOMETRIC ATTENDANCE', margin, 23);

    doc.setTextColor(100, 116, 139);
    doc.setFontSize(7.5);
    doc.setFont('helvetica', 'normal');
    doc.text('Official Employee Attendance & Time Tracking Record', margin, 27);

    // Right Header Badge Box
    doc.setFillColor(240, 253, 244);
    doc.setDrawColor(167, 243, 208);
    doc.roundedRect(pageWidth - margin - 65, 11, 65, 17, 2, 2, 'FD');

    doc.setTextColor(4, 120, 87);
    doc.setFontSize(8);
    doc.setFont('helvetica', 'bold');
    doc.text('EMPLOYEE ATTENDANCE REPORT', pageWidth - margin - 32.5, 17, { align: 'center' });

    const refCode = `REF: ATT-${empCode}-${fromDate.replace(/-/g, '')}`;
    doc.setTextColor(100, 116, 139);
    doc.setFontSize(7);
    doc.setFont('helvetica', 'normal');
    doc.text(refCode, pageWidth - margin - 32.5, 23, { align: 'center' });

    // Decorative Dual Rule
    doc.setDrawColor(5, 150, 105);
    doc.setLineWidth(0.7);
    doc.line(margin, 31, pageWidth - margin, 31);
    doc.setDrawColor(226, 232, 240);
    doc.setLineWidth(0.3);
    doc.line(margin, 32.2, pageWidth - margin, 32.2);

    // ── 2. Two-Column Metadata Box ──────────────────────────────────────────
    const metaY = 36;
    const metaHeight = 32;
    doc.setFillColor(248, 250, 252);
    doc.setDrawColor(226, 232, 240);
    doc.roundedRect(margin, metaY, contentWidth, metaHeight, 2, 2, 'FD');

    // Left Column: Employee Profile
    doc.setTextColor(100, 116, 139);
    doc.setFontSize(7);
    doc.setFont('helvetica', 'bold');
    doc.text('EMPLOYEE INFORMATION', margin + 6, metaY + 6);

    doc.setTextColor(15, 23, 42);
    doc.setFontSize(12);
    doc.setFont('helvetica', 'bold');
    doc.text(empName, margin + 6, metaY + 12.5);

    doc.setFontSize(8);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(71, 85, 105);
    doc.text('Employee Code:', margin + 6, metaY + 18);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(5, 150, 105);
    doc.text(empCode, margin + 34, metaY + 18);

    doc.setFont('helvetica', 'normal');
    doc.setTextColor(71, 85, 105);
    doc.text('Department:', margin + 6, metaY + 23.5);
    doc.setTextColor(15, 23, 42);
    doc.text(emp.department || 'Operations', margin + 34, metaY + 23.5);

    doc.setFont('helvetica', 'normal');
    doc.setTextColor(71, 85, 105);
    doc.text('Designation:', margin + 6, metaY + 28.5);
    doc.setTextColor(15, 23, 42);
    doc.text(emp.designation || 'Staff', margin + 34, metaY + 28.5);

    // Divider Line
    doc.setDrawColor(226, 232, 240);
    doc.line(margin + contentWidth / 2, metaY + 4, margin + contentWidth / 2, metaY + metaHeight - 4);

    // Right Column: Statement Information
    const rightColX = margin + contentWidth / 2 + 6;
    doc.setTextColor(100, 116, 139);
    doc.setFontSize(7);
    doc.setFont('helvetica', 'bold');
    doc.text('STATEMENT SCOPE', rightColX, metaY + 6);

    doc.setFontSize(8);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(71, 85, 105);
    doc.text('Statement Period:', rightColX, metaY + 13);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(15, 23, 42);
    doc.text(`${formatDisplayDate(fromDate)} to ${formatDisplayDate(toDate)}`, rightColX + 28, metaY + 13);

    doc.setFont('helvetica', 'normal');
    doc.setTextColor(71, 85, 105);
    doc.text('Generated On:', rightColX, metaY + 18.5);
    doc.setTextColor(15, 23, 42);
    doc.text(new Date().toLocaleString('en-GB'), rightColX + 28, metaY + 18.5);

    doc.setTextColor(71, 85, 105);
    doc.text('Verification Mode:', rightColX, metaY + 23.5);
    doc.setTextColor(15, 23, 42);
    doc.text('Facial Biometric & Edge Camera', rightColX + 28, metaY + 23.5);

    doc.setTextColor(71, 85, 105);
    doc.text('Assigned Shift:', rightColX, metaY + 28.5);
    doc.setTextColor(15, 23, 42);
    doc.text(rows[0]?.shiftName || 'General Shift (09:00 - 18:00)', rightColX + 28, metaY + 28.5);

    // ── 3. Executive KPI Dashboard Cards ────────────────────────────────────
    const kpiY = 72;
    const kpiWidth = (contentWidth - 9) / 4;
    const kpiHeight = 17;

    const totalDays = rows.length;
    const presCount = rows.filter((r) => r.status === 'PRESENT' || r.status === 'OVERTIME').length;
    const absCount = rows.filter((r) => r.status === 'ABSENT').length;
    const leaveCount = rows.filter((r) => r.status === 'LEAVE' || r.status === 'OD' || r.status === 'OFFICIAL_DUTY').length;

    const kpis = [
      { label: 'SCHEDULED DAYS', val: String(totalDays).padStart(2, '0'), color: [15, 23, 42], topColor: [59, 130, 246] },
      { label: 'DAYS PRESENT', val: String(presCount).padStart(2, '0'), color: [5, 150, 105], topColor: [16, 185, 129] },
      { label: 'DAYS ABSENT', val: String(absCount).padStart(2, '0'), color: [220, 38, 38], topColor: [239, 68, 68] },
      { label: 'LEAVE / ON DUTY', val: String(leaveCount).padStart(2, '0'), color: [217, 119, 6], topColor: [245, 158, 11] },
    ];

    kpis.forEach((k, i) => {
      const x = margin + i * (kpiWidth + 3);
      doc.setFillColor(255, 255, 255);
      doc.setDrawColor(226, 232, 240);
      doc.roundedRect(x, kpiY, kpiWidth, kpiHeight, 1.5, 1.5, 'FD');

      // Top color stripe
      doc.setFillColor(k.topColor[0], k.topColor[1], k.topColor[2]);
      doc.rect(x + 1, kpiY, kpiWidth - 2, 1, 'F');

      doc.setTextColor(100, 116, 139);
      doc.setFontSize(6.5);
      doc.setFont('helvetica', 'bold');
      doc.text(k.label, x + kpiWidth / 2, kpiY + 5.8, { align: 'center' });

      doc.setTextColor(k.color[0], k.color[1], k.color[2]);
      doc.setFontSize(12);
      doc.setFont('helvetica', 'bold');
      doc.text(k.val, x + kpiWidth / 2, kpiY + 13.5, { align: 'center' });
    });

    // ── 4. Detailed Attendance Log Table ────────────────────────────────────
    const tableData = rows.map((r) => {
      let dayName = '—';
      try {
        const [y, m, d] = r.date.split('-');
        dayName = new Date(Number(y), Number(m) - 1, Number(d)).toLocaleDateString('en-GB', { weekday: 'short' });
      } catch {
        dayName = '—';
      }

      const inTime = r.firstPunch
        ? new Date(r.firstPunch).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
        : '—';
      const outTime = r.lastPunch
        ? new Date(r.lastPunch).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
        : '—';

      let duration = '—';
      if (r.netWorkingMinutes) {
        duration = `${Math.floor(r.netWorkingMinutes / 60)}h ${r.netWorkingMinutes % 60}m`;
      } else if (r.workingDurationMinutes) {
        duration = `${Math.floor(r.workingDurationMinutes / 60)}h ${r.workingDurationMinutes % 60}m`;
      } else if (r.status === 'PRESENT') {
        duration = 'Full Shift';
      }

      const src =
        r.source === 'AI_CAMERA'
          ? 'Camera (Biometric)'
          : r.source === 'MANUAL'
          ? 'Manual Entry'
          : r.source || '—';

      return [
        formatDisplayDate(r.date),
        dayName,
        r.status || 'PENDING',
        inTime,
        outTime,
        duration,
        src,
      ];
    });

    autoTable(doc, {
      startY: 94,
      margin: { left: margin, right: margin },
      head: [['DATE', 'DAY', 'STATUS', 'CHECK IN', 'CHECK OUT', 'DURATION', 'VERIFICATION SOURCE']],
      body: tableData,
      theme: 'grid',
      styles: {
        fontSize: 8,
        cellPadding: 3,
        textColor: [15, 23, 42],
        lineColor: [226, 232, 240],
        lineWidth: 0.15,
        font: 'helvetica',
      },
      headStyles: {
        fillColor: [15, 23, 42],
        textColor: [255, 255, 255],
        fontStyle: 'bold',
        fontSize: 7.5,
        halign: 'center',
      },
      columnStyles: {
        0: { halign: 'left', fontStyle: 'bold' },
        1: { halign: 'center' },
        2: { halign: 'center', fontStyle: 'bold' },
        3: { halign: 'center' },
        4: { halign: 'center' },
        5: { halign: 'center' },
        6: { halign: 'left' },
      },
      alternateRowStyles: {
        fillColor: [248, 250, 252],
      },
      didParseCell: (data) => {
        if (data.section === 'body' && data.column.index === 2) {
          const val = String(data.cell.raw).toUpperCase();
          if (val === 'PRESENT' || val === 'OVERTIME') {
            data.cell.styles.textColor = [5, 150, 105];
          } else if (val === 'ABSENT') {
            data.cell.styles.textColor = [220, 38, 38];
          } else if (val === 'LEAVE' || val === 'OD') {
            data.cell.styles.textColor = [217, 119, 6];
          } else if (val === 'PENDING') {
            data.cell.styles.textColor = [100, 116, 139];
          }
        }
      },
      didDrawPage: (data) => {
        if (data.pageNumber > 1) {
          doc.setFontSize(7.5);
          doc.setTextColor(100, 116, 139);
          doc.text(`FaceDetect Enterprise Attendance Record • ${empName} (${empCode})`, margin, 10);
        }

        // Professional Footer Line
        doc.setDrawColor(226, 232, 240);
        doc.setLineWidth(0.3);
        doc.line(margin, pageHeight - 12, pageWidth - margin, pageHeight - 12);

        doc.setFontSize(7);
        doc.setTextColor(148, 163, 184);
        doc.setFont('helvetica', 'normal');
        doc.text('CONFIDENTIAL • OFFICIAL CORPORATE ATTENDANCE AUDIT RECORD', margin, pageHeight - 8);
        doc.text(`Page ${data.pageNumber}`, pageWidth / 2, pageHeight - 8, { align: 'center' });
        doc.text('FaceDetect Biometric Security', pageWidth - margin, pageHeight - 8, { align: 'right' });
      },
    });

    // ── 5. System Certification & Official Signatures ────────────────────────
    let currentY = (doc.lastAutoTable?.finalY || 140) + 8;

    if (currentY + 45 > pageHeight - 15) {
      doc.addPage();
      currentY = 25;
    }

    // Official System Note Box
    doc.setFillColor(248, 250, 252);
    doc.setDrawColor(226, 232, 240);
    doc.roundedRect(margin, currentY, contentWidth, 13, 1.5, 1.5, 'FD');

    doc.setFontSize(6.5);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(100, 116, 139);
    doc.text(
      'SYSTEM CERTIFICATION: This document is an electronically generated attendance record captured via AI face biometrics.',
      margin + 4,
      currentY + 4.8
    );
    doc.text(
      'All timestamp entries comply with corporate HR policies. Any discrepancy must be submitted for reconciliation within 3 working days.',
      margin + 4,
      currentY + 9.2
    );

    currentY += 20;

    // 3 Formal Signature Lines
    const sigColWidth = (contentWidth - 20) / 3;

    // Col 1: Employee
    doc.setDrawColor(148, 163, 184);
    doc.setLineWidth(0.3);
    doc.line(margin, currentY + 10, margin + sigColWidth, currentY + 10);

    doc.setFontSize(7.5);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(15, 23, 42);
    doc.text('EMPLOYEE SIGNATURE', margin, currentY + 14.5);

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7);
    doc.setTextColor(100, 116, 139);
    doc.text(`Date: ${todayFormatted}`, margin, currentY + 19);

    // Col 2: HR / Admin
    const hrX = margin + sigColWidth + 10;
    doc.line(hrX, currentY + 10, hrX + sigColWidth, currentY + 10);

    doc.setFontSize(7.5);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(15, 23, 42);
    doc.text('HR VERIFICATION', hrX, currentY + 14.5);

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7);
    doc.setTextColor(100, 116, 139);
    doc.text('Status: Verified & Approved', hrX, currentY + 19);

    // Col 3: Department Head
    const hodX = hrX + sigColWidth + 10;
    doc.line(hodX, currentY + 10, hodX + sigColWidth, currentY + 10);

    doc.setFontSize(7.5);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(15, 23, 42);
    doc.text('AUTHORIZED SIGNATORY', hodX, currentY + 14.5);

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7);
    doc.setTextColor(100, 116, 139);
    doc.text('Management Authority', hodX, currentY + 19);

    const safeName = empName.replace(/[^a-zA-Z0-9]/g, '_');
    doc.save(`Attendance_${empCode}_${safeName}_${fromDate}_to_${toDate}.pdf`);
  };

  // ── Download Company-wide PDF (Executive Corporate Format) ───────────────
  const handleExportAllPDF = () => {
    const doc = new jsPDF('p', 'mm', 'a4');
    const pageWidth = 210;
    const pageHeight = 297;
    const margin = 14;
    const contentWidth = pageWidth - margin * 2; // 182mm

    // ── 1. Top Corporate Letterhead ──────────────────────────────────────────
    doc.setTextColor(15, 23, 42);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(15);
    doc.text('FACEDETECT SYSTEMS', margin, 18);

    doc.setTextColor(5, 150, 105);
    doc.setFontSize(8);
    doc.setFont('helvetica', 'bold');
    doc.text('ENTERPRISE WORKFORCE ATTENDANCE MANAGEMENT', margin, 23);

    doc.setTextColor(100, 116, 139);
    doc.setFontSize(7.5);
    doc.setFont('helvetica', 'normal');
    doc.text('Consolidated Corporate Attendance Statement', margin, 27);

    // Right Header Badge Box
    doc.setFillColor(240, 253, 244);
    doc.setDrawColor(167, 243, 208);
    doc.roundedRect(pageWidth - margin - 65, 11, 65, 17, 2, 2, 'FD');

    doc.setTextColor(4, 120, 87);
    doc.setFontSize(8);
    doc.setFont('helvetica', 'bold');
    doc.text('ORGANIZATION REPORT', pageWidth - margin - 32.5, 17, { align: 'center' });

    const refCode = `AUDIT-ATT-${fromDate.replace(/-/g, '')}-${toDate.replace(/-/g, '')}`;
    doc.setTextColor(100, 116, 139);
    doc.setFontSize(7);
    doc.setFont('helvetica', 'normal');
    doc.text(refCode, pageWidth - margin - 32.5, 23, { align: 'center' });

    // Dual Rule
    doc.setDrawColor(5, 150, 105);
    doc.setLineWidth(0.7);
    doc.line(margin, 31, pageWidth - margin, 31);
    doc.setDrawColor(226, 232, 240);
    doc.setLineWidth(0.3);
    doc.line(margin, 32.2, pageWidth - margin, 32.2);

    // ── 2. Summary KPI Strip (5 Cards) ──────────────────────────────────────
    const kpiY = 36;
    const kpiWidth = (contentWidth - 12) / 5;
    const kpiHeight = 17;

    const totalCount = summaryData?.totalEmployees || filteredData.length;
    const presCount = summaryData?.totalPresent || 0;
    const absCount = summaryData?.totalAbsent || 0;
    const leaveCount = (summaryData?.totalLeave || 0) + (summaryData?.totalOD || 0);
    const presRate = totalCount > 0 ? Math.round((presCount / totalCount) * 100) : 0;

    const kpis = [
      { label: 'TOTAL LOGS', val: String(totalCount).padStart(2, '0'), color: [15, 23, 42], topColor: [59, 130, 246] },
      { label: 'PRESENT', val: String(presCount).padStart(2, '0'), color: [5, 150, 105], topColor: [16, 185, 129] },
      { label: 'ABSENT', val: String(absCount).padStart(2, '0'), color: [220, 38, 38], topColor: [239, 68, 68] },
      { label: 'LEAVE / OD', val: String(leaveCount).padStart(2, '0'), color: [217, 119, 6], topColor: [245, 158, 11] },
      { label: 'ATTENDANCE', val: `${presRate}%`, color: [15, 23, 42], topColor: [139, 92, 246] },
    ];

    kpis.forEach((k, i) => {
      const x = margin + i * (kpiWidth + 3);
      doc.setFillColor(248, 250, 252);
      doc.setDrawColor(226, 232, 240);
      doc.roundedRect(x, kpiY, kpiWidth, kpiHeight, 1.5, 1.5, 'FD');

      doc.setFillColor(k.topColor[0], k.topColor[1], k.topColor[2]);
      doc.rect(x + 1, kpiY, kpiWidth - 2, 1, 'F');

      doc.setTextColor(100, 116, 139);
      doc.setFontSize(6);
      doc.setFont('helvetica', 'bold');
      doc.text(k.label, x + kpiWidth / 2, kpiY + 5.8, { align: 'center' });

      doc.setTextColor(k.color[0], k.color[1], k.color[2]);
      doc.setFontSize(11);
      doc.setFont('helvetica', 'bold');
      doc.text(k.val, x + kpiWidth / 2, kpiY + 13.5, { align: 'center' });
    });

    // ── 3. Table of Records ──────────────────────────────────────────────────
    const tableData = filteredData.map((row) => {
      let dayName = '—';
      try {
        const [y, m, d] = row.date.split('-');
        dayName = new Date(Number(y), Number(m) - 1, Number(d)).toLocaleDateString('en-GB', { weekday: 'short' });
      } catch {
        dayName = '—';
      }

      const inTime = row.firstPunch
        ? new Date(row.firstPunch).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
        : '—';
      const outTime = row.lastPunch
        ? new Date(row.lastPunch).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
        : '—';

      const src =
        row.source === 'AI_CAMERA'
          ? 'Camera'
          : row.source === 'MANUAL'
          ? 'Manual'
          : row.source || '—';

      return [
        row.employeeName,
        row.employeeCode,
        formatDisplayDate(row.date),
        dayName,
        row.status || 'PENDING',
        inTime,
        outTime,
        row.rawRecords ? String(row.rawRecords.length) : '0',
        src,
      ];
    });

    autoTable(doc, {
      startY: 58,
      margin: { left: margin, right: margin },
      head: [['EMPLOYEE', 'CODE', 'DATE', 'DAY', 'STATUS', 'IN TIME', 'OUT TIME', 'CAPTURES', 'SOURCE']],
      body: tableData,
      theme: 'grid',
      styles: {
        fontSize: 7.5,
        cellPadding: 2.5,
        textColor: [15, 23, 42],
        lineColor: [226, 232, 240],
        lineWidth: 0.15,
        font: 'helvetica',
      },
      headStyles: {
        fillColor: [15, 23, 42],
        textColor: [255, 255, 255],
        fontStyle: 'bold',
        fontSize: 7,
        halign: 'center',
      },
      columnStyles: {
        0: { halign: 'left', fontStyle: 'bold' },
        1: { halign: 'center', fontStyle: 'bold', textColor: [5, 150, 105] },
        2: { halign: 'center' },
        3: { halign: 'center' },
        4: { halign: 'center', fontStyle: 'bold' },
        5: { halign: 'center' },
        6: { halign: 'center' },
        7: { halign: 'center' },
        8: { halign: 'left' },
      },
      alternateRowStyles: {
        fillColor: [248, 250, 252],
      },
      didParseCell: (data) => {
        if (data.section === 'body' && data.column.index === 4) {
          const val = String(data.cell.raw).toUpperCase();
          if (val === 'PRESENT' || val === 'OVERTIME') {
            data.cell.styles.textColor = [5, 150, 105];
          } else if (val === 'ABSENT') {
            data.cell.styles.textColor = [220, 38, 38];
          } else if (val === 'LEAVE' || val === 'OD') {
            data.cell.styles.textColor = [217, 119, 6];
          } else if (val === 'PENDING') {
            data.cell.styles.textColor = [100, 116, 139];
          }
        }
      },
      didDrawPage: (data) => {
        if (data.pageNumber > 1) {
          doc.setFontSize(7.5);
          doc.setTextColor(100, 116, 139);
          doc.text(`FaceDetect Enterprise • Workforce Attendance Audit (${formatDisplayDate(fromDate)} to ${formatDisplayDate(toDate)})`, margin, 10);
        }

        // Footer
        doc.setDrawColor(226, 232, 240);
        doc.setLineWidth(0.3);
        doc.line(margin, pageHeight - 12, pageWidth - margin, pageHeight - 12);

        doc.setFontSize(7);
        doc.setTextColor(148, 163, 184);
        doc.setFont('helvetica', 'normal');
        doc.text('CONFIDENTIAL • OFFICIAL AUDIT RECORD', margin, pageHeight - 8);
        doc.text(`Page ${data.pageNumber}`, pageWidth / 2, pageHeight - 8, { align: 'center' });
        doc.text('FaceDetect Biometric Security', pageWidth - margin, pageHeight - 8, { align: 'right' });
      },
    });

    // Sign-off
    let currentY = (doc.lastAutoTable?.finalY || 140) + 8;
    if (currentY + 30 > pageHeight - 15) {
      doc.addPage();
      currentY = 25;
    }

    const sigColWidth = (contentWidth - 20) / 2;
    doc.setDrawColor(148, 163, 184);
    doc.setLineWidth(0.3);
    doc.line(margin, currentY + 12, margin + sigColWidth, currentY + 12);
    doc.setFontSize(7.5);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(15, 23, 42);
    doc.text('HR OPERATIONS LEAD', margin, currentY + 16.5);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7);
    doc.setTextColor(100, 116, 139);
    doc.text(`Certified On: ${new Date().toLocaleString('en-GB')}`, margin, currentY + 21);

    const rightSigX = margin + sigColWidth + 20;
    doc.line(rightSigX, currentY + 12, rightSigX + sigColWidth, currentY + 12);
    doc.setFontSize(7.5);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(15, 23, 42);
    doc.text('AUTHORIZED SIGNATORY / DIRECTOR', rightSigX, currentY + 16.5);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7);
    doc.setTextColor(100, 116, 139);
    doc.text('Executive Management Authority', rightSigX, currentY + 21);

    doc.save(`Attendance_Report_${fromDate}_to_${toDate}.pdf`);
  };

  // ── Download Company-wide Excel ──────────────────────────────────────────
  const handleExportAllExcel = () => {
    const wb = XLSX.utils.book_new();

    const summaryRows = [
      ['FACEDETECT ENTERPRISE ATTENDANCE REPORT'],
      ['Report Period', `${fromDate} to ${toDate}`],
      ['Generated At', new Date().toLocaleString()],
      [],
      ['Metric', 'Count'],
      ['Total Records', summaryData?.totalEmployees || filteredData.length],
      ['Present', summaryData?.totalPresent || 0],
      ['Absent', summaryData?.totalAbsent || 0],
      ['Leave', summaryData?.totalLeave || 0],
      ['Official Duty', summaryData?.totalOD || 0],
    ];
    const summarySheet = XLSX.utils.aoa_to_sheet(summaryRows);
    XLSX.utils.book_append_sheet(wb, summarySheet, 'Overview');

    const detailsRows = filteredData.map((row) => ({
      Employee: row.employeeName,
      'Employee Code': row.employeeCode,
      Date: row.date,
      Status: row.status,
      'First Entry': row.firstPunch ? new Date(row.firstPunch).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '—',
      'Last Entry': row.lastPunch ? new Date(row.lastPunch).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '—',
      'Total Captures': row.rawRecords ? row.rawRecords.length : 0,
      Source: row.source || '—',
    }));
    const detailsSheet = XLSX.utils.json_to_sheet(detailsRows);

    const wscols = [
      { wch: 20 }, { wch: 15 }, { wch: 14 }, { wch: 14 }, { wch: 14 }, { wch: 14 }, { wch: 12 }, { wch: 14 },
    ];
    detailsSheet['!cols'] = wscols;

    XLSX.utils.book_append_sheet(wb, detailsSheet, 'Attendance Records');
    XLSX.writeFile(wb, `Attendance_Report_${fromDate}_to_${toDate}.xlsx`);
  };

  // Current formatted today for header
  const todayFormatted = new Date().toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    weekday: 'long',
  });

  return (
    <div className="report-dashboard page-container fade-in">
      {/* ── 1. HEADER BAR ────────────────────────────────────────────── */}
      <div className="report-header-banner">
        <div className="header-left">
          <div className="header-icon-box">
            <svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="#047857" strokeWidth="2.3" strokeLinecap="round" strokeLinejoin="round">
              <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
              <polyline points="14 2 14 8 20 8"/>
              <line x1="16" y1="13" x2="8" y2="13"/>
              <line x1="16" y1="17" x2="8" y2="17"/>
              <polyline points="10 9 9 9 8 9"/>
            </svg>
          </div>
          <div>
            <div className="header-badge-row">
              <span className="header-badge">REPORTS & ANALYTICS</span>
              <span className="header-period-tag">{formatPeriodDisplay(fromDate, toDate)}</span>
            </div>
            <h1 className="header-title">Attendance Reports</h1>
            <p className="header-subtitle">Generate, analyze, and instantly download employee attendance sheets.</p>
          </div>
        </div>

        <div className="header-right">
          <div className="header-today-pill">
            <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="#059669" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
              <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
              <line x1="16" y1="2" x2="16" y2="6" />
              <line x1="8" y1="2" x2="8" y2="6" />
              <line x1="3" y1="10" x2="21" y2="10" />
            </svg>
            <div>
              <span className="today-label">Today</span>
              <span className="today-val">{todayFormatted}</span>
            </div>
          </div>
        </div>
      </div>

      {/* ── 2. INTERACTIVE CONTROL CENTER ────────────────────────────── */}
      <div className="report-control-card">
        {/* Top Scope Switcher + Date Presets */}
        <div className="control-card-top">
          {/* Scope Selector */}
          <div className="scope-switch-group">
            <button
              type="button"
              className={`scope-pill-btn ${reportScope === 'ALL' ? 'active' : ''} ${reportScope === 'INDIVIDUAL' ? 'disabled-scope' : ''}`}
              disabled={reportScope === 'INDIVIDUAL'}
              onClick={() => {
                if (reportScope !== 'INDIVIDUAL') {
                  setReportScope('ALL');
                  setSelectedEmpId('');
                }
              }}
              title={reportScope === 'INDIVIDUAL' ? 'All Employees mode is disabled. Click Enable All Employees to restore.' : 'View attendance for all employees'}
            >
              <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/>
                <circle cx="9" cy="7" r="4"/>
                <path d="M23 21v-2a4 4 0 0 0-3-3.87"/>
                <path d="M16 3.13a4 4 0 0 1 0 7.75"/>
              </svg>
              <span>All Employees</span>
              {reportScope === 'INDIVIDUAL' && <span className="scope-disabled-tag">Disabled</span>}
            </button>

            <button
              type="button"
              className={`scope-pill-btn ${reportScope === 'INDIVIDUAL' ? 'active' : ''}`}
              onClick={() => {
                setReportScope('INDIVIDUAL');
                if (!selectedEmpId && employees.length > 0) {
                  setSelectedEmpId(employees[0].id);
                }
              }}
            >
              <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/>
                <circle cx="12" cy="7" r="4"/>
              </svg>
              <span>Single Employee</span>
              {reportScope === 'INDIVIDUAL' && <span className="scope-active-dot">● Active</span>}
            </button>

            {reportScope === 'INDIVIDUAL' && (
              <button
                type="button"
                className="btn-enable-all"
                onClick={() => {
                  setReportScope('ALL');
                  setSelectedEmpId('');
                }}
                title="Re-enable All Employees mode"
              >
                <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="1 4 1 10 7 10"/>
                  <path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10"/>
                </svg>
                <span>Enable All Employees</span>
              </button>
            )}
          </div>

          {/* Quick Date Presets */}
          <div className="date-presets-group">
            <span className="date-presets-label">Period:</span>
            <button
              type="button"
              className={`date-preset-chip ${activePreset === 'today' ? 'active' : ''}`}
              onClick={() => applyPreset('today')}
            >
              Today
            </button>
            <button
              type="button"
              className={`date-preset-chip ${activePreset === 'yesterday' ? 'active' : ''}`}
              onClick={() => applyPreset('yesterday')}
            >
              Yesterday
            </button>
            <button
              type="button"
              className={`date-preset-chip ${activePreset === 'week' ? 'active' : ''}`}
              onClick={() => applyPreset('week')}
            >
              Last 7 Days
            </button>
            <button
              type="button"
              className={`date-preset-chip ${activePreset === 'month' ? 'active' : ''}`}
              onClick={() => applyPreset('month')}
            >
              This Month
            </button>
          </div>
        </div>

        {/* Filter Inputs & Controls Row */}
        <form onSubmit={handleGenerate} className="control-filters-row">
          {/* Calendar Picker Block */}
          <div className="filter-item date-range-picker-block" ref={calendarContainerRef}>
            <label className="filter-item-label">
              <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="2">
                <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
                <line x1="16" y1="2" x2="16" y2="6" />
                <line x1="8" y1="2" x2="8" y2="6" />
                <line x1="3" y1="10" x2="21" y2="10" />
              </svg>
              Date Range
            </label>
            <div className="date-selector-wrapper">
              <div className="date-selector-container">
                <button
                  type="button"
                  className="date-nav-arrow"
                  onClick={() => shiftDates(-1)}
                  title="Previous Day"
                >
                  &larr;
                </button>

                <div
                  className={`date-display-box-pill ${isCalendarOpen ? 'active-picker' : ''}`}
                  onClick={() => setIsCalendarOpen(!isCalendarOpen)}
                  title="Click to open calendar"
                >
                  <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="#059669" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                    <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
                    <line x1="16" y1="2" x2="16" y2="6" />
                    <line x1="8" y1="2" x2="8" y2="6" />
                    <line x1="3" y1="10" x2="21" y2="10" />
                  </svg>
                  <span className="date-box-text">{formatPeriodDisplay(fromDate, toDate)}</span>
                  <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" style={{ color: '#64748b' }}>
                    <polyline points="6 9 12 15 18 9"/>
                  </svg>
                </div>

                <button
                  type="button"
                  className="date-nav-arrow"
                  onClick={() => shiftDates(1)}
                  title="Next Day"
                >
                  &rarr;
                </button>
              </div>

              {/* Floating Custom In-App Calendar Popover */}
              {isCalendarOpen && (
                <CustomCalendar
                  startDate={fromDate}
                  endDate={toDate}
                  onApply={(start, end) => {
                    setFromDate(start);
                    setToDate(end);
                    setIsCalendarOpen(false);
                    setActivePreset('custom');
                  }}
                  onClose={() => setIsCalendarOpen(false)}
                />
              )}
            </div>
          </div>

          {/* Employee Selector (Always visible or highlighted in Individual mode) */}
          <div className="filter-item employee-filter-item">
            <label className="filter-item-label">
              <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/>
                <circle cx="12" cy="7" r="4"/>
              </svg>
              {reportScope === 'INDIVIDUAL' ? 'Select Employee *' : 'Employee'}
            </label>
            <CustomSelect
              value={selectedEmpId}
              onChange={(val) => {
                setSelectedEmpId(val);
                if (val) {
                  setReportScope('INDIVIDUAL');
                } else {
                  setReportScope('ALL');
                }
              }}
              options={employeeOptions}
              disabled={loadingEmps}
              highlight={reportScope === 'INDIVIDUAL'}
              placeholder={loadingEmps ? 'Loading employees...' : 'All Employees'}
              ariaLabel="Select employee filter"
            />
          </div>

          {/* Status Filter */}
          <div className="filter-item status-filter-item">
            <label className="filter-item-label">Status</label>
            <CustomSelect
              value={filterStatus}
              onChange={(val) => setFilterStatus(val)}
              options={statusOptions}
              ariaLabel="Filter by attendance status"
            />
          </div>

          {/* Source Filter */}
          <div className="filter-item source-filter-item">
            <label className="filter-item-label">Source</label>
            <CustomSelect
              value={filterSource}
              onChange={(val) => setFilterSource(val)}
              options={sourceOptions}
              ariaLabel="Filter by capture source"
            />
          </div>

          {/* Action Buttons: Generate & Clear */}
          <div className="filter-actions-group">
            <button
              type="submit"
              className="btn-primary-generate"
              disabled={loading}
              title="Generate report for selected parameters"
            >
              <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor">
                <path d="M5 9.2h3V19H5zM10.6 5h2.8v14h-2.8zm5.6 8H19v6h-2.8z"/>
              </svg>
              <span>{loading ? 'Generating...' : 'Generate'}</span>
            </button>

            <button
              type="button"
              onClick={handleResetFilters}
              className="btn-secondary-reset"
              title="Reset all filters to default"
            >
              <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="23 4 23 10 17 10"/>
                <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/>
              </svg>
              <span>Reset</span>
            </button>
          </div>
        </form>

        {/* ── 2B. INDIVIDUAL EMPLOYEE SPOTLIGHT CARD ── */}
        {reportScope === 'INDIVIDUAL' && currentEmployee && (
          <div className="employee-spotlight-card">
            <div className="spotlight-left">
              <div className="spotlight-avatar">
                {currentEmployee.firstName?.charAt(0)}
                {currentEmployee.lastName?.charAt(0) || ''}
              </div>
              <div className="spotlight-info">
                <div className="spotlight-name-row">
                  <span className="spotlight-name">
                    {currentEmployee.firstName} {currentEmployee.lastName || ''}
                  </span>
                  <span className="spotlight-code">{currentEmployee.employeeCode}</span>
                </div>
                <div className="spotlight-sub">
                  <span>{currentEmployee.department || 'Operations'}</span>
                  <span className="dot">•</span>
                  <span>{currentEmployee.designation || 'Staff'}</span>
                  <span className="dot">•</span>
                  <span>Period: <strong>{formatPeriodDisplay(fromDate, toDate)}</strong></span>
                </div>
              </div>
            </div>

            {/* Individual Employee Metrics */}
            {individualStats && (
              <div className="spotlight-stats-row">
                <div className="spotlight-stat-item">
                  <span className="stat-num">{individualStats.total}</span>
                  <span className="stat-lbl">Records</span>
                </div>
                <div className="spotlight-stat-item text-success">
                  <span className="stat-num">{individualStats.present}</span>
                  <span className="stat-lbl">Present</span>
                </div>
                <div className="spotlight-stat-item text-danger">
                  <span className="stat-num">{individualStats.absent}</span>
                  <span className="stat-lbl">Absent</span>
                </div>
                <div className="spotlight-stat-item text-warning">
                  <span className="stat-num">{individualStats.leave}</span>
                  <span className="stat-lbl">Leave/OD</span>
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Error Alert */}
      {error && (
        <div className="report-alert-danger">
          <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2">
            <circle cx="12" cy="12" r="10" />
            <line x1="12" y1="8" x2="12" y2="12" />
            <line x1="12" y1="16" x2="12.01" y2="16" />
          </svg>
          <span>{error}</span>
        </div>
      )}

      {/* ── 3. SUMMARY KPI CARDS (ORGANIZATION SCOPE) ────────────────── */}
      {reportScope === 'ALL' && <SummaryCards summary={summaryData} />}

      {/* ── 4. ATTENDANCE REPORT TABLE & EXPORT ──────────────────────── */}
      <div className="report-table-card">
        {/* Table Top Header Bar */}
        <div className="report-table-header">
          <div className="table-header-left">
            <h2 className="report-table-title">
              {reportScope === 'INDIVIDUAL' && currentEmployee
                ? `Attendance Records for ${currentEmployee.firstName} ${currentEmployee.lastName || ''}`
                : 'Attendance Records'}
            </h2>
            {generatedInfo && (
              <span className="generated-status-pill">
                ✓ Generated for: <strong>{generatedInfo.target}</strong> ({generatedInfo.period}) • {generatedInfo.count} records
              </span>
            )}
          </div>

          <div className="report-table-actions">
            {/* Realtime Search Bar */}
            <div className="report-search-wrap">
              <svg className="report-search-icon" viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2">
                <circle cx="11" cy="11" r="8" />
                <line x1="21" y1="21" x2="16.65" y2="16.65" />
              </svg>
              <input
                type="text"
                placeholder="Search by name, code, date..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="report-search-input"
              />
            </div>

            {/* Export Buttons */}
            {reportScope === 'INDIVIDUAL' && currentEmployee ? (
              <div className="report-table-export-group">
                <button
                  type="button"
                  className="btn-export-pdf"
                  onClick={() => handleDownloadEmployeePDF(currentEmployee)}
                  disabled={filteredData.length === 0}
                  title="Download PDF"
                >
                  <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                    <polyline points="14 2 14 8 20 8" />
                  </svg>
                  <span>Download PDF</span>
                </button>
                <button
                  type="button"
                  className="btn-export-excel"
                  onClick={() => handleDownloadEmployeeExcel(currentEmployee)}
                  disabled={filteredData.length === 0}
                  title="Download Excel"
                >
                  <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2">
                    <rect x="3" y="3" width="18" height="18" rx="2" ry="2"/>
                    <line x1="3" y1="9" x2="21" y2="9"/>
                    <line x1="3" y1="15" x2="21" y2="15"/>
                    <line x1="9" y1="3" x2="9" y2="21"/>
                    <line x1="15" y1="3" x2="15" y2="21"/>
                  </svg>
                  <span>Download Excel</span>
                </button>
              </div>
            ) : (
              <div className="report-table-export-group">
                <button
                  type="button"
                  className="btn-export-pdf"
                  onClick={handleExportAllPDF}
                  disabled={filteredData.length === 0}
                  title="Export complete attendance table as PDF"
                >
                  <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                    <polyline points="14 2 14 8 20 8" />
                  </svg>
                  <span>Export PDF</span>
                </button>
                <button
                  type="button"
                  className="btn-export-excel"
                  onClick={handleExportAllExcel}
                  disabled={filteredData.length === 0}
                  title="Export complete attendance table as Excel"
                >
                  <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2">
                    <rect x="3" y="3" width="18" height="18" rx="2" ry="2"/>
                    <line x1="3" y1="9" x2="21" y2="9"/>
                    <line x1="3" y1="15" x2="21" y2="15"/>
                    <line x1="9" y1="3" x2="9" y2="21"/>
                    <line x1="15" y1="3" x2="15" y2="21"/>
                  </svg>
                  <span>Export Excel</span>
                </button>
              </div>
            )}
          </div>
        </div>

        {/* Table Content */}
        {loading ? (
          <div style={{ padding: '60px 0' }}>
            <Loader message="Generating attendance data..." />
          </div>
        ) : (
          <>
            <div className="report-desktop-table">
              <div className="table-responsive" style={{ overflowX: 'auto', width: '100%' }}>
                <table className="report-custom-table">
                  <thead>
                    <tr>
                      <th style={{ width: '22%' }}>EMPLOYEE</th>
                      <th style={{ width: '13%' }}>DATE</th>
                      <th style={{ width: '12%' }}>STATUS</th>
                      <th style={{ width: '12%' }}>FIRST ENTRY</th>
                      <th style={{ width: '12%' }}>LAST ENTRY</th>
                      <th style={{ width: '9%' }}>CAPTURES</th>
                      <th style={{ width: '10%' }}>SOURCE</th>
                      <th style={{ width: '10%', textAlign: 'right' }}>ACTIONS</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredData.length === 0 ? (
                      <tr>
                        <td colSpan={8} style={{ padding: 0 }}>
                          <div className="report-empty-wrap">
                            <div className="report-empty-icon">
                              <svg width="46" height="46" viewBox="0 0 24 24" fill="none" stroke="#94a3b8" strokeWidth="1.5">
                                <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                                <polyline points="14 2 14 8 20 8" />
                                <line x1="16" y1="13" x2="8" y2="13" />
                                <line x1="16" y1="17" x2="8" y2="17" />
                              </svg>
                            </div>
                            <p className="report-empty-msg">
                              {reportData.length === 0
                                ? 'No attendance records found for this period. Try adjusting the date range or filters.'
                                : 'No records match your search filter.'}
                            </p>
                          </div>
                        </td>
                      </tr>
                    ) : (
                      filteredData.map((row, idx) => (
                        <tr key={`${row.employeeId}-${row.date}-${idx}`}>
                          <td>
                            <div style={{ fontWeight: 600, color: 'var(--text-primary)', fontSize: '13.5px' }}>
                              {row.employeeName}
                            </div>
                            <div style={{ fontFamily: 'var(--font-mono)', fontSize: '11.5px', marginTop: '2px' }}>
                              <span className="report-emp-code">{row.employeeCode}</span>
                            </div>
                          </td>
                          <td style={{ fontWeight: 500 }}>
                            {formatDisplayDate(row.date)}
                          </td>
                          <td>
                            <StatusBadge status={row.status} />
                          </td>
                          <td style={{ fontFamily: 'var(--font-mono)', fontSize: '12px' }}>
                            {row.firstPunch ? (
                              <span className="punch-time-tag">
                                {new Date(row.firstPunch).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                              </span>
                            ) : (
                              <span style={{ color: 'var(--text-muted)' }}>—</span>
                            )}
                          </td>
                          <td style={{ fontFamily: 'var(--font-mono)', fontSize: '12px' }}>
                            {row.lastPunch ? (
                              <span className="punch-time-tag">
                                {new Date(row.lastPunch).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                              </span>
                            ) : (
                              <span style={{ color: 'var(--text-muted)' }}>—</span>
                            )}
                          </td>
                          <td>
                            <span style={{ color: 'var(--text-secondary)', fontWeight: 600 }}>
                              {row.rawRecords ? row.rawRecords.length : 0}
                            </span>
                          </td>
                          <td>
                            <SourceBadge source={row.source} />
                          </td>
                          <td style={{ textAlign: 'right' }}>
                            {/* View details */}
                            <button
                              type="button"
                              className="view-action-btn"
                              onClick={() => {
                                if (row.rawRecords && row.rawRecords.length > 0) {
                                  navigate(`/attendance/${row.rawRecords[0].id}`, { state: { records: row.rawRecords } });
                                }
                              }}
                              disabled={!row.rawRecords || row.rawRecords.length === 0}
                              style={{ opacity: (!row.rawRecords || row.rawRecords.length === 0) ? 0.35 : 1 }}
                              title="View punch logs"
                            >
                              View &rarr;
                            </button>
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Mobile View: Clean, Responsive Cards */}
            <div className="report-mobile-cards">
              {filteredData.length === 0 ? (
                <div className="report-empty-wrap">
                  <div className="report-empty-icon">
                    <svg width="46" height="46" viewBox="0 0 24 24" fill="none" stroke="#94a3b8" strokeWidth="1.5">
                      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                      <polyline points="14 2 14 8 20 8" />
                      <line x1="16" y1="13" x2="8" y2="13" />
                      <line x1="16" y1="17" x2="8" y2="17" />
                    </svg>
                  </div>
                  <p className="report-empty-msg">
                    {reportData.length === 0
                      ? 'No attendance records found for this period.'
                      : 'No records match your search filter.'}
                  </p>
                </div>
              ) : (
                filteredData.map((row, idx) => (
                  <div className="report-m-card" key={`m-${row.employeeId}-${row.date}-${idx}`}>
                    <div className="report-m-card-top">
                      <div className="report-m-card-user">
                        <div className="report-m-card-avatar">
                          {row.employeeName ? row.employeeName.charAt(0).toUpperCase() : 'E'}
                        </div>
                        <div className="report-m-card-name-block">
                          <span className="report-m-card-name">{row.employeeName}</span>
                          <span className="report-m-card-code">{row.employeeCode}</span>
                        </div>
                      </div>
                      <StatusBadge status={row.status} />
                    </div>

                    <div className="report-m-card-body">
                      <div className="report-m-stat-row">
                        <div className="report-m-stat-item">
                          <span className="report-m-stat-lbl">Date</span>
                          <span className="report-m-stat-val">{formatDisplayDate(row.date)}</span>
                        </div>
                        <div className="report-m-stat-item">
                          <span className="report-m-stat-lbl">Source</span>
                          <span className="report-m-stat-val"><SourceBadge source={row.source} /></span>
                        </div>
                      </div>

                      <div className="report-m-stat-row">
                        <div className="report-m-stat-item">
                          <span className="report-m-stat-lbl">Punch In</span>
                          <span className="report-m-stat-val">
                            {row.firstPunch ? (
                              <span className="punch-time-tag">
                                {new Date(row.firstPunch).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                              </span>
                            ) : (
                              '—'
                            )}
                          </span>
                        </div>
                        <div className="report-m-stat-item">
                          <span className="report-m-stat-lbl">Punch Out</span>
                          <span className="report-m-stat-val">
                            {row.lastPunch ? (
                              <span className="punch-time-tag">
                                {new Date(row.lastPunch).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                              </span>
                            ) : (
                              '—'
                            )}
                          </span>
                        </div>
                      </div>
                    </div>

                    {row.rawRecords && row.rawRecords.length > 0 && (
                      <div className="report-m-card-footer">
                        <button
                          type="button"
                          className="report-m-view-btn"
                          onClick={() => {
                            navigate(`/attendance/${row.rawRecords[0].id}`, { state: { records: row.rawRecords } });
                          }}
                        >
                          View Punch Logs &rarr;
                        </button>
                      </div>
                    )}
                  </div>
                ))
              )}
            </div>
          </>
        )}

        {/* Table Footer */}
        <div className="report-table-footer">
          <span className="report-footer-count">
            Showing <strong>{filteredData.length}</strong> of {reportData.length} records
          </span>
          <div className="report-pagination">
            <button className="report-page-nav-btn" disabled aria-label="Previous page">&lt;</button>
            <button className="report-page-num-btn" aria-label="Page 1">1</button>
            <button className="report-page-nav-btn" disabled aria-label="Next page">&gt;</button>
          </div>
        </div>
      </div>

      {/* ── CSS STYLES ────────────────────────────────────────────────── */}
      <style>{`
        .report-dashboard {
          max-width: 1400px;
          margin: 0 auto;
          padding: 20px 24px 48px;
          width: 100%;
          box-sizing: border-box;
        }

        /* ── 1. Compact Header Banner ── */
        .report-header-banner {
          background: linear-gradient(135deg, rgba(209, 250, 229, 0.85) 0%, rgba(236, 253, 245, 0.7) 60%, rgba(240, 253, 250, 0.9) 100%);
          border: 1px solid rgba(16, 185, 129, 0.22);
          border-radius: 14px;
          padding: 18px 24px;
          margin-bottom: 20px;
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 16px;
          box-shadow: 0 1px 4px rgba(5, 150, 105, 0.04);
        }

        .header-left {
          display: flex;
          align-items: center;
          gap: 16px;
        }

        .header-icon-box {
          width: 48px;
          height: 48px;
          border-radius: 12px;
          background: linear-gradient(135deg, #a7f3d0, #6ee7b7);
          display: flex;
          align-items: center;
          justify-content: center;
          color: #047857;
          flex-shrink: 0;
          box-shadow: 0 2px 8px rgba(16, 185, 129, 0.18);
        }

        .header-badge-row {
          display: flex;
          align-items: center;
          gap: 8px;
          margin-bottom: 4px;
        }

        .header-badge {
          display: inline-block;
          background: #d1fae5;
          color: #047857;
          font-size: 10px;
          font-weight: 800;
          letter-spacing: 0.05em;
          text-transform: uppercase;
          padding: 2px 8px;
          border-radius: 9999px;
        }

        .header-period-tag {
          font-size: 11px;
          font-weight: 700;
          color: #059669;
          background: rgba(255, 255, 255, 0.85);
          padding: 2px 8px;
          border-radius: 6px;
          border: 1px solid rgba(16, 185, 129, 0.2);
        }

        .header-title {
          font-size: 21px;
          font-weight: 800;
          color: #064e3b;
          letter-spacing: -0.01em;
          margin: 0 0 2px 0;
          line-height: 1.2;
        }

        .header-subtitle {
          font-size: 12.5px;
          color: #475569;
          margin: 0;
          font-weight: 500;
        }

        .header-right {
          display: flex;
          align-items: center;
          flex-shrink: 0;
        }

        .header-today-pill {
          background: #ffffff;
          border: 1px solid #e2e8f0;
          border-radius: 10px;
          padding: 8px 14px;
          display: flex;
          align-items: center;
          gap: 10px;
          box-shadow: 0 1px 3px rgba(0, 0, 0, 0.03);
        }

        .today-label {
          display: block;
          font-size: 11px;
          font-weight: 700;
          color: #059669;
          text-transform: uppercase;
          line-height: 1;
        }

        .today-val {
          font-size: 12px;
          font-weight: 600;
          color: #0f172a;
          white-space: nowrap;
        }

        /* ── 2. Interactive Control Card ── */
        .report-control-card {
          background: #ffffff;
          border: 1px solid #e2e8f0;
          border-radius: 14px;
          padding: 16px 20px;
          margin-bottom: 20px;
          box-shadow: 0 1px 3px rgba(0, 0, 0, 0.02);
        }

        .control-card-top {
          display: flex;
          align-items: center;
          justify-content: space-between;
          flex-wrap: wrap;
          gap: 12px;
          padding-bottom: 14px;
          border-bottom: 1px solid #f1f5f9;
          margin-bottom: 14px;
        }

        /* Scope Switcher */
        .scope-switch-group {
          display: flex;
          align-items: center;
          background: #f1f5f9;
          padding: 3px;
          border-radius: 10px;
          gap: 4px;
          flex-wrap: wrap;
        }

        .scope-pill-btn {
          display: inline-flex;
          align-items: center;
          gap: 6px;
          padding: 7px 14px;
          border: none;
          background: transparent;
          color: #64748b;
          font-size: 12.5px;
          font-weight: 600;
          border-radius: 8px;
          cursor: pointer;
          transition: all 0.2s ease;
        }

        .scope-pill-btn.active {
          background: #ffffff;
          color: #059669;
          box-shadow: 0 1px 3px rgba(0, 0, 0, 0.08);
        }

        .scope-pill-btn.disabled-scope {
          opacity: 0.45;
          cursor: not-allowed;
          background: #e2e8f0;
          color: #94a3b8;
          pointer-events: none;
          border: 1px dashed #cbd5e1;
        }

        .scope-disabled-tag {
          font-size: 10px;
          font-weight: 700;
          background: #cbd5e1;
          color: #475569;
          padding: 1px 6px;
          border-radius: 4px;
          text-transform: uppercase;
        }

        .scope-active-dot {
          font-size: 11px;
          font-weight: 700;
          color: #059669;
          background: #d1fae5;
          padding: 1px 7px;
          border-radius: 4px;
        }

        .btn-enable-all {
          display: inline-flex;
          align-items: center;
          gap: 5px;
          padding: 5px 11px;
          background: #ffffff;
          border: 1px solid #10b981;
          color: #059669;
          font-size: 11.5px;
          font-weight: 700;
          border-radius: 7px;
          cursor: pointer;
          box-shadow: 0 1px 2px rgba(16, 185, 129, 0.1);
          transition: all 0.15s ease;
          margin-left: 4px;
        }

        .btn-enable-all:hover {
          background: #059669;
          color: #ffffff;
        }

        /* Date Presets */
        .date-presets-group {
          display: flex;
          align-items: center;
          gap: 6px;
          flex-wrap: wrap;
        }

        .date-presets-label {
          font-size: 12px;
          font-weight: 600;
          color: #64748b;
          margin-right: 2px;
        }

        .date-preset-chip {
          padding: 5px 11px;
          font-size: 12px;
          font-weight: 600;
          color: #475569;
          background: #f8fafc;
          border: 1px solid #e2e8f0;
          border-radius: 6px;
          cursor: pointer;
          transition: all 0.15s ease;
        }

        .date-preset-chip:hover {
          background: #f1f5f9;
          color: #0f172a;
          border-color: #cbd5e1;
        }

        .date-preset-chip.active {
          background: #059669;
          color: #ffffff;
          border-color: #059669;
        }

        /* Filter Controls Row */
        .control-filters-row {
          display: flex;
          align-items: flex-end;
          gap: 12px;
          flex-wrap: wrap;
        }

        .filter-item {
          display: flex;
          flex-direction: column;
          gap: 5px;
        }

        .filter-item-label {
          font-size: 11.5px;
          font-weight: 700;
          color: #475569;
          display: flex;
          align-items: center;
          gap: 5px;
          letter-spacing: 0.01em;
        }

        /* Date Range Picker Container & Custom Calendar Popover */
        .date-range-picker-block {
          flex: 1.3;
          min-width: 270px;
          position: relative;
        }

        .date-selector-wrapper {
          position: relative;
          width: 100%;
        }

        .date-selector-container {
          display: flex;
          align-items: center;
          background: #f8fafc;
          border: 1px solid #cbd5e1;
          border-radius: 8px;
          padding: 3px;
          height: 38px;
          box-sizing: border-box;
          width: 100%;
        }

        .date-nav-arrow {
          background: transparent;
          border: none;
          color: #64748b;
          font-size: 14px;
          font-weight: 700;
          padding: 0 8px;
          height: 100%;
          cursor: pointer;
          border-radius: 6px;
          display: flex;
          align-items: center;
          justify-content: center;
          transition: background 0.15s;
        }

        .date-nav-arrow:hover {
          background: #e2e8f0;
          color: #0f172a;
        }

        .date-display-box-pill {
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 8px;
          background: #ffffff;
          border: 1px solid #e2e8f0;
          border-radius: 6px;
          padding: 4px 10px;
          font-size: 12.5px;
          font-weight: 600;
          color: #0f172a;
          cursor: pointer;
          flex: 1;
          text-align: center;
          white-space: nowrap;
          box-shadow: 0 1px 2px rgba(0, 0, 0, 0.02);
          transition: all 0.15s;
          user-select: none;
        }

        .date-display-box-pill:hover,
        .date-display-box-pill.active-picker {
          border-color: #10b981;
          box-shadow: 0 0 0 3px rgba(16, 185, 129, 0.12);
        }

        /* ── Custom In-App Calendar Floating Popover ── */
        .custom-calendar-popover {
          position: absolute;
          top: calc(100% + 8px);
          left: 0;
          z-index: 1000;
          width: 320px;
          background: #ffffff;
          border: 1px solid #cbd5e1;
          border-radius: 12px;
          box-shadow: 0 10px 25px -5px rgba(0, 0, 0, 0.1), 0 8px 10px -6px rgba(0, 0, 0, 0.1);
          padding: 14px;
          box-sizing: border-box;
          animation: popoverFadeIn 0.18s ease-out;
        }

        @keyframes popoverFadeIn {
          from {
            opacity: 0;
            transform: translateY(-6px);
          }
          to {
            opacity: 1;
            transform: translateY(0);
          }
        }

        .calendar-popover-header {
          display: flex;
          align-items: center;
          justify-content: space-between;
          margin-bottom: 10px;
          padding: 0 4px;
        }

        .cal-nav-btn {
          width: 28px;
          height: 28px;
          border: 1px solid #e2e8f0;
          border-radius: 6px;
          background: #f8fafc;
          color: #475569;
          font-size: 14px;
          font-weight: 700;
          display: flex;
          align-items: center;
          justify-content: center;
          cursor: pointer;
          transition: all 0.15s;
        }

        .cal-nav-btn:hover {
          background: #059669;
          color: #ffffff;
          border-color: #059669;
        }

        .cal-month-title {
          font-size: 13.5px;
          font-weight: 700;
          color: #0f172a;
          letter-spacing: -0.01em;
        }

        .cal-presets-strip {
          display: flex;
          align-items: center;
          gap: 4px;
          margin-bottom: 10px;
          padding-bottom: 8px;
          border-bottom: 1px solid #f1f5f9;
        }

        .cal-mini-preset {
          flex: 1;
          padding: 4px 6px;
          font-size: 11px;
          font-weight: 600;
          color: #475569;
          background: #f8fafc;
          border: 1px solid #e2e8f0;
          border-radius: 5px;
          cursor: pointer;
          text-align: center;
          transition: all 0.15s;
        }

        .cal-mini-preset:hover {
          background: #ecfdf5;
          color: #059669;
          border-color: #a7f3d0;
        }

        .cal-instruction-banner {
          background: #f0fdf4;
          border: 1px solid #bbf7d0;
          border-radius: 6px;
          padding: 5px 8px;
          margin-bottom: 8px;
          text-align: center;
          font-size: 11px;
          color: #166534;
        }

        .cal-instruction-text.active {
          color: #047857;
          font-weight: 700;
        }

        .cal-weekday-grid {
          display: grid;
          grid-template-columns: repeat(7, 1fr);
          text-align: center;
          margin-bottom: 6px;
          font-size: 11px;
          font-weight: 700;
          color: #94a3b8;
          text-transform: uppercase;
        }

        .cal-days-grid {
          display: grid;
          grid-template-columns: repeat(7, 1fr);
          row-gap: 3px;
          margin-bottom: 12px;
        }

        .cal-day-cell {
          height: 32px;
          width: 100%;
          border: none;
          background: transparent;
          font-size: 12px;
          font-weight: 600;
          color: #1e293b;
          border-radius: 6px;
          display: flex;
          align-items: center;
          justify-content: center;
          cursor: pointer;
          transition: all 0.12s ease;
          position: relative;
        }

        .cal-day-cell:hover:not(.range-start):not(.range-end) {
          background: #f1f5f9;
          color: #0f172a;
        }

        .cal-day-cell.other-month {
          color: #cbd5e1;
        }

        .cal-day-cell.is-today {
          font-weight: 800;
          color: #059669;
        }

        .cal-day-cell.is-today::after {
          content: '';
          position: absolute;
          bottom: 3px;
          width: 4px;
          height: 4px;
          border-radius: 50%;
          background: #059669;
        }

        .cal-day-cell.in-range {
          background: rgba(16, 185, 129, 0.15);
          color: #065f46;
          border-radius: 0;
        }

        .cal-day-cell.range-start {
          background: #059669 !important;
          color: #ffffff !important;
          border-radius: 6px 0 0 6px !important;
          font-weight: 700;
        }

        .cal-day-cell.range-end {
          background: #059669 !important;
          color: #ffffff !important;
          border-radius: 0 6px 6px 0 !important;
          font-weight: 700;
        }

        .cal-day-cell.range-start.range-end {
          border-radius: 6px !important;
        }

        .cal-popover-footer {
          display: flex;
          align-items: center;
          justify-content: space-between;
          border-top: 1px solid #f1f5f9;
          padding-top: 10px;
          gap: 8px;
        }

        .cal-selected-summary {
          display: flex;
          flex-direction: column;
          min-width: 0;
        }

        .cal-summary-label {
          font-size: 10px;
          font-weight: 600;
          color: #94a3b8;
          text-transform: uppercase;
        }

        .cal-summary-val {
          font-size: 11.5px;
          font-weight: 700;
          color: #059669;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
          max-width: 140px;
        }

        .cal-footer-actions {
          display: flex;
          align-items: center;
          gap: 6px;
        }

        .cal-btn-cancel {
          padding: 6px 10px;
          background: #f1f5f9;
          border: 1px solid #e2e8f0;
          color: #64748b;
          font-size: 11.5px;
          font-weight: 600;
          border-radius: 6px;
          cursor: pointer;
        }

        .cal-btn-cancel:hover {
          background: #e2e8f0;
          color: #0f172a;
        }

        .cal-btn-apply {
          padding: 6px 12px;
          background: #059669;
          border: none;
          color: #ffffff;
          font-size: 11.5px;
          font-weight: 600;
          border-radius: 6px;
          cursor: pointer;
          box-shadow: 0 1px 3px rgba(5, 150, 105, 0.3);
        }

        .cal-btn-apply:hover {
          background: #047857;
        }

        /* Styled Dropdown Inputs */
        .employee-filter-item {
          flex: 1.4;
          min-width: 180px;
        }

        .status-filter-item {
          flex: 0.9;
          min-width: 130px;
        }

        .source-filter-item {
          flex: 0.8;
          min-width: 120px;
        }

        .styled-filter-select {
          height: 38px;
          padding: 0 10px;
          border-radius: 8px;
          border: 1px solid #cbd5e1;
          background-color: #ffffff;
          font-size: 13px;
          font-weight: 500;
          color: #0f172a;
          outline: none;
          transition: all 0.2s ease;
          width: 100%;
          box-sizing: border-box;
        }

        .styled-filter-select:focus {
          border-color: #10b981;
          box-shadow: 0 0 0 3px rgba(16, 185, 129, 0.15);
        }

        .highlight-select {
          border-color: #10b981;
          background-color: #f0fdf4;
          font-weight: 600;
        }

        /* ── Custom Select Component ── */
        .custom-select-wrap {
          position: relative;
          width: 100%;
        }

        .custom-select-trigger {
          height: 38px;
          padding: 0 10px;
          border-radius: 8px;
          border: 1px solid #cbd5e1;
          background-color: #ffffff;
          font-size: 13px;
          font-weight: 500;
          color: #0f172a;
          outline: none;
          transition: all 0.2s ease;
          width: 100%;
          box-sizing: border-box;
          display: flex;
          align-items: center;
          justify-content: space-between;
          cursor: pointer;
          text-align: left;
        }

        .custom-select-trigger:hover:not(:disabled),
        .custom-select-trigger.active-picker {
          border-color: #10b981;
          box-shadow: 0 0 0 3px rgba(16, 185, 129, 0.15);
        }

        .custom-select-trigger.highlight-select {
          border-color: #10b981;
          background-color: #f0fdf4;
          font-weight: 600;
        }

        .custom-select-trigger:disabled {
          opacity: 0.6;
          cursor: not-allowed;
          background-color: #f8fafc;
        }

        .custom-select-trigger-content {
          display: flex;
          align-items: center;
          gap: 7px;
          min-width: 0;
          overflow: hidden;
          flex: 1;
        }

        .custom-select-trigger-text {
          font-size: 13px;
          font-weight: 500;
          color: #0f172a;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }

        .custom-select-trigger-code {
          font-size: 10.5px;
          font-family: 'JetBrains Mono', monospace;
          font-weight: 700;
          color: #059669;
          background: #d1fae5;
          padding: 1px 5px;
          border-radius: 4px;
          flex-shrink: 0;
        }

        .custom-select-chevron {
          color: #64748b;
          flex-shrink: 0;
          margin-left: 6px;
          transition: transform 0.2s ease;
        }

        .custom-select-chevron.rotate {
          transform: rotate(180deg);
          color: #059669;
        }

        .custom-select-dot {
          width: 8px;
          height: 8px;
          border-radius: 50%;
          flex-shrink: 0;
        }

        .custom-select-opt-icon {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          flex-shrink: 0;
          color: inherit;
        }

        .custom-select-popover {
          position: absolute;
          top: calc(100% + 5px);
          left: 0;
          width: 100%;
          min-width: 150px;
          max-width: calc(100vw - 32px);
          z-index: 1050;
          background: #ffffff;
          border: 1px solid #cbd5e1;
          border-radius: 10px;
          box-shadow: 0 10px 25px -5px rgba(0, 0, 0, 0.1), 0 8px 10px -6px rgba(0, 0, 0, 0.08);
          padding: 4px;
          box-sizing: border-box;
          animation: selectFadeIn 0.15s ease-out;
        }

        @keyframes selectFadeIn {
          from {
            opacity: 0;
            transform: translateY(-4px);
          }
          to {
            opacity: 1;
            transform: translateY(0);
          }
        }

        .custom-select-list {
          max-height: 220px;
          overflow-y: auto;
          display: flex;
          flex-direction: column;
          gap: 2px;
        }

        .custom-select-list::-webkit-scrollbar {
          width: 5px;
        }

        .custom-select-list::-webkit-scrollbar-thumb {
          background: #cbd5e1;
          border-radius: 4px;
        }

        .custom-select-item {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 8px;
          padding: 7px 10px;
          border-radius: 6px;
          cursor: pointer;
          transition: all 0.12s ease;
          user-select: none;
        }

        .custom-select-item:hover:not(.disabled) {
          background: #f0fdf4;
        }

        .custom-select-item:hover:not(.disabled) .custom-select-item-label {
          color: #059669;
        }

        .custom-select-item.selected {
          background: #ecfdf5;
        }

        .custom-select-item.selected .custom-select-item-label {
          color: #047857;
          font-weight: 700;
        }

        .custom-select-item.disabled {
          opacity: 0.45;
          cursor: not-allowed;
        }

        .custom-select-item-left {
          display: flex;
          align-items: center;
          gap: 7px;
          min-width: 0;
          overflow: hidden;
        }

        .custom-select-item-label {
          font-size: 12.5px;
          font-weight: 500;
          color: #1e293b;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }

        .custom-select-item-code {
          font-size: 10px;
          font-family: 'JetBrains Mono', monospace;
          font-weight: 700;
          color: #059669;
          background: #d1fae5;
          padding: 1px 5px;
          border-radius: 4px;
          flex-shrink: 0;
          margin-left: auto;
        }

        .custom-select-check {
          flex-shrink: 0;
          margin-left: 4px;
        }

        /* Action Buttons */
        .filter-actions-group {
          display: flex;
          align-items: center;
          gap: 8px;
          margin-left: auto;
        }

        .btn-primary-generate {
          height: 38px;
          padding: 0 18px;
          background: linear-gradient(135deg, #059669 0%, #10b981 100%);
          color: #ffffff;
          border: none;
          border-radius: 8px;
          font-size: 13px;
          font-weight: 600;
          display: inline-flex;
          align-items: center;
          gap: 6px;
          cursor: pointer;
          box-shadow: 0 2px 6px rgba(16, 185, 129, 0.3);
          transition: all 0.2s ease;
          white-space: nowrap;
        }

        .btn-primary-generate:hover:not(:disabled) {
          opacity: 0.95;
          box-shadow: 0 4px 10px rgba(16, 185, 129, 0.4);
        }

        .btn-primary-generate:disabled {
          opacity: 0.6;
          cursor: not-allowed;
        }

        .btn-secondary-reset {
          height: 38px;
          padding: 0 12px;
          background: #ffffff;
          color: #475569;
          border: 1px solid #cbd5e1;
          border-radius: 8px;
          font-size: 13px;
          font-weight: 600;
          display: inline-flex;
          align-items: center;
          gap: 6px;
          cursor: pointer;
          transition: all 0.2s ease;
        }

        .btn-secondary-reset:hover {
          background: #f8fafc;
          color: #0f172a;
          border-color: #94a3b8;
        }

        /* ── 2B. Employee Spotlight Card ── */
        .employee-spotlight-card {
          margin-top: 14px;
          background: linear-gradient(135deg, #f0fdf4 0%, #ffffff 100%);
          border: 1px solid #a7f3d0;
          border-radius: 12px;
          padding: 12px 18px;
          display: flex;
          align-items: center;
          justify-content: space-between;
          flex-wrap: wrap;
          gap: 14px;
        }

        .spotlight-left {
          display: flex;
          align-items: center;
          gap: 12px;
        }

        .spotlight-avatar {
          width: 44px;
          height: 44px;
          border-radius: 10px;
          background: linear-gradient(135deg, #059669, #10b981);
          color: #ffffff;
          font-size: 16px;
          font-weight: 700;
          display: flex;
          align-items: center;
          justify-content: center;
          box-shadow: 0 2px 6px rgba(5, 150, 105, 0.25);
        }

        .spotlight-info {
          display: flex;
          flex-direction: column;
        }

        .spotlight-name-row {
          display: flex;
          align-items: center;
          gap: 8px;
        }

        .spotlight-name {
          font-size: 15px;
          font-weight: 700;
          color: #064e3b;
        }

        .spotlight-code {
          font-family: 'JetBrains Mono', monospace;
          font-size: 11.5px;
          font-weight: 700;
          color: #059669;
          background: #d1fae5;
          padding: 1px 7px;
          border-radius: 4px;
        }

        .spotlight-sub {
          font-size: 12px;
          color: #64748b;
          display: flex;
          align-items: center;
          gap: 6px;
          margin-top: 2px;
        }

        .spotlight-sub .dot {
          color: #cbd5e1;
        }

        .spotlight-stats-row {
          display: flex;
          align-items: center;
          gap: 16px;
          background: #ffffff;
          padding: 6px 14px;
          border-radius: 8px;
          border: 1px solid #e2e8f0;
        }

        .spotlight-stat-item {
          display: flex;
          flex-direction: column;
          align-items: center;
        }

        .stat-num {
          font-size: 15px;
          font-weight: 800;
          font-family: 'JetBrains Mono', monospace;
          color: #0f172a;
          line-height: 1;
        }

        .stat-lbl {
          font-size: 10px;
          font-weight: 700;
          color: #64748b;
          text-transform: uppercase;
          margin-top: 2px;
        }

        .text-success .stat-num { color: #10b981; }
        .text-danger .stat-num { color: #ef4444; }
        .text-warning .stat-num { color: #f59e0b; }

        .spotlight-download-actions {
          display: flex;
          align-items: center;
          gap: 8px;
        }

        .btn-download-emp-pdf {
          height: 36px;
          padding: 0 14px;
          background: #e11d48;
          color: #ffffff;
          border: none;
          border-radius: 8px;
          font-size: 12.5px;
          font-weight: 600;
          display: inline-flex;
          align-items: center;
          gap: 6px;
          cursor: pointer;
          transition: background 0.15s;
        }

        .btn-download-emp-pdf:hover:not(:disabled) {
          background: #be123c;
        }

        .btn-download-emp-excel {
          height: 36px;
          padding: 0 14px;
          background: #059669;
          color: #ffffff;
          border: none;
          border-radius: 8px;
          font-size: 12.5px;
          font-weight: 600;
          display: inline-flex;
          align-items: center;
          gap: 6px;
          cursor: pointer;
          transition: background 0.15s;
        }

        .btn-download-emp-excel:hover:not(:disabled) {
          background: #047857;
        }

        /* ── Alert ── */
        .report-alert-danger {
          background: #fef2f2;
          border: 1px solid #fecaca;
          color: #b91c1c;
          padding: 10px 14px;
          border-radius: 8px;
          margin-bottom: 16px;
          display: flex;
          align-items: center;
          gap: 8px;
          font-size: 13px;
          font-weight: 500;
        }

        /* ── 3. Clean Metric Strip ── */
        .report-summary-strip {
          display: grid;
          grid-template-columns: repeat(5, minmax(0, 1fr));
          gap: 12px;
          margin-bottom: 20px;
        }

        .report-metric-box {
          background: #ffffff;
          border: 1px solid #e2e8f0;
          border-radius: 12px;
          padding: 10px 14px;
          display: flex;
          align-items: center;
          gap: 10px;
          box-shadow: 0 1px 3px rgba(0, 0, 0, 0.02);
        }

        .metric-icon {
          width: 34px;
          height: 34px;
          border-radius: 8px;
          display: flex;
          align-items: center;
          justify-content: center;
          font-size: 14px;
          font-weight: 700;
          background-color: var(--metric-bg, #eff6ff);
          flex-shrink: 0;
        }

        .metric-content {
          display: flex;
          flex-direction: column;
          min-width: 0;
        }

        .metric-val-wrap {
          display: flex;
          align-items: baseline;
          gap: 6px;
        }

        .metric-value {
          font-size: 20px;
          font-weight: 800;
          font-family: 'JetBrains Mono', monospace;
          line-height: 1.1;
        }

        .metric-sub-pill {
          font-size: 10.5px;
          font-weight: 700;
          color: #059669;
          background: #ecfdf5;
          padding: 1px 6px;
          border-radius: 4px;
        }

        .metric-label {
          font-size: 11px;
          font-weight: 700;
          color: #64748b;
          text-transform: uppercase;
          letter-spacing: 0.03em;
          margin-top: 2px;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }

        /* ── 4. Table Container ── */
        .report-table-card {
          background: #ffffff;
          border: 1px solid #e2e8f0;
          border-radius: 14px;
          overflow: hidden;
          box-shadow: 0 1px 4px rgba(0, 0, 0, 0.02);
        }

        .report-table-export-group {
          display: flex;
          align-items: center;
          gap: 8px;
        }

        .report-mobile-cards {
          display: none;
        }

        .report-table-header {
          padding: 14px 18px;
          display: flex;
          align-items: center;
          justify-content: space-between;
          border-bottom: 1px solid #e2e8f0;
          flex-wrap: wrap;
          gap: 12px;
        }

        .table-header-left {
          display: flex;
          flex-direction: column;
          gap: 4px;
        }

        .report-table-title {
          font-size: 16px;
          font-weight: 700;
          color: #0f172a;
          margin: 0;
        }

        .generated-status-pill {
          font-size: 11.5px;
          color: #059669;
          background: #ecfdf5;
          border: 1px solid #a7f3d0;
          padding: 2px 8px;
          border-radius: 6px;
          width: fit-content;
        }

        .report-table-actions {
          display: flex;
          align-items: center;
          gap: 8px;
          flex-wrap: wrap;
        }

        .report-search-wrap {
          position: relative;
          display: flex;
          align-items: center;
        }

        .report-search-icon {
          position: absolute;
          left: 10px;
          color: #94a3b8;
          pointer-events: none;
        }

        .report-search-input {
          height: 36px;
          padding: 0 12px 0 32px;
          border-radius: 8px;
          border: 1px solid #cbd5e1;
          background: #ffffff;
          font-size: 13px;
          color: #0f172a;
          width: 220px;
          outline: none;
          transition: all 0.2s;
          box-sizing: border-box;
        }

        .report-search-input:focus {
          border-color: #10b981;
          box-shadow: 0 0 0 3px rgba(16, 185, 129, 0.15);
        }

        .btn-export-pdf {
          height: 36px;
          padding: 0 14px;
          background: #e11d48;
          color: #ffffff;
          border: none;
          border-radius: 8px;
          font-size: 12.5px;
          font-weight: 600;
          display: inline-flex;
          align-items: center;
          gap: 6px;
          cursor: pointer;
          transition: all 0.2s;
        }

        .btn-export-pdf:hover:not(:disabled) {
          background: #be123c;
        }

        .btn-export-pdf:disabled {
          opacity: 0.5;
          cursor: not-allowed;
        }

        .btn-export-excel {
          height: 36px;
          padding: 0 14px;
          background: #059669;
          color: #ffffff;
          border: none;
          border-radius: 8px;
          font-size: 12.5px;
          font-weight: 600;
          display: inline-flex;
          align-items: center;
          gap: 6px;
          cursor: pointer;
          transition: all 0.2s;
        }

        .btn-export-excel:hover:not(:disabled) {
          background: #047857;
        }

        .btn-export-excel:disabled {
          opacity: 0.5;
          cursor: not-allowed;
        }

        /* ── Table Styling ── */
        .report-custom-table {
          width: 100%;
          border-collapse: collapse;
          text-align: left;
        }

        .report-custom-table th {
          background-color: #ecfdf5;
          color: #064e3b;
          font-size: 11px;
          font-weight: 700;
          letter-spacing: 0.05em;
          text-transform: uppercase;
          padding: 12px 16px;
          border-bottom: 1px solid #a7f3d0;
          white-space: nowrap;
        }

        .report-custom-table td {
          padding: 12px 16px;
          font-size: 13px;
          color: #0f172a;
          border-bottom: 1px solid #f1f5f9;
          vertical-align: middle;
        }

        .report-custom-table tr:hover td {
          background-color: #f8fafc;
        }

        .punch-time-tag {
          font-weight: 600;
          color: #1e293b;
          background: #f1f5f9;
          padding: 3px 7px;
          border-radius: 5px;
        }

        .report-emp-code {
          color: #059669;
          font-weight: 700;
        }

        .row-action-download-btn {
          background: #f1f5f9;
          border: 1px solid #cbd5e1;
          color: #334155;
          font-size: 11.5px;
          font-weight: 700;
          cursor: pointer;
          padding: 4px 8px;
          border-radius: 6px;
          display: inline-flex;
          align-items: center;
          gap: 4px;
          transition: all 0.15s;
        }

        .row-action-download-btn:hover {
          background: #fee2e2;
          border-color: #fca5a5;
          color: #b91c1c;
        }

        .view-action-btn {
          background: transparent;
          border: none;
          color: #059669;
          font-size: 12.5px;
          font-weight: 700;
          cursor: pointer;
          padding: 4px 8px;
          border-radius: 6px;
          transition: background 0.15s, color 0.15s;
        }

        .view-action-btn:hover:not(:disabled) {
          background: #ecfdf5;
          color: #047857;
        }

        .report-empty-wrap {
          padding: 48px 20px;
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          gap: 10px;
        }

        .report-empty-msg {
          font-size: 13.5px;
          font-weight: 500;
          color: #64748b;
          margin: 0;
        }

        .report-table-footer {
          padding: 12px 18px;
          display: flex;
          align-items: center;
          justify-content: space-between;
          border-top: 1px solid #e2e8f0;
          background: #ffffff;
        }

        .report-footer-count {
          font-size: 12px;
          color: #64748b;
        }

        .report-pagination {
          display: flex;
          align-items: center;
          gap: 4px;
        }

        .report-page-nav-btn {
          width: 28px;
          height: 28px;
          border: 1px solid #e2e8f0;
          background: #ffffff;
          color: #94a3b8;
          border-radius: 6px;
          display: flex;
          align-items: center;
          justify-content: center;
          cursor: pointer;
          font-size: 13px;
          font-weight: 600;
        }

        .report-page-num-btn {
          width: 28px;
          height: 28px;
          border-radius: 6px;
          background: #059669;
          color: #ffffff;
          border: none;
          font-size: 12px;
          font-weight: 700;
          display: flex;
          align-items: center;
          justify-content: center;
        }

        /* ── Dark Theme Overrides ── */
        [data-theme="dark"] .report-header-banner,
        .dark .report-header-banner {
          background: linear-gradient(135deg, #131733 0%, #1a1f42 60%, #202754 100%) !important;
          border-color: rgba(139, 92, 246, 0.25) !important;
        }
        [data-theme="dark"] .header-title,
        .dark .header-title {
          color: #ffffff !important;
        }
        [data-theme="dark"] .header-subtitle,
        .dark .header-subtitle {
          color: #94a3b8 !important;
        }
        [data-theme="dark"] .header-badge,
        .dark .header-badge {
          background: rgba(16, 185, 129, 0.16) !important;
          color: #34d399 !important;
        }
        [data-theme="dark"] .header-today-pill,
        .dark .header-today-pill {
          background: #171b38 !important;
          border-color: rgba(139, 92, 246, 0.25) !important;
        }
        [data-theme="dark"] .today-val,
        .dark .today-val {
          color: #ffffff !important;
        }
        [data-theme="dark"] .report-control-card,
        .dark .report-control-card,
        [data-theme="dark"] .report-table-card,
        .dark .report-table-card,
        [data-theme="dark"] .report-metric-box,
        .dark .report-metric-box {
          background: #111528 !important;
          border-color: rgba(139, 92, 246, 0.22) !important;
        }
        [data-theme="dark"] .control-card-top,
        .dark .control-card-top,
        [data-theme="dark"] .report-table-header,
        .dark .report-table-header,
        [data-theme="dark"] .report-table-footer,
        .dark .report-table-footer {
          border-color: rgba(255, 255, 255, 0.08) !important;
          background: #111528 !important;
        }
        [data-theme="dark"] .scope-switch-group,
        .dark .scope-switch-group {
          background: #171b38 !important;
        }
        [data-theme="dark"] .scope-pill-btn.active,
        .dark .scope-pill-btn.active {
          background: #23284f !important;
          color: #34d399 !important;
        }
        [data-theme="dark"] .date-display-box,
        .dark .date-display-box,
        [data-theme="dark"] .styled-filter-select,
        .dark .styled-filter-select,
        [data-theme="dark"] .report-search-input,
        .dark .report-search-input {
          background: #171b38 !important;
          border-color: rgba(139, 92, 246, 0.25) !important;
          color: #f1f5f9 !important;
        }
        [data-theme="dark"] .date-selector-container,
        .dark .date-selector-container {
          background: #131733 !important;
          border-color: rgba(139, 92, 246, 0.25) !important;
        }
        [data-theme="dark"] .date-preset-chip,
        .dark .date-preset-chip {
          background: #171b38 !important;
          border-color: rgba(139, 92, 246, 0.2) !important;
          color: #cbd5e1 !important;
        }
        [data-theme="dark"] .date-preset-chip.active,
        .dark .date-preset-chip.active {
          background: #059669 !important;
          color: #ffffff !important;
        }
        [data-theme="dark"] .employee-spotlight-card,
        .dark .employee-spotlight-card {
          background: #171b38 !important;
          border-color: rgba(16, 185, 129, 0.3) !important;
        }
        [data-theme="dark"] .spotlight-name,
        .dark .spotlight-name,
        [data-theme="dark"] .report-table-title,
        .dark .report-table-title {
          color: #ffffff !important;
        }
        [data-theme="dark"] .report-custom-table th,
        .dark .report-custom-table th {
          background-color: #1a1e3a !important;
          color: #34d399 !important;
          border-bottom: 1px solid rgba(139, 92, 246, 0.2) !important;
        }
        [data-theme="dark"] .report-custom-table td,
        .dark .report-custom-table td {
          color: #f1f5f9 !important;
          border-bottom-color: rgba(255, 255, 255, 0.05) !important;
        }
        [data-theme="dark"] .report-custom-table tr:hover td,
        .dark .report-custom-table tr:hover td {
          background-color: #171b38 !important;
        }
        [data-theme="dark"] .punch-time-tag,
        .dark .punch-time-tag {
          background: #23284f !important;
          color: #f1f5f9 !important;
        }
        [data-theme="dark"] .custom-calendar-popover,
        .dark .custom-calendar-popover {
          background: #111528 !important;
          border-color: rgba(139, 92, 246, 0.25) !important;
          box-shadow: 0 10px 30px rgba(0, 0, 0, 0.6) !important;
        }
        [data-theme="dark"] .cal-month-title,
        .dark .cal-month-title {
          color: #ffffff !important;
        }
        [data-theme="dark"] .cal-nav-btn,
        .dark .cal-nav-btn,
        [data-theme="dark"] .cal-mini-preset,
        .dark .cal-mini-preset,
        [data-theme="dark"] .cal-btn-cancel,
        .dark .cal-btn-cancel {
          background: #171b38 !important;
          border-color: rgba(139, 92, 246, 0.2) !important;
          color: #cbd5e1 !important;
        }
        [data-theme="dark"] .cal-day-cell,
        .dark .cal-day-cell {
          color: #f1f5f9 !important;
        }
        [data-theme="dark"] .cal-day-cell:hover:not(.range-start):not(.range-end),
        .dark .cal-day-cell:hover:not(.range-start):not(.range-end) {
          background: #23284f !important;
        }
        [data-theme="dark"] .cal-day-cell.other-month,
        .dark .cal-day-cell.other-month {
          color: #475569 !important;
        }
        [data-theme="dark"] .cal-day-cell.in-range,
        .dark .cal-day-cell.in-range {
          background: rgba(16, 185, 129, 0.22) !important;
          color: #34d399 !important;
        }
        [data-theme="dark"] .cal-presets-strip,
        .dark .cal-presets-strip,
        [data-theme="dark"] .cal-popover-footer,
        .dark .cal-popover-footer {
          border-color: rgba(255, 255, 255, 0.08) !important;
        }
        [data-theme="dark"] .date-display-box-pill,
        .dark .date-display-box-pill {
          background: #171b38 !important;
          border-color: rgba(139, 92, 246, 0.25) !important;
          color: #f1f5f9 !important;
        }
        [data-theme="dark"] .btn-secondary-reset,
        .dark .btn-secondary-reset {
          background: #171b38 !important;
          border-color: rgba(139, 92, 246, 0.25) !important;
          color: #cbd5e1 !important;
        }
        [data-theme="dark"] .btn-secondary-reset:hover,
        .dark .btn-secondary-reset:hover {
          background: #23284f !important;
          color: #ffffff !important;
          border-color: rgba(139, 92, 246, 0.4) !important;
        }
        [data-theme="dark"] .btn-enable-all,
        .dark .btn-enable-all {
          background: rgba(16, 185, 129, 0.16) !important;
          border-color: #10b981 !important;
          color: #34d399 !important;
        }
        [data-theme="dark"] .btn-enable-all:hover,
        .dark .btn-enable-all:hover {
          background: #059669 !important;
          color: #ffffff !important;
        }
        [data-theme="dark"] .report-page-nav-btn,
        .dark .report-page-nav-btn {
          background: #171b38 !important;
          border-color: rgba(139, 92, 246, 0.25) !important;
          color: #94a3b8 !important;
        }
        [data-theme="dark"] .report-page-nav-btn:hover,
        .dark .report-page-nav-btn:hover {
          background: #23284f !important;
          color: #ffffff !important;
        }
        [data-theme="dark"] .cal-instruction-banner,
        .dark .cal-instruction-banner {
          background: rgba(16, 185, 129, 0.15) !important;
          border-color: rgba(16, 185, 129, 0.3) !important;
          color: #34d399 !important;
        }
        [data-theme="dark"] .spotlight-stats-row,
        .dark .spotlight-stats-row {
          background: #131733 !important;
          border-color: rgba(139, 92, 246, 0.25) !important;
        }
        [data-theme="dark"] .stat-num,
        .dark .stat-num {
          color: #ffffff !important;
        }
        [data-theme="dark"] .stat-lbl,
        .dark .stat-lbl {
          color: #94a3b8 !important;
        }
        [data-theme="dark"] .highlight-select,
        .dark .highlight-select {
          background-color: #171b38 !important;
          border-color: #10b981 !important;
          color: #34d399 !important;
        }
        [data-theme="dark"] .date-nav-arrow,
        .dark .date-nav-arrow {
          color: #94a3b8 !important;
        }
        [data-theme="dark"] .date-nav-arrow:hover,
        .dark .date-nav-arrow:hover {
          background: #23284f !important;
          color: #ffffff !important;
        }
        [data-theme="dark"] .report-footer-count,
        .dark .report-footer-count {
          color: #94a3b8 !important;
        }
        [data-theme="dark"] .view-action-btn,
        .dark .view-action-btn {
          color: #34d399 !important;
        }
        [data-theme="dark"] .view-action-btn:hover:not(:disabled),
        .dark .view-action-btn:hover:not(:disabled) {
          background: rgba(16, 185, 129, 0.15) !important;
          color: #6ee7b7 !important;
        }
        [data-theme="dark"] .scope-pill-btn.disabled-scope,
        .dark .scope-pill-btn.disabled-scope {
          background: rgba(255, 255, 255, 0.05) !important;
          color: #475569 !important;
          border-color: rgba(255, 255, 255, 0.1) !important;
        }
        [data-theme="dark"] .scope-disabled-tag,
        .dark .scope-disabled-tag {
          background: #23284f !important;
          color: #94a3b8 !important;
        }
        [data-theme="dark"] .metric-icon,
        .dark .metric-icon {
          background-color: rgba(255, 255, 255, 0.08) !important;
        }
        [data-theme="dark"] .metric-sub-pill,
        .dark .metric-sub-pill {
          background: rgba(16, 185, 129, 0.16) !important;
          color: #34d399 !important;
        }
        [data-theme="dark"] .generated-status-pill,
        .dark .generated-status-pill {
          background: rgba(16, 185, 129, 0.16) !important;
          border-color: rgba(16, 185, 129, 0.35) !important;
          color: #34d399 !important;
        }
        [data-theme="dark"] select,
        .dark select,
        [data-theme="dark"] select option,
        .dark select option {
          background-color: #171b38 !important;
          color: #f1f5f9 !important;
        }
        [data-theme="dark"] .metric-label,
        .dark .metric-label {
          color: #94a3b8 !important;
        }

        /* Dark Theme Support for CustomSelect */
        [data-theme="dark"] .custom-select-trigger,
        .dark .custom-select-trigger {
          background: #171b38 !important;
          border-color: rgba(139, 92, 246, 0.25) !important;
          color: #f1f5f9 !important;
        }
        [data-theme="dark"] .custom-select-trigger:hover:not(:disabled),
        .dark .custom-select-trigger:hover:not(:disabled),
        [data-theme="dark"] .custom-select-trigger.active-picker,
        .dark .custom-select-trigger.active-picker {
          border-color: #10b981 !important;
          box-shadow: 0 0 0 3px rgba(16, 185, 129, 0.2) !important;
        }
        [data-theme="dark"] .custom-select-trigger-text,
        .dark .custom-select-trigger-text {
          color: #f1f5f9 !important;
        }
        [data-theme="dark"] .custom-select-trigger.highlight-select,
        .dark .custom-select-trigger.highlight-select {
          background-color: #171b38 !important;
          border-color: #10b981 !important;
        }
        [data-theme="dark"] .custom-select-popover,
        .dark .custom-select-popover {
          background: #111528 !important;
          border-color: rgba(139, 92, 246, 0.3) !important;
          box-shadow: 0 10px 25px rgba(0, 0, 0, 0.6) !important;
        }
        [data-theme="dark"] .custom-select-item-label,
        .dark .custom-select-item-label {
          color: #e2e8f0 !important;
        }
        [data-theme="dark"] .custom-select-item:hover:not(.disabled),
        .dark .custom-select-item:hover:not(.disabled) {
          background: #23284f !important;
        }
        [data-theme="dark"] .custom-select-item:hover:not(.disabled) .custom-select-item-label,
        .dark .custom-select-item:hover:not(.disabled) .custom-select-item-label {
          color: #34d399 !important;
        }
        [data-theme="dark"] .custom-select-item.selected,
        .dark .custom-select-item.selected {
          background: rgba(16, 185, 129, 0.2) !important;
        }
        [data-theme="dark"] .custom-select-item.selected .custom-select-item-label,
        .dark .custom-select-item.selected .custom-select-item-label {
          color: #34d399 !important;
        }
        [data-theme="dark"] .custom-select-list::-webkit-scrollbar-thumb,
        .dark .custom-select-list::-webkit-scrollbar-thumb {
          background: rgba(139, 92, 246, 0.3) !important;
        }

        /* ── Responsive Mobile Optimizations (<= 768px) ── */
        @media (max-width: 768px) {
          .report-dashboard {
            padding: 10px 10px 32px !important;
          }

          /* Compact Header Banner */
          .report-header-banner {
            padding: 10px 12px !important;
            margin-bottom: 12px !important;
            border-radius: 10px !important;
          }
          .header-left {
            gap: 10px !important;
          }
          .header-icon-box {
            width: 34px !important;
            height: 34px !important;
            border-radius: 8px !important;
          }
          .header-icon-box svg {
            width: 18px !important;
            height: 18px !important;
          }
          .header-title {
            font-size: 16px !important;
            margin-bottom: 0 !important;
          }
          .header-badge-row {
            margin-bottom: 2px !important;
          }
          .header-subtitle {
            display: none !important;
          }
          .header-right {
            display: none !important;
          }

          /* Control Filters Card */
          .report-control-card {
            padding: 12px !important;
            border-radius: 10px !important;
            margin-bottom: 12px !important;
          }
          .control-card-top {
            flex-direction: column !important;
            align-items: stretch !important;
            gap: 8px !important;
            padding-bottom: 10px !important;
            margin-bottom: 10px !important;
          }
          .scope-switch-group {
            display: grid !important;
            grid-template-columns: 1fr 1fr !important;
            width: 100% !important;
          }
          .scope-pill-btn {
            justify-content: center !important;
            padding: 6px 8px !important;
            font-size: 12px !important;
          }
          .date-presets-label {
            display: none !important;
          }
          .date-presets-group {
            display: flex !important;
            flex-wrap: nowrap !important;
            overflow-x: auto !important;
            -webkit-overflow-scrolling: touch !important;
            gap: 6px !important;
            width: 100% !important;
            padding-bottom: 2px !important;
          }
          .date-preset-chip {
            flex-shrink: 0 !important;
            padding: 5px 9px !important;
            font-size: 11.5px !important;
            white-space: nowrap !important;
          }

          /* Form Filter Row */
          .control-filters-row {
            display: grid !important;
            grid-template-columns: 1fr 1fr !important;
            gap: 10px !important;
            width: 100% !important;
          }
          .date-range-picker-block {
            grid-column: 1 / -1 !important;
            width: 100% !important;
            min-width: 0 !important;
          }
          .employee-filter-item {
            grid-column: 1 / -1 !important;
            width: 100% !important;
            min-width: 0 !important;
          }
          .status-filter-item {
            grid-column: 1 / 2 !important;
            width: 100% !important;
            min-width: 0 !important;
          }
          .source-filter-item {
            grid-column: 2 / 3 !important;
            width: 100% !important;
            min-width: 0 !important;
          }
          .filter-actions-group {
            grid-column: 1 / -1 !important;
            display: grid !important;
            grid-template-columns: 2fr 1fr !important;
            gap: 8px !important;
            width: 100% !important;
            margin-left: 0 !important;
            margin-top: 2px !important;
          }
          .btn-primary-generate {
            width: 100% !important;
            justify-content: center !important;
            height: 36px !important;
            font-size: 12.5px !important;
          }
          .btn-secondary-reset {
            width: 100% !important;
            justify-content: center !important;
            height: 36px !important;
            font-size: 12.5px !important;
          }

          /* Summary Stat Cards Minimal 2x2 + Top Banner */
          .report-summary-strip {
            display: grid !important;
            grid-template-columns: 1fr 1fr !important;
            gap: 8px !important;
            margin-bottom: 12px !important;
          }
          .report-metric-box.metric-idx-0 {
            grid-column: 1 / -1 !important;
            padding: 8px 12px !important;
          }
          .report-metric-box {
            padding: 8px 10px !important;
            border-radius: 10px !important;
            min-height: 52px !important;
            max-height: 60px !important;
            gap: 8px !important;
            box-sizing: border-box !important;
          }
          .metric-icon {
            width: 28px !important;
            height: 28px !important;
            font-size: 12px !important;
            border-radius: 6px !important;
          }
          .metric-value {
            font-size: 16px !important;
            line-height: 1 !important;
          }
          .metric-label {
            font-size: 9.5px !important;
            letter-spacing: 0.02em !important;
            margin-top: 1px !important;
          }
          .metric-sub-pill {
            font-size: 9px !important;
            padding: 1px 4px !important;
          }

          /* Table Card & Actions */
          .report-table-card {
            border-radius: 10px !important;
          }
          .report-table-header {
            padding: 12px !important;
            flex-direction: column !important;
            align-items: stretch !important;
            gap: 10px !important;
          }
          .report-table-title {
            font-size: 15px !important;
          }
          .generated-status-pill {
            font-size: 11px !important;
            padding: 2px 6px !important;
          }
          .report-table-actions {
            flex-direction: column !important;
            align-items: stretch !important;
            width: 100% !important;
            gap: 8px !important;
          }
          .report-search-wrap {
            width: 100% !important;
          }
          .report-search-input {
            width: 100% !important;
            height: 36px !important;
          }
          .report-table-export-group {
            display: grid !important;
            grid-template-columns: 1fr 1fr !important;
            width: 100% !important;
            gap: 8px !important;
          }
          .report-table-export-group .btn-export-pdf,
          .report-table-export-group .btn-export-excel {
            width: 100% !important;
            justify-content: center !important;
            height: 36px !important;
            font-size: 12px !important;
            padding: 0 8px !important;
          }

          /* Switch Desktop Table to Mobile Cards */
          .report-desktop-table {
            display: none !important;
          }
          .report-mobile-cards {
            display: flex !important;
            flex-direction: column !important;
            gap: 10px !important;
            padding: 12px !important;
          }
          .report-m-card {
            background: #ffffff;
            border: 1px solid #e2e8f0;
            border-radius: 10px;
            padding: 10px 12px;
            display: flex;
            flex-direction: column;
            gap: 8px;
            box-shadow: 0 1px 2px rgba(0, 0, 0, 0.03);
          }
          .report-m-card-top {
            display: flex;
            align-items: center;
            justify-content: space-between;
            gap: 8px;
          }
          .report-m-card-user {
            display: flex;
            align-items: center;
            gap: 8px;
            min-width: 0;
          }
          .report-m-card-avatar {
            width: 32px;
            height: 32px;
            border-radius: 8px;
            background: linear-gradient(135deg, #059669, #10b981);
            color: #ffffff;
            font-size: 13px;
            font-weight: 700;
            display: flex;
            align-items: center;
            justify-content: center;
            flex-shrink: 0;
          }
          .report-m-card-name-block {
            display: flex;
            flex-direction: column;
            min-width: 0;
          }
          .report-m-card-name {
            font-size: 13px;
            font-weight: 700;
            color: #0f172a;
            white-space: nowrap;
            overflow: hidden;
            text-overflow: ellipsis;
          }
          .report-m-card-code {
            font-size: 10.5px;
            font-weight: 700;
            color: #059669;
            font-family: 'JetBrains Mono', monospace;
          }
          .report-m-card-body {
            display: flex;
            flex-direction: column;
            gap: 6px;
            background: #f8fafc;
            border-radius: 8px;
            padding: 8px 10px;
          }
          .report-m-stat-row {
            display: grid;
            grid-template-columns: 1fr 1fr;
            gap: 8px;
          }
          .report-m-stat-item {
            display: flex;
            flex-direction: column;
            gap: 1px;
          }
          .report-m-stat-lbl {
            font-size: 9px;
            font-weight: 700;
            color: #64748b;
            text-transform: uppercase;
            letter-spacing: 0.03em;
          }
          .report-m-stat-val {
            font-size: 11.5px;
            font-weight: 600;
            color: #1e293b;
          }
          .report-m-card-footer {
            border-top: 1px solid #f1f5f9;
            padding-top: 6px;
            display: flex;
            justify-content: flex-end;
          }
          .report-m-view-btn {
            background: transparent;
            border: none;
            color: #059669;
            font-size: 11.5px;
            font-weight: 700;
            padding: 2px 6px;
            cursor: pointer;
          }

          /* Table Footer */
          .report-table-footer {
            padding: 10px 12px !important;
            flex-direction: column !important;
            gap: 8px !important;
            align-items: center !important;
          }

          /* Floating Calendar Popover */
          .custom-calendar-popover {
            left: 50% !important;
            transform: translateX(-50%) !important;
            width: calc(100vw - 28px) !important;
            max-width: 320px !important;
          }
        }

        /* Dark Theme Support for Mobile Cards */
        [data-theme="dark"] .report-m-card,
        .dark .report-m-card {
          background: #111528 !important;
          border-color: rgba(139, 92, 246, 0.22) !important;
        }
        [data-theme="dark"] .report-m-card-name,
        .dark .report-m-card-name {
          color: #ffffff !important;
        }
        [data-theme="dark"] .report-m-card-body,
        .dark .report-m-card-body {
          background: #171b38 !important;
        }
        [data-theme="dark"] .report-m-stat-val,
        .dark .report-m-stat-val {
          color: #f1f5f9 !important;
        }
        [data-theme="dark"] .report-m-stat-lbl,
        .dark .report-m-stat-lbl {
          color: #94a3b8 !important;
        }
        [data-theme="dark"] .report-m-card-footer,
        .dark .report-m-card-footer {
          border-color: rgba(255, 255, 255, 0.08) !important;
        }
        [data-theme="dark"] .report-m-view-btn,
        .dark .report-m-view-btn {
          color: #34d399 !important;
        }
      `}</style>
    </div>
  );
};

export default ReportDashboard;
