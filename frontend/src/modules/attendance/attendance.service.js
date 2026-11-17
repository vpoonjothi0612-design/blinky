import api from '../../services/api';

export const getAttendance = async (page = 1, limit = 50, filters = {}) => {
  const response = await api.get('/attendance', {
    params: { page, limit, ...filters },
  });
  return response.data;
};

export const getAttendanceByEmployee = async (employeeId, page = 1, limit = 50, filters = {}) => {
  const response = await api.get(`/attendance/employee/${employeeId}`, {
    params: { page, limit, ...filters },
  });
  return response.data;
};

export const createAttendance = async (data) => {
  const response = await api.post('/attendance', data);
  return response.data;
};

export const createManualAttendance = async (data) => {
  const response = await api.post('/attendance/manual', data);
  return response.data;
};

export default {
  getAttendance,
  getAttendanceByEmployee,
  createAttendance,
  createManualAttendance,
};
