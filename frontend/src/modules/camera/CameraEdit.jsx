import React, { useState, useEffect } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { getCameraById, updateCamera } from './camera.service';
import { validateCamera } from './camera.validation';
import Input from '../../components/common/Input';
import Button from '../../components/common/Button';
import Loader from '../../components/common/Loader';

const CameraEdit = () => {
  const { id } = useParams();
  const navigate = useNavigate();

  const [formData, setFormData] = useState({
    name: '',
    location: '',
    ipAddress: '',
    rtspUrl: '',
    status: 'ACTIVE',
  });

  const [initialLoading, setInitialLoading] = useState(true);
  const [errors, setErrors] = useState({});
  const [apiError, setApiError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    const fetchCamera = async () => {
      try {
        const response = await getCameraById(id);
        const cam = response.data;
        if (cam) {
          setFormData({
            name: cam.name || '',
            location: cam.location || '',
            ipAddress: cam.ipAddress || '',
            rtspUrl: cam.rtspUrl || '',
            status: cam.status || 'ACTIVE',
          });
        }
      } catch (err) {
        setApiError(err.response?.data?.message || 'Failed to load camera details.');
      } finally {
        setInitialLoading(false);
      }
    };

    fetchCamera();
  }, [id]);

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

    const validation = validateCamera(formData);
    if (!validation.isValid) {
      setErrors(validation.errors);
      return;
    }

    setSubmitting(true);
    try {
      await updateCamera(id, formData);
      navigate('/cameras');
    } catch (err) {
      if (err.response?.status === 400 && err.response?.data?.errors) {
        setErrors(err.response.data.errors);
      } else {
        setApiError(err.response?.data?.message || 'Failed to update camera.');
      }
    } finally {
      setSubmitting(false);
    }
  };

  if (initialLoading) {
    return (
      <div className="page-container">
        <Loader message="Loading camera details..." />
      </div>
    );
  }

  return (
    <div className="page-container">
      <div className="page-header">
        <h2>Edit Camera</h2>
        <Button variant="secondary" onClick={() => navigate('/cameras')}>
          Back to List
        </Button>
      </div>

      {apiError && <div className="alert alert-danger">{apiError}</div>}

      <form onSubmit={handleSubmit} noValidate className="form-grid">
        <Input
          label="Camera Name"
          name="name"
          value={formData.name}
          onChange={handleChange}
          error={errors.name}
          required
        />

        <Input
          label="Location"
          name="location"
          value={formData.location}
          onChange={handleChange}
          error={errors.location}
        />

        <Input
          label="IP Address"
          name="ipAddress"
          value={formData.ipAddress}
          onChange={handleChange}
          error={errors.ipAddress}
        />

        <Input
          label="RTSP Stream URL"
          name="rtspUrl"
          value={formData.rtspUrl}
          onChange={handleChange}
          error={errors.rtspUrl}
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

        <div className="form-actions">
          <Button type="submit" loading={submitting} disabled={submitting}>
            Update Camera
          </Button>
          <Button
            type="button"
            variant="secondary"
            onClick={() => navigate('/cameras')}
          >
            Cancel
          </Button>
        </div>
      </form>
    </div>
  );
};

export default CameraEdit;
