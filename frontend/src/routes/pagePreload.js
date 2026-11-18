const navigationPageLoaders = {
  '/dashboard': () => import('../modules/dashboard/Dashboard'),
  '/employees': () => import('../modules/employee/EmployeeList'),
  '/face-enrollments': () => import('../modules/face-enrollment/FaceEnrollmentList'),
  '/attendance': () => import('../modules/attendance/AttendanceList'),
  '/photo-log': () => import('../modules/attendance/PhotoLog'),
  '/live-monitoring': () => import('../pages/LiveAttendanceMonitoring'),
  '/cameras': () => import('../modules/camera/CameraList'),
  '/vehicles': () => import('../modules/vehicle/VehicleList'),
  '/unknown-faces': () => import('../pages/UnknownFaces'),
  '/reports': () => import('../modules/reports/ReportDashboard'),
  '/staff-security': () => import('../modules/staff-security/StaffSecurityList'),
  '/settings': () => import('../pages/Settings'),
};

const preloadedPages = new Map();

export const preloadNavigationPage = (path) => {
  const loadPage = navigationPageLoaders[path];
  if (!loadPage) return Promise.resolve();

  if (!preloadedPages.has(path)) {
    preloadedPages.set(
      path,
      loadPage().catch((error) => {
        preloadedPages.delete(path);
        return Promise.reject(error);
      })
    );
  }

  return preloadedPages.get(path);
};
