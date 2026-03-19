// backend/src/api/alerts.js
import { Router } from 'express';
import { alerts } from '../db/queries.js';

const router = Router();

// GET /api/alerts — recent alerts across all residents
router.get('/', async (req, res) => {
  const limit = Math.min(parseInt(req.query.limit || '50') || 50, 500);
  res.json(await alerts.getAll(limit));
});

// GET /api/alerts/resident/:id
router.get('/resident/:id', async (req, res) => {
  const hours = Math.min(parseInt(req.query.hours || '24') || 24, 168);
  res.json(await alerts.getRecent(req.params.id, hours));
});

// POST /api/alerts/:id/acknowledge
router.post('/:id/acknowledge', async (req, res) => {
  const { by } = req.body;
  await alerts.acknowledge(req.params.id, by || 'unknown');
  res.json({ success: true });
});

export default router;
