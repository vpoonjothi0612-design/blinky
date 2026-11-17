import api from '../../services/api';

/**
 * GET /api/reports/attendance
 * @param {Object} params
 * @param {string} [params.startDate]   - YYYY-MM-DD
 * @param {string} [params.endDate]     - YYYY-MM-DD
 * @param {string} [params.department]
 * @param {string} [params.status]      - PRESENT | LATE | ABSENT
 * @param {string} [params.employeeId]  - UUID
 */
export const getAttendanceReport = async (params = {}) => {
  const response = await api.get('/reports/attendance', { params });
  return response.data;
};

/**
 * GET /api/reports/summary
 * @param {Object} params
 * @param {string} [params.date]        - YYYY-MM-DD
 * @param {string} [params.department]
 */
export const getSummaryReport = async (params = {}) => {
  const response = await api.get('/reports/summary', { params });
  return response.data;
};

export default {
  getAttendanceReport,
  getSummaryReport,
};
