import api from '../../services/api';

export const loginApi = async (credentials) => {
  const response = await api.post('/auth/login', credentials);
  return response.data;
};

export const registerApi = async (userData) => {
  const response = await api.post('/auth/register', userData);
  return response.data;
};

export const getAllUsersApi = async () => {
  const response = await api.get('/auth/users');
  return response.data;
};

export const deleteUserApi = async (id) => {
  const response = await api.delete(`/auth/users/${id}`);
  return response.data;
};

export const protectedTestApi = async () => {
  const response = await api.get('/auth/protected-test');
  return response.data;
};

export const updateProfileApi = async (profileData) => {
  const response = await api.put('/auth/profile', profileData);
  return response.data;
};

export const updatePasswordApi = async (passwordData) => {
  const response = await api.put('/auth/change-password', passwordData);
  return response.data;
};

export default {
  loginApi,
  registerApi,
  getAllUsersApi,
  deleteUserApi,
  protectedTestApi,
  updateProfileApi,
  updatePasswordApi,
};
