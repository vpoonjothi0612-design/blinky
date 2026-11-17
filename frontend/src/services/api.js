import axios from 'axios';
import { getToken, clearAuth } from '../utils/storage';

export const getBackendBaseUrl = () => {
  if (import.meta.env.VITE_BACKEND_URL) {
    return import.meta.env.VITE_BACKEND_URL.replace(/\/+$/, '');
  }
  if (import.meta.env.VITE_API_BASE_URL) {
    return import.meta.env.VITE_API_BASE_URL.replace(/\/api\/?$/, '');
  }
  if (typeof window !== 'undefined' && window.location) {
    const hostname = window.location.hostname || '';
    // Production domain support: facetrack.gldatacenter.com or any non-localhost host
    if (hostname && hostname !== 'localhost' && hostname !== '127.0.0.1') {
      return window.location.origin;
    }
    const protocol = window.location.protocol || 'http:';
    return `${protocol}//${hostname || 'localhost'}:3000`;
  }
  return 'https://facetrack.gldatacenter.com';
};

export const getApiBaseUrl = () => {
  if (import.meta.env.VITE_API_BASE_URL) {
    return import.meta.env.VITE_API_BASE_URL;
  }
  return `${getBackendBaseUrl()}/api`;
};

const REQUEST_TIMEOUT_MS = 10_000;
const ENROLLMENT_WRITE_TIMEOUT_MS = 5 * 60_000;
const requestTimeouts = new WeakMap();

const api = axios.create({
  baseURL: getApiBaseUrl(),
  headers: {
    'Content-Type': 'application/json',
  },
});

const clearRequestTimeout = (signal) => {
  if (!signal) return;
  const timeout = requestTimeouts.get(signal);
  if (!timeout) return;

  clearTimeout(timeout.timerId);
  if (timeout.originalSignal && timeout.abortListener) {
    timeout.originalSignal.removeEventListener('abort', timeout.abortListener);
  }
  requestTimeouts.delete(signal);
};

// Request interceptor to attach Authorization Bearer token
api.interceptors.request.use(
  (config) => {
    const controller = new AbortController();
    const originalSignal = config.signal;
    const abortListener = originalSignal ? () => controller.abort() : null;
    const configuredTimeout = Number(config.timeout);
    const method = (config.method || 'get').toLowerCase();
    const requestPath = (config.url || '').split('?')[0];
    const isEnrollmentWrite =
      ['post', 'put'].includes(method) &&
      /^\/face-enrollments(?:\/[^/]+)?$/.test(requestPath);
    const timeoutMs = configuredTimeout > 0
      ? configuredTimeout
      : isEnrollmentWrite
        ? ENROLLMENT_WRITE_TIMEOUT_MS
        : REQUEST_TIMEOUT_MS;
    const timerId = setTimeout(() => controller.abort(), timeoutMs);

    if (originalSignal) {
      if (originalSignal.aborted) controller.abort();
      else originalSignal.addEventListener('abort', abortListener, { once: true });
    }

    config.signal = controller.signal;
    requestTimeouts.set(controller.signal, { timerId, originalSignal, abortListener });

    const token = getToken();
    if (token) {
      config.headers.Authorization = `Bearer ${token}`;
    }
    return config;
  },
  (error) => Promise.reject(error)
);

// Response interceptor for handling auth errors, expired tokens & network errors
api.interceptors.response.use(
  (response) => {
    clearRequestTimeout(response.config?.signal);
    return response;
  },
  (error) => {
    clearRequestTimeout(error.config?.signal);

    // 1. Preserve existing 401 handling
    if (error.response && error.response.status === 401) {
      const url = error.config?.url || '';
      const isAuthAttempt = url.includes('/auth/login') || url.includes('/auth/register');
      if (!isAuthAttempt) {
        clearAuth();
        if (typeof window !== 'undefined' && !window.location.pathname.includes('/login')) {
          window.location.href = '/login?expired=true';
        }
      }
    }

    // 2. Identify genuine network disconnections (exclude HTTP responses like 401, 403, 400, 500)
    if (!error.response) {
      const isOffline = typeof navigator !== 'undefined' && navigator.onLine === false;
      error.isNetworkError = true;
      error.userFriendlyMessage = isOffline
        ? 'You are currently offline. Please reconnect to the internet to perform this action.'
        : 'Unable to reach the server. Please verify your connection or try again later.';
    }

    return Promise.reject(error);
  }
);

export default api;
