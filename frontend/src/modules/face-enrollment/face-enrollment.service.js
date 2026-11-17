import api from '../../services/api';

export const getAllEnrollments = async () => {
  const response = await api.get('/face-enrollments');
  return response.data;
};

export const getEnrollmentById = async (id) => {
  const response = await api.get(`/face-enrollments/${id}`);
  return response.data;
};

export const getEnrollmentsByEmployee = async (employeeId) => {
  const response = await api.get(`/face-enrollments/employee/${employeeId}`);
  return response.data;
};

export const createEnrollment = async (data) => {
  const response = await api.post('/face-enrollments', data);
  return response.data;
};

export const updateEnrollment = async (id, data) => {
  const response = await api.put(`/face-enrollments/${id}`, data);
  return response.data;
};

export const deleteEnrollment = async (id) => {
  const response = await api.delete(`/face-enrollments/${id}`);
  return response.data;
};

export default {
  getAllEnrollments,
  getEnrollmentById,
  getEnrollmentsByEmployee,
  createEnrollment,
  updateEnrollment,
  deleteEnrollment,
};
