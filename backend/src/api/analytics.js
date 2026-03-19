// backend/src/api/analytics.js — per-resident trend data
import { Router } from 'express';
import { requireAuth } from '../middleware/requireAuth.js';
import { db } from '../db/pool.js';

const router = Router();

// GET /api/analytics/resident/:id?days=7|30
router.get('/resident/:id', requireAuth, async (req, res) => {
  const { id } = req.params;
  const days = Math.min(parseInt(req.query.days || '7', 10), 90);

  // Family role: can only view their assigned residents
  if (req.user.role === 'family') {
    const assignedIds = JSON.parse(req.user.resident_ids || '[]');
    if (!assignedIds.includes(id)) {
      return res.status(403).json({ error: 'Forbidden' });
    }
  }

  const [dailyRows, alertRows] = await Promise.all([
    db.all(
      `SELECT
         recorded_at::DATE                                                    AS date,
         ROUND(AVG(breathing_rate) FILTER (WHERE breathing_rate IS NOT NULL)::NUMERIC, 1)  AS avg_breathing,
         ROUND(AVG(heart_rate)     FILTER (WHERE heart_rate IS NOT NULL)::NUMERIC, 1)      AS avg_heart_rate,
         ROUND(AVG(motion_level)   FILTER (WHERE motion_level IS NOT NULL)::NUMERIC, 3)    AS avg_motion,
         COUNT(*)                                                              AS reading_count,
         SUM(CASE WHEN presence = 1 THEN 1 ELSE 0 END)                        AS presence_count
       FROM sensor_readings
       WHERE resident_id = $1
         AND recorded_at >= NOW() - ($2 || ' days')::INTERVAL
       GROUP BY recorded_at::DATE
       ORDER BY date ASC`,
      [id, days]
    ),

    db.all(
      `SELECT
         created_at::DATE                                               AS date,
         COUNT(*)                                                       AS alert_count,
         COUNT(*) FILTER (WHERE urgency = 'high')                      AS high_count,
         COUNT(*) FILTER (WHERE urgency = 'medium')                    AS medium_count
       FROM alerts
       WHERE resident_id = $1
         AND sent = 1
         AND created_at >= NOW() - ($2 || ' days')::INTERVAL
       GROUP BY created_at::DATE
       ORDER BY date ASC`,
      [id, days]
    ),
  ]);

  // Merge by date string
  const alertMap = {};
  for (const r of alertRows) {
    const key = typeof r.date === 'string' ? r.date : r.date.toISOString().slice(0, 10);
    alertMap[key] = r;
  }

  const merged = dailyRows.map(r => {
    const key = typeof r.date === 'string' ? r.date : r.date.toISOString().slice(0, 10);
    const a = alertMap[key] || {};
    return {
      date: key,
      avg_breathing:  r.avg_breathing  ? parseFloat(r.avg_breathing)  : null,
      avg_heart_rate: r.avg_heart_rate ? parseFloat(r.avg_heart_rate) : null,
      avg_motion:     r.avg_motion     ? parseFloat(r.avg_motion)     : null,
      reading_count:  parseInt(r.reading_count || 0),
      presence_pct: r.reading_count
        ? Math.round((parseInt(r.presence_count || 0) / parseInt(r.reading_count)) * 100)
        : 0,
      alerts:      parseInt(a.alert_count || 0),
      high_alerts: parseInt(a.high_count  || 0),
    };
  });

  res.json(merged);
});

// GET /api/analytics/overview — aggregate across all residents (admin/caregiver)
router.get('/overview', requireAuth, async (req, res) => {
  const days = Math.min(parseInt(req.query.days || '7', 10), 30);

  const rows = await db.all(
    `SELECT
       r.id, r.name, r.room,
       ROUND(AVG(s.heart_rate) FILTER (WHERE s.heart_rate IS NOT NULL)::NUMERIC, 1)     AS avg_hr,
       ROUND(AVG(s.breathing_rate) FILTER (WHERE s.breathing_rate IS NOT NULL)::NUMERIC, 1) AS avg_br,
       COUNT(DISTINCT a.id) FILTER (WHERE a.urgency = 'high' AND a.sent = 1)            AS high_alerts,
       COUNT(DISTINCT a.id) FILTER (WHERE a.sent = 1)                                   AS total_alerts
     FROM residents r
     LEFT JOIN sensor_readings s ON s.resident_id = r.id
       AND s.recorded_at >= NOW() - ($1 || ' days')::INTERVAL
     LEFT JOIN alerts a ON a.resident_id = r.id
       AND a.created_at >= NOW() - ($1 || ' days')::INTERVAL
     WHERE r.active = 1
     GROUP BY r.id, r.name, r.room
     ORDER BY r.name`,
    [days]
  );

  res.json(rows);
});

export default router;
