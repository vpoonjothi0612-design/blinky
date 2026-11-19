import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import api from '../services/api';
import AuthenticatedMediaImage from '../components/common/AuthenticatedMediaImage';
import { openAuthenticatedMediaInNewTab } from '../services/media.service';
import { getFaceReviewMedia, isNoFaceCapture, noFaceReasonLabel } from '../utils/faceReviewMedia';
import { crossingToReviewFace } from '../utils/crossingView';
import useAuth from '../hooks/useAuth';
import Loader from '../components/common/Loader';
import Modal from '../components/common/Modal';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import {
  triggerSecurityAlarm,
  stopSecurityAlarmSiren,
  isAlarmSoundEnabled,
  setAlarmSoundEnabled,
  isAlarmVibrateEnabled,
  setAlarmVibrateEnabled,
  requestAlarmPermissions,
  getAlarmAccessStatus,
} from '../services/alarm.service';

const isFaceNotCapturedRecord = (face) => {
  return isNoFaceCapture(face);
};

const getNoFaceReasonLabel = (face) => {
  return noFaceReasonLabel(face);
};

const UnknownFaces = () => {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { user } = useAuth();
  const [faces, setFaces] = useState([]);
  const [crossingRows, setCrossingRows] = useState([]);
  const [crossingModeActive, setCrossingModeActive] = useState(false);
  const [crossingTab, setCrossingTab] = useState('ALL');
  const [crossingFocusId, setCrossingFocusId] = useState(searchParams.get('crossing'));
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  // Live Multi-Channel Security Alarm State
  const [activeAlarmFace, setActiveAlarmFace] = useState(null);
  const [isAlarmSoundOn, setIsAlarmSoundOn] = useState(() => isAlarmSoundEnabled());
  const [isAlarmVibrateOn, setIsAlarmVibrateOn] = useState(() => isAlarmVibrateEnabled());
  const [accessStatus, setAccessStatus] = useState(() => getAlarmAccessStatus());
  const [grantingAccess, setGrantingAccess] = useState(false);
  const [grantMessage, setGrantMessage] = useState('');
  const [justDetectedId, setJustDetectedId] = useState(null);
  const watermarkRef = useRef({ initialized: false, seenIds: new Set(), lastTime: 0 });

  // Visitor Pass Form Modal State
  const [editPassModal, setEditPassModal] = useState({ isOpen: false, face: null });
  const [passForm, setPassForm] = useState({
    visitor: '',
    whichProcess: '',
    date: '',
    inTime: '',
    outTime: '',
  });
  const [saving, setSaving] = useState(false);

  // View Modal State (Inspector)
  const [viewModal, setViewModal] = useState({ isOpen: false, face: null });

  // Photo Preview Modal State
  const [previewModal, setPreviewModal] = useState({ isOpen: false, face: null });

  // Camera Scan Logs Modal State (all scans under one face)
  const [scanLogsModal, setScanLogsModal] = useState({ isOpen: false, face: null });

  // Update Out Time Modal State
  const [outTimeModal, setOutTimeModal] = useState({ isOpen: false, face: null, outTime: '' });
  const [updating, setUpdating] = useState(false);

  // Delete Modal State
  const [deleteModal, setDeleteModal] = useState({ isOpen: false, id: null });
  const [deleting, setDeleting] = useState(false);

  // Bulk Delete State
  const [selectedIds, setSelectedIds] = useState([]);
  const [bulkDeleteModalOpen, setBulkDeleteModalOpen] = useState(false);
  const [bulkDeleting, setBulkDeleting] = useState(false);

  // Filter States
  const [successToast, setSuccessToast] = useState({ show: false, message: '', type: 'success' });
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState('ALL');
  const [cameraFilter, setCameraFilter] = useState('ALL');
  const [dateFilter, setDateFilter] = useState('ALL');
  const [directionFilter, setDirectionFilter] = useState('ALL');

  // Dropdown menus toggle
  const [statusDropdownOpen, setStatusDropdownOpen] = useState(false);
  const [cameraDropdownOpen, setCameraDropdownOpen] = useState(false);
  const [dateDropdownOpen, setDateDropdownOpen] = useState(false);
  const [directionDropdownOpen, setDirectionDropdownOpen] = useState(false);

  // Pagination States
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);

  // Sorting
  const [sortField, setSortField] = useState('TIME');
  const [sortAsc, setSortAsc] = useState(false);

  const fetchFaces = useCallback(async (isManual = false) => {
    if (isManual) setRefreshing(true);
    try {
      const res = await api.get('/face-enrollments/unknown');
      const rawFaces = res.data.data || [];
      // Only show true unregistered unknown visitors (never show registered employees)
      const validUnknowns = rawFaces.filter(
        (f) => !f.employeeId && f.status !== 'ASSIGNED' && f.status !== 'REGISTERED_EMPLOYEE'
      );
      setFaces(validUnknowns);

      // Watermark-based live alarm detection for new unrecognized faces
      if (!watermarkRef.current.initialized) {
        // First load: initialize watermark to avoid false alarms on historical data
        const idSet = new Set(validUnknowns.map((f) => f.id).filter(Boolean));
        let maxTime = 0;
        validUnknowns.forEach((f) => {
          const t = new Date(f.updatedAt || f.createdAt || 0).getTime();
          if (t > maxTime) maxTime = t;
        });
        watermarkRef.current = { initialized: true, seenIds: idSet, lastTime: maxTime };
      } else {
        // Subsequent poll: detect newly captured unknown face or fresh scan
        const newFace = validUnknowns.find((f) => {
          if (isFaceNotCapturedRecord(f)) return false;
          if (!watermarkRef.current.seenIds.has(f.id)) return true;
          const t = new Date(f.updatedAt || f.createdAt || 0).getTime();
          return t > watermarkRef.current.lastTime + 1000;
        });

        if (newFace) {
          setActiveAlarmFace(newFace);
          setJustDetectedId(newFace.id);
          triggerSecurityAlarm(newFace);

        }
        // No-face captures remain visible for staff review, but do not trigger
        // an unknown-person alarm. Mark them seen so polling never reclassifies them.
        validUnknowns.forEach((f) => watermarkRef.current.seenIds.add(f.id));
        const maxTime = validUnknowns.reduce((max, f) => Math.max(max, new Date(f.updatedAt || f.createdAt || 0).getTime()), watermarkRef.current.lastTime);
        if (maxTime > watermarkRef.current.lastTime) watermarkRef.current.lastTime = maxTime;
      }
    } catch (err) {
      console.error('Error fetching unknown faces:', err);
    } finally {
      setLoading(false);
      if (isManual) setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    fetchFaces();
    const interval = setInterval(() => {
      fetchFaces(false);
    }, 4500);
    return () => clearInterval(interval);
  }, [fetchFaces]);

  // Crossing mode is server gated by FACE_CROSSING_MODE=true. A disabled or
  // older backend quietly leaves the existing review list untouched.
  useEffect(() => {
    let active = true;
    const pollCrossings = async () => {
      try {
        const response = await api.get('/crossings', { params: { limit: 100, sort: 'desc' } });
        if (!active) return;
        const rows = response.data?.rows || [];
        setCrossingModeActive(true);
        setCrossingRows(rows.map(crossingToReviewFace));
      } catch {
        if (active) setCrossingModeActive(false);
      }
    };
    pollCrossings();
    const timer = window.setInterval(pollCrossings, 2000);
    return () => { active = false; window.clearInterval(timer); };
  }, []);

  useEffect(() => {
    const crossingId = searchParams.get('crossing');
    const cameraId = searchParams.get('camera');
    setCameraFilter(cameraId === 'CAM-01' || cameraId === 'CAM-02' ? cameraId : 'ALL');
    if (!crossingId) {
      setCrossingFocusId(null);
      return;
    }
    setCrossingFocusId(crossingId);
    let active = true;
    api.get(`/crossings/${encodeURIComponent(crossingId)}`)
      .then(({ data }) => {
        if (!active || !data?.data) return;
        const face = crossingToReviewFace(data.data);
        setCrossingRows((rows) => [face, ...rows.filter((row) => row.id !== face.id)]);
        setViewModal({ isOpen: true, face });
      })
      .catch(() => {});
    return () => { active = false; };
  }, [searchParams]);

  // Listen for alarm triggers from across the application
  useEffect(() => {
    const handleAlarmEvent = (e) => {
      if (e.detail?.face) {
        setActiveAlarmFace(e.detail.face);
        setJustDetectedId(e.detail.face.id);
      }
    };
    const handleSettingsEvent = (e) => {
      if (e.detail?.sound !== undefined) setIsAlarmSoundOn(e.detail.sound);
      if (e.detail?.vibrate !== undefined) setIsAlarmVibrateOn(e.detail.vibrate);
      setAccessStatus(getAlarmAccessStatus());
    };

    window.addEventListener('security-alarm-triggered', handleAlarmEvent);
    window.addEventListener('face-alarm-settings-changed', handleSettingsEvent);
    return () => {
      window.removeEventListener('security-alarm-triggered', handleAlarmEvent);
      window.removeEventListener('face-alarm-settings-changed', handleSettingsEvent);
    };
  }, []);

  const handleSilenceAlarm = () => {
    stopSecurityAlarmSiren();
    setActiveAlarmFace(null);
  };

  const handleGrantVibrationAccess = async () => {
    setGrantingAccess(true);
    try {
      const res = await requestAlarmPermissions();
      setAccessStatus(getAlarmAccessStatus());
      setIsAlarmSoundOn(true);
      setIsAlarmVibrateOn(true);
      if (res.notifGranted || res.vibSuccess) {
        setGrantMessage('✓ Mobile phone vibration & siren alarm access authorized! Your phone will vibrate when unrecognized faces appear.');
      } else {
        setGrantMessage('✓ Vibration authorized! Ensure device vibration/haptics are enabled in your phone system settings.');
      }
      setTimeout(() => setGrantMessage(''), 6000);
    } catch (err) {
      console.error('Error granting alarm permissions:', err);
    } finally {
      setGrantingAccess(false);
    }
  };

  const handleToggleAlarmVibrate = () => {
    const nextVal = !isAlarmVibrateOn;
    setAlarmVibrateEnabled(nextVal);
    setIsAlarmVibrateOn(nextVal);
    if (nextVal && typeof navigator !== 'undefined' && navigator.vibrate) {
      try {
        navigator.vibrate([250, 100, 250]);
      } catch (e) {}
    }
    setAccessStatus(getAlarmAccessStatus());
  };

  const handleToggleAlarmSound = () => {
    const nextVal = !isAlarmSoundOn;
    setAlarmSoundEnabled(nextVal);
    setIsAlarmSoundOn(nextVal);
    if (!nextVal) {
      stopSecurityAlarmSiren();
    }
    setAccessStatus(getAlarmAccessStatus());
  };

  // Helper: Extract face image URL (handles both face object and photoUrl string)
  const getFaceImageUrl = useCallback((faceOrUrl) => {
    if (typeof faceOrUrl === 'string') return null;
    return getFaceReviewMedia(faceOrUrl).mediaKey;
  }, []);

  // Resolve gate direction from the configured camera identity or event metadata.
  const resolveCameraInfo = useCallback((face) => {
    if (!face) {
      return {
        name: 'Unknown camera',
        ip: '—',
        role: 'UNKNOWN',
        directionLabel: 'Direction unavailable',
        location: 'Location unavailable',
      };
    }

    const photo = (face.photoUrl || '').toUpperCase();
    const camObj = face.camera || {};
    let notes = {};
    if (face.notes) {
      try {
        notes = typeof face.notes === 'string' ? JSON.parse(face.notes) : face.notes;
      } catch {
        notes = {};
      }
    }

    const cameraLabel = [
      camObj.name,
      camObj.location,
      face.cameraId,
      face.direction,
      notes.cameraId,
      notes.camera,
      notes.direction,
      photo,
    ].filter(Boolean).join(' ').toUpperCase();
    const isExitCamera = /CAM[-_ ]?0?1/.test(cameraLabel) || /\b(EXIT|OUT)\b/.test(cameraLabel);
    const isEntryCamera = /CAM[-_ ]?0?2/.test(cameraLabel) || /\b(ENTRY|IN)\b/.test(cameraLabel);

    if (isExitCamera) {
      return {
        name: camObj.name || 'CAM-01',
        ip: camObj.ipAddress || notes.cameraIp || '—',
        role: 'OUT',
        directionLabel: 'Exit / OUT',
        location: camObj.location || 'Exit gate',
      };
    }
    if (isEntryCamera) {
      return {
        name: camObj.name || 'CAM-02',
        ip: camObj.ipAddress || notes.cameraIp || '—',
        role: 'IN',
        directionLabel: 'Entrance / IN',
        location: camObj.location || 'Entry gate',
      };
    }
    return {
      name: camObj.name || 'Unknown camera',
      ip: camObj.ipAddress || notes.cameraIp || '—',
      role: 'UNKNOWN',
      directionLabel: 'Direction unavailable',
      location: camObj.location || 'Location unavailable',
    };
  }, []);

  // Helper: Extract all scans under this face
  const getFaceScans = (face) => {
    if (face?.allScans && Array.isArray(face.allScans) && face.allScans.length > 0) return face.allScans;
    if (face?.notes) {
      try {
        const parsed = typeof face.notes === 'string' ? JSON.parse(face.notes) : face.notes;
        if (Array.isArray(parsed.scans) && parsed.scans.length > 0) return parsed.scans;
      } catch { }
    }
    const camName = face?.camera?.name || (face?.photoUrl?.includes('CAM-02') ? 'CAM-02 (IN)' : 'CAM-01 (OUT)');
    return [
      {
        timestamp: face?.createdAt,
        photoUrl: face?.photoUrl,
        camera: camName,
        location: face?.camera?.location || 'Main Gate',
        direction: (camName.includes('02') || camName.includes('IN')) ? 'IN' : 'OUT',
      }
    ];
  };

  // Helper: Extract detection count
  const getDetectionCount = (face) => {
    if (face?.detectionCount) return Number(face.detectionCount);
    if (face?.allScans && Array.isArray(face.allScans)) return face.allScans.length;
    if (face?.notes) {
      try {
        const parsed = typeof face.notes === 'string' ? JSON.parse(face.notes) : face.notes;
        if (parsed.detectionCount) return Number(parsed.detectionCount);
        if (parsed.visitCount) return Number(parsed.visitCount);
        if (Array.isArray(parsed.scans)) return parsed.scans.length;
      } catch { }
    }
    return 1;
  };

  // Helper: Extract total IN entries
  const getInCount = (face) => {
    if (face?.inCount !== undefined && face?.inCount !== null) return Number(face.inCount);
    const scans = getFaceScans(face);
    return scans.filter(s => s.direction === 'IN' || (s.camera && (s.camera.includes('02') || s.camera.includes('IN')))).length;
  };

  // Helper: Extract total OUT exits
  const getOutCount = (face) => {
    if (face?.outCount !== undefined && face?.outCount !== null) return Number(face.outCount);
    const scans = getFaceScans(face);
    return scans.filter(s => s.direction === 'OUT' || (s.camera && (s.camera.includes('01') || s.camera.includes('OUT')))).length;
  };

  // Helper: Check if unknown face was detected > 3 times
  const isFrequentUnknown = (face) => {
    if (face?.notes) {
      try {
        const parsed = typeof face.notes === 'string' ? JSON.parse(face.notes) : face.notes;
        if (parsed.isFrequentUnknown) return true;
        if (parsed.detectionCount && Number(parsed.detectionCount) > 3) return true;
        if (parsed.visitCount && Number(parsed.visitCount) > 3) return true;
      } catch { }
    }
    return getDetectionCount(face) > 3;
  };

  // Helper: Calculate Pass Validity
  const getPassValidity = (face) => {
    if (face.status === 'UNREGISTERED' || face.status === 'UNASSIGNED') {
      return { status: 'NO_PASS', label: 'No Pass', badgeClass: 'pass-badge-none' };
    }

    let passIssuedAt = null;
    let passExpiresAt = null;

    if (face.notes) {
      try {
        const parsed = typeof face.notes === 'string' ? JSON.parse(face.notes) : face.notes;
        if (parsed.passIssuedAt) passIssuedAt = new Date(parsed.passIssuedAt).getTime();
        if (parsed.passExpiresAt) passExpiresAt = new Date(parsed.passExpiresAt).getTime();
      } catch { }
    }

    if (!passExpiresAt && (face.entryDate || face.createdAt) && face.outTime) {
      const d = face.entryDate || new Date(face.createdAt).toISOString().split('T')[0];
      const t = face.outTime.length === 5 ? `${face.outTime}:00` : face.outTime;
      const parsedTime = new Date(`${d}T${t}`).getTime();
      if (!isNaN(parsedTime)) {
        passExpiresAt = parsedTime;
      }
    }

    if (!passIssuedAt) {
      if (face.createdAt) {
        passIssuedAt = new Date(face.createdAt).getTime();
      } else {
        passIssuedAt = Date.now();
      }
    }

    if (!passExpiresAt) {
      passExpiresAt = passIssuedAt + 12 * 60 * 60 * 1000;
    }

    const now = Date.now();
    if (now > passExpiresAt) {
      return { status: 'EXPIRED', label: 'Expired', badgeClass: 'pass-badge-expired' };
    }

    const remainingHrs = Math.max(1, Math.round((passExpiresAt - now) / (1000 * 60 * 60)));
    return { status: 'VALID', label: `Valid (${remainingHrs}h left)`, badgeClass: 'pass-badge-valid' };
  };

  // Group repeated detections so the same face always shows under ONE face
  const uniqueFaces = useMemo(() => {
    const map = new Map();
    for (const f of faces) {
      let notes = {};
      try {
        notes = typeof f.notes === 'string' ? JSON.parse(f.notes) : (f.notes || {});
      } catch { }

      // Key to group the same visitor: if personName exists use name, else fallback to id
      const key = isFaceNotCapturedRecord(f)
        ? `no-face:${f.id}`
        : f.personName
        ? `name:${f.personName.trim().toLowerCase()}`
        : `id:${f.id}`;

      const rawScans = Array.isArray(f.allScans) && f.allScans.length > 0
        ? f.allScans
        : (Array.isArray(notes.scans) && notes.scans.length > 0
            ? notes.scans
            : [
                {
                  timestamp: f.createdAt,
                  photoUrl: f.photoUrl,
                  camera: f.camera?.name || notes.camera || (f.photoUrl?.includes('CAM-02') ? 'CAM-02 (IN)' : 'CAM-01 (OUT)'),
                  location: f.camera?.location || notes.location || 'Main Gate',
                  direction: (f.photoUrl && f.photoUrl.includes('CAM-02')) ? 'IN' : 'OUT'
                }
              ]);

      let inCount = Number(f.inCount ?? notes.inCount ?? 0);
      let outCount = Number(f.outCount ?? notes.outCount ?? 0);
      if (inCount === 0 && outCount === 0) {
        for (const s of rawScans) {
          const isIN = (s.direction === 'IN') || (s.camera && (s.camera.includes('02') || s.camera.includes('IN')));
          if (isIN) inCount++;
          else outCount++;
        }
      }

      if (!map.has(key)) {
        map.set(key, {
          ...f,
          inCount,
          outCount,
          detectionCount: Math.max(Number(f.detectionCount || notes.detectionCount || 1), inCount + outCount, rawScans.length),
          allScans: rawScans,
        });
      } else {
        const item = map.get(key);
        item.inCount = (item.inCount || 0) + inCount;
        item.outCount = (item.outCount || 0) + outCount;
        const existingTimestamps = new Set(item.allScans.map((s) => s.timestamp));
        for (const s of rawScans) {
          if (!existingTimestamps.has(s.timestamp)) {
            item.allScans.push(s);
            existingTimestamps.add(s.timestamp);
          }
        }
        item.detectionCount = item.allScans.length;
        if (f.photoUrl) {
          item.photoUrl = f.photoUrl;
        }
      }
    }
    return Array.from(map.values());
  }, [faces]);

  const reviewFaces = crossingModeActive ? crossingRows : uniqueFaces;

  // Metrics
  const totalVisitors = uniqueFaces.length;
  const unregisteredVisitors = uniqueFaces.filter(
    (f) => f.status === 'UNREGISTERED' || f.status === 'UNASSIGNED'
  ).length;
  const activePasses = uniqueFaces.filter(
    (f) => f.status === 'REGISTERED' && getPassValidity(f).status === 'VALID'
  ).length;
  const frequentUnknowns = uniqueFaces.filter(
    (f) => isFrequentUnknown(f) || getDetectionCount(f) > 3
  ).length;

  // Filtered dataset
  const filteredFaces = useMemo(() => {
    return reviewFaces
      .filter((face) => {
        if (crossingFocusId && String(face.id) !== String(crossingFocusId)) return false;
        if (crossingModeActive && crossingTab !== 'ALL' && face.decision !== crossingTab) return false;
        // 1. Status Filter
        if (statusFilter === 'UNREGISTERED') {
          if (face.status !== 'UNREGISTERED' && face.status !== 'UNASSIGNED') return false;
        } else if (statusFilter === 'ACTIVE') {
          if (face.status !== 'REGISTERED' || getPassValidity(face).status !== 'VALID') return false;
        } else if (statusFilter === 'FREQUENT') {
          if (!isFrequentUnknown(face) && getDetectionCount(face) <= 3) return false;
        }

        // 2. Camera Filter
        if (cameraFilter !== 'ALL') {
          const cam = (face.camera?.name || 'CAM-01').toLowerCase();
          const scans = getFaceScans(face);
          const matchesCam = cam.includes(cameraFilter.toLowerCase()) ||
            scans.some((s) => (s.camera || '').toLowerCase().includes(cameraFilter.toLowerCase()));
          if (!matchesCam) return false;
        }

        // 3. Movement Direction Filter (IN / OUT / BOTH)
        if (directionFilter === 'IN') {
          if (getInCount(face) <= 0) return false;
        } else if (directionFilter === 'OUT') {
          if (getOutCount(face) <= 0) return false;
        } else if (directionFilter === 'BOTH') {
          if (getInCount(face) <= 0 || getOutCount(face) <= 0) return false;
        }

        // 4. Date Filter (ALL / TODAY / YESTERDAY / WEEK)
        if (dateFilter !== 'ALL') {
          const faceDate = new Date(face.createdAt || face.entryDate || Date.now());
          const now = new Date();
          if (dateFilter === 'TODAY') {
            const isToday = faceDate.toDateString() === now.toDateString();
            if (!isToday) return false;
          } else if (dateFilter === 'YESTERDAY') {
            const yesterday = new Date(now);
            yesterday.setDate(yesterday.getDate() - 1);
            const isYesterday = faceDate.toDateString() === yesterday.toDateString();
            if (!isYesterday) return false;
          } else if (dateFilter === 'WEEK') {
            const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
            if (faceDate < sevenDaysAgo) return false;
          }
        }

        // 5. Search Query Filter
        if (searchQuery.trim()) {
          const q = searchQuery.toLowerCase().trim();
          const name = (face.personName || 'Unregistered Visitor').toLowerCase();
          const reason = (face.reason || '').toLowerCase();
          const status = (face.status || '').toLowerCase();
          const loc = (face.camera?.location || 'Main Gate').toLowerCase();
          const cam = (face.camera?.name || '').toLowerCase();
          const id = String(face.id || '').toLowerCase();
          const inTime = String(face.inTime || '').toLowerCase();
          const outTime = String(face.outTime || '').toLowerCase();
          const direction = (getInCount(face) > 0 ? 'in entry' : '') + ' ' + (getOutCount(face) > 0 ? 'out exit' : '');

          const matchesQuery =
            name.includes(q) ||
            reason.includes(q) ||
            status.includes(q) ||
            loc.includes(q) ||
            cam.includes(q) ||
            id.includes(q) ||
            inTime.includes(q) ||
            outTime.includes(q) ||
            direction.toLowerCase().includes(q);

          if (!matchesQuery) return false;
        }

        return true;
      })
      .sort((a, b) => {
        const timeA = new Date(a.createdAt || 0).getTime();
        const timeB = new Date(b.createdAt || 0).getTime();
        return sortAsc ? timeA - timeB : timeB - timeA;
      });
  }, [reviewFaces, crossingModeActive, crossingTab, crossingFocusId, statusFilter, cameraFilter, directionFilter, dateFilter, searchQuery, sortAsc]);

  // Reset pagination to page 1 whenever filters or search change
  useEffect(() => {
    setCurrentPage(1);
  }, [searchQuery, statusFilter, cameraFilter, directionFilter, dateFilter, pageSize, crossingTab, crossingFocusId]);

  // Pagination computed properties
  const totalPages = Math.ceil(filteredFaces.length / pageSize) || 1;
  const paginatedFaces = useMemo(() => {
    const startIndex = (currentPage - 1) * pageSize;
    return filteredFaces.slice(startIndex, startIndex + pageSize);
  }, [filteredFaces, currentPage, pageSize]);

  // Generate page numbers array with ellipses
  const getPageNumbers = useCallback(() => {
    if (totalPages <= 7) {
      return Array.from({ length: totalPages }, (_, i) => i + 1);
    }
    if (currentPage <= 4) {
      return [1, 2, 3, 4, 5, '...', totalPages];
    }
    if (currentPage >= totalPages - 3) {
      return [1, '...', totalPages - 4, totalPages - 3, totalPages - 2, totalPages - 1, totalPages];
    }
    return [1, '...', currentPage - 1, currentPage, currentPage + 1, '...', totalPages];
  }, [currentPage, totalPages]);

  // Check if any filter is active
  const isAnyFilterActive =
    searchQuery.trim() !== '' ||
    statusFilter !== 'ALL' ||
    cameraFilter !== 'ALL' ||
    directionFilter !== 'ALL' ||
    dateFilter !== 'ALL';

  // Quick reset all filters
  const handleResetFilters = () => {
    setSearchQuery('');
    setStatusFilter('ALL');
    setCameraFilter('ALL');
    setDirectionFilter('ALL');
    setDateFilter('ALL');
    setCurrentPage(1);
  };

  // Modal Handlers
  const openEditPassModal = (face) => {
    const today = new Date().toISOString().split('T')[0];
    const now = new Date();
    const inTime = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
    const outDate = new Date(now.getTime() + 12 * 60 * 60 * 1000);
    const outTime = `${String(outDate.getHours()).padStart(2, '0')}:${String(outDate.getMinutes()).padStart(2, '0')}`;

    setPassForm({
      visitor: face.personName || '',
      whichProcess: face.reason || 'Client Meeting',
      date: face.entryDate || today,
      inTime: face.inTime || inTime,
      outTime: face.outTime || outTime,
    });
    setEditPassModal({ isOpen: true, face });
  };

  const handleSavePass = async (e) => {
    e.preventDefault();
    if (!passForm.visitor.trim()) {
      alert('Visitor Name is required.');
      return;
    }

    try {
      setSaving(true);
      const now = new Date();
      const inTimeFull = passForm.inTime.length === 5 ? `${passForm.inTime}:00` : passForm.inTime;
      const outTimeFull = passForm.outTime.length === 5 ? `${passForm.outTime}:00` : passForm.outTime;
      const inDateObj = new Date(`${passForm.date}T${inTimeFull}`);
      const expireDateObj = new Date(`${passForm.date}T${outTimeFull}`);

      let passExpiresAt = expireDateObj.toISOString();
      if (!isNaN(inDateObj.getTime()) && expireDateObj <= inDateObj) {
        const nextDay = new Date(expireDateObj.getTime() + 24 * 60 * 60 * 1000);
        passExpiresAt = nextDay.toISOString();
      }

      const passIssuedAt = !isNaN(inDateObj.getTime()) ? inDateObj.toISOString() : now.toISOString();

      let existingNotes = {};
      if (editPassModal.face.notes) {
        try {
          existingNotes =
            typeof editPassModal.face.notes === 'string'
              ? JSON.parse(editPassModal.face.notes)
              : editPassModal.face.notes;
        } catch { }
      }

      const mergedNotes = JSON.stringify({
        ...existingNotes,
        visitor: passForm.visitor.trim(),
        process: passForm.whichProcess.trim(),
        date: passForm.date,
        inTime: passForm.inTime,
        outTime: passForm.outTime,
        passIssuedAt,
        passExpiresAt,
        validityStatus: new Date(passExpiresAt).getTime() > Date.now() ? 'VALID' : 'EXPIRED',
      });

      const payload = {
        personName: passForm.visitor.trim(),
        reason: passForm.whichProcess.trim(),
        personType: 'Visitor',
        entryDate: passForm.date,
        inTime: passForm.inTime,
        outTime: passForm.outTime,
        status: 'REGISTERED',
        notes: mergedNotes,
      };

      const res = await api.put(`/face-enrollments/${editPassModal.face.id}/register`, payload);
      if (res.data.success) {
        setEditPassModal({ isOpen: false, face: null });
        setSuccessToast({
          show: true,
          message: `Visitor Pass registered successfully for "${passForm.visitor || 'visitor'}"! Valid for 12 hours.`,
          type: 'success',
        });
        setTimeout(() => setSuccessToast({ show: false, message: '', type: 'success' }), 5500);
        fetchFaces(true);
      }
    } catch (err) {
      alert(err.response?.data?.message || 'Failed to issue visitor pass');
    } finally {
      setSaving(false);
    }
  };

  const openOutTimeModal = (face) => {
    const now = new Date();
    const hours = String(now.getHours()).padStart(2, '0');
    const mins = String(now.getMinutes()).padStart(2, '0');
    setOutTimeModal({ isOpen: true, face, outTime: `${hours}:${mins}` });
  };

  const handleUpdateOutTime = async () => {
    if (!outTimeModal.outTime) {
      alert('Out Time is required.');
      return;
    }

    try {
      setUpdating(true);
      const payload = {
        personName: outTimeModal.face.personName,
        entryDate: outTimeModal.face.entryDate,
        inTime: outTimeModal.face.inTime,
        reason: outTimeModal.face.reason,
        personType: outTimeModal.face.personType,
        notes: outTimeModal.face.notes,
        outTime: outTimeModal.outTime,
      };

      const res = await api.put(`/face-enrollments/${outTimeModal.face.id}/register`, payload);
      if (res.data.success) {
        setOutTimeModal({ isOpen: false, face: null, outTime: '' });
        setSuccessToast({
          show: true,
          message: `Visitor "${outTimeModal.face?.personName || 'visitor'}" checkout recorded successfully.`,
          type: 'success',
        });
        setTimeout(() => setSuccessToast({ show: false, message: '', type: 'success' }), 5500);
        fetchFaces(true);
      }
    } catch (err) {
      alert(err.response?.data?.message || 'Failed to update out time');
    } finally {
      setUpdating(false);
    }
  };

  const executeDelete = async () => {
    try {
      setDeleting(true);
      const res = await api.delete(`/face-enrollments/${deleteModal.id}`);
      if (res.data.success) {
        setSelectedIds((prev) => prev.filter((id) => id !== deleteModal.id));
        setDeleteModal({ isOpen: false, id: null });
        fetchFaces();
      }
    } catch (err) {
      alert(err.response?.data?.message || 'Failed to delete record');
    } finally {
      setDeleting(false);
    }
  };

  const handleSelectAll = (e) => {
    if (e.target.checked) {
      setSelectedIds(filteredFaces.map((f) => f.id).filter(Boolean));
    } else {
      setSelectedIds([]);
    }
  };

  const handleSelectRow = (id) => {
    if (!id) return;
    setSelectedIds((prev) =>
      prev.includes(id) ? prev.filter((rowId) => rowId !== id) : [...prev, id]
    );
  };

  const executeBulkDelete = async () => {
    if (selectedIds.length === 0) return;
    try {
      setBulkDeleting(true);
      try {
        await api.post('/face-enrollments/bulk-delete', { ids: selectedIds });
      } catch (err) {
        // Fallback: parallel individual deletes
        await Promise.allSettled(
          selectedIds.map((id) => api.delete(`/face-enrollments/${id}`))
        );
      }
      setSelectedIds([]);
      setBulkDeleteModalOpen(false);
      fetchFaces();
    } catch (err) {
      alert(err.response?.data?.message || 'Failed to delete selected records');
    } finally {
      setBulkDeleting(false);
    }
  };

  const exportPDF = () => {
    if (filteredFaces.length === 0) {
      alert('No visitor records to export.');
      return;
    }

    const doc = new jsPDF({
      orientation: 'portrait',
      unit: 'mm',
      format: 'a4',
    });

    const pageWidth = doc.internal.pageSize.getWidth(); // 210mm
    const pageHeight = doc.internal.pageSize.getHeight(); // 297mm

    // ── 1. Top Emerald Accent Line (2.5mm) ──
    doc.setFillColor(5, 150, 105);
    doc.rect(0, 0, pageWidth, 2.5, 'F');

    // ── 2. Official Corporate Letterhead (Clean White) ──
    doc.setFillColor(5, 150, 105);
    doc.roundedRect(14, 7.5, 11, 11, 2, 2, 'F');
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(8.5);
    doc.setTextColor(255, 255, 255);
    doc.text('FD', 19.5, 15, { align: 'center' });

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(13);
    doc.setTextColor(15, 23, 42);
    doc.text('ABIRAMI TECHNOLOGIES', 28, 12.5);

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7.5);
    doc.setTextColor(100, 116, 139);
    doc.text('FaceDetect™ AI Vision & Visitor Pass Surveillance System', 28, 17);

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(8);
    doc.setTextColor(5, 150, 105);
    doc.text('SURVEILLANCE & VISITOR LOG', pageWidth - 14, 11.5, { align: 'right' });

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7);
    doc.setTextColor(100, 116, 139);
    doc.text(`Doc Ref: SEC-${new Date().toISOString().split('T')[0].replace(/-/g, '')}`, pageWidth - 14, 15.5, { align: 'right' });
    doc.text(`Generated: ${new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}, ${new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`, pageWidth - 14, 19.5, { align: 'right' });

    // Letterhead Divider
    doc.setDrawColor(226, 232, 240);
    doc.setLineWidth(0.35);
    doc.line(14, 23.5, pageWidth - 14, 23.5);

    // ── 3. Title & Period Banner ──
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(11);
    doc.setTextColor(15, 23, 42);
    doc.text('UNRECOGNIZED FACES & VISITOR AUDIT REPORT', 14, 29.5);

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7.8);
    doc.setTextColor(71, 85, 105);
    doc.text(`TOTAL LOGGED VISITOR RECORDS: ${filteredFaces.length}`, 14, 34);

    // Live CCTV Sync pill
    doc.setFillColor(236, 253, 245);
    doc.setDrawColor(167, 243, 208);
    doc.roundedRect(pageWidth - 66, 27, 52, 6, 1.2, 1.2, 'FD');

    doc.setFillColor(16, 185, 129);
    doc.circle(pageWidth - 62.5, 30, 1, 'F');

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(6.5);
    doc.setTextColor(5, 150, 105);
    doc.text('CCTV SURVEILLANCE ACTIVE', pageWidth - 59.5, 31);

    const tableData = filteredFaces.map((f, i) => {
      const cam = resolveCameraInfo(f);
      const timeStr = new Date(f.createdAt).toLocaleDateString([], { month: 'numeric', day: 'numeric' }) + ' ' + new Date(f.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      const visitorName = f.personName || 'Unregistered Visitor';
      const cameraInfo = `${cam.name}`;
      const passLabel = getPassValidity(f).label;
      const count = getDetectionCount(f);

      return [
        i + 1,
        timeStr,
        visitorName,
        cameraInfo,
        cam.location || 'Main Gate',
        passLabel,
        count,
      ];
    });

    autoTable(doc, {
      startY: 38,
      head: [['#', 'TIME', 'VISITOR / SUBJECT', 'CAMERA', 'LOCATION', 'PASS STATUS', 'CAPTURES']],
      body: tableData,
      theme: 'plain',
      styles: {
        font: 'helvetica',
        fontSize: 7.8,
        cellPadding: { top: 2.8, bottom: 2.8, left: 2, right: 2 },
        textColor: [30, 41, 59],
        lineColor: [226, 232, 240],
        lineWidth: { bottom: 0.2 },
        valign: 'middle',
      },
      headStyles: {
        fillColor: [15, 23, 42],
        textColor: [255, 255, 255],
        fontStyle: 'bold',
        fontSize: 7.2,
        halign: 'left',
        cellPadding: { top: 3.2, bottom: 3.2, left: 2, right: 2 },
      },
      alternateRowStyles: {
        fillColor: [248, 250, 252],
      },
      columnStyles: {
        0: { cellWidth: 8, halign: 'center' },
        1: { cellWidth: 32 },
        2: { cellWidth: 42, fontStyle: 'bold' },
        3: { cellWidth: 34 },
        4: { cellWidth: 26 },
        5: { cellWidth: 24, halign: 'center' },
        6: { cellWidth: 16, halign: 'center' },
      },
      didDrawPage: function (data) {
        doc.setFillColor(5, 150, 105);
        doc.rect(0, 0, pageWidth, 2.5, 'F');

        doc.setDrawColor(226, 232, 240);
        doc.setLineWidth(0.3);
        doc.line(14, pageHeight - 11, pageWidth - 14, pageHeight - 11);

        doc.setFont('helvetica', 'normal');
        doc.setFontSize(7);
        doc.setTextColor(148, 163, 184);
        doc.text(
          'FaceDetect AI Surveillance • Visitor Records • Confidential',
          14,
          pageHeight - 6.5
        );
        doc.setFont('helvetica', 'normal');
        doc.setTextColor(148, 163, 184);
        doc.text(
          `Page ${data.pageNumber}`,
          pageWidth - 14,
          pageHeight - 6.5,
          { align: 'right' }
        );
      },
      margin: { top: 16, left: 14, right: 14, bottom: 14 },
    });

    doc.save(`Unknown_Faces_Visitors_${new Date().toISOString().split('T')[0]}.pdf`);
  };

  // Date label string matching format: Today (Oct 23, 2026)
  const todayLabel = useMemo(() => {
    const d = new Date();
    const formatted = d.toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    });
    return `Today (${formatted})`;
  }, []);

  const dateLabel = useMemo(() => {
    if (dateFilter === 'TODAY') return todayLabel;
    if (dateFilter === 'YESTERDAY') return 'Yesterday';
    if (dateFilter === 'WEEK') return 'Last 7 Days';
    return 'All Dates';
  }, [dateFilter, todayLabel]);

  const directionLabel = useMemo(() => {
    if (directionFilter === 'IN') return 'Entry (IN) Only';
    if (directionFilter === 'OUT') return 'Exit (OUT) Only';
    if (directionFilter === 'BOTH') return 'Both IN & OUT';
    return 'All Movements';
  }, [directionFilter]);

  return (
    <div className="unrecognized-faces-page fade-in">
      {/* Registration / Action Notification Toast */}
      {successToast.show && (
        <div className="unrec-floating-toast" role="alert">
          <div className="unrec-toast-icon">✅</div>
          <div className="unrec-toast-msg">{successToast.message}</div>
          <button
            type="button"
            className="unrec-toast-dismiss"
            onClick={() => setSuccessToast({ show: false, message: '', type: 'success' })}
          >
            ✕
          </button>
        </div>
      )}

      {/* ── 1. PAGE HEADER ─────────────────────────────────────────────── */}
      <div className="unrec-header-row">
        <div className="unrec-header-left">
          <div className="unrec-icon-box">
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
              <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
            </svg>
          </div>
          <div className="unrec-header-text">
            <h1 className="unrec-title">Unrecognized Faces &amp; Visitors</h1>
            <p className="unrec-subtitle">
              Monitor auto-detected unknown faces, manage 12-hour temporary visitor passes, and review frequent visitor alerts.
            </p>
          </div>
        </div>

        <div className="unrec-header-actions">
          <button
            type="button"
            className="unrec-btn-refresh"
            onClick={() => {
              if (window.history.state?.idx > 0) navigate(-1);
              else navigate('/live-monitoring');
            }}
            title="Go back to the previous page"
          >
            <svg
              viewBox="0 0 24 24"
              width="15"
              height="15"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <line x1="19" y1="12" x2="5" y2="12" />
              <polyline points="12 19 5 12 12 5" />
            </svg>
            <span>Back</span>
          </button>

          <button
            type="button"
            className={`unrec-btn-alarm-toggle ${isAlarmSoundOn ? 'active' : 'muted'}`}
            onClick={handleToggleAlarmSound}
            title={isAlarmSoundOn ? 'Security alarm siren is active - click to mute' : 'Security alarm siren is muted - click to enable'}
          >
            <span>{isAlarmSoundOn ? '🔊 Alarm: On' : '🔇 Alarm: Muted'}</span>
          </button>

          <button
            type="button"
            className="unrec-btn-refresh"
            onClick={() => fetchFaces(true)}
            disabled={loading || refreshing}
          >
            <svg
              viewBox="0 0 24 24"
              width="15"
              height="15"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.2"
              strokeLinecap="round"
              strokeLinejoin="round"
              style={{ animation: refreshing ? 'spin 1s linear infinite' : 'none' }}
            >
              <path d="M21 2v6h-6" />
              <path d="M3 12a9 9 0 0 1 15-6.7L21 8" />
              <path d="M3 22v-6h6" />
              <path d="M21 12a9 9 0 0 1-15 6.7L3 16" />
            </svg>
            <span>{refreshing ? 'Refreshing...' : 'Refresh'}</span>
          </button>
        </div>
      </div>

      {/* ── LIVE SECURITY ALARM BANNER (CRITICAL DETECTION) ───────────────── */}
      {activeAlarmFace && (
        <div className="unrec-live-alarm-banner" role="alert">
          <div className="unrec-alarm-banner-left">
            <div className="unrec-alarm-siren-beacon">
              <span className="unrec-alarm-beacon-pulse"></span>
              <span className="unrec-alarm-beacon-icon">🚨</span>
            </div>
            <div className="unrec-alarm-info">
              <div className="unrec-alarm-badge-row">
                <span className="unrec-alarm-live-badge">CRITICAL SECURITY ALARM</span>
                <span className="unrec-alarm-gate-badge">
                  {resolveCameraInfo(activeAlarmFace).directionLabel} • {resolveCameraInfo(activeAlarmFace).name}
                </span>
                <span className="unrec-alarm-time-tag">Just now</span>
              </div>
              <h2 className="unrec-alarm-headline">
                Unrecognized Person Detected at {resolveCameraInfo(activeAlarmFace).location}
              </h2>
              <p className="unrec-alarm-description">
                Surveillance camera captured an unregistered visitor. Multi-channel security alarm is active (siren &amp; phone vibration).
              </p>
            </div>
          </div>

          <div className="unrec-alarm-banner-right">
            {getFaceImageUrl(activeAlarmFace) ? (
              <AuthenticatedMediaImage
                mediaKey={getFaceImageUrl(activeAlarmFace)}
                alt="Captured Face"
                className="unrec-alarm-snapshot"
                onClick={() => setPreviewModal({ isOpen: true, face: activeAlarmFace })}
                title="Click to view full photo"
              />
            ) : isFaceNotCapturedRecord(activeAlarmFace) ? (
              <div className="unrec-alarm-snapshot-placeholder">{getNoFaceReasonLabel(activeAlarmFace)}</div>
            ) : null}
            <div className="unrec-alarm-action-group">
              <button
                type="button"
                className="unrec-alarm-silence-btn"
                onClick={handleSilenceAlarm}
                title="Silence siren audio and dismiss banner"
              >
                🔕 Silence Alarm
              </button>
              <button
                type="button"
                className="unrec-alarm-inspect-btn"
                onClick={() => {
                  stopSecurityAlarmSiren();
                  setViewModal({ isOpen: true, face: activeAlarmFace });
                }}
              >
                🔍 Inspect Details
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── 2. SEARCH & FILTER CONTROLS BAR ─────────────────────────── */}
      <div className="unrec-search-filter-bar">
        {/* Search Field */}
        <div className="unrec-search-input-wrap">
          <svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="#64748b" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="11" cy="11" r="8" />
            <line x1="21" y1="21" x2="16.65" y2="16.65" />
          </svg>
          <input
            type="text"
            className="unrec-search-field"
            placeholder="Search visitor, reason, camera, location, ID..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
          {searchQuery && (
            <button
              type="button"
              className="unrec-search-clear-btn"
              onClick={() => setSearchQuery('')}
              title="Clear search"
            >
              <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2">
                <line x1="18" y1="6" x2="6" y2="18" />
                <line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button>
          )}
        </div>

        {/* Filters Group */}
        <div className="unrec-filter-actions-group">
          {/* Date Selector Dropdown */}
          <div className="unrec-dropdown-relative">
            <button
              type="button"
              className={`unrec-filter-dropdown-btn ${dateFilter !== 'ALL' ? 'active-filter' : ''}`}
              onClick={() => {
                setDateDropdownOpen(!dateDropdownOpen);
                setStatusDropdownOpen(false);
                setCameraDropdownOpen(false);
                setDirectionDropdownOpen(false);
              }}
            >
              <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
                <line x1="16" y1="2" x2="16" y2="6" />
                <line x1="8" y1="2" x2="8" y2="6" />
                <line x1="3" y1="10" x2="21" y2="10" />
              </svg>
              <span>{dateLabel}</span>
              <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2.5">
                <polyline points="6 9 12 15 18 9" />
              </svg>
            </button>

            {dateDropdownOpen && (
              <div className="unrec-dropdown-menu">
                <div
                  className={`unrec-dropdown-item ${dateFilter === 'ALL' ? 'selected' : ''}`}
                  onClick={() => {
                    setDateFilter('ALL');
                    setDateDropdownOpen(false);
                  }}
                >
                  All Dates
                </div>
                <div
                  className={`unrec-dropdown-item ${dateFilter === 'TODAY' ? 'selected' : ''}`}
                  onClick={() => {
                    setDateFilter('TODAY');
                    setDateDropdownOpen(false);
                  }}
                >
                  {todayLabel}
                </div>
                <div
                  className={`unrec-dropdown-item ${dateFilter === 'YESTERDAY' ? 'selected' : ''}`}
                  onClick={() => {
                    setDateFilter('YESTERDAY');
                    setDateDropdownOpen(false);
                  }}
                >
                  Yesterday
                </div>
                <div
                  className={`unrec-dropdown-item ${dateFilter === 'WEEK' ? 'selected' : ''}`}
                  onClick={() => {
                    setDateFilter('WEEK');
                    setDateDropdownOpen(false);
                  }}
                >
                  Last 7 Days
                </div>
              </div>
            )}
          </div>

          {/* Status Dropdown */}
          <div className="unrec-dropdown-relative">
            <button
              type="button"
              className={`unrec-filter-dropdown-btn ${statusFilter !== 'ALL' ? 'active-filter' : ''}`}
              onClick={() => {
                setStatusDropdownOpen(!statusDropdownOpen);
                setDateDropdownOpen(false);
                setCameraDropdownOpen(false);
                setDirectionDropdownOpen(false);
              }}
            >
              <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
              </svg>
              <span>
                {statusFilter === 'ALL'
                  ? 'All Status'
                  : statusFilter === 'UNREGISTERED'
                    ? 'Unregistered'
                    : statusFilter === 'ACTIVE'
                      ? 'Active Pass'
                      : 'Frequent Alerts'}
              </span>
              <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2.5">
                <polyline points="6 9 12 15 18 9" />
              </svg>
            </button>

            {statusDropdownOpen && (
              <div className="unrec-dropdown-menu">
                <div
                  className={`unrec-dropdown-item ${statusFilter === 'ALL' ? 'selected' : ''}`}
                  onClick={() => {
                    setStatusFilter('ALL');
                    setStatusDropdownOpen(false);
                  }}
                >
                  All Status
                </div>
                <div
                  className={`unrec-dropdown-item ${statusFilter === 'UNREGISTERED' ? 'selected' : ''}`}
                  onClick={() => {
                    setStatusFilter('UNREGISTERED');
                    setStatusDropdownOpen(false);
                  }}
                >
                  Unregistered
                </div>
                <div
                  className={`unrec-dropdown-item ${statusFilter === 'ACTIVE' ? 'selected' : ''}`}
                  onClick={() => {
                    setStatusFilter('ACTIVE');
                    setStatusDropdownOpen(false);
                  }}
                >
                  Active 12H Pass
                </div>
                <div
                  className={`unrec-dropdown-item ${statusFilter === 'FREQUENT' ? 'selected' : ''}`}
                  onClick={() => {
                    setStatusFilter('FREQUENT');
                    setStatusDropdownOpen(false);
                  }}
                >
                  Frequent Unknowns (&gt;3x)
                </div>
              </div>
            )}
          </div>

          {/* Movement Direction Dropdown */}
          <div className="unrec-dropdown-relative">
            <button
              type="button"
              className={`unrec-filter-dropdown-btn ${directionFilter !== 'ALL' ? 'active-filter' : ''}`}
              onClick={() => {
                setDirectionDropdownOpen(!directionDropdownOpen);
                setDateDropdownOpen(false);
                setStatusDropdownOpen(false);
                setCameraDropdownOpen(false);
              }}
            >
              <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="17 11 12 6 7 11" />
                <polyline points="7 13 12 18 17 13" />
              </svg>
              <span>{directionLabel}</span>
              <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2.5">
                <polyline points="6 9 12 15 18 9" />
              </svg>
            </button>

            {directionDropdownOpen && (
              <div className="unrec-dropdown-menu">
                <div
                  className={`unrec-dropdown-item ${directionFilter === 'ALL' ? 'selected' : ''}`}
                  onClick={() => {
                    setDirectionFilter('ALL');
                    setDirectionDropdownOpen(false);
                  }}
                >
                  All Movements
                </div>
                <div
                  className={`unrec-dropdown-item ${directionFilter === 'IN' ? 'selected' : ''}`}
                  onClick={() => {
                    setDirectionFilter('IN');
                    setDirectionDropdownOpen(false);
                  }}
                >
                  Entry (IN) Only
                </div>
                <div
                  className={`unrec-dropdown-item ${directionFilter === 'OUT' ? 'selected' : ''}`}
                  onClick={() => {
                    setDirectionFilter('OUT');
                    setDirectionDropdownOpen(false);
                  }}
                >
                  Exit (OUT) Only
                </div>
                <div
                  className={`unrec-dropdown-item ${directionFilter === 'BOTH' ? 'selected' : ''}`}
                  onClick={() => {
                    setDirectionFilter('BOTH');
                    setDirectionDropdownOpen(false);
                  }}
                >
                  Both IN &amp; OUT
                </div>
              </div>
            )}
          </div>

          {/* All Cameras Dropdown */}
          <div className="unrec-dropdown-relative">
            <button
              type="button"
              className={`unrec-filter-dropdown-btn ${cameraFilter !== 'ALL' ? 'active-filter' : ''}`}
              onClick={() => {
                setCameraDropdownOpen(!cameraDropdownOpen);
                setDateDropdownOpen(false);
                setStatusDropdownOpen(false);
                setDirectionDropdownOpen(false);
              }}
            >
              <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M23 7l-7 5 7 5V7z" />
                <rect x="1" y="5" width="15" height="14" rx="2" ry="2" />
              </svg>
              <span>{cameraFilter === 'ALL' ? 'All Cameras' : cameraFilter}</span>
              <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2.5">
                <polyline points="6 9 12 15 18 9" />
              </svg>
            </button>

            {cameraDropdownOpen && (
              <div className="unrec-dropdown-menu">
                <div
                  className={`unrec-dropdown-item ${cameraFilter === 'ALL' ? 'selected' : ''}`}
                  onClick={() => {
                    setCameraFilter('ALL');
                    setCameraDropdownOpen(false);
                  }}
                >
                  All Cameras
                </div>
                <div
                  className={`unrec-dropdown-item ${cameraFilter === 'CAM-01' ? 'selected' : ''}`}
                  onClick={() => {
                    setCameraFilter('CAM-01');
                    setCameraDropdownOpen(false);
                  }}
                >
                  CAM-01 (Exit)
                </div>
                <div
                  className={`unrec-dropdown-item ${cameraFilter === 'CAM-02' ? 'selected' : ''}`}
                  onClick={() => {
                    setCameraFilter('CAM-02');
                    setCameraDropdownOpen(false);
                  }}
                >
                  CAM-02 (Entry)
                </div>
              </div>
            )}
          </div>


          {/* Reset Filters Button */}
          {isAnyFilterActive && (
            <button
              type="button"
              className="unrec-btn-reset-filters"
              onClick={handleResetFilters}
              title="Reset all active filters"
            >
              <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="2.5">
                <line x1="18" y1="6" x2="6" y2="18" />
                <line x1="6" y1="6" x2="18" y2="18" />
              </svg>
              <span>Reset</span>
            </button>
          )}

          {/* Bulk Delete Button */}
          {selectedIds.length > 0 && (
            <button
              type="button"
              className="unrec-btn-bulk-delete"
              onClick={() => setBulkDeleteModalOpen(true)}
              title={`Delete ${selectedIds.length} selected records`}
            >
              <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="3 6 5 6 21 6" />
                <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
              </svg>
              <span>Bulk Delete ({selectedIds.length})</span>
            </button>
          )}

          {/* Export Button */}
          <button
            type="button"
            className="unrec-btn-export"
            onClick={exportPDF}
            title="Export Unknown Faces to PDF"
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

      {crossingModeActive && (
        <div className="unrec-search-filter-bar" role="tablist" aria-label="Crossing decisions">
          {[['ALL', 'All'], ['CONFIRMED', 'Registered'], ['UNKNOWN', 'Unknown'], ['NO_FACE_CAPTURED', 'No face']].map(([value, label]) => (
            <button key={value} type="button" role="tab" aria-selected={crossingTab === value}
              className={`unrec-filter-dropdown-btn ${crossingTab === value ? 'active-filter' : ''}`}
              onClick={() => setCrossingTab(value)}>
              {label} ({crossingRows.filter((row) => value === 'ALL' || row.decision === value).length})
            </button>
          ))}
        </div>
      )}

      {/* ── 4. MAIN TABLE CARD & EMPTY STATE ─────────────────────────── */}
      <div className="unrec-table-card">
        {/* Selection Banner */}
        {selectedIds.length > 0 && (
          <div className="unrec-selection-banner">
            <div className="unrec-selection-info">
              <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2.2">
                <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
                <polyline points="22 4 12 14.01 9 11.01" />
              </svg>
              <span>
                <strong>{selectedIds.length}</strong> of {filteredFaces.length} records selected
              </span>
            </div>
            <div className="unrec-selection-actions">
              <button
                type="button"
                className="unrec-btn-deselect"
                onClick={() => setSelectedIds([])}
              >
                Deselect All
              </button>
              <button
                type="button"
                className="unrec-btn-bulk-delete-sm"
                onClick={() => setBulkDeleteModalOpen(true)}
              >
                <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="2">
                  <polyline points="3 6 5 6 21 6" />
                  <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                </svg>
                <span>Delete Selected ({selectedIds.length})</span>
              </button>
            </div>
          </div>
        )}

        {loading ? (
          <div style={{ padding: '60px 0' }}>
            <Loader message="Loading unrecognized visitor records..." />
          </div>
        ) : (
          <>
            <div className="unrec-table-wrap table-responsive" style={{ overflowX: 'auto', width: '100%' }}>
            <table className="unrec-custom-table">
              <thead>
                <tr>
                  <th style={{ width: '50px' }}>S.No</th>
                  <th style={{ width: '7%', textAlign: 'center' }}>FACE</th>
                  <th onClick={() => setSortAsc(!sortAsc)} style={{ cursor: 'pointer', width: '16%' }}>
                    <div className="unrec-th-content">
                      <span>DETECTED TIME</span>
                      <svg width="10" height="12" viewBox="0 0 10 12" fill="none" className="sort-arrows">
                        <path d="M5 2L2 5h6L5 2z" fill="#047857" opacity={!sortAsc ? 1 : 0.4} />
                        <path d="M5 10l3-3H2l3 3z" fill="#047857" opacity={sortAsc ? 1 : 0.4} />
                      </svg>
                    </div>
                  </th>
                  <th style={{ width: '12%' }}>
                    <div className="unrec-th-content">
                      <span>CAMERA</span>
                      <svg width="10" height="12" viewBox="0 0 10 12" fill="none">
                        <path d="M5 2L2 5h6L5 2z" fill="#047857" opacity={0.4} />
                        <path d="M5 10l3-3H2l3 3z" fill="#047857" opacity={0.4} />
                      </svg>
                    </div>
                  </th>
                  <th style={{ width: '13%' }}>
                    <div className="unrec-th-content">
                      <span>LOCATION</span>
                      <svg width="10" height="12" viewBox="0 0 10 12" fill="none">
                        <path d="M5 2L2 5h6L5 2z" fill="#047857" opacity={0.4} />
                        <path d="M5 10l3-3H2l3 3z" fill="#047857" opacity={0.4} />
                      </svg>
                    </div>
                  </th>
                  <th style={{ width: '13%' }}>
                    <div className="unrec-th-content">
                      <span>VISITOR TYPE</span>
                      <svg width="10" height="12" viewBox="0 0 10 12" fill="none">
                        <path d="M5 2L2 5h6L5 2z" fill="#047857" opacity={0.4} />
                        <path d="M5 10l3-3H2l3 3z" fill="#047857" opacity={0.4} />
                      </svg>
                    </div>
                  </th>
                  <th style={{ width: '12%' }}>
                    <div className="unrec-th-content">
                      <span>12H PASS</span>
                      <svg width="10" height="12" viewBox="0 0 10 12" fill="none">
                        <path d="M5 2L2 5h6L5 2z" fill="#047857" opacity={0.4} />
                        <path d="M5 10l3-3H2l3 3z" fill="#047857" opacity={0.4} />
                      </svg>
                    </div>
                  </th>
                  <th style={{ width: '14%', textAlign: 'center' }}>
                    <div className="unrec-th-content" style={{ justifyContent: 'center' }}>
                      <span>MOVEMENTS (IN / OUT)</span>
                      <svg width="10" height="12" viewBox="0 0 10 12" fill="none">
                        <path d="M5 2L2 5h6L5 2z" fill="#047857" opacity={0.4} />
                        <path d="M5 10l3-3H2l3 3z" fill="#047857" opacity={0.4} />
                      </svg>
                    </div>
                  </th>
                  <th style={{ width: '12%', textAlign: 'center' }}>ACTIONS</th>
                </tr>
              </thead>
              <tbody>
                {filteredFaces.length === 0 ? (
                  <tr>
                    <td colSpan={10} style={{ padding: 0 }}>
                      <div className="unrec-empty-wrap">
                        {/* Empty Illustration with Soft Glowing Circle, Shield with Question Mark, & Sparkles */}
                        <div className="unrec-empty-icon">
                          <svg width="86" height="86" viewBox="0 0 90 90" fill="none">
                            {/* Star sparkles */}
                            <path d="M22 36 L24 38 L22 40 L20 38 Z" fill="#34d399" />
                            <circle cx="28" cy="24" r="1.5" fill="#10b981" />
                            <circle cx="68" cy="24" r="1.5" fill="#10b981" />
                            <path d="M72 36 L74 38 L72 40 L70 38 Z" fill="#34d399" />

                            {/* Soft glowing aura */}
                            <ellipse cx="45" cy="45" rx="36" ry="26" fill="#ecfdf5" />

                            {/* Shield with Question Mark */}
                            <g transform="translate(27, 24)">
                              <path
                                d="M18 36 C18 36 32 30 32 18 L32 6 L18 2 L4 6 L4 18 C4 30 18 36 18 36 Z"
                                fill="#ffffff"
                                stroke="#059669"
                                strokeWidth="2.5"
                                strokeLinejoin="round"
                              />
                              <text
                                x="18"
                                y="23"
                                textAnchor="middle"
                                fill="#059669"
                                fontSize="18"
                                fontWeight="800"
                                fontFamily="system-ui, sans-serif"
                              >
                                ?
                              </text>
                            </g>
                          </svg>
                        </div>
                        <h3 className="unrec-empty-title">No visitors recorded</h3>
                        <p className="unrec-empty-desc">
                          People detected by the camera who are not registered will automatically appear here.
                        </p>
                        <button
                          type="button"
                          className="unrec-empty-cta-btn"
                          onClick={() => navigate('/vehicles')}
                        >
                          <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                            <polyline points="14 2 14 8 20 8" />
                            <line x1="16" y1="13" x2="8" y2="13" />
                            <line x1="16" y1="17" x2="8" y2="17" />
                          </svg>
                          <span>Run Video Scanner to Detect Visitors</span>
                        </button>
                      </div>
                    </td>
                  </tr>
                ) : (
                  paginatedFaces.map((face, idx) => {
                    const isUnregistered = face.status === 'UNREGISTERED' || face.status === 'UNASSIGNED';
                    const passValidity = getPassValidity(face);
                    const count = getDetectionCount(face);
                    const faceImgUrl = getFaceImageUrl(face);
                    const allScans = getFaceScans(face);
                    const isJustDetected = face.id === justDetectedId || face.id === activeAlarmFace?.id;
                    const isCrossingAlarm = crossingModeActive && (face.decision === 'UNKNOWN' || face.decision === 'NO_FACE_CAPTURED');

                    return (
                      <tr
                        key={face.id || idx}
                        className={`unrec-table-row clickable ${isJustDetected ? 'unrec-row-just-detected' : ''} ${isCrossingAlarm ? 'unrec-crossing-alarm-row' : ''}`}
                        onClick={() => setViewModal({ isOpen: true, face })}
                        title="Click to view face photo and timestamp details"
                      >
                        <td>
                          <span className="unrec-idx-text">{(currentPage - 1) * pageSize + idx + 1}</span>
                        </td>
                        <td style={{ textAlign: 'center' }}>
                          <div
                            className="unrec-face-avatar-wrap"
                            onClick={(e) => {
                              e.stopPropagation();
                              if (face.isCrossingRecord) {
                                const target = face.employee_id ? face.photo_url : (face.face_passport_url || face.body_url || face.photo_url || face.frame_url);
                                if (target) openAuthenticatedMediaInNewTab(target);
                                return;
                              }
                              setPreviewModal({ isOpen: true, face });
                            }}
                            title={face.isCrossingRecord ? 'Open captured frame or registry photo' : 'Click to view full face capture'}
                          >
                            {faceImgUrl ? (
                              <AuthenticatedMediaImage mediaKey={faceImgUrl} alt="Face" className="unrec-face-avatar-img" />
                            ) : (
                            <div className="unrec-face-avatar-fallback">
                              <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2">
                                <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
                                <circle cx="12" cy="7" r="4" />
                              </svg>
                              {isFaceNotCapturedRecord(face) && <small>{getNoFaceReasonLabel(face)}</small>}
                            </div>
                            )}
                            <span className="unrec-face-zoom-hint" title="View Face">
                              <svg viewBox="0 0 24 24" width="10" height="10" fill="none" stroke="currentColor" strokeWidth="2.5">
                                <circle cx="11" cy="11" r="8" />
                                <line x1="21" y1="21" x2="16.65" y2="16.65" />
                              </svg>
                            </span>
                          </div>
                          {crossingModeActive && (
                            <div className="unrec-crossing-face-caption">
                              {face.personName && (face.employeeId && face.face_enrollment_id ? (
                                <button type="button" className="unrec-crossing-employee-link" onClick={(event) => { event.stopPropagation(); navigate(`/face-enrollments/${face.face_enrollment_id}`); }}>
                                  {face.personName}
                                </button>
                              ) : <span>{face.personName}</span>)}
                              <small className={`unrec-photo-source-badge ${face.photo_source === 'REGISTRY' ? 'registered' : (face.photo_source === 'CAPTURE' || face.photo_source === 'BODY_CROP' || face.photo_source === 'FRAME') ? 'captured' : 'placeholder'}`}>
                                {face.photo_source === 'REGISTRY' ? 'Registered' : face.photo_source === 'CAPTURE' ? 'Captured' : face.photo_source === 'BODY_CROP' ? 'Person crop' : face.photo_source === 'FRAME' ? 'Frame' : 'No face'}
                              </small>
                            </div>
                          )}
                        </td>
                        <td>
                          <div className="unrec-time-cell">
                            {isJustDetected && (
                              <span className="unrec-just-detected-pill">
                                🚨 JUST DETECTED
                              </span>
                            )}
                            <span className="time-val">
                              {new Date(face.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                            </span>
                            <span className="date-val">
                              {new Date(face.createdAt).toLocaleDateString([], { month: 'short', day: 'numeric' })}
                            </span>
                            {allScans.length > 1 && (
                              <span className="unrec-scan-badge">
                                {allScans.length} scans grouped
                              </span>
                            )}
                          </div>
                        </td>
                        <td>
                          <span className="unrec-cam-pill">
                            {face.camera?.name || 'CAM-01 (OUT)'}
                          </span>
                        </td>
                        <td>
                          <span className="unrec-location-text">
                            {face.camera?.location || 'Main Gate'}
                          </span>
                        </td>
                        <td>
                          <span className="unrec-type-badge">
                            {face.personType || 'Visitor'}
                          </span>
                        </td>
                        <td>
                          <span
                            className={`unrec-pass-pill ${passValidity.status === 'VALID'
                              ? 'pass-valid'
                              : passValidity.status === 'EXPIRED'
                                ? 'pass-expired'
                                : 'pass-none'
                              }`}
                          >
                            <span className="pass-dot" />
                            <span>{passValidity.label}</span>
                          </span>
                        </td>
                        <td style={{ textAlign: 'center' }}>
                          <button
                            type="button"
                            className="unrec-inout-group-btn"
                            onClick={(e) => {
                              e.stopPropagation();
                              setScanLogsModal({ isOpen: true, face });
                            }}
                            title="Click to view total IN/OUT movement logs for this visitor"
                          >
                            <div className={`unrec-count-badge ${count > 3 ? 'count-alert' : 'count-normal'}`}>
                              {count > 3 && <span style={{ fontSize: '12px' }}>🚨</span>}
                              <span className="unrec-total-count-num">{count}x</span>
                              <span className="unrec-badge-sub">Total</span>
                            </div>
                            <div className="unrec-inout-pills-row">
                              <span className="unrec-pill-in" title="Total IN Entries (CAM-02)">
                                <span className="pill-arrow-in">↓</span> {getInCount(face)} IN
                              </span>
                              <span className="unrec-pill-out" title="Total OUT Exits (CAM-01)">
                                <span className="pill-arrow-out">↑</span> {getOutCount(face)} OUT
                              </span>
                            </div>
                          </button>
                        </td>
                        <td style={{ textAlign: 'center' }}>
                          <div className="unrec-actions-group">
                            <button
                              type="button"
                              className="unrec-action-view"
                              onClick={(e) => {
                                e.stopPropagation();
                                setScanLogsModal({ isOpen: true, face });
                              }}
                              title="View Camera Scans History"
                            >
                              <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="2">
                                <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
                                <circle cx="12" cy="12" r="3" />
                              </svg>
                            </button>
                            {isUnregistered ? (
                              <button
                                type="button"
                                className="unrec-action-issue"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  openEditPassModal(face);
                                }}
                              >
                                Issue Pass
                              </button>
                            ) : (
                              <button
                                type="button"
                                className="unrec-action-out"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  openOutTimeModal(face);
                                }}
                              >
                                Check Out
                              </button>
                            )}
                            <button
                              type="button"
                              className="unrec-action-del"
                              onClick={(e) => {
                                e.stopPropagation();
                                setDeleteModal({ isOpen: true, id: face.id });
                              }}
                              title="Delete Visitor"
                            >
                              <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="2">
                                <polyline points="3 6 5 6 21 6" />
                                <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                              </svg>
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>

          {/* Mobile Modern Executive Cards View (shown on screens <= 768px) */}
          <div className="unrec-mobile-cards">
            {filteredFaces.length === 0 ? (
              <div className="unrec-empty-wrap" style={{ padding: '24px 16px' }}>
                <p className="unrec-empty-desc">No visitor records match your filter.</p>
              </div>
            ) : (
              paginatedFaces.map((face, idx) => {
                const isUnregistered = face.status === 'UNREGISTERED' || face.status === 'UNASSIGNED';
                const passValidity = getPassValidity(face);
                const count = getDetectionCount(face);
                const faceImgUrl = getFaceImageUrl(face);
                const allScans = getFaceScans(face);
                const isJustDetected = face.id === justDetectedId || face.id === activeAlarmFace?.id;
                const camInfo = resolveCameraInfo(face);
                const timeStr = new Date(face.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
                const dateStr = new Date(face.createdAt).toLocaleDateString([], { month: 'short', day: 'numeric' });

                return (
                  <div
                    key={`m-card-${face.id || idx}`}
                    className={`unrec-m-card ${isJustDetected ? 'just-detected' : ''}`}
                    onClick={() => setViewModal({ isOpen: true, face })}
                  >
                    {/* Top row: Avatar + Identity + Pass Badge */}
                    <div className="unrec-m-card-top">
                      <div className="unrec-m-card-person">
                        <div
                          className="unrec-m-card-avatar-wrap"
                          onClick={(e) => {
                            e.stopPropagation();
                            setPreviewModal({ isOpen: true, face });
                          }}
                          title="Click to view full photo"
                        >
                          {faceImgUrl ? (
                            <AuthenticatedMediaImage mediaKey={faceImgUrl} alt="Visitor" className="unrec-m-card-avatar-img" />
                          ) : (
                            <div className="unrec-m-card-avatar-fallback">
                              <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor">
                                <circle cx="12" cy="7" r="4" />
                                <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
                              </svg>
                              {isFaceNotCapturedRecord(face) && <small>{getNoFaceReasonLabel(face)}</small>}
                            </div>
                          )}
                        </div>
                        <div className="unrec-m-card-name-block">
                          <div className="unrec-m-card-title-row">
                            <span className="unrec-m-card-name">
                              {face.personName && !/^visitor\s*\d*$/i.test(face.personName.trim())
                                ? face.personName
                                : 'Unregistered Visitor'}
                            </span>
                            {isJustDetected && (
                              <span className="unrec-m-card-just-badge">🚨 NEW</span>
                            )}
                          </div>
                          <span className="unrec-m-card-id">ID: #{face.id} • {face.personType || 'Visitor'}</span>
                        </div>
                      </div>

                      <span className={`unrec-pass-pill ${passValidity.badgeClass || 'pass-none'}`}>
                        <span className="pass-dot" />
                        {passValidity.label || 'No Pass'}
                      </span>
                    </div>

                    {/* Middle details row: Camera, Location, Time & Movement */}
                    <div className="unrec-m-card-details-grid">
                      <div className="unrec-m-detail-item">
                        <span className="unrec-m-detail-label">CAMERA &amp; GATE</span>
                        <div className="unrec-m-detail-val">
                          <span className={`unrec-m-cam-dot ${camInfo.role === 'IN' ? 'in-dot' : camInfo.role === 'OUT' ? 'out-dot' : 'unknown-dot'}`} />
                          <strong>{camInfo.name}</strong> ({camInfo.directionLabel})
                        </div>
                      </div>

                      <div className="unrec-m-detail-item">
                        <span className="unrec-m-detail-label">TIME CAPTURED</span>
                        <div className="unrec-m-detail-val">
                          <strong>{timeStr}</strong> • {dateStr}
                          {allScans.length > 1 && (
                            <span className="unrec-m-scans-tag">{allScans.length} scans</span>
                          )}
                        </div>
                      </div>

                      <div className="unrec-m-detail-item">
                        <span className="unrec-m-detail-label">LOCATION</span>
                        <div className="unrec-m-detail-val">{camInfo.location}</div>
                      </div>

                      <div className="unrec-m-detail-item">
                        <span className="unrec-m-detail-label">MOVEMENTS</span>
                        <div className="unrec-m-movement-pills">
                          <span className="unrec-pill-in">↓ {getInCount(face)} IN</span>
                          <span className="unrec-pill-out">↑ {getOutCount(face)} OUT</span>
                          {count > 3 && (
                            <span className="unrec-m-frequent-tag" title="Frequent Visitor">
                              🚨 {count}x
                            </span>
                          )}
                        </div>
                      </div>
                    </div>

                    {/* Bottom actions row */}
                    <div className="unrec-m-card-actions" onClick={(e) => e.stopPropagation()}>
                      {isUnregistered ? (
                        <button
                          type="button"
                          className="unrec-m-btn-primary"
                          onClick={() => openEditPassModal(face)}
                        >
                          <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="2.2">
                            <rect x="3" y="4" width="18" height="18" rx="2" />
                            <line x1="16" y1="2" x2="16" y2="6" />
                            <line x1="8" y1="2" x2="8" y2="6" />
                          </svg>
                          <span>Issue Pass</span>
                        </button>
                      ) : (
                        <button
                          type="button"
                          className="unrec-m-btn-checkout"
                          onClick={() => openOutTimeModal(face)}
                        >
                          <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="2.2">
                            <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
                            <polyline points="16 17 21 12 16 7" />
                            <line x1="21" y1="12" x2="9" y2="12" />
                          </svg>
                          <span>Check Out</span>
                        </button>
                      )}

                      <button
                        type="button"
                        className="unrec-m-btn-sec"
                        onClick={() => setScanLogsModal({ isOpen: true, face })}
                        title="View Scans"
                      >
                        <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="2">
                          <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
                          <circle cx="12" cy="12" r="3" />
                        </svg>
                        <span>Scans ({allScans.length})</span>
                      </button>

                      <button
                        type="button"
                        className="unrec-m-btn-icon-del"
                        onClick={() => setDeleteModal({ isOpen: true, id: face.id })}
                        title="Delete"
                      >
                        <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="2">
                          <polyline points="3 6 5 6 21 6" />
                          <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                        </svg>
                      </button>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </>
      )}

        {/* Table Footer */}
        <div className="unrec-table-footer">
          <div className="unrec-footer-left">
            <span className="unrec-footer-count">
              Showing {filteredFaces.length === 0 ? 0 : (currentPage - 1) * pageSize + 1} to {Math.min(currentPage * pageSize, filteredFaces.length)} of {filteredFaces.length} records
            </span>
            <div className="unrec-page-size-selector">
              <label htmlFor="unrec-page-size-select">Rows per page:</label>
              <select
                id="unrec-page-size-select"
                className="unrec-select-pagesize"
                value={pageSize}
                onChange={(e) => {
                  setPageSize(Number(e.target.value));
                  setCurrentPage(1);
                }}
              >
                <option value={5}>5</option>
                <option value={10}>10</option>
                <option value={20}>20</option>
                <option value={50}>50</option>
              </select>
            </div>
          </div>

          <div className="unrec-pagination">
            {/* First Page */}
            <button
              type="button"
              className="unrec-page-arrow"
              onClick={() => setCurrentPage(1)}
              disabled={currentPage === 1}
              title="First Page"
            >
              <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="11 17 6 12 11 7" />
                <polyline points="18 17 13 12 18 7" />
              </svg>
            </button>

            {/* Previous Page */}
            <button
              type="button"
              className="unrec-page-arrow"
              onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
              disabled={currentPage === 1}
              title="Previous Page"
            >
              <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="15 18 9 12 15 6" />
              </svg>
            </button>

            {/* Page Numbers */}
            {getPageNumbers().map((item, idx) => {
              if (item === '...') {
                return (
                  <span key={`ellipsis-${idx}`} className="unrec-page-ellipsis">
                    …
                  </span>
                );
              }
              const pageNum = Number(item);
              const isActive = currentPage === pageNum;
              return (
                <button
                  key={`page-${pageNum}`}
                  type="button"
                  className={`unrec-page-num ${isActive ? 'active' : ''}`}
                  onClick={() => setCurrentPage(pageNum)}
                >
                  {pageNum}
                </button>
              );
            })}

            {/* Next Page */}
            <button
              type="button"
              className="unrec-page-arrow"
              onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
              disabled={currentPage === totalPages || totalPages === 0}
              title="Next Page"
            >
              <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="9 18 15 12 9 6" />
              </svg>
            </button>

            {/* Last Page */}
            <button
              type="button"
              className="unrec-page-arrow"
              onClick={() => setCurrentPage(totalPages)}
              disabled={currentPage === totalPages || totalPages === 0}
              title="Last Page"
            >
              <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="13 17 18 12 13 7" />
                <polyline points="6 17 11 12 6 7" />
              </svg>
            </button>
          </div>
        </div>
      </div>

      {/* ── 5. BOTTOM GRID (RECENT ALERTS & 12H PASS ACTIVITY) ────────── */}
      <div className="unrec-bottom-grid">
        {/* Recent Visitor Alerts Card */}
        <div className="unrec-bottom-card">
          <div className="unrec-bottom-card-header">
            <div className="unrec-bottom-header-title">
              <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="#059669" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                <polyline points="14 2 14 8 20 8" />
                <line x1="16" y1="13" x2="8" y2="13" />
                <line x1="16" y1="17" x2="8" y2="17" />
              </svg>
              <span>Recent Visitor Alerts</span>
            </div>
            <button
              type="button"
              className="unrec-view-all-link"
              onClick={() => setStatusFilter('FREQUENT')}
            >
              <span>View All</span>
              <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="2.5">
                <line x1="5" y1="12" x2="19" y2="12" />
                <polyline points="12 5 19 12 12 19" />
              </svg>
            </button>
          </div>

          <div className="unrec-empty-bottom-state">
            <div className="unrec-empty-bottom-icon">
              <svg width="36" height="36" viewBox="0 0 36 36" fill="none">
                <circle cx="18" cy="18" r="16" fill="#ecfdf5" className="unrec-svg-circle-bg" />
                <rect x="11" y="9" width="14" height="18" rx="2" stroke="#059669" strokeWidth="1.8" fill="#ffffff" className="unrec-svg-sheet" />
                <line x1="14" y1="15" x2="22" y2="15" stroke="#10b981" strokeWidth="1.5" strokeLinecap="round" />
                <line x1="14" y1="19" x2="22" y2="19" stroke="#10b981" strokeWidth="1.5" strokeLinecap="round" />
              </svg>
            </div>
            <span className="unrec-empty-bottom-title">No recent visitor alerts.</span>
            <span className="unrec-empty-bottom-sub">Unknown faces detected by the camera will appear here.</span>
          </div>
        </div>

        {/* 12-Hour Pass Activity Card */}
        <div className="unrec-bottom-card">
          <div className="unrec-bottom-card-header">
            <div className="unrec-bottom-header-title">
              <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="#059669" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="10" />
                <polyline points="12 6 12 12 16 14" />
              </svg>
              <span>12-Hour Pass Activity</span>
            </div>
            <button
              type="button"
              className="unrec-view-all-link"
              onClick={() => setStatusFilter('ACTIVE')}
            >
              <span>View All</span>
              <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="2.5">
                <line x1="5" y1="12" x2="19" y2="12" />
                <polyline points="12 5 19 12 12 19" />
              </svg>
            </button>
          </div>

          <div className="unrec-empty-bottom-state">
            <div className="unrec-empty-bottom-icon">
              <svg width="36" height="36" viewBox="0 0 36 36" fill="none">
                <circle cx="18" cy="18" r="16" fill="#ecfdf5" className="unrec-svg-circle-bg" />
                <circle cx="18" cy="18" r="8" stroke="#059669" strokeWidth="1.8" fill="#ffffff" className="unrec-svg-clock" />
                <polyline points="18 14 18 18 21 20" stroke="#059669" strokeWidth="1.8" strokeLinecap="round" />
              </svg>
            </div>
            <span className="unrec-empty-bottom-title">No 12-hour passes yet.</span>
            <span className="unrec-empty-bottom-sub">Temporary visitor passes will appear here.</span>
          </div>
        </div>
      </div>

      {/* ── 6. ISSUE / EDIT VISITOR PASS MODAL ───────────────────────── */}
      <Modal
        isOpen={editPassModal.isOpen}
        title="Issue 12-Hour Temporary Visitor Pass"
        onClose={() => setEditPassModal({ isOpen: false, face: null })}
        confirmText={saving ? 'Saving...' : 'Issue Pass'}
        onConfirm={handleSavePass}
      >
        {editPassModal.face && (
          <div className="unrec-modal-face-header">
            <div className="unrec-modal-face-avatar">
              {getFaceImageUrl(editPassModal.face) ? (
                <AuthenticatedMediaImage mediaKey={getFaceImageUrl(editPassModal.face)} alt="Visitor Face" />
              ) : (
                <svg viewBox="0 0 24 24" width="28" height="28" fill="none" stroke="currentColor">
                  <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
                  <circle cx="12" cy="7" r="4" />
                </svg>
              )}
            </div>
            <div className="unrec-modal-face-meta">
              <div className="unrec-modal-face-title">
                {editPassModal.face.personName || 'Unregistered Visitor'}
              </div>
              <div className="unrec-modal-face-sub">
                Camera: {editPassModal.face.camera?.name || 'CAM-01 (OUT)'} • {editPassModal.face.camera?.location || 'Main Gate'}
              </div>
              <div className="unrec-modal-face-badge">
                <span>🚨 {getDetectionCount(editPassModal.face)}x Detections Recorded</span>
              </div>
            </div>
          </div>
        )}

        <form onSubmit={handleSavePass} style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
          <div>
            <label style={{ fontSize: '12px', fontWeight: 700, color: '#334155', display: 'block', marginBottom: '5px' }}>
              Visitor Full Name *
            </label>
            <input
              type="text"
              className="unrec-modal-input"
              value={passForm.visitor}
              onChange={(e) => setPassForm({ ...passForm, visitor: e.target.value })}
              placeholder="e.g. John Doe / Vendor"
              required
              autoFocus
            />
          </div>
          <div>
            <label style={{ fontSize: '12px', fontWeight: 700, color: '#334155', display: 'block', marginBottom: '5px' }}>
              Purpose of Visit / Department *
            </label>
            <input
              type="text"
              className="unrec-modal-input"
              value={passForm.whichProcess}
              onChange={(e) => setPassForm({ ...passForm, whichProcess: e.target.value })}
              placeholder="e.g. Hardware Delivery, HR Interview, Maintenance"
              required
            />
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
            <div>
              <label style={{ fontSize: '12px', fontWeight: 700, color: '#334155', display: 'block', marginBottom: '5px' }}>
                Visit Date
              </label>
              <input
                type="date"
                className="unrec-modal-input"
                value={passForm.date}
                onChange={(e) => setPassForm({ ...passForm, date: e.target.value })}
                required
              />
            </div>
            <div>
              <label style={{ fontSize: '12px', fontWeight: 700, color: '#334155', display: 'block', marginBottom: '5px' }}>
                In Time
              </label>
              <input
                type="time"
                className="unrec-modal-input"
                value={passForm.inTime}
                onChange={(e) => setPassForm({ ...passForm, inTime: e.target.value })}
                required
              />
            </div>
          </div>
          <div>
            <label style={{ fontSize: '12px', fontWeight: 700, color: '#334155', display: 'block', marginBottom: '5px' }}>
              Out Time (Expires in 12h)
            </label>
            <input
              type="time"
              className="unrec-modal-input"
              value={passForm.outTime}
              onChange={(e) => setPassForm({ ...passForm, outTime: e.target.value })}
              required
            />
          </div>
        </form>
      </Modal>

      {/* ── 7. UPDATE OUT TIME MODAL ─────────────────────────────────── */}
      <Modal
        isOpen={outTimeModal.isOpen}
        title="Check Out Visitor"
        onClose={() => setOutTimeModal({ isOpen: false, face: null, outTime: '' })}
        confirmText={updating ? 'Updating...' : 'Confirm Check Out'}
        onConfirm={handleUpdateOutTime}
      >
        <p style={{ margin: '0 0 14px 0', fontSize: '13.5px', color: '#475569' }}>
          Confirm checkout time for visitor <strong>{outTimeModal.face?.personName || 'Visitor'}</strong>:
        </p>
        <div>
          <label style={{ fontSize: '12px', fontWeight: 700, color: '#334155', display: 'block', marginBottom: '5px' }}>
            Exit / Out Time *
          </label>
          <input
            type="time"
            className="unrec-modal-input"
            value={outTimeModal.outTime}
            onChange={(e) => setOutTimeModal({ ...outTimeModal, outTime: e.target.value })}
            required
            autoFocus
          />
        </div>
      </Modal>

      {/* ── 8. DELETE MODAL ───────────────────────────────────────────── */}
      <Modal
        isOpen={deleteModal.isOpen}
        title="Delete Visitor Record"
        onClose={() => setDeleteModal({ isOpen: false, id: null })}
        confirmText={deleting ? 'Deleting...' : 'Delete'}
        confirmVariant="danger"
        onConfirm={executeDelete}
      >
        <p style={{ margin: 0, fontSize: '14px', color: '#334155' }}>
          Are you sure you want to delete this unrecognized visitor record? This action cannot be undone.
        </p>
      </Modal>

      {/* ── 8C. BULK DELETE MODAL ────────────────────────────────────── */}
      <Modal
        isOpen={bulkDeleteModalOpen}
        title={`Bulk Delete (${selectedIds.length} Selected)`}
        onClose={() => setBulkDeleteModalOpen(false)}
        confirmText={bulkDeleting ? 'Deleting...' : `Delete ${selectedIds.length} Records`}
        confirmVariant="danger"
        onConfirm={executeBulkDelete}
      >
        <p className="unrec-modal-desc" style={{ margin: 0 }}>
          Are you sure you want to delete <strong>{selectedIds.length}</strong> selected unrecognized visitor record(s)? This action cannot be undone.
        </p>
      </Modal>

      {/* ── 9. FACE PHOTO ENLARGED PREVIEW MODAL ───────────────────────── */}
      <Modal
        isOpen={viewModal.isOpen}
        title="Detected Visitor Face & Timestamp Record"
        onClose={() => setViewModal({ isOpen: false, face: null })}
        className="unrec-inspector-modal modal-lg"
        footer={
          <div style={{ display: 'flex', justifyContent: 'space-between', width: '100%', alignItems: 'center' }}>
            <button
              type="button"
              className="unrec-modal-close-btn"
              onClick={() => setViewModal({ isOpen: false, face: null })}
            >
              Close
            </button>
            <div style={{ display: 'flex', gap: '10px' }}>
              {viewModal.face && (viewModal.face.status === 'UNREGISTERED' || viewModal.face.status === 'UNASSIGNED') ? (
                <button
                  type="button"
                  className="unrec-modal-primary-btn"
                  onClick={() => {
                    const target = viewModal.face;
                    setViewModal({ isOpen: false, face: null });
                    openEditPassModal(target);
                  }}
                >
                  <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M16 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
                    <circle cx="8.5" cy="7" r="4" />
                    <line x1="20" y1="8" x2="20" y2="14" />
                    <line x1="23" y1="11" x2="17" y2="11" />
                  </svg>
                  <span>Issue 12-Hour Visitor Pass</span>
                </button>
              ) : (
                <button
                  type="button"
                  className="unrec-modal-amber-btn"
                  onClick={() => {
                    const target = viewModal.face;
                    setViewModal({ isOpen: false, face: null });
                    openOutTimeModal(target);
                  }}
                >
                  <span>Check Out Visitor</span>
                </button>
              )}
            </div>
          </div>
        }
      >
        {viewModal.face && (() => {
          const face = viewModal.face;
          const camInfo = resolveCameraInfo(face);
          const passVal = getPassValidity(face);
          const count = getDetectionCount(face);
          const faceUrl = getFaceImageUrl(face);
          const createdDate = new Date(face.createdAt);

          return (
            <div className="unrec-detail-container">
              {/* Top frequent warning if > 3 */}
              {count > 3 && (
                <div className="unrec-detail-alert-box">
                  <div className="unrec-alert-icon-wrap" style={{ padding: '6px', borderRadius: '8px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="#ef4444" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
                      <line x1="12" y1="9" x2="12" y2="13" />
                      <line x1="12" y1="17" x2="12.01" y2="17" />
                    </svg>
                  </div>
                  <div>
                    <strong>High-Frequency Unknown Detection Alert</strong>
                    <p>This unknown face has been detected <strong>{count} times</strong> without an active visitor pass.</p>
                  </div>
                </div>
              )}

              <div className="unrec-detail-body-grid">
                {/* Left: Captured Face Preview Card */}
                <div className="unrec-detail-photo-card">
                  <div className="unrec-detail-photo-frame">
                    {faceUrl ? (
                      <AuthenticatedMediaImage mediaKey={faceUrl} alt="Captured Unknown Face" className="unrec-detail-photo-img" />
                    ) : null}
                    <div
                      className="unrec-detail-photo-placeholder"
                      style={{ display: faceUrl ? 'none' : 'flex' }}
                    >
                      <svg viewBox="0 0 24 24" width="48" height="48" fill="none" stroke="#94a3b8" strokeWidth="1.8">
                        <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
                        <circle cx="12" cy="7" r="4" />
                      </svg>
                      <span>{isFaceNotCapturedRecord(face) ? getNoFaceReasonLabel(face) : 'No Face Crop Available'}</span>
                    </div>
                    <span className="unrec-detail-photo-badge">
                      {isFaceNotCapturedRecord(face) ? '📸 Person Capture for Review' : '📸 Live Face Crop'}
                    </span>
                  </div>
                  <div className="unrec-detail-photo-caption">
                    <span className="unrec-detail-photo-fname" title={face.photoUrl || ''}>
                      {face.photoUrl || 'unknown_face.jpg'}
                    </span>
                    {faceUrl && (
                      <button
                        type="button"
                        onClick={() => openAuthenticatedMediaInNewTab(faceUrl)}
                        className="unrec-detail-open-link"
                      >
                        <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="2">
                          <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
                          <polyline points="15 3 21 3 21 9" />
                          <line x1="10" y1="14" x2="21" y2="3" />
                        </svg>
                        <span>Open Full Image</span>
                      </button>
                    )}
                    {face.frameMediaKey && <button type="button" className="unrec-detail-open-link" onClick={() => openAuthenticatedMediaInNewTab(face.frameMediaKey)}>Open Full Frame</button>}
                    {face.bodyMediaKey && <button type="button" className="unrec-detail-open-link" onClick={() => openAuthenticatedMediaInNewTab(face.bodyMediaKey)}>Open Body Crop</button>}
                  </div>
                </div>

                {/* Right: Exact Timestamp & Metadata */}
                <div className="unrec-detail-meta-col">
                  {/* Timestamp Card */}
                  <div className="unrec-meta-section timestamp-card">
                    <div className="unrec-meta-sec-title">
                      <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="#10b981" strokeWidth="2.2">
                        <circle cx="12" cy="12" r="10" />
                        <polyline points="12 6 12 12 16 14" />
                      </svg>
                      <span>Capture Timestamp</span>
                    </div>
                    <div className="unrec-timestamp-highlight">
                      <span className="unrec-time-big">
                        {createdDate.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: true })}
                      </span>
                      <span className="unrec-date-big">
                        {createdDate.toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}
                      </span>
                      <span className="unrec-iso-sub">
                        ISO Time: {face.createdAt}
                      </span>
                    </div>
                  </div>

                  {/* Camera Details Card */}
                  <div className="unrec-meta-section camera-card">
                    <div className="unrec-meta-sec-title">
                      <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="#10b981" strokeWidth="2.2">
                        <path d="M23 7l-7 5 7 5V7z" />
                        <rect x="1" y="5" width="15" height="14" rx="2" ry="2" />
                      </svg>
                      <span>Camera & Gate Source</span>
                    </div>
                    <div className="unrec-meta-rows">
                      <div className="unrec-meta-row">
                        <span className="meta-label">Camera Identifier:</span>
                        <span className={`meta-value camera-tag ${camInfo.role === 'IN' ? 'tag-cam-in' : camInfo.role === 'OUT' ? 'tag-cam-out' : 'tag-cam-unknown'}`}>
                          {camInfo.name} ({camInfo.role})
                        </span>
                      </div>
                      <div className="unrec-meta-row">
                        <span className="meta-label">Camera IP Address:</span>
                        <span className="meta-value ip-code">{camInfo.ip}</span>
                      </div>
                      <div className="unrec-meta-row">
                        <span className="meta-label">Gate / Location:</span>
                        <span className="meta-value">{camInfo.location}</span>
                      </div>
                      <div className="unrec-meta-row">
                        <span className="meta-label">Direction Event:</span>
                        <span className={`meta-value direction-pill ${camInfo.role === 'IN' ? 'dir-in' : camInfo.role === 'OUT' ? 'dir-out' : 'dir-unknown'}`}>
                          {camInfo.role === 'IN' ? '↓ Entry (IN)' : camInfo.role === 'OUT' ? '↑ Exit (OUT)' : 'Direction unavailable'}
                        </span>
                      </div>
                    </div>
                  </div>

                  {/* Visitor & Pass Status */}
                  <div className="unrec-meta-section visitor-card">
                    <div className="unrec-meta-sec-title">
                      <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="#10b981" strokeWidth="2.2">
                        <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
                      </svg>
                      <span>Security & Pass Status</span>
                    </div>
                    <div className="unrec-meta-rows">
                      <div className="unrec-meta-row">
                        <span className="meta-label">Visitor Identity:</span>
                        <span className="meta-value font-semibold">
                          {face.personName || 'Unregistered Unknown Visitor'}
                        </span>
                      </div>
                      <div className="unrec-meta-row">
                        <span className="meta-label">12-Hour Pass:</span>
                        <span className={`meta-value unrec-pass-pill ${passVal.status === 'VALID' ? 'pass-valid' : passVal.status === 'EXPIRED' ? 'pass-expired' : 'pass-none'}`}>
                          <span className="pass-dot" />
                          <span>{passVal.label}</span>
                        </span>
                      </div>
                      <div className="unrec-meta-row">
                        <span className="meta-label">Observation Frequency:</span>
                        <span className={`meta-value unrec-count-badge ${count > 3 ? 'count-alert' : 'count-normal'}`}>
                          {count > 3 && '🚨 '}
                          {count} detection(s)
                        </span>
                      </div>
                      {face.reason && (
                        <div className="unrec-meta-row">
                          <span className="meta-label">Purpose / Process:</span>
                          <span className="meta-value">{face.reason}</span>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            </div>
          );
        })()}
      </Modal>


      {/* ── 9B. ENLARGED FACE PHOTO PREVIEW MODAL ─────────────────────── */}
      <Modal
        isOpen={previewModal.isOpen}
        title="Visitor Face Photo Preview"
        onClose={() => setPreviewModal({ isOpen: false, face: null })}
        footer={
          <div style={{ display: 'flex', justifyContent: 'flex-end', width: '100%' }}>
            <button
              type="button"
              className="unrec-modal-close-btn"
              onClick={() => setPreviewModal({ isOpen: false, face: null })}
            >
              Close
            </button>
          </div>
        }
      >
        {previewModal.face && (() => {
          const face = previewModal.face;
          const imgUrl = getFaceImageUrl(face);
          const scans = getFaceScans(face);
          const count = getDetectionCount(face);
          const pass = getPassValidity(face);

          return (
            <div className="unrec-preview-modal-body">
              <div className="unrec-preview-photo-wrap">
                {imgUrl ? (
                  <AuthenticatedMediaImage mediaKey={imgUrl} alt="Captured Face" className="unrec-preview-large-img" />
                ) : (
                  <div className="unrec-preview-large-fallback">
                    <svg viewBox="0 0 24 24" width="48" height="48" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
                      <circle cx="12" cy="7" r="4" />
                    </svg>
                    <span>{isFaceNotCapturedRecord(face) ? getNoFaceReasonLabel(face) : 'No Face Crop'}</span>
                  </div>
                )}
              </div>

              <div className="unrec-preview-details-box" style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                {face.frameMediaKey && <button type="button" className="unrec-detail-open-link" onClick={() => openAuthenticatedMediaInNewTab(face.frameMediaKey)}>Open full frame</button>}
                {face.bodyMediaKey && <button type="button" className="unrec-detail-open-link" onClick={() => openAuthenticatedMediaInNewTab(face.bodyMediaKey)}>Open body crop</button>}
              </div>

              <div className="unrec-preview-details-box">
                <div className="unrec-preview-detail-row">
                  <span className="unrec-preview-label">Visitor Identity</span>
                  <span className="unrec-preview-val">{face.personName || 'Unregistered Visitor'}</span>
                </div>
                <div className="unrec-preview-detail-row">
                  <span className="unrec-preview-label">Camera</span>
                  <span className="unrec-preview-val">{face.camera?.name || 'CAM-01 (OUT)'}</span>
                </div>
                <div className="unrec-preview-detail-row">
                  <span className="unrec-preview-label">First Seen</span>
                  <span className="unrec-preview-val">{new Date(face.createdAt).toLocaleString()}</span>
                </div>
                <div className="unrec-preview-detail-row">
                  <span className="unrec-preview-label">Total Detections</span>
                  <span className="unrec-preview-val badge-val">{count}x recorded</span>
                </div>
                <div className="unrec-preview-detail-row">
                  <span className="unrec-preview-label">Pass Status</span>
                  <span className="unrec-preview-val">{pass.label}</span>
                </div>
              </div>

              <div className="unrec-preview-actions">
                <button
                  type="button"
                  className="unrec-preview-btn-scans"
                  onClick={() => {
                    const target = previewModal.face;
                    setPreviewModal({ isOpen: false, face: null });
                    setScanLogsModal({ isOpen: true, face: target });
                  }}
                >
                  View All {scans.length} Scans
                </button>
                {face.status === 'UNREGISTERED' || face.status === 'UNASSIGNED' ? (
                  <button
                    type="button"
                    className="unrec-preview-btn-pass"
                    onClick={() => {
                      const target = previewModal.face;
                      setPreviewModal({ isOpen: false, face: null });
                      openEditPassModal(target);
                    }}
                  >
                    Issue 12-Hour Pass
                  </button>
                ) : (
                  <button
                    type="button"
                    className="unrec-preview-btn-pass"
                    onClick={() => {
                      const target = previewModal.face;
                      setPreviewModal({ isOpen: false, face: null });
                      openOutTimeModal(target);
                    }}
                  >
                    Check Out Visitor
                  </button>
                )}
              </div>
            </div>
          );
        })()}
      </Modal>

      {/* ── 10. CAMERA SCAN & IN/OUT MOVEMENTS LOGS MODAL ───────── */}
      <Modal
        isOpen={scanLogsModal.isOpen}
        title={`Movement & Scan History — ${scanLogsModal.face?.personName || 'Unregistered Visitor'}`}
        onClose={() => setScanLogsModal({ isOpen: false, face: null })}
        className="scan-modal-dialog modal-lg"
        footer={
          <div style={{ display: 'flex', justifyContent: 'space-between', width: '100%', alignItems: 'center' }}>
            <button
              type="button"
              className="unrec-modal-close-btn"
              onClick={() => setScanLogsModal({ isOpen: false, face: null })}
            >
              Close
            </button>
            {scanLogsModal.face && (scanLogsModal.face.status === 'UNREGISTERED' || scanLogsModal.face.status === 'UNASSIGNED') && (
              <button
                type="button"
                className="unrec-modal-primary-btn"
                onClick={() => {
                  const target = scanLogsModal.face;
                  setScanLogsModal({ isOpen: false, face: null });
                  openEditPassModal(target);
                }}
              >
                Issue Visitor Pass
              </button>
            )}
          </div>
        }
      >
        {scanLogsModal.face && (() => {
          const face = scanLogsModal.face;
          const scans = getFaceScans(face);
          const count = getDetectionCount(face);
          const faceImg = getFaceImageUrl(face);

          return (
            <div className="unrec-scan-modal-container">
              {/* Header Summary Banner */}
              <div className="unrec-scan-summary-banner">
                <div className="unrec-scan-summary-left">
                  <div className="unrec-scan-summary-avatar">
                    {faceImg ? (
                      <AuthenticatedMediaImage mediaKey={faceImg} alt="Face" />
                    ) : (
                      <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor">
                        <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
                        <circle cx="12" cy="7" r="4" />
                      </svg>
                    )}
                  </div>
                  <div className="unrec-scan-summary-meta">
                    <div className="unrec-scan-summary-name">
                      {face.personName || 'Unregistered Visitor'}
                    </div>
                    <div className="unrec-scan-summary-sub">
                      Latest Camera: {face.camera?.name || 'CAM-01 (OUT)'} • {face.camera?.location || 'Main Gate'}
                    </div>
                  </div>
                </div>

                {/* 3 Prominent Stat Boxes: Total, IN, OUT */}
                <div className="unrec-scan-stats-grid">
                  <div className="unrec-scan-stat-box box-total">
                    <span className="unrec-scan-stat-label">TOTAL VISITS</span>
                    <span className="unrec-scan-stat-num">{count}x</span>
                    <span className="unrec-scan-stat-hint">Consolidated Face</span>
                  </div>
                  <div className="unrec-scan-stat-box box-in">
                    <span className="unrec-scan-stat-label">ENTRIES (IN)</span>
                    <span className="unrec-scan-stat-num in-green">↓ {getInCount(face)}</span>
                    <span className="unrec-scan-stat-hint">CAM-02 (Entry Gate)</span>
                  </div>
                  <div className="unrec-scan-stat-box box-out">
                    <span className="unrec-scan-stat-label">EXITS (OUT)</span>
                    <span className="unrec-scan-stat-num out-blue">↑ {getOutCount(face)}</span>
                    <span className="unrec-scan-stat-hint">CAM-01 (Exit Gate)</span>
                  </div>
                </div>
              </div>

              {/* Table of Scans with Direction Badges */}
              <div className="unrec-scan-table-wrap">
                <table className="unrec-scan-table">
                  <thead>
                    <tr>
                      <th style={{ width: '45px', textAlign: 'center' }}>#</th>
                      <th style={{ width: '70px', textAlign: 'center' }}>Face</th>
                      <th>Date</th>
                      <th>Time</th>
                      <th>Camera / Location</th>
                      <th style={{ textAlign: 'center', width: '130px' }}>Direction</th>
                      <th style={{ textAlign: 'center', width: '100px' }}>Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {scans.map((scan, sIdx) => {
                      const scanImg = scan.facePassportMediaKey || faceImg;

                      const sCam = scan.camera || face.camera?.name || 'CAM-01 (OUT)';
                      const isScanIN = scan.direction === 'IN' || sCam.includes('02') || sCam.includes('IN');

                      return (
                        <tr key={sIdx}>
                          <td style={{ textAlign: 'center' }}>
                            <span className="unrec-scan-idx">{sIdx + 1}</span>
                          </td>
                          <td style={{ textAlign: 'center' }}>
                            <div className="unrec-scan-thumb">
                              {scanImg ? (
                                <AuthenticatedMediaImage mediaKey={scanImg} alt="Scan" />
                              ) : null}
                            </div>
                          </td>
                          <td>
                            <span className="unrec-scan-date">
                              {new Date(scan.timestamp || face.createdAt).toLocaleDateString([], {
                                month: 'short',
                                day: 'numeric',
                                year: 'numeric',
                              })}
                            </span>
                          </td>
                          <td>
                            <span className="unrec-scan-time">
                              {new Date(scan.timestamp || face.createdAt).toLocaleTimeString([], {
                                hour: '2-digit',
                                minute: '2-digit',
                                second: '2-digit',
                              })}
                            </span>
                          </td>
                          <td>
                            <div className="unrec-scan-cam-cell">
                              <span className="unrec-scan-cam-name">
                                {sCam}
                              </span>
                              <span className="unrec-scan-cam-loc">
                                {scan.location || face.camera?.location || 'Main Gate'}
                              </span>
                            </div>
                          </td>
                          <td style={{ textAlign: 'center' }}>
                            <span className={`unrec-scan-direction-pill ${isScanIN ? 'pill-dir-in' : 'pill-dir-out'}`}>
                              {isScanIN ? '↓ ENTRY (IN)' : '↑ EXIT (OUT)'}
                            </span>
                          </td>
                          <td style={{ textAlign: 'center' }}>
                            <span className="unrec-scan-status-tag">
                              DETECTED
                            </span>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          );
        })()}
      </Modal>

      {/* ── 9. SCOPED MODERN CSS ───────────────────────────────────────── */}
      <style>{`
        .unrecognized-faces-page {
          width: 100%;
          padding: 24px 28px 48px;
          color: #0f172a;
          box-sizing: border-box;
          background: #f4fbf7;
          min-height: calc(100vh - 70px);
        }

        /* ── Floating Notification Toast ── */
        .unrec-floating-toast {
          position: fixed;
          top: 80px;
          right: 28px;
          z-index: 9999;
          display: flex;
          align-items: center;
          gap: 12px;
          background: #ffffff;
          border: 1px solid #bbf7d0;
          border-left: 4px solid #10b981;
          border-radius: 12px;
          padding: 12px 18px;
          box-shadow: 0 10px 28px rgba(16, 185, 129, 0.2);
          animation: toastSlideIn 0.3s cubic-bezier(0.16, 1, 0.3, 1);
          max-width: 480px;
        }

        .unrec-toast-icon {
          font-size: 20px;
          flex-shrink: 0;
        }

        .unrec-toast-msg {
          font-size: 13.5px;
          font-weight: 600;
          color: #065f46;
          line-height: 1.4;
          flex: 1;
        }

        .unrec-toast-dismiss {
          background: none;
          border: none;
          color: #64748b;
          font-size: 16px;
          cursor: pointer;
          padding: 2px 4px;
          margin-left: 6px;
          line-height: 1;
        }

        .unrec-toast-dismiss:hover {
          color: #0f172a;
        }

        .dark .unrec-floating-toast,
        [data-theme="dark"] .unrec-floating-toast {
          background: #151936 !important;
          border-color: rgba(16, 185, 129, 0.35) !important;
          border-left-color: #10b981 !important;
          box-shadow: 0 10px 28px rgba(0, 0, 0, 0.45) !important;
        }

        .dark .unrec-toast-msg,
        [data-theme="dark"] .unrec-toast-msg {
          color: #34d399 !important;
        }

        /* ── Header ── */
        .unrec-header-row {
          display: flex;
          align-items: center;
          justify-content: space-between;
          margin-bottom: 22px;
          flex-wrap: wrap;
          gap: 16px;
        }

        .unrec-header-left {
          display: flex;
          align-items: center;
          gap: 16px;
        }

        .unrec-icon-box {
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

        .unrec-header-text {
          display: flex;
          flex-direction: column;
        }

        .unrec-title {
          font-size: 26px;
          font-weight: 800;
          color: #0f172a;
          letter-spacing: -0.01em;
          margin: 0 0 4px 0;
          line-height: 1.2;
        }

        .unrec-subtitle {
          font-size: 14px;
          color: #475569;
          margin: 0;
          font-weight: 500;
        }

        .unrec-header-actions {
          display: flex;
          align-items: center;
          gap: 10px;
          flex-wrap: wrap;
        }

        .unrec-btn-alarm-toggle {
          height: 40px;
          padding: 0 14px;
          border-radius: 8px;
          font-size: 13px;
          font-weight: 700;
          display: inline-flex;
          align-items: center;
          gap: 6px;
          cursor: pointer;
          transition: all 0.2s ease;
          border: 1px solid #bbf7d0;
          background: #f0fdf4;
          color: #059669;
          box-shadow: 0 1px 3px rgba(0, 0, 0, 0.03);
        }

        .unrec-btn-alarm-toggle.muted {
          border-color: #e2e8f0;
          background: #f8fafc;
          color: #64748b;
        }

        .unrec-btn-alarm-toggle:hover {
          filter: brightness(0.97);
        }

        .unrec-btn-alarm-test {
          height: 40px;
          padding: 0 16px;
          border-radius: 8px;
          font-size: 13px;
          font-weight: 700;
          display: inline-flex;
          align-items: center;
          gap: 6px;
          cursor: pointer;
          transition: all 0.2s ease;
          border: 1px solid #fecaca;
          background: #fef2f2;
          color: #dc2626;
          box-shadow: 0 1px 3px rgba(220, 38, 38, 0.12);
        }

        .unrec-btn-alarm-test:hover {
          background: #fee2e2;
          border-color: #fca5a5;
          transform: translateY(-1px);
        }

        .unrec-btn-refresh {
          height: 40px;
          padding: 0 18px;
          border-radius: 8px;
          border: 1px solid #e2e8f0;
          background: #ffffff;
          color: #334155;
          font-size: 13px;
          font-weight: 600;
          display: inline-flex;
          align-items: center;
          gap: 8px;
          cursor: pointer;
          transition: all 0.2s ease;
          box-shadow: 0 1px 3px rgba(0, 0, 0, 0.03);
        }

        .unrec-btn-refresh:hover:not(:disabled) {
          background: #f8fafc;
          border-color: #cbd5e1;
        }

        /* ── Prominent Live Security Alarm Banner ── */
        .unrec-live-alarm-banner {
          display: flex;
          align-items: center;
          justify-content: space-between;
          background: linear-gradient(135deg, #fff5f5 0%, #ffffff 100%);
          border: 2px solid #ef4444;
          border-radius: 16px;
          padding: 16px 20px;
          margin-bottom: 22px;
          gap: 16px;
          box-shadow: 0 12px 36px rgba(239, 68, 68, 0.22), 0 0 0 3px rgba(239, 68, 68, 0.12);
          animation: alarmBannerPulse 1.6s infinite alternate ease-in-out;
        }

        @keyframes alarmBannerPulse {
          0% {
            border-color: #f87171;
            box-shadow: 0 8px 24px rgba(239, 68, 68, 0.18), 0 0 0 2px rgba(239, 68, 68, 0.1);
          }
          100% {
            border-color: #dc2626;
            box-shadow: 0 14px 40px rgba(239, 68, 68, 0.32), 0 0 0 5px rgba(239, 68, 68, 0.22);
          }
        }

        .unrec-alarm-banner-left {
          display: flex;
          align-items: center;
          gap: 16px;
          flex: 1;
          min-width: 0;
        }

        .unrec-alarm-siren-beacon {
          position: relative;
          width: 50px;
          height: 50px;
          border-radius: 14px;
          background: #fee2e2;
          display: flex;
          align-items: center;
          justify-content: center;
          flex-shrink: 0;
        }

        .unrec-alarm-beacon-pulse {
          position: absolute;
          width: 46px;
          height: 46px;
          border-radius: 14px;
          background: rgba(239, 68, 68, 0.35);
          animation: beaconRipple 1.4s infinite ease-out;
        }

        @keyframes beaconRipple {
          0% { transform: scale(0.9); opacity: 0.9; }
          100% { transform: scale(1.6); opacity: 0; }
        }

        .unrec-alarm-beacon-icon {
          font-size: 24px;
          position: relative;
          z-index: 1;
        }

        .unrec-alarm-info {
          display: flex;
          flex-direction: column;
          gap: 3px;
          min-width: 0;
        }

        .unrec-alarm-badge-row {
          display: flex;
          align-items: center;
          gap: 8px;
          flex-wrap: wrap;
        }

        .unrec-alarm-live-badge {
          background: #dc2626;
          color: #ffffff;
          font-size: 10px;
          font-weight: 800;
          letter-spacing: 0.5px;
          padding: 2px 7px;
          border-radius: 4px;
        }

        .unrec-alarm-gate-badge {
          background: #fef2f2;
          color: #b91c1c;
          border: 1px solid #fecaca;
          font-size: 11px;
          font-weight: 700;
          padding: 2px 8px;
          border-radius: 6px;
        }

        .unrec-alarm-time-tag {
          font-size: 11px;
          color: #94a3b8;
          font-weight: 600;
        }

        .unrec-alarm-headline {
          font-size: 16px;
          font-weight: 800;
          color: #991b1b;
          margin: 0;
          line-height: 1.3;
        }

        .unrec-alarm-description {
          font-size: 12.5px;
          color: #64748b;
          margin: 0;
        }

        .unrec-alarm-banner-right {
          display: flex;
          align-items: center;
          gap: 12px;
          flex-shrink: 0;
        }

        .unrec-alarm-snapshot {
          width: 52px;
          height: 52px;
          border-radius: 12px;
          object-fit: cover;
          border: 2px solid #ef4444;
          cursor: pointer;
          box-shadow: 0 4px 12px rgba(239, 68, 68, 0.25);
          transition: transform 0.15s ease;
        }

        .unrec-alarm-snapshot:hover {
          transform: scale(1.06);
        }

        .unrec-alarm-action-group {
          display: flex;
          align-items: center;
          gap: 8px;
        }

        .unrec-alarm-silence-btn {
          height: 38px;
          padding: 0 14px;
          border-radius: 8px;
          border: 1px solid #cbd5e1;
          background: #ffffff;
          color: #475569;
          font-size: 12px;
          font-weight: 700;
          cursor: pointer;
          transition: all 0.15s ease;
          white-space: nowrap;
        }

        .unrec-alarm-silence-btn:hover {
          background: #f1f5f9;
          color: #0f172a;
        }

        .unrec-alarm-inspect-btn {
          height: 38px;
          padding: 0 16px;
          border-radius: 8px;
          border: none;
          background: #dc2626;
          color: #ffffff;
          font-size: 12px;
          font-weight: 700;
          cursor: pointer;
          transition: all 0.15s ease;
          white-space: nowrap;
          box-shadow: 0 4px 12px rgba(220, 38, 38, 0.3);
        }

        .unrec-alarm-inspect-btn:hover {
          background: #b91c1c;
          transform: translateY(-1px);
        }

        /* ── Newly Registered Face Table Row Highlight ── */
        .unrec-row-just-detected td,
        .unrec-crossing-alarm-row td {
          background-color: #fff1f2 !important;
          border-top: 1px solid #fecaca !important;
          border-bottom: 1px solid #fecaca !important;
        }

        .unrec-row-just-detected td:first-child,
        .unrec-crossing-alarm-row td:first-child {
          border-left: 4px solid #ef4444 !important;
        }

        .unrec-just-detected-pill {
          display: inline-block;
          font-size: 9px;
          font-weight: 800;
          color: #ffffff;
          background: #ef4444;
          padding: 2px 6px;
          border-radius: 4px;
          margin-bottom: 3px;
          letter-spacing: 0.3px;
          animation: badgePulse 1.6s infinite;
        }

        /* ── 4 Executive Stat Cards ── */
        .unrec-stat-cards-grid {
          display: grid;
          grid-template-columns: repeat(4, 1fr);
          gap: 16px;
          margin-bottom: 22px;
        }

        .unrec-stat-card {
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

        .unrec-stat-card:hover {
          border-color: #10b981;
          box-shadow: 0 4px 12px rgba(5, 150, 105, 0.06);
          transform: translateY(-1px);
        }

        .unrec-stat-card-top {
          display: flex;
          align-items: flex-start;
          gap: 14px;
        }

        .unrec-stat-icon-wrap {
          width: 46px;
          height: 46px;
          border-radius: 12px;
          display: flex;
          align-items: center;
          justify-content: center;
          flex-shrink: 0;
        }

        .icon-mint {
          background: #d1fae5;
        }

        .icon-amber {
          background: #fef3c7;
        }

        .icon-blue {
          background: #dbeafe;
        }

        .icon-purple {
          background: #fce7f3;
        }

        .unrec-stat-card-meta {
          flex: 1;
        }

        .unrec-stat-label {
          font-size: 11px;
          font-weight: 700;
          letter-spacing: 0.05em;
          color: #64748b;
          text-transform: uppercase;
          display: block;
        }

        .unrec-stat-value-row {
          margin-top: 4px;
        }

        .unrec-stat-number {
          font-size: 28px;
          font-weight: 800;
          color: #0f172a;
          line-height: 1.1;
          display: block;
        }

        .unrec-stat-trend {
          display: inline-flex;
          align-items: center;
          gap: 4px;
          font-size: 11.5px;
          font-weight: 700;
          margin-top: 8px;
        }

        .trend-green {
          color: #059669;
        }

        .trend-vs {
          color: #94a3b8;
          font-weight: 500;
          margin-left: 2px;
        }

        .unrec-stat-wave-wrap {
          width: 105px;
          height: 34px;
          position: absolute;
          right: -8px;
          bottom: -4px;
          z-index: 1;
          pointer-events: none;
        }

        .unrec-stat-wave-svg {
          width: 100%;
          height: 100%;
        }

        /* ── Search & Filter Controls Bar ── */
        .unrec-search-filter-bar {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 14px;
          margin-bottom: 20px;
          flex-wrap: wrap;
        }

        .unrec-search-input-wrap {
          background: #ffffff;
          border: 1px solid #e2e8f0;
          border-radius: 10px;
          padding: 8px 14px;
          display: flex;
          align-items: center;
          gap: 10px;
          flex: 1;
          max-width: 460px;
          min-width: 260px;
          box-shadow: 0 1px 2px rgba(0, 0, 0, 0.02);
        }

        .unrec-search-field {
          background: transparent;
          border: none;
          outline: none;
          font-size: 13px;
          color: #0f172a;
          width: 100%;
        }

        .unrec-search-field::placeholder {
          color: #94a3b8;
        }

        .unrec-search-clear-btn {
          background: none;
          border: none;
          color: #94a3b8;
          cursor: pointer;
          display: flex;
          align-items: center;
        }

        .unrec-filter-actions-group {
          display: flex;
          align-items: center;
          gap: 10px;
          flex-wrap: wrap;
        }

        .unrec-dropdown-relative {
          position: relative;
        }

        .unrec-filter-dropdown-btn {
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

        .unrec-filter-dropdown-btn:hover {
          background: #f8fafc;
        }

        .unrec-filter-dropdown-btn.active-filter {
          border-color: #10b981;
          background: #f0fdf4;
          color: #065f46;
          font-weight: 700;
        }

        .unrec-btn-reset-filters {
          display: inline-flex;
          align-items: center;
          gap: 6px;
          height: 38px;
          padding: 0 14px;
          border-radius: 8px;
          font-size: 12.5px;
          font-weight: 700;
          background: #fef2f2;
          border: 1px solid #fecaca;
          color: #dc2626;
          cursor: pointer;
          transition: all 0.2s ease;
        }

        .unrec-btn-reset-filters:hover {
          background: #fee2e2;
          border-color: #fca5a5;
          transform: translateY(-1px);
        }

        .unrec-dropdown-menu {
          position: absolute;
          top: calc(100% + 6px);
          left: 0;
          min-width: 175px;
          background: #ffffff;
          border: 1px solid #e2e8f0;
          border-radius: 8px;
          box-shadow: 0 10px 25px rgba(0, 0, 0, 0.08);
          padding: 6px;
          z-index: 50;
        }

        .unrec-dropdown-item {
          padding: 8px 12px;
          font-size: 12.5px;
          color: #334155;
          border-radius: 6px;
          cursor: pointer;
        }

        .unrec-dropdown-item:hover {
          background: #f1f5f9;
        }

        .unrec-dropdown-item.selected {
          background: #ecfdf5;
          color: #059669;
          font-weight: 700;
        }

        .unrec-btn-export {
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

        .unrec-btn-export:hover {
          opacity: 0.95;
          transform: translateY(-1px);
        }

        .unrec-btn-bulk-delete {
          height: 38px;
          padding: 0 16px;
          border-radius: 8px;
          background: linear-gradient(135deg, #ef4444 0%, #dc2626 100%);
          color: #ffffff;
          border: none;
          font-size: 13px;
          font-weight: 700;
          display: inline-flex;
          align-items: center;
          gap: 8px;
          cursor: pointer;
          transition: all 0.2s ease;
          box-shadow: 0 3px 8px rgba(239, 68, 68, 0.25);
        }

        .unrec-btn-bulk-delete:hover {
          opacity: 0.95;
          transform: translateY(-1px);
          box-shadow: 0 4px 12px rgba(239, 68, 68, 0.35);
        }

        .unrec-selection-banner {
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding: 10px 16px;
          background: #ecfdf5;
          border: 1px solid #a7f3d0;
          border-radius: 10px;
          margin-bottom: 14px;
          font-size: 13px;
          color: #065f46;
        }

        .unrec-selection-info {
          display: flex;
          align-items: center;
          gap: 8px;
          font-weight: 600;
        }

        .unrec-selection-actions {
          display: flex;
          align-items: center;
          gap: 12px;
        }

        .unrec-btn-deselect {
          background: none;
          border: none;
          color: #059669;
          font-size: 12.5px;
          font-weight: 700;
          cursor: pointer;
          text-decoration: underline;
        }

        .unrec-btn-bulk-delete-sm {
          height: 30px;
          padding: 0 12px;
          border-radius: 6px;
          background: #ef4444;
          color: #ffffff;
          border: none;
          font-size: 12px;
          font-weight: 700;
          display: inline-flex;
          align-items: center;
          gap: 6px;
          cursor: pointer;
          box-shadow: 0 2px 6px rgba(239, 68, 68, 0.25);
          transition: all 0.15s ease;
        }

        .unrec-btn-bulk-delete-sm:hover {
          background: #dc2626;
        }

        .unrec-checkbox {
          width: 16px;
          height: 16px;
          accent-color: #059669;
          cursor: pointer;
          border-radius: 4px;
          vertical-align: middle;
        }

        .unrec-table-row.selected-row td {
          background-color: #f0fdf4 !important;
        }

        /* ── Main Table Card & Mobile Cards ── */
        .unrec-mobile-cards {
          display: none;
        }

        .unrec-table-card {
          background: #ffffff;
          border: 1px solid #e2ece8;
          border-radius: 18px;
          padding: 16px 20px 20px;
          box-shadow: 0 1px 4px rgba(0, 0, 0, 0.02);
          margin-bottom: 24px;
        }

        .unrec-custom-table {
          width: 100%;
          border-collapse: separate;
          border-spacing: 0;
          text-align: left;
        }

        .unrec-custom-table th {
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

        .unrec-custom-table th:first-child {
          border-top-left-radius: 12px;
          border-bottom-left-radius: 12px;
        }

        .unrec-custom-table th:last-child {
          border-top-right-radius: 12px;
          border-bottom-right-radius: 12px;
        }

        .unrec-th-content {
          display: inline-flex;
          align-items: center;
          gap: 6px;
        }

        .sort-arrows {
          flex-shrink: 0;
        }

        .unrec-custom-table td {
          padding: 13px 14px;
          font-size: 13px;
          color: #0f172a;
          border-bottom: 1px solid #f1f5f9;
          vertical-align: middle;
        }

        .unrec-custom-table tr:hover td {
          background-color: #f8fafc;
        }

        .unrec-idx-text {
          font-size: 12px;
          font-weight: 600;
          color: #64748b;
        }

        .unrec-time-cell {
          display: flex;
          flex-direction: column;
        }

        .time-val {
          font-weight: 700;
          color: #0f172a;
          font-size: 13px;
        }

        .date-val {
          font-size: 11px;
          color: #64748b;
        }

        .unrec-cam-pill {
          display: inline-block;
          padding: 3px 8px;
          border-radius: 6px;
          background: #ecfdf5;
          color: #047857;
          font-size: 11.5px;
          font-weight: 600;
        }

        .unrec-location-text {
          color: #475569;
          font-size: 12.5px;
        }

        .unrec-type-badge {
          display: inline-block;
          padding: 3px 8px;
          border-radius: 6px;
          background: #f1f5f9;
          color: #334155;
          font-size: 12px;
          font-weight: 500;
        }

        .unrec-pass-pill {
          display: inline-flex;
          align-items: center;
          gap: 5px;
          padding: 3px 9px;
          border-radius: 9999px;
          font-size: 11px;
          font-weight: 700;
        }

        .pass-dot {
          width: 5px;
          height: 5px;
          border-radius: 50%;
        }

        .pass-valid {
          background: #dcfce7;
          color: #15803d;
        }
        .pass-valid .pass-dot {
          background: #16a34a;
        }

        .pass-expired {
          background: #fee2e2;
          color: #dc2626;
        }
        .pass-expired .pass-dot {
          background: #ef4444;
        }

        .pass-none {
          background: #f1f5f9;
          color: #64748b;
        }
        .pass-none .pass-dot {
          background: #94a3b8;
        }

        .unrec-count-badge {
          font-weight: 700;
          font-size: 12px;
          padding: 2px 7px;
          border-radius: 6px;
        }

        .count-normal {
          background: #f1f5f9;
          color: #334155;
        }

        .count-alert {
          background: #fee2e2;
          color: #dc2626;
          border: 1px solid #fecaca;
        }

        .unrec-actions-group {
          display: inline-flex;
          align-items: center;
          gap: 6px;
        }

        .unrec-action-issue {
          height: 28px;
          padding: 0 10px;
          border-radius: 6px;
          background: #059669;
          color: #ffffff;
          border: none;
          font-size: 11.5px;
          font-weight: 700;
          cursor: pointer;
        }

        .unrec-action-out {
          height: 28px;
          padding: 0 10px;
          border-radius: 6px;
          background: #fef3c7;
          color: #d97706;
          border: 1px solid #fde68a;
          font-size: 11.5px;
          font-weight: 700;
          cursor: pointer;
        }

        .unrec-action-del {
          width: 28px;
          height: 28px;
          border-radius: 6px;
          background: #ffffff;
          border: 1px solid #e2e8f0;
          color: #ef4444;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          cursor: pointer;
        }

        /* ── Face & Timestamp Detail Modal ── */
        .modal-content.unrec-inspector-modal {
          max-width: 780px;
          width: 96%;
        }

        .unrec-detail-container {
          display: flex;
          flex-direction: column;
          gap: 16px;
          width: 100%;
        }

        .unrec-detail-alert-box {
          display: flex;
          align-items: center;
          gap: 14px;
          padding: 12px 16px;
          border-radius: 12px;
          background: #fef2f2;
          border: 1px solid #fecaca;
          color: #991b1b;
          font-size: 13px;
        }

        .unrec-detail-alert-box strong {
          display: block;
          font-size: 13.5px;
          margin-bottom: 2px;
          color: #b91c1c;
        }

        .unrec-detail-alert-box p {
          margin: 0;
          color: #7f1d1d;
          font-size: 12.5px;
        }

        .unrec-detail-body-grid {
          display: grid;
          grid-template-columns: 280px 1fr;
          gap: 20px;
          align-items: start;
        }

        @media (max-width: 680px) {
          .unrec-detail-body-grid {
            grid-template-columns: 1fr;
          }
        }

        .unrec-detail-photo-card {
          display: flex;
          flex-direction: column;
          gap: 10px;
        }

        .unrec-detail-photo-frame {
          position: relative;
          width: 100%;
          aspect-ratio: 3.5 / 4.5;
          height: auto;
          max-height: 420px;
          border-radius: 14px;
          overflow: hidden;
          background: #090d16;
          border: 2px solid #10b981;
          box-shadow: 0 4px 16px rgba(16, 185, 129, 0.25);
          display: flex;
          align-items: center;
          justify-content: center;
        }

        .unrec-detail-photo-img {
          width: 100%;
          height: 100%;
          object-fit: cover;
          display: block;
          transition: transform 0.2s ease;
        }

        .unrec-detail-photo-frame:hover .unrec-detail-photo-img {
          transform: scale(1.04);
        }

        .unrec-detail-photo-placeholder {
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          gap: 8px;
          color: #94a3b8;
          font-size: 12px;
          text-align: center;
          padding: 10px;
        }

        .unrec-detail-photo-badge {
          position: absolute;
          top: 8px;
          left: 8px;
          background: rgba(15, 23, 42, 0.82);
          backdrop-filter: blur(4px);
          color: #34d399;
          font-size: 10.5px;
          font-weight: 700;
          padding: 3px 8px;
          border-radius: 6px;
          border: 1px solid rgba(52, 211, 153, 0.4);
        }

        .unrec-detail-photo-caption {
          display: flex;
          flex-direction: column;
          gap: 4px;
        }

        .unrec-detail-photo-fname {
          font-size: 11px;
          color: #64748b;
          font-family: monospace;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }

        .unrec-detail-open-link {
          font-size: 12px;
          color: #059669;
          font-weight: 600;
          display: inline-flex;
          align-items: center;
          gap: 5px;
          text-decoration: none;
        }

        .unrec-detail-open-link:hover {
          text-decoration: underline;
        }

        .unrec-detail-meta-col {
          display: flex;
          flex-direction: column;
          gap: 12px;
        }

        .unrec-meta-section {
          background: #f8fafc;
          border: 1px solid #e2e8f0;
          border-radius: 12px;
          padding: 12px 14px;
        }

        .unrec-meta-section.timestamp-card {
          background: #ecfdf5;
          border-color: #a7f3d0;
        }

        .unrec-meta-sec-title {
          display: flex;
          align-items: center;
          gap: 7px;
          font-size: 12px;
          font-weight: 700;
          color: #065f46;
          text-transform: uppercase;
          letter-spacing: 0.03em;
          margin-bottom: 8px;
        }

        .unrec-timestamp-highlight {
          display: flex;
          flex-direction: column;
          gap: 3px;
        }

        .unrec-time-big {
          font-size: 22px;
          font-weight: 800;
          color: #064e3b;
          letter-spacing: -0.01em;
          line-height: 1.1;
        }

        .unrec-date-big {
          font-size: 13.5px;
          font-weight: 600;
          color: #047857;
        }

        .unrec-iso-sub {
          font-size: 10.5px;
          color: #64748b;
          font-family: monospace;
          margin-top: 2px;
        }

        .unrec-meta-rows {
          display: flex;
          flex-direction: column;
          gap: 7px;
        }

        .unrec-meta-row {
          display: flex;
          align-items: center;
          justify-content: space-between;
          font-size: 12.5px;
        }

        .meta-label {
          color: #64748b;
          font-weight: 500;
        }

        .meta-value {
          color: #0f172a;
          font-weight: 600;
          text-align: right;
        }

        .meta-value.camera-tag {
          padding: 2px 8px;
          border-radius: 6px;
          font-size: 11.5px;
          font-weight: 700;
        }

        .tag-cam-in {
          background: #dcfce7;
          color: #15803d;
          border: 1px solid #bbf7d0;
        }

        .tag-cam-out {
          background: #ffedd5;
          color: #c2410c;
          border: 1px solid #fed7aa;
        }

        .tag-cam-unknown {
          background: #f1f5f9;
          color: #475569;
          border: 1px solid #cbd5e1;
        }

        .meta-value.ip-code {
          font-family: monospace;
          font-size: 12px;
          background: #ffffff;
          padding: 1px 6px;
          border-radius: 4px;
          border: 1px solid #cbd5e1;
        }

        .direction-pill {
          padding: 2px 7px;
          border-radius: 6px;
          font-size: 11.5px;
          font-weight: 700;
        }

        .dir-in {
          background: #dcfce7;
          color: #166534;
        }

        .dir-out {
          background: #fee2e2;
          color: #991b1b;
        }

        .dir-unknown {
          background: #e2e8f0;
          color: #475569;
        }

        .unrec-modal-close-btn {
          height: 36px;
          padding: 0 16px;
          border-radius: 8px;
          border: 1px solid #cbd5e1;
          background: #ffffff;
          color: #475569;
          font-size: 13px;
          font-weight: 600;
          cursor: pointer;
        }

        .unrec-modal-close-btn:hover {
          background: #f8fafc;
        }

        .unrec-modal-primary-btn {
          height: 36px;
          padding: 0 16px;
          border-radius: 8px;
          border: none;
          background: linear-gradient(135deg, #059669 0%, #10b981 100%);
          color: #ffffff;
          font-size: 13px;
          font-weight: 700;
          display: inline-flex;
          align-items: center;
          gap: 6px;
          cursor: pointer;
          box-shadow: 0 2px 6px rgba(16, 185, 129, 0.25);
        }

        .unrec-modal-primary-btn:hover {
          opacity: 0.95;
        }

        .unrec-modal-amber-btn {
          height: 36px;
          padding: 0 16px;
          border-radius: 8px;
          border: 1px solid #fde68a;
          background: #fef3c7;
          color: #b45309;
          font-size: 13px;
          font-weight: 700;
          cursor: pointer;
        }

        /* ── Empty State ── */
        .unrec-empty-wrap {
          padding: 60px 20px 70px;
          display: flex;
          flex-direction: column;
          align-items: center;
          text-align: center;
        }

        .unrec-empty-icon {
          margin-bottom: 16px;
          display: flex;
          align-items: center;
          justify-content: center;
        }

        .unrec-empty-title {
          font-size: 17px;
          font-weight: 800;
          color: #0f172a;
          margin: 0 0 6px 0;
        }

        .unrec-empty-desc {
          font-size: 13px;
          color: #64748b;
          max-width: 500px;
          margin: 0 0 22px 0;
        }

        .unrec-empty-cta-btn {
          height: 38px;
          padding: 0 18px;
          border-radius: 8px;
          background: #ecfdf5;
          color: #065f46;
          border: 1px solid #a7f3d0;
          font-size: 13px;
          font-weight: 700;
          display: inline-flex;
          align-items: center;
          gap: 8px;
          cursor: pointer;
          transition: all 0.2s ease;
        }

        .unrec-empty-cta-btn:hover {
          background: #d1fae5;
          transform: translateY(-1px);
        }

        /* ── Table Footer ── */
        .unrec-table-footer {
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding-top: 18px;
          border-top: 1px solid #f1f5f9;
          margin-top: 6px;
          gap: 16px;
          flex-wrap: wrap;
        }

        .unrec-footer-left {
          display: flex;
          align-items: center;
          gap: 20px;
          flex-wrap: wrap;
        }

        .unrec-footer-count {
          font-size: 12.5px;
          color: #64748b;
          font-weight: 500;
        }

        .unrec-page-size-selector {
          display: inline-flex;
          align-items: center;
          gap: 8px;
          font-size: 12.5px;
          color: #64748b;
          font-weight: 500;
        }

        .unrec-select-pagesize {
          height: 32px;
          padding: 0 10px;
          border-radius: 8px;
          border: 1px solid #e2e8f0;
          background: #ffffff;
          color: #334155;
          font-size: 12.5px;
          font-weight: 600;
          cursor: pointer;
          outline: none;
          transition: all 0.15s ease;
        }

        .unrec-select-pagesize:focus {
          border-color: #10b981;
          box-shadow: 0 0 0 2px rgba(16, 185, 129, 0.15);
        }

        .unrec-pagination {
          display: flex;
          align-items: center;
          gap: 6px;
        }

        .unrec-page-arrow {
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

        .unrec-page-arrow:not(:disabled):hover {
          background: #f8fafc;
          border-color: #cbd5e1;
          color: #059669;
          transform: translateY(-1px);
        }

        .unrec-page-arrow:disabled {
          opacity: 0.35;
          cursor: not-allowed;
          color: #cbd5e1;
          border-color: #f1f5f9;
        }

        .unrec-page-num {
          min-width: 32px;
          height: 32px;
          padding: 0 6px;
          border-radius: 8px;
          border: 1px solid #e2e8f0;
          font-size: 12.5px;
          font-weight: 700;
          cursor: pointer;
          display: flex;
          align-items: center;
          justify-content: center;
          background: #ffffff;
          color: #334155;
          transition: all 0.15s ease;
        }

        .unrec-page-num:not(.active):hover {
          background: #ecfdf5;
          border-color: #a7f3d0;
          color: #047857;
        }

        .unrec-page-num.active {
          background: #059669;
          border-color: #059669;
          color: #ffffff;
          box-shadow: 0 2px 4px rgba(5, 150, 105, 0.25);
        }

        .unrec-page-ellipsis {
          display: flex;
          align-items: center;
          justify-content: center;
          min-width: 28px;
          height: 32px;
          font-size: 13px;
          color: #94a3b8;
          font-weight: 700;
          user-select: none;
        }

        /* ── Bottom Grid (Recent Alerts & 12H Pass Activity) ── */
        .unrec-bottom-grid {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 20px;
        }

        .unrec-bottom-card {
          background: #ffffff;
          border: 1px solid #e2ece8;
          border-radius: 18px;
          padding: 20px;
          box-shadow: 0 1px 4px rgba(0, 0, 0, 0.02);
        }

        .unrec-bottom-card-header {
          display: flex;
          align-items: center;
          justify-content: space-between;
          margin-bottom: 16px;
        }

        .unrec-bottom-header-title {
          display: flex;
          align-items: center;
          gap: 8px;
          font-size: 14.5px;
          font-weight: 700;
          color: #0f172a;
        }

        .unrec-view-all-link {
          background: none;
          border: none;
          color: #059669;
          font-size: 12.5px;
          font-weight: 700;
          cursor: pointer;
          display: inline-flex;
          align-items: center;
          gap: 5px;
        }

        .unrec-view-all-link:hover {
          text-decoration: underline;
        }

        .unrec-empty-bottom-state {
          padding: 28px 10px;
          display: flex;
          flex-direction: column;
          align-items: center;
          text-align: center;
        }

        .unrec-empty-bottom-icon {
          margin-bottom: 8px;
        }

        .unrec-empty-bottom-title {
          font-size: 13px;
          font-weight: 700;
          color: #0f172a;
        }

        .unrec-empty-bottom-sub {
          font-size: 11.5px;
          color: #64748b;
          margin-top: 2px;
        }

        .unrec-modal-input {
          width: 100%;
          box-sizing: border-box;
          padding: 8px 12px;
          border-radius: 8px;
          border: 1px solid #cbd5e1;
          font-size: 13px;
          outline: none;
        }

        /* ── Face Avatar Thumbnail in Table ── */
        .unrec-face-avatar-wrap {
          position: relative;
          width: 40px;
          aspect-ratio: 3.5 / 4.5;
          height: auto;
          border-radius: 8px;
          cursor: pointer;
          margin: 0 auto;
          display: flex;
          align-items: center;
          justify-content: center;
          background: #ecfdf5;
          border: 2px solid #10b981;
          box-shadow: 0 2px 6px rgba(16, 185, 129, 0.2);
          transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1);
          overflow: hidden;
        }

        .unrec-face-avatar-wrap:hover {
          transform: scale(1.1);
          border-color: #059669;
          box-shadow: 0 4px 12px rgba(16, 185, 129, 0.35);
        }

        .unrec-crossing-face-caption {
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 3px;
          max-width: 120px;
          margin: 3px auto 0;
          font-size: 10px;
          color: #475569;
        }

        .unrec-crossing-employee-link {
          max-width: 120px;
          padding: 0;
          border: 0;
          background: transparent;
          color: #047857;
          font: inherit;
          font-weight: 700;
          cursor: pointer;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }

        .unrec-photo-source-badge {
          padding: 2px 5px;
          border-radius: 999px;
          font-size: 9px;
          font-weight: 700;
          background: #f1f5f9;
          color: #64748b;
        }

        .unrec-photo-source-badge.registered { background: #d1fae5; color: #047857; }
        .unrec-photo-source-badge.captured { background: #dbeafe; color: #1d4ed8; }

        .unrec-face-avatar-img {
          width: 100%;
          height: 100%;
          object-fit: cover;
          border-radius: 6px;
        }

        .unrec-face-avatar-fallback {
          width: 100%;
          height: 100%;
          display: flex;
          align-items: center;
          justify-content: center;
          color: #059669;
          background: #d1fae5;
        }

        .unrec-face-zoom-hint {
          position: absolute;
          right: -1px;
          bottom: -1px;
          width: 16px;
          height: 16px;
          border-radius: 50%;
          background: #059669;
          color: #ffffff;
          display: flex;
          align-items: center;
          justify-content: center;
          opacity: 0;
          transition: opacity 0.15s ease;
        }

        .unrec-face-avatar-wrap:hover .unrec-face-zoom-hint {
          opacity: 1;
        }

        .unrec-scan-badge {
          display: inline-block;
          font-size: 10px;
          font-weight: 700;
          color: #059669;
          background: #ecfdf5;
          border: 1px solid #a7f3d0;
          padding: 1px 5px;
          border-radius: 4px;
          margin-top: 3px;
          width: fit-content;
        }

        .unrec-inout-group-btn {
          background: transparent;
          border: none;
          cursor: pointer;
          display: inline-flex;
          flex-direction: column;
          align-items: center;
          gap: 4px;
          padding: 4px 6px;
          border-radius: 8px;
          transition: all 0.15s ease;
        }

        .unrec-inout-group-btn:hover {
          background: rgba(16, 185, 129, 0.08);
          transform: translateY(-1px);
        }

        .unrec-inout-pills-row {
          display: flex;
          align-items: center;
          gap: 4px;
        }

        .unrec-pill-in {
          display: inline-flex;
          align-items: center;
          gap: 3px;
          padding: 1.5px 6px;
          border-radius: 10px;
          font-size: 10.5px;
          font-weight: 700;
          background: #ecfdf5;
          color: #047857;
          border: 1px solid #a7f3d0;
        }

        .unrec-pill-out {
          display: inline-flex;
          align-items: center;
          gap: 3px;
          padding: 1.5px 6px;
          border-radius: 10px;
          font-size: 10.5px;
          font-weight: 700;
          background: #eff6ff;
          color: #1d4ed8;
          border: 1px solid #bfdbfe;
        }

        .pill-arrow-in {
          color: #059669;
          font-weight: 900;
        }

        .pill-arrow-out {
          color: #2563eb;
          font-weight: 900;
        }

        /* Modal stat boxes */
        .unrec-scan-stats-grid {
          display: flex;
          align-items: center;
          gap: 8px;
          flex-wrap: wrap;
        }

        .unrec-scan-stat-box {
          display: flex;
          flex-direction: column;
          padding: 6px 12px;
          border-radius: 8px;
          min-width: 85px;
          text-align: center;
        }

        .box-total {
          background: #f8fafc;
          border: 1px solid #e2e8f0;
        }

        .box-in {
          background: #ecfdf5;
          border: 1px solid #a7f3d0;
        }

        .box-out {
          background: #eff6ff;
          border: 1px solid #bfdbfe;
        }

        .unrec-scan-stat-label {
          font-size: 9px;
          font-weight: 700;
          color: #64748b;
          letter-spacing: 0.5px;
        }

        .unrec-scan-stat-num {
          font-size: 16px;
          font-weight: 800;
          color: #0f172a;
          line-height: 1.2;
          margin-top: 2px;
        }

        .unrec-scan-stat-num.in-green {
          color: #059669;
        }

        .unrec-scan-stat-num.out-blue {
          color: #2563eb;
        }

        .unrec-scan-stat-hint {
          font-size: 8.5px;
          color: #94a3b8;
          margin-top: 1px;
        }

        .unrec-scan-direction-pill {
          display: inline-flex;
          align-items: center;
          padding: 3px 9px;
          border-radius: 12px;
          font-size: 10.5px;
          font-weight: 800;
          letter-spacing: 0.3px;
        }

        .pill-dir-in {
          background: #d1fae5;
          color: #047857;
          border: 1px solid #6ee7b7;
        }

        .pill-dir-out {
          background: #dbeafe;
          color: #1d4ed8;
          border: 1px solid #93c5fd;
        }

        .unrec-count-badge {
          border: none;
          cursor: pointer;
          display: inline-flex;
          align-items: center;
          gap: 4px;
          transition: all 0.15s ease;
        }

        .unrec-count-badge:hover {
          transform: translateY(-1px);
          filter: brightness(0.95);
        }

        .unrec-badge-sub {
          font-size: 9.5px;
          opacity: 0.75;
          text-transform: uppercase;
          font-weight: 700;
          margin-left: 2px;
          text-decoration: underline;
        }

        .unrec-action-view {
          width: 30px;
          height: 30px;
          border-radius: 6px;
          background: #f1f5f9;
          border: 1px solid #cbd5e1;
          color: #475569;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          cursor: pointer;
          transition: all 0.15s ease;
        }

        .unrec-action-view:hover {
          background: #e2e8f0;
          color: #0f172a;
          border-color: #94a3b8;
          transform: translateY(-1px);
        }

        /* ── Visitor Pass Modal Face Header ── */
        .unrec-modal-face-header {
          display: flex;
          align-items: center;
          gap: 14px;
          padding: 12px 14px;
          background: #f8fafc;
          border: 1px solid #e2e8f0;
          border-radius: 10px;
          margin-bottom: 6px;
        }

        .unrec-modal-face-avatar {
          width: 54px;
          height: 54px;
          border-radius: 50%;
          overflow: hidden;
          background: #ecfdf5;
          border: 2px solid #10b981;
          flex-shrink: 0;
          display: flex;
          align-items: center;
          justify-content: center;
          color: #059669;
        }

        .unrec-modal-face-avatar img {
          width: 100%;
          height: 100%;
          object-fit: cover;
        }

        .unrec-modal-face-meta {
          display: flex;
          flex-direction: column;
          gap: 2px;
        }

        .unrec-modal-face-title {
          font-size: 14px;
          font-weight: 800;
          color: #0f172a;
        }

        .unrec-modal-face-sub {
          font-size: 12px;
          color: #64748b;
        }

        .unrec-modal-face-badge {
          font-size: 11px;
          font-weight: 700;
          color: #dc2626;
          margin-top: 2px;
        }

        /* ── Face Preview Enlarged Modal ── */
        .unrec-preview-modal-body {
          display: flex;
          flex-direction: column;
          gap: 16px;
          align-items: center;
        }

        .unrec-preview-photo-wrap {
          width: 220px;
          aspect-ratio: 3.5 / 4.5;
          height: auto;
          border-radius: 16px;
          overflow: hidden;
          background: #0f172a;
          border: 3px solid #10b981;
          box-shadow: 0 8px 24px rgba(16, 185, 129, 0.25);
          display: flex;
          align-items: center;
          justify-content: center;
        }

        .unrec-preview-large-img {
          width: 100%;
          height: 100%;
          object-fit: cover;
          aspect-ratio: 3.5 / 4.5;
        }

        .unrec-preview-large-fallback {
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 8px;
          color: #64748b;
          font-size: 12px;
          font-weight: 600;
        }

        .unrec-preview-details-box {
          width: 100%;
          background: #f8fafc;
          border: 1px solid #e2e8f0;
          border-radius: 12px;
          padding: 12px 16px;
          display: flex;
          flex-direction: column;
          gap: 8px;
          box-sizing: border-box;
        }

        .unrec-preview-detail-row {
          display: flex;
          align-items: center;
          justify-content: space-between;
          font-size: 13px;
          gap: 8px;
        }

        .unrec-preview-label {
          color: #64748b;
          font-weight: 600;
        }

        .unrec-preview-val {
          color: #0f172a;
          font-weight: 700;
          text-align: right;
        }

        .unrec-preview-val.badge-val {
          color: #dc2626;
        }

        .unrec-preview-actions {
          display: flex;
          align-items: center;
          gap: 10px;
          width: 100%;
        }

        .unrec-preview-btn-scans {
          flex: 1;
          height: 38px;
          border-radius: 8px;
          background: #f1f5f9;
          border: 1px solid #cbd5e1;
          color: #334155;
          font-weight: 700;
          font-size: 12.5px;
          cursor: pointer;
          transition: all 0.15s ease;
        }

        .unrec-preview-btn-scans:hover {
          background: #e2e8f0;
          color: #0f172a;
        }

        .unrec-preview-btn-pass {
          flex: 1;
          height: 38px;
          border-radius: 8px;
          background: #059669;
          border: none;
          color: #ffffff;
          font-weight: 700;
          font-size: 12.5px;
          cursor: pointer;
          transition: all 0.15s ease;
          box-shadow: 0 2px 8px rgba(5, 150, 105, 0.25);
        }

        .unrec-preview-btn-pass:hover {
          background: #047857;
        }

        /* ── Camera Scan Logs Modal (Single Face Group) ── */
        .unrec-scan-modal-container {
          display: flex;
          flex-direction: column;
          gap: 14px;
        }

        .unrec-scan-summary-banner {
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding: 12px 16px;
          border-radius: 12px;
          background: #ecfdf5;
          border: 1px solid #a7f3d0;
          gap: 12px;
          flex-wrap: wrap;
        }

        .unrec-scan-summary-left {
          display: flex;
          align-items: center;
          gap: 12px;
        }

        .unrec-scan-summary-avatar {
          width: 46px;
          height: 46px;
          border-radius: 50%;
          overflow: hidden;
          background: #ffffff;
          border: 2px solid #10b981;
          display: flex;
          align-items: center;
          justify-content: center;
          color: #059669;
          flex-shrink: 0;
        }

        .unrec-scan-summary-avatar img {
          width: 100%;
          height: 100%;
          object-fit: cover;
        }

        .unrec-scan-summary-meta {
          display: flex;
          flex-direction: column;
          gap: 2px;
        }

        .unrec-scan-summary-name {
          font-size: 15px;
          font-weight: 800;
          color: #064e3b;
        }

        .unrec-scan-summary-sub {
          font-size: 12px;
          color: #047857;
          font-weight: 500;
        }

        .unrec-scan-summary-right {
          display: flex;
          flex-direction: column;
          align-items: flex-end;
          gap: 2px;
        }

        .unrec-scan-count-pill {
          display: inline-block;
          font-size: 13px;
          font-weight: 800;
          color: #dc2626;
          background: #fef2f2;
          padding: 3px 10px;
          border-radius: 6px;
          border: 1px solid #fecaca;
        }

        .unrec-scan-group-tag {
          font-size: 11px;
          color: #047857;
          font-weight: 600;
        }

        .unrec-scan-table-wrap {
          width: 100%;
          max-height: 380px;
          overflow-y: auto;
          border: 1px solid #e2e8f0;
          border-radius: 10px;
          background: #ffffff;
        }

        .unrec-scan-table {
          width: 100%;
          border-collapse: separate;
          border-spacing: 0;
          font-size: 12.5px;
          text-align: left;
        }

        .unrec-scan-table thead th {
          position: sticky;
          top: 0;
          background: #f8fafc;
          color: #475569;
          font-size: 11px;
          font-weight: 700;
          text-transform: uppercase;
          letter-spacing: 0.04em;
          padding: 10px 12px;
          border-bottom: 1.5px solid #e2e8f0;
          z-index: 2;
        }

        .unrec-scan-table tbody td {
          padding: 10px 12px;
          border-bottom: 1px solid #f1f5f9;
          vertical-align: middle;
          color: #0f172a;
        }

        .unrec-scan-table tbody tr:hover td {
          background-color: #f8fafc;
        }

        .unrec-scan-table tbody tr:last-child td {
          border-bottom: none;
        }

        .unrec-scan-idx {
          font-size: 11px;
          font-weight: 700;
          color: #64748b;
          background: #f1f5f9;
          padding: 2px 6px;
          border-radius: 4px;
        }

        .unrec-scan-thumb {
          width: 34px;
          height: 34px;
          border-radius: 50%;
          overflow: hidden;
          background: #f1f5f9;
          border: 1.5px solid #10b981;
          margin: 0 auto;
        }

        .unrec-scan-thumb img {
          width: 100%;
          height: 100%;
          object-fit: cover;
        }

        .unrec-scan-date {
          font-weight: 500;
          color: #334155;
        }

        .unrec-scan-time {
          font-weight: 800;
          color: #059669;
        }

        .unrec-scan-cam-cell {
          display: flex;
          align-items: center;
          gap: 6px;
        }

        .unrec-scan-cam-name {
          font-weight: 700;
          color: #1e293b;
        }

        .unrec-scan-cam-loc {
          font-size: 11px;
          color: #64748b;
          background: #f1f5f9;
          padding: 1px 5px;
          border-radius: 4px;
          border: 1px solid #e2e8f0;
        }

        .unrec-scan-status-tag {
          display: inline-block;
          font-size: 10px;
          font-weight: 800;
          color: #059669;
          background: #ecfdf5;
          border: 1px solid #a7f3d0;
          padding: 2px 7px;
          border-radius: 4px;
        }

        .unrec-modal-label {
          font-size: 12px;
          font-weight: 700;
          color: #334155;
          display: block;
          margin-bottom: 5px;
        }

        .unrec-modal-desc {
          margin: 0 0 14px 0;
          font-size: 13.5px;
          color: #475569;
        }

        /* ── Security Management & Mobile Vibration Control Center ── */
        .unrec-security-access-panel {
          background: #ffffff;
          border: 1px solid #d1fae5;
          border-left: 4px solid #10b981;
          border-radius: 16px;
          padding: 16px 20px;
          margin-bottom: 22px;
          box-shadow: 0 2px 8px rgba(16, 185, 129, 0.08);
          box-sizing: border-box;
        }

        .unrec-sec-panel-top {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 16px;
          flex-wrap: wrap;
          margin-bottom: 12px;
        }

        .unrec-sec-officer-info {
          display: flex;
          flex-direction: column;
          gap: 4px;
        }

        .unrec-sec-badge-row {
          display: flex;
          align-items: center;
          gap: 8px;
          flex-wrap: wrap;
        }

        .unrec-sec-badge-officer {
          display: inline-flex;
          align-items: center;
          gap: 7px;
          font-size: 12px;
          font-weight: 700;
          color: #065f46;
          background: #ecfdf5;
          border: 1px solid #a7f3d0;
          padding: 3px 10px;
          border-radius: 9999px;
          letter-spacing: 0.02em;
        }

        .unrec-sec-dot-pulse {
          width: 7px;
          height: 7px;
          border-radius: 50%;
          background: #10b981;
          box-shadow: 0 0 6px #10b981;
          animation: pulseBeacon 1.8s infinite;
        }

        .unrec-sec-role-tag {
          font-size: 11px;
          font-weight: 700;
          color: #b45309;
          background: #fef3c7;
          border: 1px solid #fde68a;
          padding: 3px 8px;
          border-radius: 6px;
        }

        .unrec-sec-desc {
          font-size: 12.5px;
          color: #64748b;
          margin: 0;
        }

        .unrec-sec-access-action {
          flex-shrink: 0;
        }

        .unrec-sec-granted-badge {
          display: inline-flex;
          align-items: center;
          gap: 7px;
          background: #ecfdf5;
          border: 1px solid #a7f3d0;
          color: #059669;
          font-size: 12px;
          font-weight: 700;
          padding: 7px 14px;
          border-radius: 10px;
        }

        .unrec-dot-live-green {
          width: 8px;
          height: 8px;
          border-radius: 50%;
          background: #10b981;
          box-shadow: 0 0 6px #10b981;
        }

        .unrec-btn-grant-access {
          display: inline-flex;
          align-items: center;
          gap: 8px;
          background: linear-gradient(135deg, #059669 0%, #10b981 100%);
          color: #ffffff;
          border: none;
          font-size: 12.5px;
          font-weight: 700;
          padding: 8px 16px;
          border-radius: 10px;
          cursor: pointer;
          box-shadow: 0 3px 10px rgba(16, 185, 129, 0.28);
          transition: all 0.2s ease;
        }

        .unrec-btn-grant-access:hover:not(:disabled) {
          opacity: 0.95;
          transform: translateY(-1px);
          box-shadow: 0 5px 14px rgba(16, 185, 129, 0.38);
        }

        .unrec-sec-toast-alert {
          background: #f0fdf4;
          border: 1px solid #bbf7d0;
          color: #166534;
          font-size: 12.5px;
          font-weight: 600;
          padding: 8px 14px;
          border-radius: 8px;
          margin-bottom: 12px;
        }

        .unrec-sec-toggles-row {
          display: flex;
          align-items: center;
          gap: 12px;
          flex-wrap: wrap;
          padding-top: 10px;
          border-top: 1px dashed #e2ece8;
        }

        .unrec-sec-toggle-chip {
          display: inline-flex;
          align-items: center;
          gap: 8px;
          background: #f8fafc;
          border: 1px solid #e2e8f0;
          padding: 5px 12px;
          border-radius: 8px;
          font-size: 12px;
        }

        .unrec-chip-icon {
          font-size: 14px;
        }

        .unrec-chip-label {
          font-weight: 600;
          color: #334155;
        }

        .unrec-chip-btn {
          padding: 2px 10px;
          border-radius: 6px;
          font-size: 11.5px;
          font-weight: 700;
          cursor: pointer;
          border: 1px solid transparent;
          transition: all 0.15s ease;
        }

        .unrec-chip-btn.active {
          background: #10b981;
          color: #ffffff;
        }

        .unrec-chip-btn.muted {
          background: #e2e8f0;
          color: #64748b;
        }

        .unrec-btn-test-vibrate-siren {
          display: inline-flex;
          align-items: center;
          gap: 6px;
          background: #fff1f2;
          border: 1px solid #fecdd3;
          color: #e11d48;
          font-size: 12px;
          font-weight: 700;
          padding: 6px 14px;
          border-radius: 8px;
          cursor: pointer;
          transition: all 0.18s ease;
          margin-left: auto;
        }

        .unrec-btn-test-vibrate-siren:hover {
          background: #ffe4e6;
          border-color: #fda4af;
          transform: translateY(-1px);
        }

        @media (max-width: 1024px) {
          .unrec-stat-cards-grid {
            grid-template-columns: repeat(2, 1fr);
          }
          .unrec-bottom-grid {
            grid-template-columns: 1fr;
          }
        }

        @media (max-width: 768px) {
          .unrecognized-faces-page {
            padding: 12px 14px 32px !important;
          }

          /* Header compact layout */
          .unrec-header-row {
            margin-bottom: 12px !important;
            gap: 10px !important;
          }

          .unrec-header-left {
            gap: 10px !important;
          }

          .unrec-icon-box {
            width: 38px !important;
            height: 38px !important;
            border-radius: 10px !important;
          }

          .unrec-icon-box svg {
            width: 20px !important;
            height: 20px !important;
          }

          .unrec-title {
            font-size: 19px !important;
            margin: 0 !important;
          }

          .unrec-subtitle {
            display: none !important;
          }

          /* Security Access Panel Mobile Layout */
          .unrec-security-access-panel {
            padding: 12px 14px !important;
            margin-bottom: 14px !important;
            border-radius: 12px !important;
          }

          .unrec-sec-panel-top {
            flex-direction: column !important;
            align-items: stretch !important;
            gap: 10px !important;
            margin-bottom: 10px !important;
          }

          .unrec-sec-desc {
            display: none !important;
          }

          .unrec-btn-grant-access {
            width: 100% !important;
            justify-content: center !important;
            height: 38px !important;
            font-size: 12px !important;
          }

          .unrec-sec-granted-badge {
            width: 100% !important;
            justify-content: center !important;
            height: 34px !important;
            box-sizing: border-box !important;
          }

          .unrec-sec-toggles-row {
            display: grid !important;
            grid-template-columns: 1fr 1fr !important;
            gap: 8px !important;
            width: 100% !important;
          }

          .unrec-sec-toggle-chip {
            padding: 6px 8px !important;
            font-size: 11px !important;
            justify-content: space-between !important;
          }

          .unrec-btn-test-vibrate-siren {
            grid-column: span 2 !important;
            width: 100% !important;
            justify-content: center !important;
            height: 36px !important;
            margin-left: 0 !important;
          }

          .unrec-header-actions {
            width: 100% !important;
            display: flex !important;
            gap: 6px !important;
          }

          .unrec-btn-alarm-toggle,
          .unrec-btn-alarm-test,
          .unrec-btn-refresh {
            flex: 1 !important;
            height: 34px !important;
            font-size: 11px !important;
            font-weight: 700 !important;
            padding: 0 4px !important;
            justify-content: center !important;
            border-radius: 8px !important;
          }

          /* Live alarm banner compact on mobile */
          .unrec-live-alarm-banner {
            flex-direction: column !important;
            align-items: flex-start !important;
            padding: 12px 14px !important;
            gap: 10px !important;
            margin-bottom: 14px !important;
          }

          .unrec-alarm-banner-left {
            width: 100% !important;
            gap: 12px !important;
          }

          .unrec-alarm-siren-beacon {
            width: 42px !important;
            height: 42px !important;
            border-radius: 10px !important;
          }

          .unrec-alarm-beacon-icon {
            font-size: 20px !important;
          }

          .unrec-alarm-headline {
            font-size: 14px !important;
          }

          .unrec-alarm-description {
            font-size: 11px !important;
          }

          .unrec-alarm-banner-right {
            width: 100% !important;
            justify-content: space-between !important;
            gap: 8px !important;
          }

          .unrec-alarm-snapshot {
            width: 44px !important;
            height: 44px !important;
          }

          .unrec-alarm-action-group {
            flex: 1 !important;
            justify-content: flex-end !important;
            gap: 6px !important;
          }

          .unrec-alarm-silence-btn,
          .unrec-alarm-inspect-btn {
            height: 32px !important;
            font-size: 11px !important;
            padding: 0 10px !important;
          }

          /* 4 Executive Stat Cards into Clean 2x2 Minimal Grid */
          .unrec-stat-cards-grid {
            grid-template-columns: repeat(2, 1fr) !important;
            gap: 8px !important;
            margin-bottom: 12px !important;
          }

          .unrec-stat-card {
            padding: 10px 12px !important;
            border-radius: 12px !important;
            min-height: unset !important;
            box-shadow: 0 1px 3px rgba(0, 0, 0, 0.02) !important;
          }

          .unrec-stat-icon-wrap {
            width: 30px !important;
            height: 30px !important;
            border-radius: 8px !important;
          }

          .unrec-stat-icon-wrap svg {
            width: 16px !important;
            height: 16px !important;
          }

          .unrec-stat-label {
            font-size: 9px !important;
            font-weight: 700 !important;
          }

          .unrec-stat-number {
            font-size: 19px !important;
            font-weight: 800 !important;
          }

          .unrec-stat-trend {
            font-size: 9px !important;
            padding: 1px 4px !important;
          }

          .unrec-stat-trend .trend-vs {
            display: none !important;
          }

          .unrec-stat-wave-wrap {
            display: none !important;
          }

          /* Clean, non-clumsy search & filter bar */
          .unrec-search-filter-bar {
            display: flex !important;
            flex-direction: column !important;
            gap: 8px !important;
            margin-bottom: 14px !important;
          }

          .unrec-search-input-wrap {
            width: 100% !important;
            height: 38px !important;
          }

          .unrec-search-field {
            font-size: 12.5px !important;
          }

          .unrec-filter-actions-group {
            display: grid !important;
            grid-template-columns: 1fr 1fr !important;
            gap: 8px !important;
            width: 100% !important;
          }

          .unrec-dropdown-relative {
            width: 100% !important;
          }

          .unrec-filter-dropdown-btn {
            width: 100% !important;
            height: 36px !important;
            font-size: 11.5px !important;
            padding: 0 10px !important;
            justify-content: space-between !important;
            border-radius: 8px !important;
          }

          .unrec-btn-export {
            grid-column: span 2 !important;
            width: 100% !important;
            height: 36px !important;
            font-size: 12px !important;
            justify-content: center !important;
            border-radius: 8px !important;
          }

          /* Hide wide desktop table and show responsive executive mobile cards */
          .unrec-table-wrap,
          .unrec-table-card .table-responsive {
            display: none !important;
          }

          .unrec-mobile-cards {
            display: flex !important;
            flex-direction: column !important;
            gap: 10px !important;
          }

          .unrec-table-card {
            padding: 10px !important;
            border-radius: 14px !important;
            margin-bottom: 14px !important;
          }

          /* Mobile Visitor Cards Styling */
          .unrec-m-card {
            background: #ffffff;
            border: 1px solid #e2ece8;
            border-radius: 12px;
            padding: 12px 14px;
            display: flex;
            flex-direction: column;
            gap: 8px;
            box-shadow: 0 1px 4px rgba(0, 0, 0, 0.02);
            transition: all 0.15s ease;
          }

          .unrec-m-card.just-detected {
            border-left: 4px solid #ef4444 !important;
            background: #fffafa !important;
          }

          .unrec-m-card-top {
            display: flex;
            align-items: center;
            justify-content: space-between;
          }

          .unrec-m-card-person {
            display: flex;
            align-items: center;
            gap: 10px;
            min-width: 0;
          }

          .unrec-m-card-avatar-wrap {
            width: 42px;
            height: 42px;
            border-radius: 50%;
            overflow: hidden;
            border: 2px solid #10b981;
            flex-shrink: 0;
            background: #f1f5f9;
          }

          .unrec-m-card-avatar-img {
            width: 100%;
            height: 100%;
            object-fit: cover;
          }

          .unrec-m-card-avatar-fallback {
            width: 100%;
            height: 100%;
            background: #ecfdf5;
            display: flex;
            align-items: center;
            justify-content: center;
            color: #059669;
          }

          .unrec-m-card-name-block {
            display: flex;
            flex-direction: column;
            min-width: 0;
          }

          .unrec-m-card-title-row {
            display: flex;
            align-items: center;
            gap: 6px;
          }

          .unrec-m-card-name {
            font-size: 13.5px;
            font-weight: 700;
            color: #0f172a;
            white-space: nowrap;
            overflow: hidden;
            text-overflow: ellipsis;
          }

          .unrec-m-card-just-badge {
            background: #ef4444;
            color: #ffffff;
            font-size: 9px;
            font-weight: 800;
            padding: 1px 5px;
            border-radius: 4px;
            flex-shrink: 0;
          }

          .unrec-m-card-id {
            font-size: 11px;
            color: #64748b;
          }

          .unrec-m-card-details-grid {
            display: grid;
            grid-template-columns: 1fr 1fr;
            gap: 6px 10px;
            background: #f8fafc;
            border-radius: 8px;
            padding: 8px 10px;
            font-size: 11px;
          }

          .unrec-m-detail-item {
            display: flex;
            flex-direction: column;
            gap: 1px;
            min-width: 0;
          }

          .unrec-m-detail-label {
            font-size: 9px;
            font-weight: 700;
            color: #94a3b8;
            text-transform: uppercase;
            letter-spacing: 0.3px;
          }

          .unrec-m-detail-val {
            font-size: 11px;
            color: #1e293b;
            display: flex;
            align-items: center;
            gap: 4px;
            overflow: hidden;
            text-overflow: ellipsis;
            white-space: nowrap;
          }

          .unrec-m-cam-dot {
            width: 6px;
            height: 6px;
            border-radius: 50%;
            display: inline-block;
            flex-shrink: 0;
          }

          .unrec-m-cam-dot.in-dot {
            background: #059669;
          }

          .unrec-m-cam-dot.out-dot {
            background: #2563eb;
          }

          .unrec-m-cam-dot.unknown-dot {
            background: #94a3b8;
          }

          .unrec-m-scans-tag {
            font-size: 9.5px;
            background: #e0f2fe;
            color: #0284c7;
            padding: 0 4px;
            border-radius: 4px;
            font-weight: 700;
          }

          .unrec-m-movement-pills {
            display: flex;
            align-items: center;
            gap: 5px;
            flex-wrap: wrap;
          }

          .unrec-m-frequent-tag {
            font-size: 9.5px;
            font-weight: 800;
            color: #dc2626;
            background: #fee2e2;
            padding: 1px 5px;
            border-radius: 4px;
          }

          .unrec-m-card-actions {
            display: flex;
            align-items: center;
            gap: 6px;
            padding-top: 6px;
            border-top: 1px solid #f1f5f9;
          }

          .unrec-m-btn-primary {
            flex: 1;
            height: 32px;
            border-radius: 6px;
            background: #059669;
            color: #ffffff;
            font-size: 11.5px;
            font-weight: 700;
            border: none;
            display: flex;
            align-items: center;
            justify-content: center;
            gap: 4px;
            cursor: pointer;
          }

          .unrec-m-btn-checkout {
            flex: 1;
            height: 32px;
            border-radius: 6px;
            background: #f59e0b;
            color: #ffffff;
            font-size: 11.5px;
            font-weight: 700;
            border: none;
            display: flex;
            align-items: center;
            justify-content: center;
            gap: 4px;
            cursor: pointer;
          }

          .unrec-m-btn-sec {
            height: 32px;
            padding: 0 8px;
            border-radius: 6px;
            background: #f1f5f9;
            color: #334155;
            font-size: 11px;
            font-weight: 600;
            border: 1px solid #cbd5e1;
            display: flex;
            align-items: center;
            gap: 4px;
            cursor: pointer;
          }

          .unrec-m-btn-icon-del {
            width: 32px;
            height: 32px;
            border-radius: 6px;
            background: #fef2f2;
            color: #dc2626;
            border: 1px solid #fecaca;
            display: flex;
            align-items: center;
            justify-content: center;
            cursor: pointer;
            flex-shrink: 0;
          }

          /* Bottom Cards stacked cleanly */
          .unrec-bottom-grid {
            grid-template-columns: 1fr !important;
            gap: 12px !important;
          }

          .unrec-bottom-card {
            padding: 14px !important;
            border-radius: 14px !important;
          }

          /* Table Footer on Mobile */
          .unrec-table-footer {
            flex-direction: column !important;
            gap: 8px !important;
            align-items: center !important;
            text-align: center !important;
            padding-top: 12px !important;
          }

          .unrec-footer-count {
            font-size: 11px !important;
          }

          .unrec-page-size-selector {
            font-size: 11px !important;
          }
        }

        /* ── DARK THEME SYSTEM OVERRIDES ────────────────────────────── */
        [data-theme="dark"] .unrec-security-access-panel,
        .dark .unrec-security-access-panel {
          background: #111528 !important;
          border-color: rgba(139, 92, 246, 0.25) !important;
          border-left-color: #10b981 !important;
        }

        [data-theme="dark"] .unrec-sec-badge-officer,
        .dark .unrec-sec-badge-officer {
          background: rgba(16, 185, 129, 0.16) !important;
          border-color: rgba(16, 185, 129, 0.3) !important;
          color: #34d399 !important;
        }

        [data-theme="dark"] .unrec-sec-role-tag,
        .dark .unrec-sec-role-tag {
          background: rgba(245, 158, 11, 0.16) !important;
          border-color: rgba(245, 158, 11, 0.3) !important;
          color: #fbbf24 !important;
        }

        [data-theme="dark"] .unrec-sec-desc,
        .dark .unrec-sec-desc {
          color: #94a3b8 !important;
        }

        [data-theme="dark"] .unrec-sec-granted-badge,
        .dark .unrec-sec-granted-badge {
          background: rgba(16, 185, 129, 0.16) !important;
          border-color: rgba(16, 185, 129, 0.3) !important;
          color: #34d399 !important;
        }

        [data-theme="dark"] .unrec-sec-toggles-row,
        .dark .unrec-sec-toggles-row {
          border-top-color: rgba(255, 255, 255, 0.08) !important;
        }

        [data-theme="dark"] .unrec-sec-toggle-chip,
        .dark .unrec-sec-toggle-chip {
          background: #171b38 !important;
          border-color: rgba(139, 92, 246, 0.22) !important;
        }

        [data-theme="dark"] .unrec-chip-label,
        .dark .unrec-chip-label {
          color: #cbd5e1 !important;
        }

        [data-theme="dark"] .unrec-chip-btn.muted,
        .dark .unrec-chip-btn.muted {
          background: #23284f !important;
          color: #94a3b8 !important;
        }

        [data-theme="dark"] .unrec-btn-test-vibrate-siren,
        .dark .unrec-btn-test-vibrate-siren {
          background: rgba(225, 29, 72, 0.14) !important;
          border-color: rgba(225, 29, 72, 0.3) !important;
          color: #fb7185 !important;
        }

        .dark .unrec-m-card,
        [data-theme="dark"] .unrec-m-card {
          background: var(--surface, #141829) !important;
          border-color: rgba(139, 92, 246, 0.22) !important;
          box-shadow: 0 2px 10px rgba(0, 0, 0, 0.35) !important;
        }

        .dark .unrec-m-card.just-detected,
        [data-theme="dark"] .unrec-m-card.just-detected {
          background: rgba(239, 68, 68, 0.12) !important;
          border-left-color: #ef4444 !important;
        }

        .dark .unrec-m-card-name,
        [data-theme="dark"] .unrec-m-card-name {
          color: #f1f5f9 !important;
        }

        .dark .unrec-m-card-id,
        [data-theme="dark"] .unrec-m-card-id {
          color: #94a3b8 !important;
        }

        .dark .unrec-m-card-details-grid,
        [data-theme="dark"] .unrec-m-card-details-grid {
          background: #181d3d !important;
          border: 1px solid rgba(139, 92, 246, 0.18) !important;
        }

        .dark .unrec-m-detail-val,
        [data-theme="dark"] .unrec-m-detail-val {
          color: #e2e8f0 !important;
        }

        .dark .unrec-m-detail-label,
        [data-theme="dark"] .unrec-m-detail-label {
          color: #94a3b8 !important;
        }

        .dark .unrec-m-btn-sec,
        [data-theme="dark"] .unrec-m-btn-sec {
          background: #1e244d !important;
          border-color: rgba(139, 92, 246, 0.3) !important;
          color: #cbd5e1 !important;
        }

        .dark .unrec-m-card-actions,
        [data-theme="dark"] .unrec-m-card-actions {
          border-top-color: rgba(139, 92, 246, 0.16) !important;
        }

        .dark .unrecognized-faces-page,
        [data-theme="dark"] .unrecognized-faces-page {
          background: var(--bg, #0c0e1e) !important;
          color: var(--text-primary, #f1f5f9) !important;
        }

        .dark .unrec-live-alarm-banner,
        [data-theme="dark"] .unrec-live-alarm-banner {
          background: linear-gradient(135deg, rgba(239, 68, 68, 0.12) 0%, rgba(20, 24, 41, 0.95) 100%) !important;
          border-color: rgba(239, 68, 68, 0.5) !important;
          box-shadow: 0 12px 36px rgba(0, 0, 0, 0.5) !important;
        }

        .dark .unrec-alarm-siren-beacon,
        [data-theme="dark"] .unrec-alarm-siren-beacon {
          background: rgba(239, 68, 68, 0.25) !important;
        }

        .dark .unrec-alarm-headline,
        [data-theme="dark"] .unrec-alarm-headline {
          color: #fca5a5 !important;
        }

        .dark .unrec-alarm-description,
        [data-theme="dark"] .unrec-alarm-description {
          color: #cbd5e1 !important;
        }

        .dark .unrec-alarm-silence-btn,
        [data-theme="dark"] .unrec-alarm-silence-btn {
          background: #1e244d !important;
          border-color: rgba(139, 92, 246, 0.3) !important;
          color: #cbd5e1 !important;
        }

        .dark .unrec-btn-alarm-toggle,
        [data-theme="dark"] .unrec-btn-alarm-toggle {
          background: rgba(16, 185, 129, 0.15) !important;
          border-color: rgba(16, 185, 129, 0.35) !important;
          color: #34d399 !important;
        }

        .dark .unrec-btn-alarm-toggle.muted,
        [data-theme="dark"] .unrec-btn-alarm-toggle.muted {
          background: rgba(148, 163, 184, 0.1) !important;
          border-color: rgba(148, 163, 184, 0.25) !important;
          color: #94a3b8 !important;
        }

        .dark .unrec-btn-alarm-test,
        [data-theme="dark"] .unrec-btn-alarm-test {
          background: rgba(239, 68, 68, 0.15) !important;
          border-color: rgba(239, 68, 68, 0.35) !important;
          color: #f87171 !important;
        }

        .dark .unrec-row-just-detected td,
        [data-theme="dark"] .unrec-row-just-detected td {
          background-color: rgba(239, 68, 68, 0.14) !important;
          border-top-color: rgba(239, 68, 68, 0.4) !important;
          border-bottom-color: rgba(239, 68, 68, 0.4) !important;
        }

        .dark .unrec-title,
        [data-theme="dark"] .unrec-title {
          color: #ffffff !important;
        }

        .dark .unrec-subtitle,
        [data-theme="dark"] .unrec-subtitle {
          color: #94a3b8 !important;
        }

        .dark .unrec-btn-refresh,
        [data-theme="dark"] .unrec-btn-refresh {
          background: #171b38 !important;
          border-color: rgba(139, 92, 246, 0.25) !important;
          color: #cbd5e1 !important;
        }

        .dark .unrec-btn-refresh:hover:not(:disabled),
        [data-theme="dark"] .unrec-btn-refresh:hover:not(:disabled) {
          background: #23284f !important;
          border-color: rgba(139, 92, 246, 0.45) !important;
          color: #ffffff !important;
        }

        .dark .unrec-stat-card,
        [data-theme="dark"] .unrec-stat-card {
          background: var(--surface, #141829) !important;
          border: 1px solid rgba(139, 92, 246, 0.22) !important;
          box-shadow: 0 4px 18px rgba(0, 0, 0, 0.45) !important;
        }

        .dark .unrec-stat-card:hover,
        [data-theme="dark"] .unrec-stat-card:hover {
          border-color: #10b981 !important;
          box-shadow: 0 6px 20px rgba(16, 185, 129, 0.15) !important;
        }

        .dark .unrec-stat-number,
        [data-theme="dark"] .unrec-stat-number {
          color: #f1f5f9 !important;
        }

        .dark .unrec-stat-label,
        [data-theme="dark"] .unrec-stat-label {
          color: #94a3b8 !important;
        }

        .dark .unrec-search-input-wrap,
        [data-theme="dark"] .unrec-search-input-wrap {
          background: #171b38 !important;
          border: 1px solid rgba(139, 92, 246, 0.25) !important;
          box-shadow: none !important;
        }

        .dark .unrec-search-field,
        [data-theme="dark"] .unrec-search-field {
          color: #ffffff !important;
        }

        .dark .unrec-search-field::placeholder,
        [data-theme="dark"] .unrec-search-field::placeholder {
          color: #64748b !important;
        }

        .dark .unrec-filter-dropdown-btn,
        [data-theme="dark"] .unrec-filter-dropdown-btn {
          background: #171b38 !important;
          border: 1px solid rgba(139, 92, 246, 0.25) !important;
          color: #cbd5e1 !important;
        }

        .dark .unrec-filter-dropdown-btn:hover,
        [data-theme="dark"] .unrec-filter-dropdown-btn:hover {
          background: #23284f !important;
          border-color: rgba(139, 92, 246, 0.45) !important;
          color: #ffffff !important;
        }

        .dark .unrec-dropdown-menu,
        [data-theme="dark"] .unrec-dropdown-menu {
          background: #141829 !important;
          border: 1px solid rgba(139, 92, 246, 0.3) !important;
          box-shadow: 0 12px 30px rgba(0, 0, 0, 0.6) !important;
        }

        .dark .unrec-dropdown-item,
        [data-theme="dark"] .unrec-dropdown-item {
          color: #cbd5e1 !important;
        }

        .dark .unrec-dropdown-item:hover,
        [data-theme="dark"] .unrec-dropdown-item:hover {
          background: #23284f !important;
          color: #ffffff !important;
        }

        .dark .unrec-dropdown-item.selected,
        [data-theme="dark"] .unrec-dropdown-item.selected {
          background: rgba(16, 185, 129, 0.2) !important;
          color: #34d399 !important;
          font-weight: 700 !important;
        }

        .dark .unrec-table-card,
        [data-theme="dark"] .unrec-table-card {
          background: var(--surface, #141829) !important;
          border: 1px solid rgba(139, 92, 246, 0.2) !important;
          box-shadow: 0 4px 22px rgba(0, 0, 0, 0.45) !important;
        }

        .dark .unrec-custom-table th,
        [data-theme="dark"] .unrec-custom-table th {
          background-color: #1a1e3a !important;
          color: #34d399 !important;
          border-bottom: 1px solid rgba(139, 92, 246, 0.2) !important;
        }

        .dark .unrec-custom-table td,
        [data-theme="dark"] .unrec-custom-table td {
          color: #e2e8f0 !important;
          border-bottom: 1px solid rgba(139, 92, 246, 0.12) !important;
        }

        .dark .unrec-custom-table tr:hover td,
        [data-theme="dark"] .unrec-custom-table tr:hover td,
        .dark .unrec-table-row.clickable:hover td,
        [data-theme="dark"] .unrec-table-row.clickable:hover td {
          background-color: rgba(16, 185, 129, 0.08) !important;
        }

        .dark .unrec-idx-text,
        [data-theme="dark"] .unrec-idx-text {
          color: #94a3b8 !important;
        }

        .dark .time-val,
        [data-theme="dark"] .time-val {
          color: #f1f5f9 !important;
        }

        .dark .date-val,
        [data-theme="dark"] .date-val {
          color: #94a3b8 !important;
        }

        .dark .unrec-location-text,
        [data-theme="dark"] .unrec-location-text {
          color: #cbd5e1 !important;
        }

        .dark .unrec-type-badge,
        [data-theme="dark"] .unrec-type-badge {
          background: #1e2442 !important;
          color: #e2e8f0 !important;
          border: 1px solid rgba(139, 92, 246, 0.25) !important;
        }

        .dark .pass-none,
        [data-theme="dark"] .pass-none {
          background: #1e2442 !important;
          color: #94a3b8 !important;
          border: 1px solid rgba(148, 163, 184, 0.2) !important;
        }

        .dark .unrec-cam-pill,
        [data-theme="dark"] .unrec-cam-pill {
          background: rgba(16, 185, 129, 0.16) !important;
          color: #34d399 !important;
          border: 1px solid rgba(16, 185, 129, 0.35) !important;
        }

        .dark .unrec-scan-badge,
        [data-theme="dark"] .unrec-scan-badge {
          background: rgba(16, 185, 129, 0.16) !important;
          color: #34d399 !important;
          border: 1px solid rgba(16, 185, 129, 0.35) !important;
        }

        .dark .unrec-scan-cam-loc,
        [data-theme="dark"] .unrec-scan-cam-loc {
          background: #1e2442 !important;
          color: #94a3b8 !important;
          border-color: rgba(139, 92, 246, 0.25) !important;
        }

        .dark .unrec-scan-idx,
        [data-theme="dark"] .unrec-scan-idx {
          background: #1e2442 !important;
          color: #94a3b8 !important;
        }

        .dark .unrec-scan-status-tag,
        [data-theme="dark"] .unrec-scan-status-tag {
          background: rgba(16, 185, 129, 0.16) !important;
          color: #34d399 !important;
          border: 1px solid rgba(16, 185, 129, 0.35) !important;
        }

        .dark .unrec-modal-face-header,
        [data-theme="dark"] .unrec-modal-face-header {
          background: #151936 !important;
          border-color: rgba(139, 92, 246, 0.25) !important;
        }

        .dark .pass-valid,
        [data-theme="dark"] .pass-valid {
          background: rgba(16, 185, 129, 0.16) !important;
          color: #34d399 !important;
          border: 1px solid rgba(16, 185, 129, 0.35) !important;
        }

        .dark .pass-expired,
        [data-theme="dark"] .pass-expired {
          background: rgba(239, 68, 68, 0.16) !important;
          color: #f87171 !important;
          border: 1px solid rgba(239, 68, 68, 0.35) !important;
        }

        .dark .unrec-count-badge.count-normal,
        [data-theme="dark"] .unrec-count-badge.count-normal {
          background: #1e2442 !important;
          color: #cbd5e1 !important;
          border: 1px solid rgba(139, 92, 246, 0.2) !important;
        }

        .dark .unrec-count-badge.count-alert,
        [data-theme="dark"] .unrec-count-badge.count-alert {
          background: rgba(239, 68, 68, 0.18) !important;
          color: #fca5a5 !important;
          border: 1px solid rgba(239, 68, 68, 0.4) !important;
        }

        .dark .unrec-action-view,
        [data-theme="dark"] .unrec-action-view {
          background: rgba(16, 185, 129, 0.16) !important;
          color: #34d399 !important;
          border: 1px solid rgba(16, 185, 129, 0.35) !important;
        }

        .dark .unrec-action-del,
        [data-theme="dark"] .unrec-action-del {
          background: #171b38 !important;
          border: 1px solid rgba(239, 68, 68, 0.3) !important;
          color: #f87171 !important;
        }

        .dark .unrec-table-footer,
        [data-theme="dark"] .unrec-table-footer {
          border-top: 1px solid rgba(139, 92, 246, 0.16) !important;
        }

        .dark .unrec-footer-count,
        [data-theme="dark"] .unrec-footer-count {
          color: #94a3b8 !important;
        }

        .dark .unrec-page-size-selector,
        [data-theme="dark"] .unrec-page-size-selector {
          color: #94a3b8 !important;
        }

        .dark .unrec-select-pagesize,
        [data-theme="dark"] .unrec-select-pagesize {
          background-color: #171b38 !important;
          border-color: rgba(139, 92, 246, 0.25) !important;
          color: #f1f5f9 !important;
        }

        .dark .unrec-select-pagesize option,
        [data-theme="dark"] .unrec-select-pagesize option {
          background-color: #171b38 !important;
          color: #f1f5f9 !important;
        }

        .dark .unrec-page-arrow,
        [data-theme="dark"] .unrec-page-arrow {
          background: #171b38 !important;
          border: 1px solid rgba(139, 92, 246, 0.25) !important;
          color: #94a3b8 !important;
        }

        .dark .unrec-page-num,
        [data-theme="dark"] .unrec-page-num {
          background: #171b38 !important;
          border: 1px solid rgba(139, 92, 246, 0.25) !important;
          color: #cbd5e1 !important;
        }

        .dark .unrec-page-num.active,
        [data-theme="dark"] .unrec-page-num.active {
          background: #059669 !important;
          color: #ffffff !important;
        }

        .dark .unrec-bottom-card,
        [data-theme="dark"] .unrec-bottom-card {
          background: var(--surface, #141829) !important;
          border: 1px solid rgba(139, 92, 246, 0.2) !important;
          box-shadow: 0 4px 22px rgba(0, 0, 0, 0.45) !important;
        }

        .dark .unrec-bottom-header-title,
        [data-theme="dark"] .unrec-bottom-header-title {
          color: #f1f5f9 !important;
        }

        .dark .unrec-meta-section,
        [data-theme="dark"] .unrec-meta-section {
          background: #151936 !important;
          border-color: rgba(139, 92, 246, 0.2) !important;
        }

        .dark .unrec-preview-details-box,
        [data-theme="dark"] .unrec-preview-details-box {
          background: #151936 !important;
          border-color: rgba(139, 92, 246, 0.2) !important;
        }

        .dark .unrec-preview-val,
        [data-theme="dark"] .unrec-preview-val {
          color: #f1f5f9 !important;
        }

        .dark .unrec-scan-summary-banner,
        [data-theme="dark"] .unrec-scan-summary-banner {
          background: #151936 !important;
          border-color: rgba(16, 185, 129, 0.3) !important;
        }

        .dark .unrec-scan-summary-name,
        [data-theme="dark"] .unrec-scan-summary-name {
          color: #34d399 !important;
        }

        .dark .unrec-scan-table-wrap,
        [data-theme="dark"] .unrec-scan-table-wrap {
          background: #101426 !important;
          border-color: rgba(139, 92, 246, 0.2) !important;
        }

        .dark .unrec-scan-table thead th,
        [data-theme="dark"] .unrec-scan-table thead th {
          background: #181d38 !important;
          color: #34d399 !important;
          border-bottom-color: rgba(139, 92, 246, 0.2) !important;
        }

        .dark .unrec-scan-table tbody td,
        [data-theme="dark"] .unrec-scan-table tbody td {
          color: #e2e8f0 !important;
          border-bottom-color: rgba(139, 92, 246, 0.12) !important;
        }

        .dark .unrec-scan-cam-name,
        [data-theme="dark"] .unrec-scan-cam-name {
          color: #f1f5f9 !important;
        }

        .dark .unrec-scan-table tbody tr:hover td,
        [data-theme="dark"] .unrec-scan-table tbody tr:hover td {
          background: rgba(16, 185, 129, 0.08) !important;
        }

        /* ── Movement & Scan History Modal Dark Mode ── */
        .dark .unrec-scan-summary-avatar,
        [data-theme="dark"] .unrec-scan-summary-avatar {
          background: #171b38 !important;
          border-color: #10b981 !important;
        }

        .dark .unrec-scan-summary-sub,
        [data-theme="dark"] .unrec-scan-summary-sub {
          color: #94a3b8 !important;
        }

        .dark .unrec-scan-stat-box.box-total,
        [data-theme="dark"] .unrec-scan-stat-box.box-total {
          background: #181d38 !important;
          border: 1px solid rgba(139, 92, 246, 0.25) !important;
        }

        .dark .unrec-scan-stat-box.box-in,
        [data-theme="dark"] .unrec-scan-stat-box.box-in {
          background: rgba(16, 185, 129, 0.16) !important;
          border: 1px solid rgba(16, 185, 129, 0.35) !important;
        }

        .dark .unrec-scan-stat-box.box-out,
        [data-theme="dark"] .unrec-scan-stat-box.box-out {
          background: rgba(59, 130, 246, 0.16) !important;
          border: 1px solid rgba(59, 130, 246, 0.35) !important;
        }

        .dark .unrec-scan-stat-label,
        [data-theme="dark"] .unrec-scan-stat-label {
          color: #cbd5e1 !important;
        }

        .dark .unrec-scan-stat-num,
        [data-theme="dark"] .unrec-scan-stat-num {
          color: #f1f5f9 !important;
        }

        .dark .unrec-scan-stat-num.in-green,
        [data-theme="dark"] .unrec-scan-stat-num.in-green {
          color: #34d399 !important;
        }

        .dark .unrec-scan-stat-num.out-blue,
        [data-theme="dark"] .unrec-scan-stat-num.out-blue {
          color: #60a5fa !important;
        }

        .dark .unrec-scan-stat-hint,
        [data-theme="dark"] .unrec-scan-stat-hint {
          color: #94a3b8 !important;
        }

        .dark .unrec-scan-thumb,
        [data-theme="dark"] .unrec-scan-thumb {
          background: #171b38 !important;
          border: 1px solid rgba(139, 92, 246, 0.25) !important;
        }

        .dark .pill-dir-in,
        [data-theme="dark"] .pill-dir-in,
        .dark .dir-in,
        [data-theme="dark"] .dir-in {
          background: rgba(16, 185, 129, 0.16) !important;
          color: #34d399 !important;
          border: 1px solid rgba(16, 185, 129, 0.35) !important;
        }

        .dark .pill-dir-out,
        [data-theme="dark"] .pill-dir-out,
        .dark .dir-out,
        [data-theme="dark"] .dir-out {
          background: rgba(59, 130, 246, 0.16) !important;
          color: #60a5fa !important;
          border: 1px solid rgba(59, 130, 246, 0.35) !important;
        }

        .dark .unrec-modal-close-btn,
        [data-theme="dark"] .unrec-modal-close-btn {
          background: #171b38 !important;
          border: 1px solid rgba(139, 92, 246, 0.25) !important;
          color: #cbd5e1 !important;
        }

        .dark .unrec-modal-close-btn:hover,
        [data-theme="dark"] .unrec-modal-close-btn:hover {
          background: #23284f !important;
          color: #ffffff !important;
        }

        .dark .meta-value.ip-code,
        [data-theme="dark"] .meta-value.ip-code {
          background: #171b38 !important;
          color: #cbd5e1 !important;
          border-color: rgba(139, 92, 246, 0.25) !important;
        }
      `}</style>
    </div>
  );
};

export default UnknownFaces;
