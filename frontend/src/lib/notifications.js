// frontend/src/lib/notifications.js
// Unified push notification setup — native (Capacitor) or Web Push

import { Capacitor } from '@capacitor/core';

export async function setupNotifications(apiBase) {
  if (Capacitor.isNativePlatform()) {
    return setupNativePush(apiBase);
  }
  return setupWebPush(apiBase);
}

// ── Native push (iOS / Android via Capacitor) ─────────────────────
async function setupNativePush(apiBase) {
  try {
    const { PushNotifications } = await import('@capacitor/push-notifications');

    const permResult = await PushNotifications.requestPermissions();
    if (permResult.receive !== 'granted') return false;

    await PushNotifications.register();

    // Receive the FCM/APNs device token
    await new Promise((resolve) => {
      PushNotifications.addListener('registration', async (token) => {
        try {
          await fetch(`${apiBase}/api/push/native-subscribe`, {
            method: 'POST',
            credentials: 'include',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ token: token.value, platform: Capacitor.getPlatform() }),
          });
        } catch { /* non-fatal */ }
        resolve(true);
      });

      PushNotifications.addListener('registrationError', () => resolve(false));
    });

    // Handle foreground push
    PushNotifications.addListener('pushNotificationReceived', (notification) => {
      console.log('Push received (foreground):', notification.title);
    });

    // Handle tap on notification
    PushNotifications.addListener('pushNotificationActionPerformed', (action) => {
      const url = action.notification.data?.url;
      if (url && url !== '/') {
        // Could navigate to alerts tab here
        console.log('Notification tapped, target:', url);
      }
    });

    return true;
  } catch (err) {
    console.warn('Native push setup failed:', err.message);
    return false;
  }
}

// ── Web Push (browser / PWA) ──────────────────────────────────────
async function setupWebPush(apiBase) {
  if (!('Notification' in window) || !('serviceWorker' in navigator)) return false;

  const perm = await Notification.requestPermission();
  if (perm !== 'granted') return false;

  try {
    const keyRes = await fetch(`${apiBase}/api/push/vapid-public-key`, { credentials: 'include' });
    if (!keyRes.ok) return false;
    const { key } = await keyRes.json();

    const sw  = await navigator.serviceWorker.ready;
    const sub = await sw.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(key),
    });

    await fetch(`${apiBase}/api/push/subscribe`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(sub),
    });

    return true;
  } catch (err) {
    console.warn('Web push setup failed:', err.message);
    return false;
  }
}

function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - base64String.length % 4) % 4);
  const base64  = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw     = window.atob(base64);
  return Uint8Array.from([...raw].map(c => c.charCodeAt(0)));
}
