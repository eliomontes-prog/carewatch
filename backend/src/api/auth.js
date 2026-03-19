// backend/src/api/auth.js
import { Router } from 'express';
import { randomUUID } from 'crypto';
import { users } from '../db/queries.js';
import { signToken, hashPassword, checkPassword } from '../services/auth.js';

const router = Router();

const COOKIE_OPTS = {
  httpOnly: true,
  sameSite: 'lax',
  secure: process.env.NODE_ENV === 'production',
  maxAge: 8 * 60 * 60 * 1000, // 8 hours
};

// ── POST /api/auth/login ──────────────────────────────────────────
router.post('/login', async (req, res) => {
  const { email, password } = req.body || {};
  if (!email || !password) {
    return res.status(400).json({ error: 'Email and password required' });
  }

  const user = await users.getByEmail(email.toLowerCase().trim());
  if (!user) return res.status(401).json({ error: 'Invalid credentials' });

  const ok = await checkPassword(password, user.password_hash);
  if (!ok) return res.status(401).json({ error: 'Invalid credentials' });

  const payload = {
    id: user.id,
    email: user.email,
    name: user.name,
    role: user.role,
    resident_ids: user.resident_ids,
  };

  const token = signToken(payload);
  res.cookie('token', token, COOKIE_OPTS);
  res.json({ ok: true, user: payload });
});

// ── POST /api/auth/register ───────────────────────────────────────
// Open for first user; subsequent registrations require admin role
router.post('/register', async (req, res) => {
  const { email, password, name, role = 'caregiver', resident_ids = '[]' } = req.body || {};
  if (!email || !password || !name) {
    return res.status(400).json({ error: 'email, password, and name required' });
  }

  // Check if any user exists — if so, only admins may register new users
  const existing = await users.getByEmail(email.toLowerCase().trim());
  if (existing) return res.status(409).json({ error: 'Email already registered' });

  // Check auth requirement: if there are already users, caller must be admin
  const token = req.cookies?.token || (req.headers.authorization || '').replace('Bearer ', '');
  if (token) {
    try {
      const { verifyToken } = await import('../services/auth.js');
      const caller = verifyToken(token);
      if (caller.role !== 'admin') {
        return res.status(403).json({ error: 'Only admins can register new users' });
      }
    } catch {
      return res.status(401).json({ error: 'Invalid token' });
    }
  }
  // If no token provided and it's the first user, allow it (bootstrap)
  // If no token and users already exist, block
  const allUsers = await users.getAll();
  if (allUsers.length > 0 && !token) {
    return res.status(401).json({ error: 'Authentication required to register users' });
  }

  const password_hash = await hashPassword(password);
  const id = randomUUID();
  const validRole = ['admin', 'caregiver', 'family'].includes(role) ? role : 'caregiver';

  await users.create({ id, email: email.toLowerCase().trim(), password_hash, name, role: validRole, resident_ids });

  const payload = { id, email: email.toLowerCase().trim(), name, role: validRole, resident_ids };
  const newToken = signToken(payload);
  res.cookie('token', newToken, COOKIE_OPTS);
  res.status(201).json({ ok: true, user: payload });
});

// ── POST /api/auth/logout ─────────────────────────────────────────
router.post('/logout', (req, res) => {
  res.clearCookie('token');
  res.json({ ok: true });
});

// ── GET /api/auth/me ──────────────────────────────────────────────
router.get('/me', async (req, res) => {
  const token = req.cookies?.token || (req.headers.authorization || '').replace('Bearer ', '');
  if (!token) return res.status(401).json({ error: 'Not authenticated' });

  try {
    const { verifyToken } = await import('../services/auth.js');
    const user = verifyToken(token);
    // Refresh from DB to pick up any role/name changes
    const dbUser = await users.getById(user.id);
    if (!dbUser || !dbUser.active) return res.status(401).json({ error: 'User not found' });
    const { password_hash: _, ...safe } = dbUser;
    res.json(safe);
  } catch {
    res.status(401).json({ error: 'Invalid session' });
  }
});

// ── GET /api/auth/users (admin only) ─────────────────────────────
router.get('/users', async (req, res) => {
  // inline auth check since this route is mounted before global requireAuth
  const token = req.cookies?.token || (req.headers.authorization || '').replace('Bearer ', '');
  if (!token) return res.status(401).json({ error: 'Not authenticated' });
  try {
    const { verifyToken } = await import('../services/auth.js');
    const caller = verifyToken(token);
    if (caller.role !== 'admin') return res.status(403).json({ error: 'Admin only' });
    const all = await users.getAll();
    res.json(all);
  } catch {
    res.status(401).json({ error: 'Invalid session' });
  }
});

export default router;
