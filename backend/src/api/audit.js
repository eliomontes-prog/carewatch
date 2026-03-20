// backend/src/api/audit.js — Admin-only audit log query endpoint
import { Router } from 'express';
import { queryAuditLog } from '../services/auditLog.js';

const router = Router();

// GET /api/audit?userId=...&resourceType=...&action=...&startDate=...&endDate=...&limit=100&offset=0
router.get('/', async (req, res) => {
  if (req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Admin access required' });
  }

  const { userId, resourceType, resourceId, action, startDate, endDate } = req.query;
  const limit = Math.min(parseInt(req.query.limit || '100') || 100, 500);
  const offset = parseInt(req.query.offset || '0') || 0;

  const rows = await queryAuditLog({ userId, resourceType, resourceId, action, startDate, endDate, limit, offset });
  res.json(rows);
});

export default router;
