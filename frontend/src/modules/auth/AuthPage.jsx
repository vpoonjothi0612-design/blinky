import React, { useState, useEffect, useRef } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import useAuth from '../../hooks/useAuth';
import { loginApi, registerApi } from './auth.service';
import { validateLogin, validateRegister } from './auth.validation';
import AiVisualPanel from './AiVisualPanel';
import PwaInstallButton from '../../components/common/PwaInstallButton';
import './auth.css';


export const LOGIN_ROLE_OPTIONS = [
  {
    value: 'ADMIN',
    label: 'Admin',
    icon: (
      <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
        <path d="m9 12 2 2 4-4" />
      </svg>
    ),
  },
  {
    value: 'STAFF',
    label: 'Staff',
    icon: (
      <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2" />
        <circle cx="12" cy="7" r="4" />
      </svg>
    ),
  },
  {
    value: 'SECURITY',
    label: 'Security',
    icon: (
      <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M12 2a10 10 0 1 0 10 10A10 10 0 0 0 12 2zm1 14.93V17a1 1 0 0 1-2 0v-.07A8 8 0 0 1 4.07 11H4a1 1 0 0 1 0-2h.07A8 8 0 0 1 11 4.07V4a1 1 0 0 1 2 0v.07A8 8 0 0 1 19.93 9H20a1 1 0 0 1 0 2h-.07A8 8 0 0 1 13 16.93z" />
        <circle cx="12" cy="12" r="3" />
      </svg>
    ),
  },
];

export const REGISTER_ROLE_OPTIONS = [
  {
    value: 'ADMIN',
    label: 'Admin',
    icon: (
      <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
        <path d="m9 12 2 2 4-4" />
      </svg>
    ),
  },
  {
    value: 'STAFF',
    label: 'Staff',
    icon: (
      <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2" />
        <circle cx="12" cy="7" r="4" />
      </svg>
    ),
  },
  {
    value: 'SECURITY',
    label: 'Security',
    icon: (
      <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M12 2a10 10 0 1 0 10 10A10 10 0 0 0 12 2zm1 14.93V17a1 1 0 0 1-2 0v-.07A8 8 0 0 1 4.07 11H4a1 1 0 0 1 0-2h.07A8 8 0 0 1 11 4.07V4a1 1 0 0 1 2 0v.07A8 8 0 0 1 19.93 9H20a1 1 0 0 1 0 2h-.07A8 8 0 0 1 13 16.93z" />
        <circle cx="12" cy="12" r="3" />
      </svg>
    ),
  },
];

