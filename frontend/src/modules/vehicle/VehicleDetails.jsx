import React, { useState, useEffect } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { getVehicleById, deleteVehicle } from './vehicle.service';
import Button from '../../components/common/Button';
import Loader from '../../components/common/Loader';
import Modal from '../../components/common/Modal';

const VehicleDetails = () => {
  const { id } = useParams();
  const navigate = useNavigate();

  const [vehicle, setVehicle] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const [deleteModalOpen, setDeleteModalOpen] = useState(false);
  const [deleteLoading, setDeleteLoading] = useState(false);

  useEffect(() => {
    const fetchVehicle = async () => {
      try {
        const response = await getVehicleById(id);
        setVehicle(response.data);
      } catch (err) {
        setError(err.response?.data?.message || 'Failed to fetch vehicle details.');
      } finally {
        setLoading(false);
      }
    };

    fetchVehicle();
  }, [id]);

  const handleDelete = async () => {
    setDeleteLoading(true);
    try {
      await deleteVehicle(id);
      navigate('/vehicles');
    } catch (err) {
      alert(err.response?.data?.message || 'Failed to delete vehicle.');
      setDeleteLoading(false);
      setDeleteModalOpen(false);
    }
  };

  if (loading) {
    return (
      <div className="page-container">
        <Loader message="Loading vehicle details..." />
      </div>
    );
  }

  if (error || !vehicle) {
    return (
      <div className="page-container">
        <div className="alert alert-danger">{error || 'Vehicle record not found.'}</div>
        <Button variant="secondary" onClick={() => navigate('/vehicles')}>
          Back to List
        </Button>
      </div>
    );
  }

  return (
    <div className="page-container">
      <div className="page-header">
        <h2>Vehicle Details</h2>
        <div className="action-buttons">
          <Button onClick={() => navigate(`/vehicles/${id}/edit`)}>
            Edit Vehicle
          </Button>
          <Button variant="danger" onClick={() => setDeleteModalOpen(true)}>
            Delete
          </Button>
          <Button variant="secondary" onClick={() => navigate('/vehicles')}>
            Back to List
          </Button>
        </div>
      </div>

      <div className="details-card">
        <div className="details-grid">
          <div className="details-item">
            <span className="details-label">Vehicle ID</span>
            <span className="details-value">{vehicle.id}</span>
          </div>

          <div className="details-item">
            <span className="details-label">Registration Number</span>
            <span className="details-value">{vehicle.registrationNumber}</span>
          </div>

          <div className="details-item">
            <span className="details-label">Type</span>
            <span className="details-value">{vehicle.type || 'N/A'}</span>
          </div>

          <div className="details-item">
            <span className="details-label">Make / Manufacturer</span>
            <span className="details-value">{vehicle.make || 'N/A'}</span>
          </div>

          <div className="details-item">
            <span className="details-label">Model</span>
            <span className="details-value">{vehicle.model || 'N/A'}</span>
          </div>

          <div className="details-item">
            <span className="details-label">Color</span>
            <span className="details-value">{vehicle.color || 'N/A'}</span>
          </div>

          <div className="details-item">
            <span className="details-label">Assigned Owner</span>
            <span className="details-value">
              {vehicle.employee
                ? `${vehicle.employee.firstName} ${vehicle.employee.lastName || ''} (${vehicle.employee.employeeCode})`.trim()
                : 'Unassigned'}
            </span>
          </div>

          <div className="details-item">
            <span className="details-label">Status</span>
            <span className="details-value">
              <span
                className={`badge ${
                  vehicle.status === 'ACTIVE' ? 'badge-success' : 'badge-danger'
                }`}
              >
                {vehicle.status || 'ACTIVE'}
              </span>
            </span>
          </div>

          <div className="details-item">
            <span className="details-label">Registered Date</span>
            <span className="details-value">
              {vehicle.createdAt
                ? new Date(vehicle.createdAt).toLocaleString()
                : 'N/A'}
            </span>
          </div>
        </div>
      </div>

      <Modal
        isOpen={deleteModalOpen}
        title="Confirm Delete"
        onClose={() => setDeleteModalOpen(false)}
        onConfirm={handleDelete}
        confirmText="Delete"
        confirmVariant="danger"
        loading={deleteLoading}
      >
        <p>
          Are you sure you want to delete vehicle{' '}
          <strong>{vehicle.registrationNumber}</strong>?
        </p>
      </Modal>
    </div>
  );
};

export default VehicleDetails;
