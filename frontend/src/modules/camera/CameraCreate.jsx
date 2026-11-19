import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { createCamera } from './camera.service';
import { validateCamera } from './camera.validation';
import Input from '../../components/common/Input';
import Button from '../../components/common/Button';

const CameraCreate = () => {
  const navigate = useNavigate();

  const [formData, setFormData] = useState({
    name: '',
    location: '',
    ipAddress: '',
    rtspUrl: '',
    status: 'ACTIVE',
  });

  const [errors, setErrors] = useState({});
  const [apiError, setApiError] = useState('');
  const [submitting, setSubmitting] = useState(false);

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
      await createCamera(formData);
      navigate('/cameras');
    } catch (err) {
      if (err.response?.status === 400 && err.response?.data?.errors) {
        setErrors(err.response.data.errors);
      } else {
        setApiError(err.response?.data?.message || 'Failed to create camera.');
      }
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="page-container">
      <div className="page-header">
        <h2>Add New Camera</h2>
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
          placeholder="e.g. Main Entrance Camera"
          error={errors.name}
          required
        />

        <Input
          label="Location"
          name="location"
          value={formData.location}
          onChange={handleChange}
          placeholder="e.g. Building A, Gate 1"
          error={errors.location}
        />

        <Input
          label="IP Address"
          name="ipAddress"
          value={formData.ipAddress}
          onChange={handleChange}
          placeholder="e.g. 192.168.1.100"
          error={errors.ipAddress}
        />

        <Input
          label="RTSP Stream URL"
          name="rtspUrl"
          value={formData.rtspUrl}
          onChange={handleChange}
          placeholder="e.g. rtsp://192.168.1.100:554/stream"
          error={errors.rtspUrl}
        />
        <small className="form-hint">
          Do not include camera credentials in this URL. Store them in the AI service&apos;s local environment file.
        </small>

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
            Save Camera
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

export default CameraCreate;