const CustomRoleDropdown = ({ value, onChange, disabled, id = 'role-select', options = LOGIN_ROLE_OPTIONS }) => {
  const [isOpen, setIsOpen] = useState(false);
  const dropdownRef = useRef(null);

  const selectedOption = options.find((r) => r.value === value) || options[0];

  useEffect(() => {
    const handleOutsideClick = (e) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target)) {
        setIsOpen(false);
      }
    };

    const handleKeyDown = (e) => {
      if (e.key === 'Escape') {
        setIsOpen(false);
      }
    };

    if (isOpen) {
      document.addEventListener('mousedown', handleOutsideClick);
      document.addEventListener('touchstart', handleOutsideClick);
      document.addEventListener('keydown', handleKeyDown);
    }

    return () => {
      document.removeEventListener('mousedown', handleOutsideClick);
      document.removeEventListener('touchstart', handleOutsideClick);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [isOpen]);

  const handleSelect = (roleValue) => {
    onChange({ target: { name: 'role', value: roleValue } });
    setIsOpen(false);
  };

  return (
    <div className="auth-custom-dropdown-wrap" ref={dropdownRef}>
      <button
        id={id}
        type="button"
        className={`auth-custom-dropdown-trigger ${isOpen ? 'is-open' : ''}`}
        onClick={() => !disabled && setIsOpen((prev) => !prev)}
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={isOpen}
      >
        <div className="auth-custom-dropdown-left">
          <span className="auth-custom-dropdown-trigger-icon">
            {selectedOption.icon}
          </span>
          <span className="auth-custom-dropdown-trigger-label">
            {selectedOption.label}
          </span>
        </div>

        <span className={`auth-custom-dropdown-chevron ${isOpen ? 'rotate' : ''}`}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="6 9 12 15 18 9" />
          </svg>
        </span>
      </button>

      {isOpen && (
        <ul className="auth-custom-dropdown-menu" role="listbox" aria-label="Select System Role">
          {options.map((option) => {
            const isSelected = option.value === value;
            return (
              <li
                key={option.value}
                className={`auth-custom-dropdown-item ${isSelected ? 'is-selected' : ''}`}
                onClick={() => handleSelect(option.value)}
                role="option"
                aria-selected={isSelected}
              >
                <div className="auth-custom-dropdown-item-icon-box">
                  {option.icon}
                </div>
                <div className="auth-custom-dropdown-item-body">
                  <span className="auth-custom-dropdown-item-title">{option.label}</span>
                </div>
                {isSelected && (
                  <div className="auth-custom-dropdown-item-check">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.8" strokeLinecap="round" strokeLinejoin="round">
                      <polyline points="20 6 9 17 4 12" />
                    </svg>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
};

const AuthPage = ({ defaultMode = 'login' }) => {
  const navigate = useNavigate();
  const location = useLocation();
  const { login } = useAuth();

  // Mode state: 'login' | 'register'
  const [mode, setMode] = useState(defaultMode);

  // Sync mode with URL if location changes (e.g. back/forward navigation)
  useEffect(() => {
    if (location.pathname === '/register' && mode !== 'register') {
      setMode('register');
    } else if (location.pathname === '/login' && mode !== 'login') {
      setMode('login');
    }
  }, [location.pathname, mode]);

  // Session expired banner
  const isExpired = new URLSearchParams(window.location.search).get('expired') === 'true';

  // Login form state
  const [loginForm, setLoginForm] = useState({
    role: 'ADMIN',
    email: '',
    password: '',
  });
  const [loginErrors, setLoginErrors] = useState({});
  const [loginApiError, setLoginApiError] = useState('');
  const [loginLoading, setLoginLoading] = useState(false);
  const [showLoginPassword, setShowLoginPassword] = useState(false);

  // Register form state
  const [registerForm, setRegisterForm] = useState({
    name: '',
    email: '',
    password: '',
    role: 'STAFF',
  });
  const [registerErrors, setRegisterErrors] = useState({});
  const [registerApiError, setRegisterApiError] = useState('');
  const [registerSuccess, setRegisterSuccess] = useState('');
  const [registerLoading, setRegisterLoading] = useState(false);
  const [showRegisterPassword, setShowRegisterPassword] = useState(false);

  // Switch between Login and Register smoothly
  const handleSwitchMode = (targetMode) => {
    setMode(targetMode);
    setLoginApiError('');
    setRegisterApiError('');
    setRegisterSuccess('');
    // Update URL without triggering page reload/remount
    navigate(targetMode === 'register' ? '/register' : '/login', { replace: true });
  };

  // Login inputs handler
  const handleLoginChange = (e) => {
    const { name, value } = e.target;
    setLoginForm((prev) => ({ ...prev, [name]: value }));
    if (loginErrors[name]) {
      setLoginErrors((prev) => ({ ...prev, [name]: '' }));
    }
    if (loginApiError) setLoginApiError('');
  };

  // Login role tab selector handler
  const handleLoginRoleSelect = (role) => {
    setLoginForm((prev) => ({ ...prev, role }));
    if (loginApiError) setLoginApiError('');
  };

  // Register inputs handler
  const handleRegisterChange = (e) => {
    const { name, value } = e.target;
    setRegisterForm((prev) => ({ ...prev, [name]: value }));
    if (registerErrors[name]) {
      setRegisterErrors((prev) => ({ ...prev, [name]: '' }));
    }
    if (registerApiError) setRegisterApiError('');
  };

  // Submit Login
  const handleLoginSubmit = async (e) => {
    e.preventDefault();
    setLoginApiError('');

    const validation = validateLogin(loginForm);
    if (!validation.isValid) {
      setLoginErrors(validation.errors);
      return;
    }

    setLoginLoading(true);
    try {
      await login(loginForm);
      navigate('/', { replace: true });
    } catch (error) {
      if (error.response) {
        const { status, data } = error.response;
        if (status === 400 && data.errors) {
          setLoginErrors(data.errors);
        } else if (status === 401) {
          setLoginApiError(data.message || 'Invalid email or password');
        } else {
          setLoginApiError(data.message || 'An error occurred during login. Please try again.');
        }
      } else if (error.request) {
        setLoginApiError('Unable to connect to server. Please check your network connection.');
      } else {
        setLoginApiError('An unexpected error occurred.');
      }
    } finally {
      setLoginLoading(false);
    }
  };

  // Submit Register
  const handleRegisterSubmit = async (e) => {
    e.preventDefault();
    setRegisterApiError('');
    setRegisterSuccess('');

    const validation = validateRegister(registerForm);
    if (!validation.isValid) {
      setRegisterErrors(validation.errors);
      return;
    }

    setRegisterLoading(true);
    try {
      const response = await registerApi(registerForm);
      if (response?.data?.token && response?.data?.user) {
        // Automatically log in
        await login({ email: registerForm.email, password: registerForm.password });
        navigate('/', { replace: true });
      } else {
        setRegisterSuccess('Account created successfully! Switching to sign in...');
        setTimeout(() => {
          handleSwitchMode('login');
        }, 1500);
      }
    } catch (error) {
      if (error.response) {
        const { status, data } = error.response;
        if (status === 400 && data.errors) {
          setRegisterErrors(data.errors);
        } else if (status === 409) {
          setRegisterApiError(data.message || 'Email is already registered.');
        } else {
          setRegisterApiError(data.message || 'Registration failed. Please try again.');
        }
      } else if (error.request) {
        setRegisterApiError('Unable to connect to server. Please check your network connection.');
      } else {
        setRegisterApiError('An unexpected error occurred.');
      }
    } finally {
      setRegisterLoading(false);
    }
  };

  return (
    <div className="auth-viewport">
      {/* Floating PWA Install Action Button */}
      <PwaInstallButton variant="floating" />

      <div className={`auth-container ${mode === 'register' ? 'register-active' : ''}`}>
        
        {/* ============================================================
            SLIDING FORM PANEL (Left on Login, Slides to Right on Register)
            ============================================================ */}
        <div className="auth-slider-form">
          <div className="auth-form-scroll-wrapper">
            
            {/* Unified FaceDetect Branding */}
            <div className="auth-brand-badge">
              <div className="auth-brand-icon-box">
                <svg
                  viewBox="0 0 24 24"
                  width="22"
                  height="22"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2.2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="M4 8V6a2 2 0 0 1 2-2h2" />
                  <path d="M16 4h2a2 2 0 0 1 2 2v2" />
                  <path d="M4 16v2a2 2 0 0 0 2 2h2" />
                  <path d="M16 20h2a2 2 0 0 0 2-2v-2" />
                  <circle cx="12" cy="12" r="3.5" />
                  <path d="M12 9v1" />
                  <path d="M12 14v1" />
                </svg>
              </div>
              <div className="auth-brand-text">
                <span className="auth-brand-title">FaceDetect</span>
                <span className="auth-brand-subtitle">ENTERPRISE ATTENDANCE</span>
              </div>
            </div>

            {/* Forms Container */}
            <div className="auth-form-views-container">
              
              {/* ── LOGIN FORM VIEW ── */}
              <div className={`auth-form-view ${mode === 'login' ? 'view-active' : 'view-hidden'}`}>
                <div className="auth-heading-area">
                  <h2 className="auth-main-title">Sign In</h2>
                  <p className="auth-main-subtitle">
                    Enter your credentials to access the command center.
                  </p>
                </div>

                {isExpired && !loginApiError && (
                  <div className="auth-alert auth-alert-warning">
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z" />
                      <line x1="12" y1="9" x2="12" y2="13" />
                      <line x1="12" y1="17" x2="12.01" y2="17" />
                    </svg>
                    <span>Your session has expired. Please sign in again to continue.</span>
                  </div>
                )}

                {loginApiError && (
                  <div className="auth-alert auth-alert-danger">
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <circle cx="12" cy="12" r="10" />
                      <line x1="12" y1="8" x2="12" y2="12" />
                      <line x1="12" y1="16" x2="12.01" y2="16" />
                    </svg>
                    <span>{loginApiError}</span>
                  </div>
                )}

                <form onSubmit={handleLoginSubmit} noValidate>
                  {/* Role Selector Dropdown (Admin, Staff, Security) */}
                  <div className="auth-input-group auth-role-select-group">
                    <label className="auth-input-label" htmlFor="login-role">
                      <span>Select Access Role</span>
                    </label>
                    <CustomRoleDropdown
                      id="login-role"
                      value={loginForm.role}
                      onChange={handleLoginChange}
                      disabled={loginLoading}
                      options={LOGIN_ROLE_OPTIONS}
                    />
                  </div>

                  {/* Email Field */}
                  <div className="auth-input-group">
                    <label className="auth-input-label" htmlFor="login-email">
                      <span>Username or Email Address <span className="auth-input-required">*</span></span>
                    </label>
                    <div className={`auth-input-box ${loginErrors.email ? 'has-error' : ''}`}>
                      <div className="auth-input-prefix-icon">
                        <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                          <rect width="20" height="16" x="2" y="4" rx="2" />
                          <path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7" />
                        </svg>
                      </div>
                      <input
                        id="login-email"
                        name="email"
                        type="text"
                        autoComplete="username email"
                        value={loginForm.email}
                        onChange={handleLoginChange}
                        placeholder="Enter email or username"
                        disabled={loginLoading}
                        className="auth-input-field"
                      />
                    </div>
                    {loginErrors.email && (
                      <span className="auth-input-error-msg">
                        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                          <circle cx="12" cy="12" r="10" />
                          <line x1="12" y1="8" x2="12" y2="12" />
                          <line x1="12" y1="16" x2="12.01" y2="16" />
                        </svg>
                        {loginErrors.email}
                      </span>
                    )}
                  </div>

                  {/* Password Field */}
                  <div className="auth-input-group">
                    <label className="auth-input-label" htmlFor="login-password">
                      <span>Password <span className="auth-input-required">*</span></span>
                    </label>
                    <div className={`auth-input-box ${loginErrors.password ? 'has-error' : ''}`}>
                      <div className="auth-input-prefix-icon">
                        <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                          <rect width="18" height="11" x="3" y="11" rx="2" ry="2" />
                          <path d="M7 11V7a5 5 0 0 1 10 0v4" />
                        </svg>
                      </div>
                      <input
                        id="login-password"
                        name="password"
                        type={showLoginPassword ? 'text' : 'password'}
                        autoComplete="current-password"
                        value={loginForm.password}
                        onChange={handleLoginChange}
                        placeholder="Enter your password"
                        disabled={loginLoading}
                        className="auth-input-field"
                      />
                      <button
                        type="button"
                        onClick={() => setShowLoginPassword((prev) => !prev)}
                        className="auth-password-toggle-btn"
                        tabIndex={-1}
                        aria-label={showLoginPassword ? 'Hide password' : 'Show password'}
                      >
                        {showLoginPassword ? (
                          <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                            <path d="M9.88 9.88a3 3 0 1 0 4.24 4.24" />
                            <path d="M10.73 5.08A10.43 10.43 0 0 1 12 5c7 0 10 7 10 7a13.16 13.16 0 0 1-1.67 2.68" />
                            <path d="M6.61 6.61A13.526 13.526 0 0 0 2 12s3 7 10 7a9.74 9.74 0 0 0 5.39-1.61" />
                            <line x1="2" y1="2" x2="22" y2="22" />
                          </svg>
                        ) : (
                          <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                            <path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z" />
                            <circle cx="12" cy="12" r="3" />
                          </svg>
                        )}
                      </button>
                    </div>
                    {loginErrors.password && (
                      <span className="auth-input-error-msg">
                        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                          <circle cx="12" cy="12" r="10" />
                          <line x1="12" y1="8" x2="12" y2="12" />
                          <line x1="12" y1="16" x2="12.01" y2="16" />
                        </svg>
                        {loginErrors.password}
                      </span>
                    )}
                  </div>

                  {/* Sign In Button */}
                  <button
                    type="submit"
                    disabled={loginLoading}
                    className="auth-submit-btn"
                  >
                    {loginLoading ? (
                      <>
                        <span className="auth-btn-spinner" />
                        <span>Verifying credentials...</span>
                      </>
                    ) : (
                      <>
                        <span>Sign In</span>
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                          <path d="M5 12h14" />
                          <path d="m12 5 7 7-7 7" />
                        </svg>
                      </>
                    )}
                  </button>

                  {/* Switch to Register link */}
                  <div className="auth-switch-section">
                    Don't have an account?{' '}
                    <button
                      type="button"
                      onClick={() => handleSwitchMode('register')}
                      className="auth-switch-action-btn"
                    >
                      Register
                    </button>
                  </div>
                </form>
              </div>

              {/* ── REGISTER FORM VIEW ── */}
              <div className={`auth-form-view ${mode === 'register' ? 'view-active' : 'view-hidden'}`}>
                <div className="auth-heading-area">
                  <div className="auth-admin-access-badge">
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
                      <path d="m9 12 2 2 4-4" />
                    </svg>
                    <span>New Account Registration</span>
                  </div>
                  <h2 className="auth-main-title">Create Account</h2>
                  <p className="auth-main-subtitle">
                    Enter your name, email, and password to register your account.
                  </p>
                </div>

                {registerSuccess && (
                  <div className="auth-alert auth-alert-success">
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
                      <polyline points="22 4 12 14.01 9 11.01" />
                    </svg>
                    <span>{registerSuccess}</span>
                  </div>
                )}

                {registerApiError && (
                  <div className="auth-alert auth-alert-danger">
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <circle cx="12" cy="12" r="10" />
                      <line x1="12" y1="8" x2="12" y2="12" />
                      <line x1="12" y1="16" x2="12.01" y2="16" />
                    </svg>
                    <span>{registerApiError}</span>
                  </div>
                )}

                <form onSubmit={handleRegisterSubmit} noValidate>
                  {/* Full Name */}
                  <div className="auth-input-group">
                    <label className="auth-input-label" htmlFor="register-name">
                      <span>Full Name <span className="auth-input-required">*</span></span>
                    </label>
                    <div className={`auth-input-box ${registerErrors.name ? 'has-error' : ''}`}>
                      <div className="auth-input-prefix-icon">
                        <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                          <path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2" />
                          <circle cx="12" cy="7" r="4" />
                        </svg>
                      </div>
                      <input
                        id="register-name"
                        name="name"
                        type="text"
                        autoComplete="name"
                        value={registerForm.name}
                        onChange={handleRegisterChange}
                        placeholder="e.g. Alexander Vance"
                        disabled={registerLoading}
                        className="auth-input-field"
                      />
                    </div>
                    {registerErrors.name && (
                      <span className="auth-input-error-msg">
                        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                          <circle cx="12" cy="12" r="10" />
                          <line x1="12" y1="8" x2="12" y2="12" />
                          <line x1="12" y1="16" x2="12.01" y2="16" />
                        </svg>
                        {registerErrors.name}
                      </span>
                    )}
                  </div>

                  {/* Email Address */}
                  <div className="auth-input-group">
                    <label className="auth-input-label" htmlFor="register-email">
                      <span>Email Address <span className="auth-input-required">*</span></span>
                    </label>
                    <div className={`auth-input-box ${registerErrors.email ? 'has-error' : ''}`}>
                      <div className="auth-input-prefix-icon">
                        <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                          <rect width="20" height="16" x="2" y="4" rx="2" />
                          <path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7" />
                        </svg>
                      </div>
                      <input
                        id="register-email"
                        name="email"
                        type="email"
                        autoComplete="email"
                        value={registerForm.email}
                        onChange={handleRegisterChange}
                        placeholder="name@company.com"
                        disabled={registerLoading}
                        className="auth-input-field"
                      />
                    </div>
                    {registerErrors.email && (
                      <span className="auth-input-error-msg">
                        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                          <circle cx="12" cy="12" r="10" />
                          <line x1="12" y1="8" x2="12" y2="12" />
                          <line x1="12" y1="16" x2="12.01" y2="16" />
                        </svg>
                        {registerErrors.email}
                      </span>
                    )}
                  </div>

                  {/* Password */}
                  <div className="auth-input-group">
                    <label className="auth-input-label" htmlFor="register-password">
                      <span>Password <span className="auth-input-required">*</span></span>
                    </label>
                    <div className={`auth-input-box ${registerErrors.password ? 'has-error' : ''}`}>
                      <div className="auth-input-prefix-icon">
                        <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                          <rect width="18" height="11" x="3" y="11" rx="2" ry="2" />
                          <path d="M7 11V7a5 5 0 0 1 10 0v4" />
                        </svg>
                      </div>
                      <input
                        id="register-password"
                        name="password"
                        type={showRegisterPassword ? 'text' : 'password'}
                        autoComplete="new-password"
                        value={registerForm.password}
                        onChange={handleRegisterChange}
                        placeholder="Minimum 6 characters"
                        disabled={registerLoading}
                        className="auth-input-field"
                      />
                      <button
                        type="button"
                        onClick={() => setShowRegisterPassword((prev) => !prev)}
                        className="auth-password-toggle-btn"
                        tabIndex={-1}
                        aria-label={showRegisterPassword ? 'Hide password' : 'Show password'}
                      >
                        {showRegisterPassword ? (
                          <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                            <path d="M9.88 9.88a3 3 0 1 0 4.24 4.24" />
                            <path d="M10.73 5.08A10.43 10.43 0 0 1 12 5c7 0 10 7 10 7a13.16 13.16 0 0 1-1.67 2.68" />
                            <path d="M6.61 6.61A13.526 13.526 0 0 0 2 12s3 7 10 7a9.74 9.74 0 0 0 5.39-1.61" />
                            <line x1="2" y1="2" x2="22" y2="22" />
                          </svg>
                        ) : (
                          <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                            <path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z" />
                            <circle cx="12" cy="12" r="3" />
                          </svg>
                        )}
                      </button>
                    </div>
                    {registerErrors.password && (
                      <span className="auth-input-error-msg">
                        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                          <circle cx="12" cy="12" r="10" />
                          <line x1="12" y1="8" x2="12" y2="12" />
                          <line x1="12" y1="16" x2="12.01" y2="16" />
                        </svg>
                        {registerErrors.password}
                      </span>
                    )}
                  </div>



                  {/* Register Submit Button */}
                  <button
                    type="submit"
                    disabled={registerLoading}
                    className="auth-submit-btn"
                  >
                    {registerLoading ? (
                      <>
                        <span className="auth-btn-spinner" />
                        <span>Creating account...</span>
                      </>
                    ) : (
                      <>
                        <span>Create Account</span>
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                          <path d="M5 12h14" />
                          <path d="m12 5 7 7-7 7" />
                        </svg>
                      </>
                    )}
                  </button>

                  {/* Switch to Sign In link */}
                  <div className="auth-switch-section">
                    Already have an account?{' '}
                    <button
                      type="button"
                      onClick={() => handleSwitchMode('login')}
                      className="auth-switch-action-btn"
                    >
                      Sign In
                    </button>
                  </div>
                </form>
              </div>

            </div>
          </div>
        </div>

        {/* ============================================================
            SLIDING AI VISUAL PANEL (Right on Login, Slides to Left on Register)
            ============================================================ */}
        <div className="auth-slider-visual">
          <AiVisualPanel mode={mode} />
        </div>

      </div>
    </div>
  );
};

export default AuthPage;
