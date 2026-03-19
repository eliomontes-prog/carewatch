// frontend/src/lib/api.js
// Unified API client — works in web browser, PWA, and Capacitor native app

import { Capacitor } from '@capacitor/core';

// In a native Capacitor app the webview runs on a local origin,
// so we must use the absolute backend URL stored in env/config.
// In the browser dev server the Vite proxy handles /api → localhost:4000.
function resolveBase() {
  if (Capacitor.isNativePlatform()) {
    // Production native app: use the real server URL
    return import.meta.env.VITE_API_URL || 'https://carewatch-backend.onrender.com';
  }
  // Browser (dev or PWA): relative path works via Vite proxy
  return import.meta.env.VITE_API_URL || '';
}

export const API_BASE = resolveBase();

// Fetch wrapper with cookie credentials + JSON default
export async function apiFetch(path, options = {}) {
  const url = `${API_BASE}${path}`;
  const res = await fetch(url, {
    credentials: 'include',
    headers: { 'Content-Type': 'application/json', ...options.headers },
    ...options,
  });
  return res;
}

// WebSocket URL resolver
export function wsUrl(path = '/ws') {
  if (Capacitor.isNativePlatform()) {
    const base = (import.meta.env.VITE_WS_URL || 'wss://carewatch-backend.onrender.com');
    return `${base}${path}`;
  }
  // Browser: derive from current host
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  const host  = import.meta.env.VITE_WS_URL
    ? import.meta.env.VITE_WS_URL.replace(/^https?/, proto === 'wss' ? 'wss' : 'ws')
    : `${proto}://${location.host}`;
  return `${host}${path}`;
}
