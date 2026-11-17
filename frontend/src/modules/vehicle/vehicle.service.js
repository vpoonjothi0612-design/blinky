import api from '../../services/api';

export const getVehicles = async () => {
  const response = await api.get('/vehicles');
  return response.data;
};

export const getVehicleDetections = async (params = {}) => {
  const query = new URLSearchParams({
    type: 'VEHICLE',
    limit: params.limit || 100,
    ...params,
  }).toString();
  const response = await api.get(`/events?${query}`);
  return response.data;
};

export const getVehicleById = async (id) => {
  const response = await api.get(`/vehicles/${id}`);
  return response.data;
};

export const createVehicle = async (data) => {
  const response = await api.post('/vehicles', data);
  return response.data;
};

export const updateVehicle = async (id, data) => {
  const response = await api.put(`/vehicles/${id}`, data);
  return response.data;
};

export const deleteVehicle = async (id) => {
  const response = await api.delete(`/vehicles/${id}`);
  return response.data;
};

export const analyzeVehicleVideo = async (formData, options = {}, onProgress) => {
  const params = new URLSearchParams();
  if (options.processing_fps) params.set('processing_fps', options.processing_fps);
  if (options.conf_threshold) params.set('conf_threshold', options.conf_threshold);
  if (options.max_frames) params.set('max_frames', options.max_frames);
  if (options.save_annotated !== undefined) params.set('save_annotated', options.save_annotated);
  const queryString = params.toString() ? `?${params.toString()}` : '';

  const response = await api.post(`/vehicle/video${queryString}`, formData, {
    headers: {
      'Content-Type': 'multipart/form-data',
    },
    timeout: 1800000, // 30 minutes for large videos
    onUploadProgress: (progressEvent) => {
      if (onProgress && progressEvent.total) {
        const percent = Math.round((progressEvent.loaded * 100) / progressEvent.total);
        onProgress(percent);
      }
    },
  });
  return response.data;
};

export const analyzeSampleVideo = async (options = {}) => {
  const params = new URLSearchParams();
  if (options.processing_fps) params.set('processing_fps', options.processing_fps);
  if (options.conf_threshold) params.set('conf_threshold', options.conf_threshold);
  if (options.max_frames) params.set('max_frames', options.max_frames);
  if (options.save_annotated !== undefined) params.set('save_annotated', options.save_annotated);
  const queryString = params.toString() ? `?${params.toString()}` : '';
  const response = await api.post(`/vehicle/sample-video${queryString}`, {}, {
    timeout: 1800000,
  });
  return response.data;
};


export const analyzeVehicleImage = async (formData) => {
  const response = await api.post('/vehicle/image', formData, {
    headers: {
      'Content-Type': 'multipart/form-data',
    },
    timeout: 60000,
  });
  return response.data;
};

export const getAiHealth = async () => {
  try {
    const response = await api.get('/ai/health');
    return response.data;
  } catch (error) {
    return {
      success: false,
      isOnline: false,
      message: error.response?.data?.message || 'AI service unavailable',
    };
  }
};

export default {
  getVehicles,
  getVehicleDetections,
  getVehicleById,
  createVehicle,
  updateVehicle,
  deleteVehicle,
  analyzeVehicleVideo,
  analyzeSampleVideo,
  analyzeVehicleImage,
  getAiHealth,
};


