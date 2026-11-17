import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { getEmployeeById, updateEmployee } from './employee.service';
import { validateEmployee } from './employee.validation';
import {
  getEnrollmentsByEmployee,
  createEnrollment,
  updateEnrollment,
} from '../face-enrollment/face-enrollment.service';
import Input from '../../components/common/Input';
import Button from '../../components/common/Button';
import Loader from '../../components/common/Loader';

const ANGLES = [
  {
    id: 'front',
    label: 'Front View',
    hint: 'Look straight at the camera',
    icon: (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="12" cy="12" r="10" />
        <circle cx="9" cy="10" r="1.5" fill="currentColor" />
        <circle cx="15" cy="10" r="1.5" fill="currentColor" />
        <path d="M10 15a4 4 0 0 0 4 0" />
      </svg>
    ),
  },
  {
    id: 'left',
    label: 'Left Angle',
    hint: 'Turn head slightly left (~30°)',
    icon: (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="12" cy="12" r="10" />
        <circle cx="8" cy="10" r="1.5" fill="currentColor" />
        <circle cx="13" cy="10" r="1.5" fill="currentColor" />
        <path d="M8 15a3 3 0 0 0 3.5-1" />
        <path d="M4 12l-2-2m0 0l2-2m-2 2h4" />
      </svg>
    ),
  },
  {
    id: 'right',
    label: 'Right Angle',
    hint: 'Turn head slightly right (~30°)',
    icon: (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="12" cy="12" r="10" />
        <circle cx="11" cy="10" r="1.5" fill="currentColor" />
        <circle cx="16" cy="10" r="1.5" fill="currentColor" />
        <path d="M12.5 14a3 3 0 0 0 3.5 1" />
        <path d="M20 12l2-2m0 0l-2-2m2 2h-4" />
      </svg>
    ),
  },
];

