import api from '../../services/api';

export const getEmployees = async () => {
  const response = await api.get('/employees');
  return response.data;
};

export const getEmployeeById = async (id) => {
  const response = await api.get(`/employees/${id}`);
  return response.data;
};

export const getEmployeeByCode = async (employeeCode) => {
  const response = await api.get(`/employees/code/${employeeCode}`);
  return response.data;
};

export const getNextEmployeeCode = async () => {
  const response = await api.get('/employees/next-code');
  return response.data;
};

export const createEmployee = async (data) => {
  const response = await api.post('/employees', data);
  return response.data;
};

export const updateEmployee = async (id, data) => {
  const response = await api.put(`/employees/${id}`, data);
  return response.data;
};

export const deleteEmployee = async (id) => {
  const response = await api.delete(`/employees/${id}`);
  return response.data;
};

export const bulkDeleteEmployees = async (ids) => {
  const response = await api.post('/employees/bulk-delete', { ids });
  return response.data;
};

export default {
  getEmployees,
  getEmployeeById,
  getEmployeeByCode,
  getNextEmployeeCode,
  createEmployee,
  updateEmployee,
  deleteEmployee,
  bulkDeleteEmployees,
};
