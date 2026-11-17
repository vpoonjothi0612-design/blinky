import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { createEnrollment } from './face-enrollment.service';
import { validateEnrollment } from './face-enrollment.validation';
import { getEmployees } from '../employee/employee.service';
import Button from '../../components/common/Button';
import Loader from '../../components/common/Loader';

const FaceEnrollmentCreate = () => {
  const navigate = useNavigate();

  const [employees, setEmployees] = useState([]);
  const [loadingEmployees, setLoadingEmployees] = useState(true);

  const [formData, setFormData] = useState({
    employeeId: '',
    images: { photos: [] },
  });

  const [photoNames, setPhotoNames] = useState([]);
  const [errors, setErrors] = useState({});
  const [apiError, setApiError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    const fetchEmployees = async () => {
      try {
        const response = await getEmployees();
        setEmployees(response.data || []);
      } catch (err) {
        setApiError('Failed to load employee list for selection.');
      } finally {
        setLoadingEmployees(false);
      }
    };

    fetchEmployees();
  }, []);

  const handleFileChange = async (e) => {
    const files = Array.from(e.target.files || []);
    if (files.length < 3 || files.length > 5) {
      setErrors((prev) => ({ ...prev, photos: 'Select 3 to 5 photos. The first photo must be a clear frontal view.' }));
      e.target.value = '';
      return;
    }
    if (files.some((file) => !file.type.startsWith('image/') || file.size > 10 * 1024 * 1024)) {
      setErrors((prev) => ({ ...prev, photos: 'Use image files up to 10 MB each.' }));
      return;
    }
    try {
      const photos = await Promise.all(files.map((file) => new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = () => reject(new Error(`Could not read ${file.name}`));
        reader.readAsDataURL(file);
      })));
      setPhotoNames(files.map((file) => file.name));
      setFormData((prev) => ({ ...prev, images: { photos } }));
      setErrors((prev) => ({ ...prev, photos: '' }));
    } catch (error) {
      setErrors((prev) => ({ ...prev, photos: error.message }));
    }
  };

  const handleEmployeeChange = (e) => {
    const value = e.target.value;
    setFormData((prev) => ({ ...prev, employeeId: value }));
    if (errors.employeeId) {
      setErrors((prev) => ({ ...prev, employeeId: '' }));
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setApiError('');

    const validation = validateEnrollment(formData);
    if (!validation.isValid) {
      setErrors(validation.errors);
      return;
    }

    setSubmitting(true);
    try {
      await createEnrollment(formData);
      navigate('/face-enrollments');
    } catch (err) {
      if (err.response?.status === 400 && err.response?.data?.errors) {
        setErrors(err.response.data.errors);
      } else {
        setApiError(err.response?.data?.message || 'Failed to create face enrollment.');
      }
    } finally {
      setSubmitting(false);
    }
  };

  if (loadingEmployees) {
    return (
      <div className="page-container">
        <Loader message="Loading employees..." />
      </div>
    );
  }

  return (
    <div className="page-container">
      <div className="page-header">
        <h2>Enroll New Face</h2>
        <Button variant="secondary" onClick={() => navigate('/face-enrollments')}>
          Back to Face Registry
        </Button>
      </div>

      {apiError && <div className="alert alert-danger">{apiError}</div>}

      <form onSubmit={handleSubmit} noValidate className="form-grid">
        <div className="form-group">
          <label htmlFor="employeeId" className="form-label">
            Select Employee <span className="required-star">*</span>
          </label>
          <select
            id="employeeId"
            name="employeeId"
            value={formData.employeeId}
            onChange={handleEmployeeChange}
            className={`form-input ${errors.employeeId ? 'input-error' : ''}`}
          >
            <option value="">-- Choose Employee --</option>
            {employees.map((emp) => (
              <option key={emp.id} value={emp.id}>
                {emp.employeeCode} - {emp.firstName} {emp.lastName || ''} ({emp.department || 'No Dept'})
              </option>
            ))}
          </select>
          {errors.employeeId && (
            <span className="error-text">{errors.employeeId}</span>
          )}
        </div>

        <div className="form-group" style={{ gridColumn: '1 / -1' }}>
          <label className="form-label">
            Face Photo / Feature Data <span className="required-star">*</span>
          </label>
          
          <div 
            className={`dropzone-container ${errors.photos ? 'dropzone-error' : ''}`}
            style={{
              border: '2px dashed var(--border-strong)',
              borderRadius: 'var(--radius-lg)',
              padding: '40px 20px',
              textAlign: 'center',
              backgroundColor: 'var(--surface-2)',
              position: 'relative',
              cursor: 'pointer',
              transition: 'all 0.2s ease',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '12px'
            }}
            onMouseOver={(e) => {
              e.currentTarget.style.borderColor = 'var(--primary)';
              e.currentTarget.style.backgroundColor = 'var(--primary-light)';
            }}
            onMouseOut={(e) => {
              e.currentTarget.style.borderColor = 'var(--border-strong)';
              e.currentTarget.style.backgroundColor = 'var(--surface-2)';
            }}
          >
            <input
              type="file"
              accept="image/*"
              multiple
              required
              onChange={handleFileChange}
              style={{
                position: 'absolute',
                top: 0,
                left: 0,
                width: '100%',
                height: '100%',
                opacity: 0,
                cursor: 'pointer'
              }}
            />
            
            <div style={{ 
              width: '56px', 
              height: '56px', 
              borderRadius: '50%', 
              background: 'var(--grad-primary)', 
              display: 'flex', 
              alignItems: 'center', 
              justifyContent: 'center',
              color: 'white',
              boxShadow: 'var(--shadow-md)'
            }}>
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
                <polyline points="17 8 12 3 7 8"></polyline>
                <line x1="12" y1="3" x2="12" y2="15"></line>
              </svg>
            </div>
            
            <div>
              <p style={{ margin: 0, fontSize: '15px', fontWeight: 600, color: 'var(--text-primary)' }}>
                {photoNames.length ? `${photoNames.length} photos selected` : 'Click or drag 3–5 face photos to upload'}
              </p>
              <p style={{ margin: '4px 0 0', fontSize: '13px', color: 'var(--text-muted)' }}>
                {photoNames.length ? photoNames.join(', ') : 'First photo: frontal view. Include varied angles and lighting; each image is checked by the AI service.'}
              </p>
            </div>
          </div>
          
          {errors.photos && (
            <span className="error-text" style={{ marginTop: '8px', display: 'block' }}>{errors.photos}</span>
          )}
        </div>

        <div className="form-actions" style={{ gridColumn: '1 / -1', marginTop: '24px', display: 'flex', gap: '12px', justifyContent: 'flex-end' }}>
          <Button type="submit" loading={submitting} disabled={submitting}>
            Submit Enrollment
          </Button>
          <Button
            type="button"
            variant="secondary"
            onClick={() => navigate('/face-enrollments')}
          >
            Cancel
          </Button>
        </div>
      </form>
    </div>
  );
};

export default FaceEnrollmentCreate;
