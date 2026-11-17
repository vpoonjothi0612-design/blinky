import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { createVehicle } from './vehicle.service';
import { validateVehicle } from './vehicle.validation';
import { getEmployees } from '../employee/employee.service';
import Input from '../../components/common/Input';
import Button from '../../components/common/Button';
import Loader from '../../components/common/Loader';

const VehicleCreate = () => {
  const navigate = useNavigate();

  const [employees, setEmployees] = useState([]);
  const [loadingEmployees, setLoadingEmployees] = useState(true);

  const [formData, setFormData] = useState({
    registrationNumber: '',
    type: '',
    make: '',
    model: '',
    color: '',
    employeeId: '',
    status: 'ACTIVE',
  });

  const [errors, setErrors] = useState({});
  const [apiError, setApiError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    const fetchEmployees = async () => {
      try {
        const response = await getEmployees();
        setEmployees(response.data || []);
      } catch (err) {
        // Optional relationship, so error doesn't block form if employee fetch fails
      } finally {
        setLoadingEmployees(false);
      }
    };

    fetchEmployees();
  }, []);

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

    const validation = validateVehicle(formData);
    if (!validation.isValid) {
      setErrors(validation.errors);
      return;
    }

    setSubmitting(true);
    try {
      const payload = {
        ...formData,
        employeeId: formData.employeeId ? formData.employeeId : null,
      };
      await createVehicle(payload);
      navigate('/vehicles');
    } catch (err) {
      if (err.response?.status === 400 && err.response?.data?.errors) {
        setErrors(err.response.data.errors);
      } else {
        setApiError(err.response?.data?.message || 'Failed to create vehicle.');
      }
    } finally {
      setSubmitting(false);
    }
  };

  if (loadingEmployees) {
    return (
      <div className="page-container">
        <Loader message="Loading vehicle form..." />
      </div>
    );
  }

  return (
    <div className="page-container">
      <div className="page-header">
        <h2>Add New Vehicle</h2>
        <Button variant="secondary" onClick={() => navigate('/vehicles')}>
          Back to List
        </Button>
      </div>

      {apiError && <div className="alert alert-danger">{apiError}</div>}

      <form onSubmit={handleSubmit} noValidate className="form-grid">
        <Input
          label="Registration Number"
          name="registrationNumber"
          value={formData.registrationNumber}
          onChange={handleChange}
          placeholder="e.g. KA-01-AB-1234"
          error={errors.registrationNumber}
          required
        />

        <Input
          label="Vehicle Type"
          name="type"
          value={formData.type}
          onChange={handleChange}
          placeholder="e.g. Car, Motorcycle, SUV"
          error={errors.type}
        />

        <Input
          label="Make / Manufacturer"
          name="make"
          value={formData.make}
          onChange={handleChange}
          placeholder="e.g. Toyota, Honda, Hyundai"
          error={errors.make}
        />

        <Input
          label="Model"
          name="model"
          value={formData.model}
          onChange={handleChange}
          placeholder="e.g. Camry, Civic, Tucson"
          error={errors.model}
        />

        <Input
          label="Color"
          name="color"
          value={formData.color}
          onChange={handleChange}
          placeholder="e.g. Black, White, Silver"
          error={errors.color}
        />

        <div className="form-group">
          <label htmlFor="employeeId" className="form-label">
            Assigned Employee (Owner)
          </label>
          <select
            id="employeeId"
            name="employeeId"
            value={formData.employeeId}
            onChange={handleChange}
            className="form-input"
          >
            <option value="">-- None (Unassigned) --</option>
            {employees.map((emp) => (
              <option key={emp.id} value={emp.id}>
                {emp.employeeCode} - {emp.firstName} {emp.lastName || ''}
              </option>
            ))}
          </select>
        </div>

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
            Save Vehicle
          </Button>
          <Button
            type="button"
            variant="secondary"
            onClick={() => navigate('/vehicles')}
          >
            Cancel
          </Button>
        </div>
      </form>
    </div>
  );
};

export default VehicleCreate;
