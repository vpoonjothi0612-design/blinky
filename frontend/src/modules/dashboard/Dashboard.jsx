import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import useAuth from '../../hooks/useAuth';
import { getEmployees } from '../employee/employee.service';
import { getCameras } from '../camera/camera.service';
import { getAttendance } from '../attendance/attendance.service';
import { getAllEnrollments } from '../face-enrollment/face-enrollment.service';
import { getSummaryReport } from '../reports/report.service';
import { getAiHealth } from '../vehicle/vehicle.service';
import api from '../../services/api';
import Loader from '../../components/common/Loader';
import cctvCameraImg from '../../assets/cctv_camera_3d.jpg';
import cctvCameraDarkImg from '../../assets/cctv_camera_dark.jpg';
import './dashboard.css';

const Dashboard = () => {
  const { user } = useAuth();
  const navigate = useNavigate();

  const [loading, setLoading] = useState(true);
  const [systemHealth, setSystemHealth] = useState({
    apiOnline: false,
    aiServiceOnline: false,
  });

  const [summaryData, setSummaryData] = useState(null);

  const [data, setData] = useState({
    employees: [],
    cameras: [],
    attendance: [],
    enrollments: [],
    unknownFaces: [],
  });

  // Effective Normalized Role
  const effectiveRole = useMemo(() => {
    let r = (user?.role || '').toUpperCase();
    if (r === 'SUPER_ADMIN') return 'ADMIN';
    if (r === 'USER') return 'STAFF';
    return r || 'STAFF';
  }, [user]);

  const isAdmin = effectiveRole === 'ADMIN';
  const isSecurity = effectiveRole === 'SECURITY';
  const isStaff = effectiveRole === 'STAFF';

  useEffect(() => {
    const fetchDashboardData = async () => {
      try {
        const todayStr = new Date().toISOString().split('T')[0];

        // Fetch only authorized resources per role
        const [empRes, camRes, attRes, enrollRes, sumRes, unkRes, healthRes, aiHealthRes] =
          await Promise.allSettled([
            isAdmin || isSecurity ? getEmployees() : Promise.resolve({ data: [] }),
            isAdmin || isSecurity ? getCameras() : Promise.resolve({ data: [] }),
            getAttendance(1, 100),
            isAdmin ? getAllEnrollments() : Promise.resolve({ data: [] }),
            getSummaryReport({ startDate: todayStr, endDate: todayStr }),
            isAdmin || isSecurity ? api.get('/face-enrollments/unknown') : Promise.resolve({ data: [] }),
            api.get('/health'),
            isAdmin || isSecurity ? getAiHealth() : Promise.resolve({ success: true, isOnline: true }),
          ]);

        const employees = empRes.status === 'fulfilled' && empRes.value?.data
          ? (Array.isArray(empRes.value.data) ? empRes.value.data : [])
          : (empRes.status === 'fulfilled' && Array.isArray(empRes.value) ? empRes.value : []);

        const cameras = camRes.status === 'fulfilled' && camRes.value?.data
          ? (Array.isArray(camRes.value.data) ? camRes.value.data : [])
          : (camRes.status === 'fulfilled' && Array.isArray(camRes.value) ? camRes.value : []);

        const attendance = attRes.status === 'fulfilled' && attRes.value?.data
          ? (Array.isArray(attRes.value.data)
              ? attRes.value.data
              : (Array.isArray(attRes.value.data.rows) ? attRes.value.data.rows : []))
          : (attRes.status === 'fulfilled' && Array.isArray(attRes.value) ? attRes.value : []);

        const enrollments = enrollRes.status === 'fulfilled' && enrollRes.value?.data
          ? (Array.isArray(enrollRes.value.data) ? enrollRes.value.data : [])
          : (enrollRes.status === 'fulfilled' && Array.isArray(enrollRes.value) ? enrollRes.value : []);

        const unknownFaces = unkRes.status === 'fulfilled' && unkRes.value?.data
          ? (Array.isArray(unkRes.value.data) ? unkRes.value.data : [])
          : (unkRes.status === 'fulfilled' && Array.isArray(unkRes.value) ? unkRes.value : []);

        const summary = sumRes.status === 'fulfilled' && sumRes.value?.data
          ? sumRes.value.data
          : null;

        setData({
          employees,
          cameras,
          attendance,
          enrollments,
          unknownFaces,
        });

        setSummaryData(summary);

        setSystemHealth({
          apiOnline: healthRes.status === 'fulfilled' && healthRes.value?.data?.success === true,
          aiServiceOnline:
            aiHealthRes.status === 'fulfilled' &&
            Boolean(aiHealthRes.value?.data?.success ?? aiHealthRes.value?.success) &&
            aiHealthRes.value?.isOnline !== false,
        });
      } catch (error) {
        console.error('Error fetching dashboard data:', error);
      } finally {
        setLoading(false);
      }
    };
    fetchDashboardData();
  }, [isAdmin, isSecurity]);

  // Time-of-day greeting
  const greeting = useMemo(() => {
    const hour = new Date().getHours();
    if (hour < 12) return 'Good morning';
    if (hour < 17) return 'Good afternoon';
    return 'Good evening';
  }, []);

  const displayName = user?.name || user?.email?.split('@')[0] || 'User';

  const currentDateFormatted = useMemo(() => {
    return new Date().toLocaleDateString('en-US', {
      weekday: 'long',
      month: 'long',
      day: 'numeric',
      year: 'numeric',
    }).toUpperCase();
  }, []);

  // Real Counts & Metrics strictly from database
  const totalEmployees = data.employees.length || summaryData?.totalEmployees || 0;
  const enrolledCount = data.enrollments.length;

  // Helper: check if a record timestamp/date belongs strictly to today (in user's local date)
  const isTodayRecord = useCallback((r) => {
    if (!r) return false;
    const raw = r.timestamp || r.createdAt || r.date;
    if (!raw) return false;
    const d = new Date(raw);
    if (isNaN(d.getTime())) return false;

    const now = new Date();
    const isSameDay =
      d.getFullYear() === now.getFullYear() &&
      d.getMonth() === now.getMonth() &&
      d.getDate() === now.getDate();

    if (isSameDay) return true;

    const localTodayStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
    if (typeof r.date === 'string' && r.date === localTodayStr) return true;

    return false;
  }, []);

  const todayAttendanceRecords = useMemo(() => {
    return (data.attendance || []).filter(isTodayRecord);
  }, [data.attendance, isTodayRecord]);

  const todayAttendance = summaryData?.totalPresent !== undefined
    ? summaryData.totalPresent
    : todayAttendanceRecords.length;

  const attendanceRate = totalEmployees > 0
    ? ((todayAttendance / totalEmployees) * 100).toFixed(1)
    : '0.0';

  const totalAbsent = summaryData?.totalAbsent !== undefined
    ? summaryData.totalAbsent
    : Math.max(0, totalEmployees - todayAttendance);

  const totalLeave = summaryData?.totalLeave || 0;
  const totalOD = summaryData?.totalOD || 0;

  // First punch of the day for staff
  const firstPunchTime = useMemo(() => {
    if (!todayAttendanceRecords.length) return null;
    const sorted = [...todayAttendanceRecords].sort((a, b) => {
      const tA = new Date(a.timestamp || a.createdAt || a.date || 0).getTime();
      const tB = new Date(b.timestamp || b.createdAt || b.date || 0).getTime();
      return tA - tB;
    });
    const first = sorted[0];
    const recDate = first.timestamp ? new Date(first.timestamp) : (first.createdAt ? new Date(first.createdAt) : null);
    return recDate ? recDate.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: true }) : null;
  }, [todayAttendanceRecords]);

  // Camera connectivity statistics from real cameras
  const cameraStats = useMemo(() => {
    const cameras = data.cameras || [];
    const total = cameras.length;
    const online = cameras.filter((c) => {
      return Boolean(c.isOnline ?? (c.connectionStatus === 'ONLINE'));
    }).length;
    const offline = total - online;

    return { total, online, offline };
  }, [data.cameras]);

  // Daily recent attendance activity ONLY (strictly today's punches)
  const recentActivity = useMemo(() => {
    const todayAtt = (data.attendance || []).filter(isTodayRecord);
    todayAtt.sort((a, b) => {
      const tA = new Date(a.timestamp || a.createdAt || a.date || 0).getTime();
      const tB = new Date(b.timestamp || b.createdAt || b.date || 0).getTime();
      return tB - tA;
    });
    return todayAtt.slice(0, 5);
  }, [data.attendance, isTodayRecord]);

  // Donut chart calculations
  const donutMath = useMemo(() => {
    const total = isStaff ? (todayAttendanceRecords.length ? 1 : 1) : (totalEmployees || 1);
    const pFrac = Math.min(1, Math.max(0, todayAttendance / total));
    const aFrac = Math.min(1 - pFrac, Math.max(0, totalAbsent / total));
    const lFrac = Math.min(1 - pFrac - aFrac, Math.max(0, totalLeave / total));
    const oFrac = Math.min(1 - pFrac - aFrac - lFrac, Math.max(0, totalOD / total));

    const circ = 226.19; // 2 * PI * 36
    const pDash = pFrac * circ;
    const aDash = aFrac * circ;
    const lDash = lFrac * circ;
    const oDash = oFrac * circ;

    return {
      circ,
      pDash,
      aDash,
      lDash,
      oDash,
      pOffset: 0,
      aOffset: -pDash,
      lOffset: -(pDash + aDash),
      oOffset: -(pDash + aDash + lDash),
      presentPct: total > 0 ? ((todayAttendance / total) * 100).toFixed(1) : '0.0',
      absentPct: total > 0 ? ((totalAbsent / total) * 100).toFixed(1) : '0.0',
      leavePct: total > 0 ? ((totalLeave / total) * 100).toFixed(1) : '0.0',
      odPct: total > 0 ? ((totalOD / total) * 100).toFixed(1) : '0.0',
    };
  }, [totalEmployees, todayAttendance, totalAbsent, totalLeave, totalOD, isStaff, todayAttendanceRecords]);

  // System operational status
  const systemStatusInfo = useMemo(() => {
    const isAiOnline = Boolean(systemHealth.aiServiceOnline);
    const isCamOnline = cameraStats.online > 0;
    const hasCameras = cameraStats.total > 0;
    const isCamAllOnline = hasCameras && isCamOnline && cameraStats.offline === 0;

    if (!hasCameras) {
      return {
        dotClass: 'dot-amber',
        pingClass: 'ping-amber',
        titleClass: 'text-amber',
        title: 'NO CAMERAS CONFIGURED',
        sub: isAiOnline
          ? 'AI API responds; configure a camera and run its RTSP decode test.'
          : 'No camera configuration or AI API response is available.',
      };
    }

    if (isAiOnline && isCamAllOnline) {
      return {
        dotClass: '',
        pingClass: '',
        titleClass: '',
        title: 'SERVICES RESPONDING',
        sub: 'AI API responds; camera networks reachable. RTSP decode is unverified.',
      };
    }

    if (isAiOnline) {
      return {
        dotClass: 'dot-amber',
        pingClass: 'ping-amber',
        titleClass: 'text-amber',
        title: isCamOnline ? 'PARTIAL CAMERA NETWORK AVAILABILITY' : 'CAMERA NETWORK UNAVAILABLE',
        sub: `${cameraStats.online} of ${cameraStats.total} camera network checks passed; RTSP decode remains unverified.`,
      };
    }

    return {
      dotClass: isCamOnline ? 'dot-amber' : 'dot-red',
      pingClass: isCamOnline ? 'ping-amber' : 'ping-red',
      titleClass: isCamOnline ? 'text-amber' : 'text-red',
      title: 'AI SERVICE UNAVAILABLE',
      sub: isCamOnline
        ? 'Camera network reachable; AI API did not respond.'
        : 'No camera network checks passed; AI API did not respond.',
    };
  }, [systemHealth.aiServiceOnline, cameraStats.online, cameraStats.offline, cameraStats.total]);

  return (
    <div className="dashboard-page fade-in">
      {/* ============================================================
          1. HERO BANNER (Role-Adaptive)
          ============================================================ */}
      <div className="dash-hero-banner">
        <div className="dash-hero-left">
          <span className="dash-hero-eyebrow">
            {isSecurity
              ? 'SURVEILLANCE & SECURITY COMMAND'
              : isStaff
              ? 'PERSONAL WORKFORCE DESK'
              : currentDateFormatted}
          </span>
          <h1 className="dash-hero-title">
            {greeting}, {displayName}{' '}
            <span className="dash-hero-leaf">
              {isSecurity ? '🚨' : isStaff ? '👤' : '🌿'}
            </span>
          </h1>
          <p className="dash-hero-subtitle">
            {isSecurity
              ? 'Real-time CCTV gate monitoring, visitor alerts, and vehicle scans.'
              : isStaff
              ? 'Your daily attendance records, punch history, and personal schedule.'
              : 'Real-time workforce attendance and surveillance overview.'}
          </p>
        </div>

        {/* Center CCTV Security Camera 3D Image */}
        <div className="dash-hero-center">
          <img
            src={cctvCameraImg}
            alt="3D CCTV Surveillance Camera"
            className="dash-hero-camera-img dash-hero-camera-img-light"
          />
          <img
            src={cctvCameraDarkImg}
            alt="3D CCTV Surveillance Camera"
            className="dash-hero-camera-img dash-hero-camera-img-dark"
          />
        </div>

        {/* Right Header Actions */}
        <div className="dash-hero-right">
          <div className="dash-status-capsule">
            <div className="dash-status-dot-wrap">
              <span className={`dash-status-ping ${systemStatusInfo.pingClass}`} />
              <span className={`dash-status-dot ${systemStatusInfo.dotClass}`} />
            </div>
            <div className="dash-status-text">
              <span className={`dash-status-title ${systemStatusInfo.titleClass}`}>
                {systemStatusInfo.title}
              </span>
              <span className="dash-status-sub">{systemStatusInfo.sub}</span>
            </div>
          </div>

          {isAdmin && (
            <button
              className="dash-hero-btn-enroll"
              onClick={() => navigate('/face-enrollments/create')}
            >
              <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M16 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/>
                <circle cx="8.5" cy="7" r="4"/>
                <line x1="20" y1="8" x2="20" y2="14"/>
                <line x1="23" y1="11" x2="17" y2="11"/>
              </svg>
              <span>Enroll New Face</span>
            </button>
          )}

          {isSecurity && (
            <button
              className="dash-hero-btn-enroll"
              onClick={() => navigate('/unknown-faces')}
              style={{ background: 'linear-gradient(135deg, #ef4444 0%, #b91c1c 100%)' }}
            >
              <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
              </svg>
              <span>Unrecognized Faces</span>
            </button>
          )}

          {isStaff && (
            <button
              className="dash-hero-btn-enroll"
              onClick={() => navigate('/attendance')}
            >
              <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                <rect x="3" y="4" width="18" height="18" rx="2" ry="2"/>
                <line x1="16" y1="2" x2="16" y2="6"/>
                <line x1="8" y1="2" x2="8" y2="6"/>
                <line x1="3" y1="10" x2="21" y2="10"/>
              </svg>
              <span>View Attendance Log</span>
            </button>
          )}
        </div>
      </div>

      {/* ============================================================
          2. PRIMARY 4 KPI METRIC CARDS (Role-Adaptive)
          ============================================================ */}
      <div className="dash-kpi-grid">
        {isAdmin && (
          <>
            {/* Card 1: Total Employees */}
            <div className="dash-kpi-card" onClick={() => navigate('/employees')}>
              <div className="dash-kpi-header">
                <div className="dash-kpi-icon-box">
                  <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="#059669" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/>
                    <circle cx="9" cy="7" r="4"/>
                    <path d="M23 21v-2a4 4 0 0 0-3-3.87"/>
                    <path d="M16 3.13a4 4 0 0 1 0 7.75"/>
                  </svg>
                </div>
                <div className="dash-kpi-title-wrap">
                  <span className="dash-kpi-label">TOTAL EMPLOYEES</span>
                  <span className="dash-kpi-number">{loading ? '—' : totalEmployees}</span>
                </div>
              </div>
              <div className="dash-kpi-footer">
                <span className="dash-kpi-trend">Full Registry</span>
                <span className="dash-card-link" style={{ fontSize: '11.5px' }}>Manage &rarr;</span>
              </div>
            </div>

            {/* Card 2: Face Registry */}
            <div className="dash-kpi-card" onClick={() => navigate('/face-enrollments')}>
              <div className="dash-kpi-header">
                <div className="dash-kpi-icon-box">
                  <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="#059669" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M9 3H5a2 2 0 0 0-2 2v4m0 6v4a2 2 0 0 0 2 2h4m6 0h4a2 2 0 0 0 2-2v-4m0-6V5a2 2 0 0 0-2-2h-4"/>
                    <circle cx="12" cy="12" r="3"/>
                  </svg>
                </div>
                <div className="dash-kpi-title-wrap">
                  <span className="dash-kpi-label">FACE REGISTRY</span>
                  <span className="dash-kpi-number">{loading ? '—' : enrolledCount}</span>
                </div>
              </div>
              <div className="dash-kpi-footer">
                <span className="dash-kpi-trend">Biometric Enrolled</span>
                <span className="dash-card-link" style={{ fontSize: '11.5px' }}>Enroll &rarr;</span>
              </div>
            </div>

            {/* Card 3: Today's Attendance */}
            <div className="dash-kpi-card" onClick={() => navigate('/attendance')}>
              <div className="dash-kpi-header">
                <div className="dash-kpi-icon-box">
                  <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="#059669" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <rect x="3" y="4" width="18" height="18" rx="2" ry="2"/>
                    <line x1="16" y1="2" x2="16" y2="6"/>
                    <line x1="8" y1="2" x2="8" y2="6"/>
                    <line x1="3" y1="10" x2="21" y2="10"/>
                    <polyline points="9 16 11 18 15 14"/>
                  </svg>
                </div>
                <div className="dash-kpi-title-wrap">
                  <span className="dash-kpi-label">TODAY'S ATTENDANCE</span>
                  <span className="dash-kpi-number">{loading ? '—' : todayAttendance}</span>
                </div>
              </div>
              <div className="dash-kpi-footer">
                <span className="dash-kpi-stat-sub">{attendanceRate}% of workforce</span>
                <span className="dash-card-link" style={{ fontSize: '11.5px' }}>Log &rarr;</span>
              </div>
            </div>

            {/* Card 4: Camera Feeds */}
            <div className="dash-kpi-card" onClick={() => navigate('/cameras')}>
              <div className="dash-kpi-header">
                <div className="dash-kpi-icon-box">
                  <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="#059669" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M23 7l-7 5 7 5V7z"/>
                    <rect x="1" y="5" width="15" height="14" rx="2" ry="2"/>
                  </svg>
                </div>
                <div className="dash-kpi-title-wrap">
                  <span className="dash-kpi-label">CAMERA FEEDS</span>
                  <span className="dash-kpi-number">
                    {loading ? '—' : `${cameraStats.online} / ${cameraStats.total}`}
                  </span>
                </div>
              </div>
              <div className="dash-kpi-footer">
                <span className={`dash-kpi-cam-status ${cameraStats.online > 0 ? '' : 'offline'}`}>
                  <span className={`dash-cam-dot ${cameraStats.online > 0 ? '' : 'dot-offline'}`}></span>
                  {cameraStats.total === 0 ? 'No cameras' : `${cameraStats.online} of ${cameraStats.total} reachable`}
                </span>
                <span className="dash-card-link" style={{ fontSize: '11.5px' }}>Feeds &rarr;</span>
              </div>
            </div>
          </>
        )}

        {isSecurity && (
          <>
            {/* Security Card 1: Camera Feeds */}
            <div className="dash-kpi-card" onClick={() => navigate('/cameras')}>
              <div className="dash-kpi-header">
                <div className="dash-kpi-icon-box" style={{ background: 'rgba(56, 189, 248, 0.15)', color: '#0284c7' }}>
                  <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M23 7l-7 5 7 5V7z"/>
                    <rect x="1" y="5" width="15" height="14" rx="2" ry="2"/>
                  </svg>
                </div>
                <div className="dash-kpi-title-wrap">
                  <span className="dash-kpi-label">CAMERAS ONLINE</span>
                  <span className="dash-kpi-number">
                    {loading ? '—' : `${cameraStats.online} / ${cameraStats.total}`}
                  </span>
                </div>
              </div>
              <div className="dash-kpi-footer">
                <span className="dash-kpi-trend">Live Gate Surveillance</span>
                <span className="dash-card-link" style={{ fontSize: '11.5px' }}>View Feeds &rarr;</span>
              </div>
            </div>

            {/* Security Card 2: Unrecognized Faces */}
            <div className="dash-kpi-card" onClick={() => navigate('/unknown-faces')}>
              <div className="dash-kpi-header">
                <div className="dash-kpi-icon-box" style={{ background: 'rgba(239, 68, 68, 0.15)', color: '#ef4444' }}>
                  <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
                  </svg>
                </div>
                <div className="dash-kpi-title-wrap">
                  <span className="dash-kpi-label">UNKNOWN FACES</span>
                  <span className="dash-kpi-number" style={{ color: '#ef4444' }}>
                    {loading ? '—' : data.unknownFaces.length}
                  </span>
                </div>
              </div>
              <div className="dash-kpi-footer">
                <span className="dash-kpi-trend" style={{ color: '#ef4444' }}>Active Security Alerts</span>
                <span className="dash-card-link" style={{ fontSize: '11.5px', color: '#ef4444' }}>Triage &rarr;</span>
              </div>
            </div>

            {/* Security Card 3: Today's Gate Attendance */}
            <div className="dash-kpi-card" onClick={() => navigate('/attendance')}>
              <div className="dash-kpi-header">
                <div className="dash-kpi-icon-box">
                  <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="#059669" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <rect x="3" y="4" width="18" height="18" rx="2" ry="2"/>
                    <line x1="16" y1="2" x2="16" y2="6"/>
                    <line x1="8" y1="2" x2="8" y2="6"/>
                    <line x1="3" y1="10" x2="21" y2="10"/>
                  </svg>
                </div>
                <div className="dash-kpi-title-wrap">
                  <span className="dash-kpi-label">TODAY'S GATE PUNCHES</span>
                  <span className="dash-kpi-number">{loading ? '—' : todayAttendance}</span>
                </div>
              </div>
              <div className="dash-kpi-footer">
                <span className="dash-kpi-stat-sub">Verified Employees</span>
                <span className="dash-card-link" style={{ fontSize: '11.5px' }}>Gate Log &rarr;</span>
              </div>
            </div>

            {/* Security Card 4: Personnel Lookup */}
            <div className="dash-kpi-card" onClick={() => navigate('/employees')}>
              <div className="dash-kpi-header">
                <div className="dash-kpi-icon-box" style={{ background: 'rgba(139, 92, 246, 0.15)', color: '#8b5cf6' }}>
                  <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <circle cx="11" cy="11" r="8" />
                    <line x1="21" y1="21" x2="16.65" y2="16.65" />
                  </svg>
                </div>
                <div className="dash-kpi-title-wrap">
                  <span className="dash-kpi-label">PERSONNEL DIRECTORY</span>
                  <span className="dash-kpi-number">{loading ? '—' : totalEmployees}</span>
                </div>
              </div>
              <div className="dash-kpi-footer">
                <span className="dash-kpi-trend">Read-Only Verification</span>
                <span className="dash-card-link" style={{ fontSize: '11.5px' }}>Lookup &rarr;</span>
              </div>
            </div>
          </>
        )}

        {isStaff && (
          <>
            {/* Staff Card 1: Today's Status */}
            <div className="dash-kpi-card" onClick={() => navigate('/attendance')}>
              <div className="dash-kpi-header">
                <div className="dash-kpi-icon-box" style={{ background: todayAttendanceRecords.length > 0 ? 'rgba(16, 185, 129, 0.15)' : 'rgba(245, 158, 11, 0.15)', color: todayAttendanceRecords.length > 0 ? '#10b981' : '#f59e0b' }}>
                  <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="9 11 12 14 22 4" />
                    <path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11" />
                  </svg>
                </div>
                <div className="dash-kpi-title-wrap">
                  <span className="dash-kpi-label">TODAY'S STATUS</span>
                  <span className="dash-kpi-number" style={{ fontSize: '18px', color: todayAttendanceRecords.length > 0 ? '#10b981' : '#f59e0b' }}>
                    {loading ? '—' : todayAttendanceRecords.length > 0 ? 'PRESENT' : 'NOT CLOCKED IN'}
                  </span>
                </div>
              </div>
              <div className="dash-kpi-footer">
                <span className="dash-kpi-trend">{todayAttendanceRecords.length > 0 ? 'Verified Clock-In' : 'No scans today yet'}</span>
                <span className="dash-card-link" style={{ fontSize: '11.5px' }}>Details &rarr;</span>
              </div>
            </div>

            {/* Staff Card 2: Clock-In Time */}
            <div className="dash-kpi-card" onClick={() => navigate('/attendance')}>
              <div className="dash-kpi-header">
                <div className="dash-kpi-icon-box" style={{ background: 'rgba(56, 189, 248, 0.15)', color: '#0284c7' }}>
                  <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <circle cx="12" cy="12" r="10"/>
                    <polyline points="12 6 12 12 16 14"/>
                  </svg>
                </div>
                <div className="dash-kpi-title-wrap">
                  <span className="dash-kpi-label">FIRST CLOCK-IN</span>
                  <span className="dash-kpi-number" style={{ fontSize: '19px' }}>
                    {loading ? '—' : firstPunchTime || '—'}
                  </span>
                </div>
              </div>
              <div className="dash-kpi-footer">
                <span className="dash-kpi-trend">Gate Camera Punch</span>
                <span className="dash-card-link" style={{ fontSize: '11.5px' }}>Logs &rarr;</span>
              </div>
            </div>

            {/* Staff Card 3: Today's Total Punches */}
            <div className="dash-kpi-card" onClick={() => navigate('/attendance')}>
              <div className="dash-kpi-header">
                <div className="dash-kpi-icon-box">
                  <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="#059669" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <rect x="3" y="4" width="18" height="18" rx="2" ry="2"/>
                    <line x1="16" y1="2" x2="16" y2="6"/>
                    <line x1="8" y1="2" x2="8" y2="6"/>
                    <line x1="3" y1="10" x2="21" y2="10"/>
                  </svg>
                </div>
                <div className="dash-kpi-title-wrap">
                  <span className="dash-kpi-label">PUNCHES TODAY</span>
                  <span className="dash-kpi-number">{loading ? '—' : todayAttendanceRecords.length}</span>
                </div>
              </div>
              <div className="dash-kpi-footer">
                <span className="dash-kpi-stat-sub">Gate IN/OUT movements</span>
                <span className="dash-card-link" style={{ fontSize: '11.5px' }}>View &rarr;</span>
              </div>
            </div>

            {/* Staff Card 4: Attendance Rate */}
            <div className="dash-kpi-card" onClick={() => navigate('/reports')}>
              <div className="dash-kpi-header">
                <div className="dash-kpi-icon-box" style={{ background: 'rgba(139, 92, 246, 0.15)', color: '#8b5cf6' }}>
                  <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <line x1="18" y1="20" x2="18" y2="10" />
                    <line x1="12" y1="20" x2="12" y2="4" />
                    <line x1="6" y1="20" x2="6" y2="14" />
                  </svg>
                </div>
                <div className="dash-kpi-title-wrap">
                  <span className="dash-kpi-label">ATTENDANCE RATE</span>
                  <span className="dash-kpi-number">
                    {loading ? '—' : `${summaryData?.attendancePercentage || (todayAttendanceRecords.length ? '100.0' : '0.0')}%`}
                  </span>
                </div>
              </div>
              <div className="dash-kpi-footer">
                <span className="dash-kpi-trend">Personal Monthly Record</span>
                <span className="dash-card-link" style={{ fontSize: '11.5px' }}>My Report &rarr;</span>
              </div>
            </div>
          </>
        )}
      </div>

      {/* ============================================================
          3. MAIN BALANCED 2-COLUMN WORKSPACE
          ============================================================ */}
      <div className="dash-main-split">
        {/* LEFT COLUMN: RECENT ATTENDANCE ACTIVITY TABLE */}
        <div className="dash-activity-card">
          <div className="dash-card-header">
            <div className="dash-card-title-group">
              <div className="dash-card-icon-pill">
                <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="#10b981" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
                  <polyline points="14 2 14 8 20 8"/>
                  <line x1="16" y1="13" x2="8" y2="13"/>
                  <line x1="16" y1="17" x2="8" y2="17"/>
                  <polyline points="10 9 9 9 8 9"/>
                </svg>
              </div>
              <div className="dash-card-text">
                <h2 className="dash-card-heading">
                  {isStaff ? 'My Attendance Punches Today' : 'Recent Attendance Activity'}
                </h2>
                <p className="dash-card-subheading">
                  {isStaff
                    ? 'Latest camera clock-in and gate movement timestamps for today'
                    : 'Latest live camera and manual verifications for today'}
                </p>
              </div>
            </div>

            <Link to="/attendance" className="dash-card-link">
              {isStaff ? 'My Full Log →' : 'View Attendance Log →'}
            </Link>
          </div>

          {loading ? (
            <div style={{ padding: '60px 0' }}>
              <Loader message="Loading activity records..." />
            </div>
          ) : recentActivity.length === 0 ? (
            <div className="dash-empty-state">
              <div className="dash-empty-icon-wrap">
                <svg width="48" height="48" viewBox="0 0 48 48" fill="none">
                  <path d="M14 6H28L36 14V38C36 40.2 34.2 42 32 42H14C11.8 42 10 40.2 10 38V10C10 7.8 11.8 6 14 6Z" stroke="#cbd5e1" strokeWidth="2.5" strokeLinejoin="round" fill="none"/>
                  <path d="M28 6V14H36" stroke="#cbd5e1" strokeWidth="2.5" strokeLinejoin="round"/>
                  <path d="M16 22H24M16 28H28" stroke="#e2e8f0" strokeWidth="2" strokeLinecap="round"/>
                  <circle cx="30" cy="30" r="7" stroke="#10b981" strokeWidth="2.5" fill="#f0fdf4"/>
                  <path d="M35 35L41 41" stroke="#10b981" strokeWidth="2.5" strokeLinecap="round"/>
                </svg>
              </div>
              <p className="dash-empty-title">No attendance records recorded today yet</p>
              <span className="dash-empty-desc">
                {isStaff
                  ? 'Your gate camera punches will appear here as soon as you clock in.'
                  : 'Live scans will appear here in real time as employees check in at camera gates.'}
              </span>
            </div>
          ) : (
            <div className="table-responsive" style={{ overflowX: 'auto', width: '100%' }}>
              <table className="dash-activity-table">
                <thead>
                  <tr>
                    <th style={{ width: '28%' }}>EMPLOYEE</th>
                    <th style={{ width: '18%' }}>TIME</th>
                    <th style={{ width: '18%' }}>STATUS</th>
                    <th style={{ width: '22%' }}>CAMERA</th>
                    <th style={{ width: '14%' }}>ACTION</th>
                  </tr>
                </thead>
                <tbody>
                  {recentActivity.map((row, idx) => {
                    const emp = row.employee;
                    const empName = emp
                      ? `${emp.firstName} ${emp.lastName || ''}`.trim()
                      : (row.employeeName || displayName);
                    const empCode = emp?.employeeCode || row.employeeCode || 'EMP';

                    const initials = (
                      (emp?.firstName ? emp.firstName[0] : (empName ? empName[0] : 'E')) +
                      (emp?.lastName ? emp.lastName[0] : '')
                    ).toUpperCase();

                    const avatarColorStyles = [
                      { bg: '#eff6ff', color: '#2563eb' },
                      { bg: '#fef2f2', color: '#dc2626' },
                      { bg: '#fffbeb', color: '#d97706' },
                      { bg: '#f5f3ff', color: '#7c3aed' },
                    ];
                    const avStyle = avatarColorStyles[idx % avatarColorStyles.length];

                    const recDate = row.timestamp ? new Date(row.timestamp) : (row.createdAt ? new Date(row.createdAt) : null);
                    const timeStr = recDate
                      ? recDate.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: true })
                      : '—';
                    const dateStr = recDate
                      ? `${String(recDate.getDate()).padStart(2, '0')}-${String(recDate.getMonth() + 1).padStart(2, '0')}-${recDate.getFullYear()}`
                      : (row.date || '—');

                    const rawStatus = (row.status || 'PRESENT').toUpperCase();
                    const isLate = rawStatus === 'LATE';
                    const isAbsent = rawStatus === 'ABSENT';
                    const isOD = rawStatus === 'OD' || rawStatus === 'OFFICIAL_DUTY';

                    let pillClass = 'status-pill-present';
                    let pillText = 'Present';
                    if (isLate) { pillClass = 'status-pill-late'; pillText = 'Late'; }
                    else if (isAbsent) { pillClass = 'status-pill-absent'; pillText = 'Absent'; }
                    else if (isOD) { pillClass = 'status-pill-od'; pillText = 'Official Duty'; }

                    const camName = row.camera?.name || (row.source === 'MANUAL' ? 'Manual Entry' : 'Camera-01');
                    const camLoc = row.camera?.location || (row.source === 'MANUAL' ? 'Office Entrance' : 'Main Gate');

                    return (
                      <tr key={row.id || idx}>
                        <td>
                          <div className="table-emp-cell">
                            <div className="table-emp-avatar" style={{ backgroundColor: avStyle.bg, color: avStyle.color }}>
                              {initials}
                            </div>
                            <div className="table-emp-meta">
                              <span className="table-emp-name">{empName}</span>
                              <span className="table-emp-code">{empCode}</span>
                            </div>
                          </div>
                        </td>
                        <td>
                          <div className="table-time-cell">
                            <span className="table-time-val">{timeStr}</span>
                            <span className="table-date-val">{dateStr}</span>
                          </div>
                        </td>
                        <td>
                          <span className={`table-status-capsule ${pillClass}`}>
                            <span className="capsule-dot"></span>
                            <span>{pillText}</span>
                          </span>
                        </td>
                        <td>
                          <div className="table-cam-cell">
                            <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="#059669" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                              <path d="M23 7l-7 5 7 5V7z"/>
                              <rect x="1" y="5" width="15" height="14" rx="2" ry="2"/>
                            </svg>
                            <div className="table-cam-meta">
                              <span className="table-cam-name">{camName}</span>
                              <span className="table-cam-loc">{camLoc}</span>
                            </div>
                          </div>
                        </td>
                        <td>
                          <button
                            className="table-view-btn"
                            onClick={() => navigate('/attendance')}
                          >
                            <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                              <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/>
                              <circle cx="12" cy="12" r="3"/>
                            </svg>
                            <span>View</span>
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}

          <div className="dash-table-footer">
            <span>
              {recentActivity.length === 0
                ? 'No activity recorded today'
                : `Showing 1 to ${recentActivity.length} of ${todayAttendanceRecords.length} records today`}
            </span>
          </div>
        </div>

        {/* RIGHT COLUMN: ATTENDANCE DONUT & SYSTEM / PROFILE CARDS */}
        <div className="dash-side-col">
          {/* Card A: Today's Attendance Rate Donut Chart */}
          <div className="dash-donut-card">
            <div className="dash-side-header">
              <div className="dash-side-icon-pill">
                <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="#10b981" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <line x1="18" y1="20" x2="18" y2="10" />
                  <line x1="12" y1="20" x2="12" y2="4" />
                  <line x1="6" y1="20" x2="6" y2="14" />
                </svg>
              </div>
              <h3 className="dash-side-title">
                {isStaff ? 'My Daily Status' : "Today's Attendance Rate"}
              </h3>
            </div>

            <div className="dash-donut-body">
              {/* Segmented Donut SVG */}
              <div className="dash-donut-chart-wrap">
                <svg viewBox="0 0 100 100" className="dash-donut-svg">
                  <g transform="rotate(-90 50 50)">
                    <circle cx="50" cy="50" r="36" fill="none" stroke="#f1f5f9" strokeWidth="9" />
                    {/* Present Segment (Green) */}
                    <circle
                      cx="50"
                      cy="50"
                      r="36"
                      fill="none"
                      stroke="#10b981"
                      strokeWidth="9"
                      strokeDasharray={`${donutMath.pDash} ${donutMath.circ}`}
                      strokeDashoffset={donutMath.pOffset}
                      strokeLinecap="round"
                    />
                    {/* Absent Segment (Red) */}
                    <circle
                      cx="50"
                      cy="50"
                      r="36"
                      fill="none"
                      stroke="#ef4444"
                      strokeWidth="9"
                      strokeDasharray={`${donutMath.aDash} ${donutMath.circ}`}
                      strokeDashoffset={donutMath.aOffset}
                      strokeLinecap="round"
                    />
                    {/* Leave Segment (Amber) */}
                    <circle
                      cx="50"
                      cy="50"
                      r="36"
                      fill="none"
                      stroke="#f59e0b"
                      strokeWidth="9"
                      strokeDasharray={`${donutMath.lDash} ${donutMath.circ}`}
                      strokeDashoffset={donutMath.lOffset}
                      strokeLinecap="round"
                    />
                    {/* Official Duty Segment (Purple) */}
                    <circle
                      cx="50"
                      cy="50"
                      r="36"
                      fill="none"
                      stroke="#8b5cf6"
                      strokeWidth="9"
                      strokeDasharray={`${donutMath.oDash} ${donutMath.circ}`}
                      strokeDashoffset={donutMath.oOffset}
                      strokeLinecap="round"
                    />
                  </g>
                  <text x="50" y="47" textAnchor="middle" fill="#0f172a" fontSize="13" fontWeight="800">
                    {attendanceRate}%
                  </text>
                  <text x="50" y="58" textAnchor="middle" fill="#64748b" fontSize="5.5" fontWeight="600">
                    Present Today
                  </text>
                </svg>
              </div>

              {/* Legend Breakdown */}
              <div className="dash-donut-legend">
                <div className="dash-legend-row">
                  <div className="dash-legend-label">
                    <span className="dash-dot dot-present"></span>
                    <span>Present</span>
                  </div>
                  <span className="dash-legend-count">{todayAttendance}</span>
                  <span className="dash-legend-pct">{donutMath.presentPct}%</span>
                </div>

                <div className="dash-legend-row">
                  <div className="dash-legend-label">
                    <span className="dash-dot dot-absent"></span>
                    <span>Absent</span>
                  </div>
                  <span className="dash-legend-count">{totalAbsent}</span>
                  <span className="dash-legend-pct">{donutMath.absentPct}%</span>
                </div>

                <div className="dash-legend-row">
                  <div className="dash-legend-label">
                    <span className="dash-dot dot-leave"></span>
                    <span>On Leave</span>
                  </div>
                  <span className="dash-legend-count">{totalLeave}</span>
                  <span className="dash-legend-pct">{donutMath.leavePct}%</span>
                </div>

                <div className="dash-legend-row">
                  <div className="dash-legend-label">
                    <span className="dash-dot dot-od"></span>
                    <span>Official Duty</span>
                  </div>
                  <span className="dash-legend-count">{totalOD}</span>
                  <span className="dash-legend-pct">{donutMath.odPct}%</span>
                </div>
              </div>
            </div>
          </div>

          {/* Card B: Camera Health for ADMIN & SECURITY; Personal Profile for STAFF */}
          {(isAdmin || isSecurity) ? (
            <div className="dash-cam-health-card">
              <div className="dash-side-header">
                <div className="dash-side-icon-pill">
                  <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="#10b981" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>
                  </svg>
                </div>
                <h3 className="dash-side-title">Camera &amp; System Health</h3>
                <Link to="/cameras" className="dash-side-header-link">
                  View All &rarr;
                </Link>
              </div>

              <div className="dash-cam-list">
                {data.cameras.length === 0 ? (
                  <div className="dash-empty-compact">
                    <p>No cameras configured yet.</p>
                    {isAdmin && (
                      <Link to="/cameras" className="dash-link-emerald">Configure Cameras &rarr;</Link>
                    )}
                  </div>
                ) : (
                  data.cameras.slice(0, 4).map((cam, idx) => {
                    const isOnline = Boolean(cam.isOnline ?? (cam.connectionStatus === 'ONLINE'));
                    return (
                      <div key={cam.id || idx} className="dash-cam-item">
                        <div className="dash-cam-item-left">
                          <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="#64748b" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="dash-cam-item-icon">
                            <path d="M23 7l-7 5 7 5V7z"/>
                            <rect x="1" y="5" width="15" height="14" rx="2" ry="2"/>
                          </svg>
                          <div className="dash-cam-item-names">
                            <span className="dash-cam-item-name">{cam.name || `Camera-0${idx + 1}`}</span>
                            <span className="dash-cam-item-loc">{cam.location || 'Main Gate'}</span>
                          </div>
                        </div>
                        <div className={`dash-cam-item-status ${isOnline ? 'online' : 'offline'}`}>
                          <span className="dash-status-dot-sm"></span>
                          <span>{isOnline ? 'Reachable' : 'Unreachable'}</span>
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
            </div>
          ) : (
            <div className="dash-cam-health-card">
              <div className="dash-side-header">
                <div className="dash-side-icon-pill">
                  <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="#10b981" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"></path>
                    <circle cx="12" cy="7" r="4"></circle>
                  </svg>
                </div>
                <h3 className="dash-side-title">My Account &amp; Profile</h3>
                <Link to="/settings" className="dash-side-header-link">
                  Manage &rarr;
                </Link>
              </div>

              <div style={{ padding: '16px 20px', display: 'flex', flexDirection: 'column', gap: '12px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span style={{ fontSize: '12px', color: 'var(--text-muted, #64748b)' }}>Account Name</span>
                  <span style={{ fontSize: '13px', fontWeight: '700', color: 'var(--text-primary, #0f172a)' }}>{displayName}</span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span style={{ fontSize: '12px', color: 'var(--text-muted, #64748b)' }}>Email</span>
                  <span style={{ fontSize: '12.5px', color: 'var(--text-muted, #64748b)' }}>{user?.email}</span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span style={{ fontSize: '12px', color: 'var(--text-muted, #64748b)' }}>Access Level</span>
                  <span style={{ fontSize: '11px', fontWeight: '700', color: '#10b981', background: 'rgba(16, 185, 129, 0.1)', padding: '2px 8px', borderRadius: '6px' }}>
                    STAFF MEMBER
                  </span>
                </div>
                <button
                  onClick={() => navigate('/settings')}
                  style={{
                    marginTop: '8px',
                    padding: '8px 14px',
                    borderRadius: '8px',
                    border: '1px solid rgba(16, 185, 129, 0.3)',
                    background: 'rgba(16, 185, 129, 0.08)',
                    color: '#10b981',
                    fontWeight: '700',
                    fontSize: '12px',
                    cursor: 'pointer',
                  }}
                >
                  Edit Profile &amp; Change Password
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default Dashboard;
