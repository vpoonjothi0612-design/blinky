import React from 'react';
import { Routes, Route, Navigate, useNavigate } from 'react-router-dom';
import useAuth from '../hooks/useAuth';
import MainLayout from '../components/layout/MainLayout';
import Loader from '../components/common/Loader';

// Load page modules on demand so each navigation fetches only that page's code.
const Login = React.lazy(() => import('../modules/auth/Login'));
const Register = React.lazy(() => import('../modules/auth/Register'));
const Dashboard = React.lazy(() => import('../modules/dashboard/Dashboard'));
const UnknownFaces = React.lazy(() => import('../pages/UnknownFaces'));
const Settings = React.lazy(() => import('../pages/Settings'));
const LiveAttendanceMonitoring = React.lazy(() => import('../pages/LiveAttendanceMonitoring'));
const EmployeeList = React.lazy(() => import('../modules/employee/EmployeeList'));
const EmployeeCreate = React.lazy(() => import('../modules/employee/EmployeeCreate'));
const EmployeeEdit = React.lazy(() => import('../modules/employee/EmployeeEdit'));
const EmployeeDetails = React.lazy(() => import('../modules/employee/EmployeeDetails'));
const FaceEnrollmentList = React.lazy(() => import('../modules/face-enrollment/FaceEnrollmentList'));
const FaceEnrollmentCreate = React.lazy(() => import('../modules/face-enrollment/FaceEnrollmentCreate'));
const FaceEnrollmentDetails = React.lazy(() => import('../modules/face-enrollment/FaceEnrollmentDetails'));
const CameraList = React.lazy(() => import('../modules/camera/CameraList'));
const CameraCreate = React.lazy(() => import('../modules/camera/CameraCreate'));
const CameraEdit = React.lazy(() => import('../modules/camera/CameraEdit'));
const CameraDetails = React.lazy(() => import('../modules/camera/CameraDetails'));
const VehicleList = React.lazy(() => import('../modules/vehicle/VehicleList'));
const VehicleCreate = React.lazy(() => import('../modules/vehicle/VehicleCreate'));
const VehicleEdit = React.lazy(() => import('../modules/vehicle/VehicleEdit'));
const VehicleDetails = React.lazy(() => import('../modules/vehicle/VehicleDetails'));
const AttendanceList = React.lazy(() => import('../modules/attendance/AttendanceList'));
const AttendanceDetails = React.lazy(() => import('../modules/attendance/AttendanceDetails'));
const ReportDashboard = React.lazy(() => import('../modules/reports/ReportDashboard'));
const ReportDetails = React.lazy(() => import('../modules/reports/ReportDetails'));
const StaffSecurityList = React.lazy(() => import('../modules/staff-security/StaffSecurityList'));
const StaffSecurityCreate = React.lazy(() => import('../modules/staff-security/StaffSecurityCreate'));

// Access Denied Screen
const UnauthorizedPage = ({ userRole, allowedRoles }) => {
  const navigate = useNavigate();

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        minHeight: '65vh',
        padding: '30px 20px',
        textAlign: 'center',
      }}
    >
      <div
        style={{
          width: '72px',
          height: '72px',
          borderRadius: '50%',
          backgroundColor: 'rgba(239, 68, 68, 0.12)',
          border: '2px solid rgba(239, 68, 68, 0.3)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontSize: '32px',
          marginBottom: '20px',
        }}
      >
        🛡️
      </div>

      <h2
        style={{
          fontSize: '22px',
          fontWeight: '800',
          color: 'var(--text-primary, #0f172a)',
          marginBottom: '10px',
        }}
      >
        Access Denied
      </h2>

      <p
        style={{
          maxWidth: '460px',
          fontSize: '14px',
          lineHeight: '1.6',
          color: 'var(--text-muted, #64748b)',
          marginBottom: '24px',
        }}
      >
        Your current account role (
        <strong>{userRole || 'STAFF'}</strong>) does not have authorization
        to access this page. This area requires{' '}
        <strong>{allowedRoles?.join(' or ')}</strong> clearance.
      </p>

      <div
        style={{
          display: 'flex',
          gap: '12px',
          flexWrap: 'wrap',
          justifyContent: 'center',
        }}
      >
        <button
          onClick={() => navigate('/dashboard')}
          style={{
            padding: '10px 22px',
            backgroundColor: '#10b981',
            color: '#ffffff',
            borderRadius: '10px',
            border: 'none',
            fontWeight: '700',
            fontSize: '13.5px',
            cursor: 'pointer',
            boxShadow: '0 4px 12px rgba(16, 185, 129, 0.25)',
          }}
        >
          Return to Dashboard
        </button>
      </div>
    </div>
  );
};