const EmployeeEdit = () => {
  const { id } = useParams();
  const navigate = useNavigate();

  // Employee Form State
  const [formData, setFormData] = useState({
    employeeCode: '',
    firstName: '',
    lastName: '',
    email: '',
    phone: '',
    department: '',
    designation: '',
    joiningDate: '',
    status: 'ACTIVE',
  });

  const [initialLoading, setInitialLoading] = useState(true);
  const [errors, setErrors] = useState({});
  const [apiError, setApiError] = useState('');
  const [loading, setLoading] = useState(false);

  // Face Enrollment State
  const [enrollment, setEnrollment] = useState(null);
  const [capturedImages, setCapturedImages] = useState({
    front: null,
    left: null,
    right: null,
  });

  const [activeAngle, setActiveAngle] = useState(null);
  const [cameraActive, setCameraActive] = useState(false);
  const [cameraError, setCameraError] = useState('');
  const [faceErrors, setFaceErrors] = useState({});
  const [dragOverAngle, setDragOverAngle] = useState(null);

  const videoRef = useRef(null);
  const streamRef = useRef(null);
  const quickUploadRef = useRef(null);
  const fileInputRefs = {
    front: useRef(null),
    left: useRef(null),
    right: useRef(null),
  };

  // Stop camera tracks cleanly
  const stopCamera = useCallback(() => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    }
    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
    setCameraActive(false);
    setActiveAngle(null);
  }, []);

  useEffect(() => {
    return () => {
      stopCamera();
    };
  }, [stopCamera]);

  // Ensure active video element always receives the stream
  useEffect(() => {
    if (videoRef.current && streamRef.current && cameraActive) {
      if (videoRef.current.srcObject !== streamRef.current) {
        videoRef.current.srcObject = streamRef.current;
      }
      videoRef.current.play().catch((err) => {
        console.warn('Video playback warning:', err);
      });
    }
  }, [activeAngle, cameraActive]);

  useEffect(() => {
    const fetchEmployeeAndEnrollment = async () => {
      try {
        const empRes = await getEmployeeById(id);
        const emp = empRes.data || empRes;
        if (emp) {
          setFormData({
            employeeCode: emp.employeeCode || '',
            firstName: emp.firstName || '',
            lastName: emp.lastName || '',
            email: emp.email || '',
            phone: emp.phone || '',
            department: emp.department || '',
            designation: emp.designation || '',
            joiningDate: emp.joiningDate ? emp.joiningDate.substring(0, 10) : '',
            status: emp.status || 'ACTIVE',
          });

          // Check if face enrollment already exists
          let enrollData = emp.faceEnrollment || null;
          if (!enrollData) {
            try {
              const enrollRes = await getEnrollmentsByEmployee(id);
              if (enrollRes?.data) {
                enrollData = enrollRes.data;
              }
            } catch (e) {
              enrollData = null;
            }
          }

          if (enrollData) {
            setEnrollment(enrollData);

            let parsedImages = {};
            if (enrollData.images) {
              if (typeof enrollData.images === 'string') {
                try {
                  parsedImages = JSON.parse(enrollData.images);
                } catch (e) {
                  parsedImages = {};
                }
              } else if (typeof enrollData.images === 'object') {
                parsedImages = enrollData.images;
              }
            }

            const frontImg = parsedImages.front || enrollData.photoUrl || null;
            const leftImg = parsedImages.left || null;
            const rightImg = parsedImages.right || null;

            setCapturedImages({
              front: frontImg ? { dataUrl: frontImg } : null,
              left: leftImg ? { dataUrl: leftImg } : null,
              right: rightImg ? { dataUrl: rightImg } : null,
            });
          }
        }
      } catch (err) {
        setApiError(err.response?.data?.message || 'Failed to load employee details.');
      } finally {
        setInitialLoading(false);
      }
    };

    fetchEmployeeAndEnrollment();
  }, [id]);

  // Request browser camera stream
  const startCamera = async (targetAngle = 'front') => {
    setCameraError('');
    try {
      let stream = streamRef.current;
      if (!stream || !stream.active) {
        stream = await navigator.mediaDevices.getUserMedia({
          video: {
            width: { ideal: 640 },
            height: { ideal: 480 },
            facingMode: 'user',
          },
          audio: false,
        });
        streamRef.current = stream;
      }

      setCameraActive(true);
      setActiveAngle(targetAngle);

      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        videoRef.current.play().catch(() => {});
      }
    } catch (err) {
      console.error('Camera access error:', err);
      setCameraError(
        'Unable to access camera. Please allow camera permissions in your browser to proceed with face enrollment.'
      );
      setCameraActive(false);
    }
  };

  const handleSelectAngle = (angleId) => {
    if (capturedImages[angleId]) return;
    startCamera(angleId);
  };

  const handleCapturePhoto = (angleId) => {
    if (!videoRef.current || !streamRef.current) return;

    try {
      const video = videoRef.current;
      const canvas = document.createElement('canvas');
      canvas.width = video.videoWidth || 640;
      canvas.height = video.videoHeight || 480;

      const ctx = canvas.getContext('2d');
      ctx.translate(canvas.width, 0);
      ctx.scale(-1, 1);
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

      const dataUrl = canvas.toDataURL('image/jpeg', 0.9);

      // Generate normalized feature vector from canvas pixels
      const tempCanvas = document.createElement('canvas');
      tempCanvas.width = 16;
      tempCanvas.height = 16;
      const tempCtx = tempCanvas.getContext('2d');
      tempCtx.drawImage(canvas, 0, 0, 16, 16);
      const imgData = tempCtx.getImageData(0, 0, 16, 16).data;

      const vector = [];
      for (let i = 0; i < 128; i++) {
        const idx = i * 2 * 4;
        const r = imgData[idx] || 0;
        const g = imgData[idx + 1] || 0;
        const b = imgData[idx + 2] || 0;
        const gray = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
        const val = parseFloat(((gray - 0.5) * 2).toFixed(4));
        vector.push(val);
      }

      setCapturedImages((prev) => ({
        ...prev,
        [angleId]: { dataUrl, vector },
      }));

      if (faceErrors[angleId] || faceErrors.general) {
        setFaceErrors((prev) => ({ ...prev, [angleId]: false, general: '' }));
      }

      const remaining = ANGLES.filter(
        (a) => a.id !== angleId && !capturedImages[a.id]
      );
      if (remaining.length > 0) {
        setActiveAngle(remaining[0].id);
      } else {
        setActiveAngle(null);
        stopCamera();
      }
    } catch (err) {
      console.error('Photo capture error:', err);
    }
  };

  const handleRetake = (angleId) => {
    setCapturedImages((prev) => ({
      ...prev,
      [angleId]: null,
    }));
    startCamera(angleId);
  };

  const handleRemoveImage = (angleId) => {
    setCapturedImages((prev) => ({
      ...prev,
      [angleId]: null,
    }));
  };

  const processImageFile = (file) => {
    return new Promise((resolve, reject) => {
      if (!file) return reject(new Error('No file selected'));
      if (!file.type.startsWith('image/')) {
        return reject(new Error('Please select an image file (JPG, PNG, WEBP).'));
      }

      const reader = new FileReader();
      reader.onload = (e) => {
        const dataUrl = e.target.result;
        const img = new Image();
        img.onload = () => {
          const canvas = document.createElement('canvas');
          canvas.width = 16;
          canvas.height = 16;
          const ctx = canvas.getContext('2d');
          ctx.drawImage(img, 0, 0, 16, 16);
          const imgData = ctx.getImageData(0, 0, 16, 16).data;

          const vector = [];
          for (let i = 0; i < 128; i++) {
            const idx = i * 2 * 4;
            const r = imgData[idx] || 0;
            const g = imgData[idx + 1] || 0;
            const b = imgData[idx + 2] || 0;
            const gray = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
            const val = parseFloat(((gray - 0.5) * 2).toFixed(4));
            vector.push(val);
          }

          resolve({
            dataUrl,
            vector,
            fileName: file.name,
          });
        };
        img.onerror = () => reject(new Error('Failed to decode image file.'));
        img.src = dataUrl;
      };
      reader.onerror = () => reject(new Error('Failed to read image file.'));
      reader.readAsDataURL(file);
    });
  };

  const handleAngleFileUpload = async (angleId, file) => {
    if (!file) return;
    try {
      if (cameraActive && activeAngle === angleId) {
        stopCamera();
      }
      const processed = await processImageFile(file);
      setCapturedImages((prev) => ({
        ...prev,
        [angleId]: processed,
      }));
      setFaceErrors((prev) => ({
        ...prev,
        [angleId]: false,
        general: '',
      }));
    } catch (err) {
      setFaceErrors((prev) => ({
        ...prev,
        general: err.message || 'Failed to upload photo.',
      }));
    }
  };

  const handleQuickUpload = async (e) => {
    const files = Array.from(e.target.files || []);
    if (!files.length) return;

    try {
      if (cameraActive) stopCamera();

      if (files.length === 1) {
        const processed = await processImageFile(files[0]);
        setCapturedImages({
          front: processed,
          left: processed,
          right: processed,
        });
        setFaceErrors({});
      } else {
        const order = ['front', 'left', 'right'];
        const newCaptured = { ...capturedImages };
        for (let i = 0; i < Math.min(files.length, 3); i++) {
          const processed = await processImageFile(files[i]);
          newCaptured[order[i]] = processed;
        }
        setCapturedImages(newCaptured);
        setFaceErrors({});
      }
    } catch (err) {
      setFaceErrors((prev) => ({
        ...prev,
        general: err.message || 'Failed to process uploaded images.',
      }));
    } finally {
      e.target.value = '';
    }
  };

  const getCombinedVector = () => {
    const fVec = capturedImages.front?.vector;
    const lVec = capturedImages.left?.vector;
    const rVec = capturedImages.right?.vector;

    // If no new photos were retaken during this edit session, keep existing embedding
    if (!fVec && !lVec && !rVec) {
      return enrollment?.embedding || [];
    }

    const fallbackVec = enrollment?.embedding || [];
    const combined = [];
    for (let i = 0; i < 128; i++) {
      const f = fVec ? fVec[i] : (fallbackVec[i] ?? 0);
      const l = lVec ? lVec[i] : (fallbackVec[i] ?? 0);
      const r = rVec ? rVec[i] : (fallbackVec[i] ?? 0);
      const avg = parseFloat((f * 0.5 + l * 0.25 + r * 0.25).toFixed(4));
      combined.push(avg);
    }
    return combined;
  };

  const handleChange = (e) => {
    const { name, value } = e.target;
    setFormData((prev) => ({
      ...prev,
      [name]: value,
    }));
    if (errors[name]) {
      setErrors((prev) => ({ ...prev, [name]: '' }));
    }
    if (apiError) {
      setApiError('');
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setApiError('');

    // 1. Validate employee form fields
    const validation = validateEmployee(formData);
    if (!validation.isValid) {
      setErrors(validation.errors);
      return;
    }

    // 2. Validate face angles - if front is provided, automatically fallback left & right to front if missing
    let imagesToSubmit = { ...capturedImages };
    if (imagesToSubmit.front && (!imagesToSubmit.left || !imagesToSubmit.right)) {
      imagesToSubmit = {
        front: imagesToSubmit.front,
        left: imagesToSubmit.left || imagesToSubmit.front,
        right: imagesToSubmit.right || imagesToSubmit.front,
      };
      setCapturedImages(imagesToSubmit);
    }

    const missingAngles = ANGLES.filter((a) => !imagesToSubmit[a.id]);
    if (missingAngles.length > 0) {
      const newFaceErrors = {
        general:
          'Please ensure at least a Front View face photo is captured or uploaded before updating.',
      };
      missingAngles.forEach((a) => {
        newFaceErrors[a.id] = true;
      });
      setFaceErrors(newFaceErrors);

      if (!cameraActive && !imagesToSubmit.front) {
        startCamera(missingAngles[0].id);
      }
      return;
    }

    setLoading(true);
    try {
      // 3. Prepare payload with trimmed strings & null for empty optional fields
      const payload = {
        employeeCode: formData.employeeCode.trim(),
        firstName: formData.firstName.trim(),
        lastName: formData.lastName ? formData.lastName.trim() : null,
        email: formData.email ? formData.email.trim() : null,
        phone: formData.phone ? formData.phone.trim() : null,
        department: formData.department ? formData.department.trim() : null,
        designation: formData.designation ? formData.designation.trim() : null,
        joiningDate: formData.joiningDate || null,
        status: formData.status || 'ACTIVE',
      };

      // 4. Update Employee
      await updateEmployee(id, payload);

      // 5. Update or Create Face Enrollment
      const embedding = getCombinedVector();
      const imagesPayload = {
        front: capturedImages.front?.dataUrl || null,
        left: capturedImages.left?.dataUrl || null,
        right: capturedImages.right?.dataUrl || null,
      };
      const photoUrl = capturedImages.front?.dataUrl || null;

      if (enrollment?.id) {
        await updateEnrollment(enrollment.id, {
          embedding: embedding.length > 0 ? embedding : enrollment.embedding,
          images: imagesPayload,
          photoUrl,
        });
      } else {
        await createEnrollment({
          employeeId: id,
          embedding,
          images: imagesPayload,
          photoUrl,
        });
      }

      // 6. Clean up camera & navigate
      stopCamera();
      navigate(`/employees/${id}`);
    } catch (err) {
      const msg =
        err.response?.data?.message ||
        err.message ||
        'Failed to update employee and face enrollment.';

      setApiError(msg);

      if (err.response?.status === 400 && err.response?.data?.errors) {
        setErrors(err.response.data.errors);
      } else if (err.response?.status === 409) {
        if (msg.toLowerCase().includes('code')) {
          setErrors((prev) => ({ ...prev, employeeCode: msg }));
        }
        if (msg.toLowerCase().includes('email')) {
          setErrors((prev) => ({ ...prev, email: msg }));
        }
      }

      window.scrollTo({ top: 0, behavior: 'smooth' });
    } finally {
      setLoading(false);
    }
  };

  if (initialLoading) {
    return (
      <div className="page-container">
        <Loader message="Loading employee details..." />
      </div>
    );
  }

  const totalCaptured = Object.values(capturedImages).filter(Boolean).length;

  return (
    <div className="emp-directory-page fade-in">
      {/* ── HERO BANNER ─────────────────────────────────────────────── */}
      <div className="emp-hero-banner">
        <div className="emp-hero-left">
          <div className="emp-hero-icon-box">
            <svg viewBox="0 0 24 24" width="28" height="28" fill="#047857">
              <path d="M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z" />
            </svg>
          </div>
          <div className="emp-hero-text">
            <h1 className="emp-hero-title">Edit Employee Record</h1>
            <p className="emp-hero-subtitle">
              Update personnel details and manage biometric face credentials.
            </p>
          </div>
        </div>

        <div className="emp-hero-right">
          <button
            type="button"
            className="emp-btn-back"
            onClick={() => {
              stopCamera();
              navigate(`/employees/${id}`);
            }}
          >
            <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="19" y1="12" x2="5" y2="12" />
              <polyline points="12 19 5 12 12 5" />
            </svg>
            <span>Back to Profile</span>
          </button>
        </div>
      </div>

      {apiError && <div className="alert alert-danger mb-4">{apiError}</div>}

      <div className="emp-form-card">
        <form onSubmit={handleSubmit} noValidate>
          {/* Employee Information Section */}
          <div className="form-grid">
            <Input
              label="Employee Code"
              name="employeeCode"
              value={formData.employeeCode}
              onChange={handleChange}
              error={errors.employeeCode}
              required
            />

            <Input
              label="First Name"
              name="firstName"
              value={formData.firstName}
              onChange={handleChange}
              error={errors.firstName}
              required
            />

            <Input
              label="Last Name"
              name="lastName"
              value={formData.lastName}
              onChange={handleChange}
              error={errors.lastName}
            />

            <Input
              label="Email Address"
              type="email"
              name="email"
              value={formData.email}
              onChange={handleChange}
              error={errors.email}
            />

            <Input
              label="Phone Number"
              name="phone"
              value={formData.phone}
              onChange={handleChange}
              error={errors.phone}
            />

            <Input
              label="Department"
              name="department"
              value={formData.department}
              onChange={handleChange}
              error={errors.department}
            />

            <Input
              label="Designation"
              name="designation"
              value={formData.designation}
              onChange={handleChange}
              error={errors.designation}
            />

            <Input
              label="Joining Date"
              type="date"
              name="joiningDate"
              value={formData.joiningDate}
              onChange={handleChange}
              error={errors.joiningDate}
            />

            <div className="form-group">
              <label htmlFor="status" className="form-label">
                Status
              </label>
              <select
                id="status"
                name="status"
                value={formData.status}
                onChange={handleChange}
                className="form-input"
              >
                <option value="ACTIVE">ACTIVE</option>
                <option value="INACTIVE">INACTIVE</option>
              </select>
            </div>
          </div>

          {/* Face Enrollment & Retake Section */}
          <div className="face-enrollment-section">
            <div className="face-enrollment-header">
              <div className="flex items-center justify-between flex-wrap gap-3">
                <div>
                  <h3 className="face-enrollment-title">
                    <svg
                      width="20"
                      height="20"
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
                    Biometric Face Photos
                  </h3>
                  <p className="face-enrollment-subtitle">
                    Upload new photos or retake live from camera for attendance recognition.
                  </p>
                </div>

                <div className="flex items-center gap-2">
                  <input
                    type="file"
                    ref={quickUploadRef}
                    onChange={handleQuickUpload}
                    accept="image/jpeg,image/png,image/webp,image/jpg"
                    multiple
                    style={{ display: 'none' }}
                  />
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="flex items-center gap-1.5 font-medium border-primary/40 text-primary hover:bg-primary/10"
                    onClick={() => quickUploadRef.current?.click()}
                    title="Upload single photo (autofills all angles) or 3 photos from your computer"
                  >
                    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                      <polyline points="17 8 12 3 7 8" />
                      <line x1="12" y1="3" x2="12" y2="15" />
                    </svg>
                    Upload Photo(s)
                  </Button>

                  <span
                    className={`angle-status-badge ${
                      totalCaptured === 3 ? 'badge-captured' : 'badge-pending'
                    }`}
                  >
                    {totalCaptured}/3 Angles Ready
                  </span>
                </div>
              </div>

              {cameraError && (
                <div className="camera-permission-alert mt-3">
                  <span>{cameraError}</span>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={() => startCamera(activeAngle || 'front')}
                  >
                    Retry Permission
                  </Button>
                </div>
              )}

              {faceErrors.general && (
                <div className="alert alert-danger mt-3">
                  {faceErrors.general}
                </div>
              )}
            </div>

            {/* Global camera controls toolbar when streaming */}
            {cameraActive && (
              <div className="camera-global-toolbar">
                <div className="camera-status-indicator">
                  <span className="camera-pulse-dot" />
                  <span>
                    Camera Active &bull; Retaking{' '}
                    <strong>
                      {ANGLES.find((a) => a.id === activeAngle)?.label ||
                        'Front View'}
                    </strong>
                  </span>
                </div>
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  onClick={stopCamera}
                >
                  Turn Off Camera
                </Button>
              </div>
            )}

            {/* 3 Angle Cards Grid */}
            <div className="face-angles-grid">
              {ANGLES.map((angle) => {
                const captured = capturedImages[angle.id];
                const isCaptured = !!captured?.dataUrl;
                const isStreaming = cameraActive && activeAngle === angle.id;
                const hasError = !!faceErrors[angle.id];

                return (
                  <div
                    key={angle.id}
                    className={`face-angle-card ${
                      isStreaming ? 'active-stream' : ''
                    } ${isCaptured ? 'captured' : ''} ${
                      hasError ? 'has-error' : ''
                    }`}
                  >
                    {/* Hidden file input for this angle */}
                    <input
                      type="file"
                      ref={fileInputRefs[angle.id]}
                      onChange={(e) => {
                        const file = e.target.files?.[0];
                        if (file) handleAngleFileUpload(angle.id, file);
                        e.target.value = '';
                      }}
                      accept="image/jpeg,image/png,image/webp,image/jpg"
                      style={{ display: 'none' }}
                    />

                    <div className="angle-card-header">
                      <div className="angle-card-title-group">
                        <span className="angle-icon-badge">{angle.icon}</span>
                        <div>
                          <div className="angle-card-label">{angle.label}</div>
                          <div className="angle-card-hint">{angle.hint}</div>
                        </div>
                      </div>
                      <div>
                        {isCaptured ? (
                          <span className="angle-status-badge badge-captured">
                            Captured ✓
                          </span>
                        ) : isStreaming ? (
                          <span className="angle-status-badge badge-live">
                            Live
                          </span>
                        ) : (
                          <span className="angle-status-badge badge-pending">
                            Pending
                          </span>
                        )}
                      </div>
                    </div>

                    {/* Preview Box with Drag & Drop */}
                    <div
                      className={`angle-preview-box ${dragOverAngle === angle.id ? 'drag-over' : ''}`}
                      onDragOver={(e) => {
                        e.preventDefault();
                        setDragOverAngle(angle.id);
                      }}
                      onDragLeave={() => setDragOverAngle(null)}
                      onDrop={(e) => {
                        e.preventDefault();
                        setDragOverAngle(null);
                        const file = e.dataTransfer.files?.[0];
                        if (file) handleAngleFileUpload(angle.id, file);
                      }}
                    >
                      {isCaptured ? (
                        <>
                          <img
                            src={captured.dataUrl}
                            alt={`${angle.label} captured`}
                            className="angle-captured-img"
                          />
                          {captured.fileName && (
                            <div className="absolute bottom-1 left-1 bg-black/60 text-white text-[10px] px-1.5 py-0.5 rounded truncate max-w-[90%]">
                              {captured.fileName}
                            </div>
                          )}
                        </>
                      ) : isStreaming ? (
                        <>
                          <video
                            ref={(el) => {
                              videoRef.current = el;
                              if (
                                el &&
                                streamRef.current &&
                                el.srcObject !== streamRef.current
                              ) {
                                el.srcObject = streamRef.current;
                                el.play().catch(() => {});
                              }
                            }}
                            autoPlay
                            playsInline
                            muted
                            className="angle-video-stream"
                          />
                          <div className="angle-guide-overlay">
                            <div className="angle-guide-oval" />
                            <div className="angle-guide-hint">{angle.hint}</div>
                          </div>
                        </>
                      ) : (
                        <div className="angle-idle-placeholder">
                          <svg
                            className="angle-idle-icon"
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="1.5"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                          >
                            <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z" />
                            <circle cx="12" cy="13" r="4" />
                          </svg>
                          <div className="text-xs text-muted-foreground flex flex-col gap-1 items-center">
                            <span>Drop photo here or choose:</span>
                            <div className="flex gap-2 mt-1">
                              <button
                                type="button"
                                className="text-primary hover:underline font-semibold cursor-pointer"
                                onClick={() => fileInputRefs[angle.id].current?.click()}
                              >
                                📁 Upload File
                              </button>
                              <span>•</span>
                              <button
                                type="button"
                                className="text-primary hover:underline font-semibold cursor-pointer"
                                onClick={() => handleSelectAngle(angle.id)}
                              >
                                📸 Camera
                              </button>
                            </div>
                          </div>
                        </div>
                      )}
                    </div>

                    {/* Actions */}
                    <div className="angle-card-actions flex gap-2">
                      {isCaptured ? (
                        <>
                          <Button
                            type="button"
                            variant="secondary"
                            size="sm"
                            className="flex-1 text-xs"
                            onClick={() => fileInputRefs[angle.id].current?.click()}
                            title="Upload new image from file"
                          >
                            Upload New
                          </Button>
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            className="flex-1 text-xs"
                            onClick={() => handleRetake(angle.id)}
                            title="Retake live from webcam"
                          >
                            Camera
                          </Button>
                          <button
                            type="button"
                            className="px-2 py-1 text-red-500 hover:bg-red-50 dark:hover:bg-red-950/30 rounded border border-red-200 dark:border-red-900 transition-colors cursor-pointer"
                            onClick={() => handleRemoveImage(angle.id)}
                            title="Remove photo"
                          >
                            ✕
                          </button>
                        </>
                      ) : isStreaming ? (
                        <Button
                          type="button"
                          size="sm"
                          className="btn-primary-gradient w-full"
                          onClick={() => handleCapturePhoto(angle.id)}
                        >
                          Capture Photo
                        </Button>
                      ) : (
                        <>
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            className="flex-1 text-xs flex items-center justify-center gap-1"
                            onClick={() => handleSelectAngle(angle.id)}
                          >
                            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                              <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z" />
                              <circle cx="12" cy="13" r="4" />
                            </svg>
                            Start Camera
                          </Button>
                          <Button
                            type="button"
                            variant="secondary"
                            size="sm"
                            className="flex-1 text-xs flex items-center justify-center gap-1"
                            onClick={() => fileInputRefs[angle.id].current?.click()}
                          >
                            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                              <polyline points="17 8 12 3 7 8" />
                              <line x1="12" y1="3" x2="12" y2="15" />
                            </svg>
                            Upload File
                          </Button>
                        </>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Submit Actions */}
          {apiError && <div className="alert alert-danger mt-6">{apiError}</div>}

          <div className="form-actions mt-6 pt-6 border-t border-gray-100 dark:border-gray-800 flex gap-3">
            <Button
              type="submit"
              loading={loading}
              disabled={loading}
              className="px-6"
            >
              Update Employee &amp; Enrollment
            </Button>
            <Button
              type="button"
              variant="secondary"
              onClick={() => {
                stopCamera();
                navigate(`/employees/${id}`);
              }}
            >
              Cancel
            </Button>
          </div>
        </form>
      </div>

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
          padding: 0 18px;
          border-radius: 10px;
          background: #ffffff;
          color: #334155;
          border: 1px solid #cbd5e1;
          font-size: 13.5px;
          font-weight: 600;
          display: inline-flex;
          align-items: center;
          gap: 8px;
          cursor: pointer;
          transition: all 0.2s ease;
          box-shadow: 0 1px 3px rgba(0, 0, 0, 0.04);
        }

        .emp-btn-back:hover {
          background: #f8fafc;
          border-color: #94a3b8;
          color: #0f172a;
          transform: translateY(-1px);
        }

        .emp-form-card {
          background: #ffffff;
          border: 1px solid #e2ece8;
          border-radius: 18px;
          padding: 32px 36px;
          box-shadow: 0 1px 4px rgba(0, 0, 0, 0.02);
          max-width: 980px;
        }
      `}</style>
    </div>
  );
};

export default EmployeeEdit;

