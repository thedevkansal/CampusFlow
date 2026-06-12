import axios from 'axios';

// Get API URL from env, fallback to localhost for dev
const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001/api/v1';

export const api = axios.create({
  baseURL: API_URL,
  headers: {
    'Content-Type': 'application/json',
  },
});

// Request interceptor to add auth token
api.interceptors.request.use((config) => {
  if (typeof window !== 'undefined') {
    const token = localStorage.getItem('token');
    if (token) {
      config.headers.Authorization = `Bearer ${token}`;
    }
  }
  return config;
});

// Response interceptor — handle 401 (token expired) gracefully.
// IMPORTANT: Do NOT use window.location.href here — that causes a hard reload
// which unmounts all sockets, bypasses React Router, and resets React state.
// Instead, dispatch a custom event so AuthContext can call logout() cleanly,
// which lets useRequireAuth redirect via Next.js router (soft navigation).
api.interceptors.response.use(
  (response) => response,
  (error) => {
    const status = error.response?.status;
    const code = error.response?.data?.code;

    // Only trigger auth reset when the backend explicitly says the token is bad.
    // 401 from /login itself should not recurse.
    const isAuthError =
      status === 401 &&
      code !== undefined && // backend always sends a code on auth failures
      typeof window !== 'undefined' &&
      !window.location.pathname.startsWith('/login') &&
      !window.location.pathname.startsWith('/register');

    if (isAuthError) {
      window.dispatchEvent(new CustomEvent('auth:unauthorized'));
    }

    return Promise.reject(error);
  }
);
