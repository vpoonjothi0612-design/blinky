import React, { useState, useEffect } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { getCameraById, deleteCamera } from './camera.service';
import Button from '../../components/common/Button';
import Loader from '../../components/common/Loader';
import Modal from '../../components/common/Modal';

const CameraDetails = () => {
  const { id } = useParams();
  const navigate = useNavigate();

  const [camera, setCamera] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const [deleteModalOpen, setDeleteModalOpen] = useState(false);
  const [deleteLoading, setDeleteLoading] = useState(false);

  useEffect(() => {
    const fetchCamera = async () => {
      try {
        const response = await getCameraById(id);
        setCamera(response.data);
      } catch (err) {
        setError(err.response?.data?.message || 'Failed to fetch camera details.');
      } finally {
        setLoading(false);
      }
    };

    fetchCamera();
  }, [id]);

  const handleDelete = async () => {
    setDeleteLoading(true);
    try {
      await deleteCamera(id);
      navigate('/cameras');
    } catch (err) {
      alert(err.response?.data?.message || 'Failed to delete camera.');
      setDeleteLoading(false);
      setDeleteModalOpen(false);
    }
  };

  if (loading) {
    return (
      <div className="page-container">
        <Loader message="Loading camera details..." />
      </div>
    );
  }

  if (error || !camera) {
    return (
      <div className="page-container">
        <div className="alert alert-danger">{error || 'Camera record not found.'}</div>
        <Button variant="secondary" onClick={() => navigate('/cameras')}>
          Back to List
        </Button>
      </div>
    );
  }

  return (
    <div className="page-container">
      <div className="page-header">
        <h2>Camera Details</h2>
        <div className="action-buttons">
          <Button onClick={() => navigate(`/cameras/${id}/edit`)}>
            Edit Camera
          </Button>
          <Button variant="danger" onClick={() => setDeleteModalOpen(true)}>
            Delete
          </Button>
          <Button variant="secondary" onClick={() => navigate('/cameras')}>
            Back to List
          </Button>
        </div>
      </div>

      <div className="details-card">
        <div className="details-grid">
          <div className="details-item">
            <span className="details-label">Camera ID</span>
            <span className="details-value">{camera.id}</span>
          </div>

          <div className="details-item">
            <span className="details-label">Camera Name</span>
            <span className="details-value">{camera.name}</span>
          </div>

          <div className="details-item">
            <span className="details-label">Location</span>
            <span className="details-value">{camera.location || 'N/A'}</span>
          </div>

          <div className="details-item">
            <span className="details-label">IP Address</span>
            <span className="details-value">{camera.ipAddress || 'N/A'}</span>
          </div>

          <div className="details-item">
            <span className="details-label">RTSP Stream URL</span>
            <span className="details-value">{camera.rtspUrl || 'N/A'}</span>
          </div>

          <div className="details-item">
            <span className="details-label">Status</span>
            <span className="details-value">
              <span
                className={`badge ${
                  camera.status === 'ACTIVE' ? 'badge-success' : 'badge-danger'
                }`}
              >
                {camera.status || 'ACTIVE'}
              </span>
            </span>
          </div>

          <div className="details-item">
            <span className="details-label">Created At</span>
            <span className="details-value">
              {camera.createdAt
                ? new Date(camera.createdAt).toLocaleString()
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
          Are you sure you want to delete camera <strong>{camera.name}</strong>?
        </p>
      </Modal>
    </div>
  );
};

export default CameraDetails;
