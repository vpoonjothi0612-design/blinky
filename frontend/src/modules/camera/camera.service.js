import api from '../../services/api';

export const getCameras = async () => {
  const response = await api.get('/cameras');
  return response.data;
};

export const getCameraById = async (id) => {
  const response = await api.get(`/cameras/${id}`);
  return response.data;
};

export const createCamera = async (data) => {
  const response = await api.post('/cameras', data);
  return response.data;
};

export const updateCamera = async (id, data) => {
  const response = await api.put(`/cameras/${id}`, data);
  return response.data;
};

export const deleteCamera = async (id) => {
  const response = await api.delete(`/cameras/${id}`);
  return response.data;
};

// CP PLUS / Camera Event Stream & Diagnostics
export const getCameraStreamStatus = async () => {
  const response = await api.get('/cameras/stream/status');
  return response.data;
};

export const startCameraStream = async () => {
  const response = await api.post('/cameras/stream/start');
  return response.data;
};

export const stopCameraStream = async () => {
  const response = await api.post('/cameras/stream/stop');
  return response.data;
};

export const testCameraStreamConnection = async (url) => {
  const response = await api.post('/cameras/stream/test', { url });
  return response.data;
};

export const testRtspCamera = async (cameraId) => {
  const response = await api.get(`/cameras/rtsp-test/${encodeURIComponent(cameraId)}`);
  return response.data;
};

export const getCameraStreamEvents = async () => {
  const response = await api.get('/cameras/stream/events');
  return response.data;
};

export default {
  getCameras,
  getCameraById,
  createCamera,
  updateCamera,
  deleteCamera,
  getCameraStreamStatus,
  startCameraStream,
  stopCameraStream,
  testCameraStreamConnection,
  testRtspCamera,
  getCameraStreamEvents,
};