// Role-Protected Route Guard
const ProtectedRoute = ({ children, allowedRoles }) => {
  const { user, isAuthenticated, loading } = useAuth();

  if (loading) {
    return <Loader message="Checking authentication..." />;
  }

  if (!isAuthenticated) {
    return <Navigate to="/login" replace />;
  }

  if (allowedRoles && allowedRoles.length > 0) {
    let userRole = (user?.role || '').toUpperCase();

    if (userRole === 'SUPER_ADMIN') userRole = 'ADMIN';
    if (userRole === 'USER') userRole = 'STAFF';

    const normalizedAllowed = allowedRoles.map((role) =>
      role.toUpperCase()
    );

    if (!normalizedAllowed.includes(userRole)) {
      return (
        <UnauthorizedPage
          userRole={userRole}
          allowedRoles={allowedRoles}
        />
      );
    }
  }

  return children;
};

// Public Route Guard
const PublicRoute = ({ children }) => {
  const { isAuthenticated, loading } = useAuth();

  if (loading) {
    return <Loader message="Checking authentication..." />;
  }

  if (isAuthenticated) {
    return <Navigate to="/dashboard" replace />;
  }

  return children;
};

// Application Routes
const AppRoutes = () => {
  return (
    <React.Suspense fallback={<Loader />}>
    <Routes>
      {/* Public Routes */}
      <Route
        path="/login"
        element={
          <PublicRoute>
            <Login />
          </PublicRoute>
        }
      />

      <Route
        path="/register"
        element={
          <PublicRoute>
            <Register />
          </PublicRoute>
        }
      />

      {/* Protected Application Layout */}
      <Route
        path="/"
        element={
          <ProtectedRoute>
            <MainLayout />
          </ProtectedRoute>
        }
      >
        <Route index element={<Navigate to="/dashboard" replace />} />

        {/* Dashboard - All Roles */}
        <Route
          path="dashboard"
          element={
            <ProtectedRoute allowedRoles={['ADMIN', 'STAFF', 'SECURITY', 'USER']}>
              <Dashboard />
            </ProtectedRoute>
          }
        />

        {/* Live Attendance Monitoring - Accessible to all roles with alias support */}
        <Route
          path="live-monitoring"
          element={
            <ProtectedRoute allowedRoles={['ADMIN', 'STAFF', 'SECURITY', 'USER']}>
              <LiveAttendanceMonitoring />
            </ProtectedRoute>
          }
        />
        <Route path="live_monitoring" element={<Navigate to="/live-monitoring" replace />} />
        <Route path="live monitoring" element={<Navigate to="/live-monitoring" replace />} />
        <Route path="live%20monitoring" element={<Navigate to="/live-monitoring" replace />} />

        {/* Employee Routes */}
        <Route
          path="employees"
          element={
            <ProtectedRoute allowedRoles={['ADMIN', 'SECURITY']}>
              <EmployeeList />
            </ProtectedRoute>
          }
        />

        <Route
          path="employees/create"
          element={
            <ProtectedRoute allowedRoles={['ADMIN']}>
              <EmployeeCreate />
            </ProtectedRoute>
          }
        />

        <Route
          path="employees/:id"
          element={
            <ProtectedRoute allowedRoles={['ADMIN', 'SECURITY']}>
              <EmployeeDetails />
            </ProtectedRoute>
          }
        />

        <Route
          path="employees/:id/edit"
          element={
            <ProtectedRoute allowedRoles={['ADMIN']}>
              <EmployeeEdit />
            </ProtectedRoute>
          }
        />

        {/* Face Enrollment - ADMIN Only */}
        <Route
          path="face-enrollments"
          element={
            <ProtectedRoute allowedRoles={['ADMIN']}>
              <FaceEnrollmentList />
            </ProtectedRoute>
          }
        />

        <Route
          path="face-enrollments/create"
          element={
            <ProtectedRoute allowedRoles={['ADMIN']}>
              <FaceEnrollmentCreate />
            </ProtectedRoute>
          }
        />

        <Route
          path="face-enrollments/:id"
          element={
            <ProtectedRoute allowedRoles={['ADMIN']}>
              <FaceEnrollmentDetails />
            </ProtectedRoute>
          }
        />

        {/* Camera Routes */}
        <Route
          path="cameras"
          element={
            <ProtectedRoute allowedRoles={['ADMIN', 'SECURITY']}>
              <CameraList />
            </ProtectedRoute>
          }
        />

        <Route
          path="cameras/create"
          element={
            <ProtectedRoute allowedRoles={['ADMIN']}>
              <CameraCreate />
            </ProtectedRoute>
          }
        />

        <Route
          path="cameras/:id"
          element={
            <ProtectedRoute allowedRoles={['ADMIN', 'SECURITY']}>
              <CameraDetails />
            </ProtectedRoute>
          }
        />

        <Route
          path="cameras/:id/edit"
          element={
            <ProtectedRoute allowedRoles={['ADMIN']}>
              <CameraEdit />
            </ProtectedRoute>
          }
        />

        {/* Vehicle Routes - ADMIN & SECURITY */}
        <Route
          path="vehicles"
          element={
            <ProtectedRoute allowedRoles={['ADMIN', 'SECURITY']}>
              <VehicleList />
            </ProtectedRoute>
          }
        />

        <Route
          path="vehicles/create"
          element={
            <ProtectedRoute allowedRoles={['ADMIN', 'SECURITY']}>
              <VehicleCreate />
            </ProtectedRoute>
          }
        />

        <Route
          path="vehicles/:id"
          element={
            <ProtectedRoute allowedRoles={['ADMIN', 'SECURITY']}>
              <VehicleDetails />
            </ProtectedRoute>
          }
        />

        <Route
          path="vehicles/:id/edit"
          element={
            <ProtectedRoute allowedRoles={['ADMIN', 'SECURITY']}>
              <VehicleEdit />
            </ProtectedRoute>
          }
        />

        {/* Attendance - All Roles (STAFF scoped to own records) */}
        <Route
          path="attendance"
          element={
            <ProtectedRoute allowedRoles={['ADMIN', 'STAFF', 'SECURITY', 'USER']}>
              <AttendanceList />
            </ProtectedRoute>
          }
        />

        <Route
          path="attendance/:id"
          element={
            <ProtectedRoute allowedRoles={['ADMIN', 'STAFF', 'SECURITY', 'USER']}>
              <AttendanceDetails />
            </ProtectedRoute>
          }
        />

        {/* Reports - All Roles */}
        <Route
          path="reports"
          element={
            <ProtectedRoute allowedRoles={['ADMIN', 'STAFF', 'SECURITY', 'USER']}>
              <ReportDashboard />
            </ProtectedRoute>
          }
        />

        <Route
          path="reports/details"
          element={
            <ProtectedRoute allowedRoles={['ADMIN', 'STAFF', 'SECURITY', 'USER']}>
              <ReportDetails />
            </ProtectedRoute>
          }
        />

        {/* Unknown Faces - ADMIN & SECURITY */}
        <Route
          path="unknown-faces"
          element={
            <ProtectedRoute allowedRoles={['ADMIN', 'SECURITY']}>
              <UnknownFaces />
            </ProtectedRoute>
          }
        />

        {/* Settings - All Roles */}
        <Route
          path="settings"
          element={
            <ProtectedRoute allowedRoles={['ADMIN', 'STAFF', 'SECURITY', 'USER']}>
              <Settings />
            </ProtectedRoute>
          }
        />

        {/* Staff & Security Administration - ADMIN Only */}
        <Route
          path="staff-security"
          element={
            <ProtectedRoute allowedRoles={['ADMIN']}>
              <StaffSecurityList />
            </ProtectedRoute>
          }
        />

        <Route
          path="staff-security/create"
          element={
            <ProtectedRoute allowedRoles={['ADMIN']}>
              <StaffSecurityCreate />
            </ProtectedRoute>
          }
        />
      </Route>

      {/* Fallback */}
      <Route
        path="*"
        element={<Navigate to="/dashboard" replace />}
      />
    </Routes>
    </React.Suspense>
  );
};

export default AppRoutes;
