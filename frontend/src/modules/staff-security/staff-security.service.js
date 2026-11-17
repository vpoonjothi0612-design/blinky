import api from '../../services/api';

/**
 * Fetch all provisioned system user accounts (Admin, Staff, Security).
 */
export const getStaffSecurityUsers = async () => {
  const response = await api.get('/auth/users');
  return response.data;
};

/**
 * Fetch single user by ID.
 * @param {string} id
 */
export const getStaffSecurityUserById = async (id) => {
  const response = await api.get(`/auth/users/${id}`);
  return response.data;
};

/**
 * Provision a new Staff or Security user account.
 * @param {Object} data { name, email, password, role: 'STAFF' | 'SECURITY' }
 */
export const createStaffSecurityUser = async (data) => {
  const response = await api.post('/auth/register', data);
  return response.data;
};

/**
 * Update an existing user account by ID (Admin control).
 * @param {string} id
 * @param {Object} data { name, email, role, isActive, password }
 */
export const updateStaffSecurityUser = async (id, data) => {
  const response = await api.put(`/auth/users/${id}`, data);
  return response.data;
};

/**
 * Revoke/delete a user account by ID.
 * @param {string} id
 */
export const deleteStaffSecurityUser = async (id) => {
  const response = await api.delete(`/auth/users/${id}`);
  return response.data;
};

export default {
  getStaffSecurityUsers,
  getStaffSecurityUserById,
  createStaffSecurityUser,
  updateStaffSecurityUser,
  deleteStaffSecurityUser,
};
