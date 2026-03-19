// backend/src/services/push.js — Web Push notifications
import webpush from 'web-push';
import { pushSubs } from '../db/queries.js';

let _configured = false;

function configure() {
  if (_configured) return;
  if (process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY) {
    webpush.setVapidDetails(
      `mailto:${process.env.VAPID_EMAIL || 'admin@carewatch.app'}`,
      process.env.VAPID_PUBLIC_KEY,
      process.env.VAPID_PRIVATE_KEY,
    );
    _configured = true;
  }
}

/**
 * Send a push notification to all subscriptions for a given user.
 * On 410 Gone, the subscription is removed automatically.
 */
export async function sendPushToUser(userId, payload) {
  configure();
  if (!_configured) return; // VAPID not set up — silently skip

  const subs = await pushSubs.getForUser(userId);
  await _sendToSubs(subs, payload);
}

/**
 * Send a push notification to all users assigned to a resident.
 */
export async function sendPushForResident(residentId, payload) {
  configure();
  if (!_configured) return;

  const subs = await pushSubs.getForResident(residentId);
  await _sendToSubs(subs, payload);
}

async function _sendToSubs(subs, payload) {
  const message = JSON.stringify(payload);
  await Promise.allSettled(
    subs.map(async (sub) => {
      try {
        await webpush.sendNotification(
          { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
          message
        );
      } catch (err) {
        if (err.statusCode === 410 || err.statusCode === 404) {
          // Subscription expired — clean up
          await pushSubs.remove(sub.endpoint).catch(() => {});
        } else {
          console.warn('Push send error:', err.message);
        }
      }
    })
  );
}
