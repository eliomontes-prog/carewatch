// backend/src/middleware/requireAuth.js
import { verifyToken } from '../services/auth.js';

export function requireAuth(req, res, next) {
  // 1. Cookie (browser / PWA)
  let token = req.cookies?.token;

  // 2. Authorization: Bearer <token> fallback (mobile / API clients)
  if (!token) {
    const header = req.headers.authorization || '';
    if (header.startsWith('Bearer ')) token = header.slice(7);
  }

  if (!token) {
    return res.status(401).json({ error: 'Authentication required' });
  }

  try {
    req.user = verifyToken(token);
    next();
  } catch {
    return res.status(401).json({ error: 'Invalid or expired session' });
  }
}
