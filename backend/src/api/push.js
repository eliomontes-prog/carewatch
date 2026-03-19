// backend/src/api/push.js — Web Push subscription management
import { Router } from 'express';
import { pushSubs } from '../db/queries.js';
import { requireAuth } from '../middleware/requireAuth.js';

const router = Router();

// GET /api/push/vapid-public-key — return public VAPID key to frontend
router.get('/vapid-public-key', (req, res) => {
  const key = process.env.VAPID_PUBLIC_KEY;
  if (!key) return res.status(503).json({ error: 'Push not configured' });
  res.json({ key });
});

// POST /api/push/subscribe — save a push subscription for the current user
router.post('/subscribe', requireAuth, async (req, res) => {
  const sub = req.body;
  if (!sub?.endpoint || !sub?.keys?.p256dh || !sub?.keys?.auth) {
    return res.status(400).json({ error: 'Invalid push subscription' });
  }
  await pushSubs.save(req.user.id, sub);
  res.json({ ok: true });
});

// DELETE /api/push/subscribe — remove a push subscription
router.delete('/subscribe', requireAuth, async (req, res) => {
  const { endpoint } = req.body || {};
  if (!endpoint) return res.status(400).json({ error: 'endpoint required' });
  await pushSubs.remove(endpoint);
  res.json({ ok: true });
});

// POST /api/push/native-subscribe — store FCM/APNs device token from Capacitor app
router.post('/native-subscribe', requireAuth, async (req, res) => {
  const { token, platform } = req.body || {};
  if (!token) return res.status(400).json({ error: 'token required' });
  // Store as a "native" pseudo-subscription using the token as endpoint
  await pushSubs.save(req.user.id, {
    endpoint: `native:${platform}:${token}`,
    keys: { p256dh: 'native', auth: platform },
  });
  res.json({ ok: true });
});

export default router;
