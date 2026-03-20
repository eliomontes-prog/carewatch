// backend/src/db/queries.js — PostgreSQL (all ? → $N)
import { db } from './pool.js';

// ── Residents ────────────────────────────────────────────────────────────────

export const residents = {
  getAll: async () =>
    db.all(`SELECT * FROM residents WHERE active = 1 ORDER BY name`),

  getById: async (id) =>
    db.get(`SELECT * FROM residents WHERE id = $1`, [id]),

  getByRoom: async (room) =>
    db.get(`SELECT * FROM residents WHERE room = $1 AND active = 1`, [room]),

  create: async (resident) =>
    db.run(
      `INSERT INTO residents (id, name, room, date_of_birth, emergency_contacts, notes)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [resident.id, resident.name, resident.room, resident.date_of_birth,
       resident.emergency_contacts, resident.notes]
    ),

  update: async (id, fields) =>
    db.run(
      `UPDATE residents SET name = $1, room = $2, notes = $3 WHERE id = $4`,
      [fields.name, fields.room, fields.notes, id]
    ),
};

// ── Baselines ────────────────────────────────────────────────────────────────

export const baselines = {
  get: async (residentId) => {
    const rows = await db.all(
      `SELECT * FROM baselines WHERE resident_id = $1`, [residentId]
    );
    return Object.fromEntries(rows.map(r => [r.metric, r.value]));
  },

  update: async (residentId, metric, newValue) => {
    const existing = await db.get(
      `SELECT value, sample_count FROM baselines WHERE resident_id = $1 AND metric = $2`,
      [residentId, metric]
    );

    if (!existing) {
      return db.run(
        `INSERT INTO baselines (resident_id, metric, value, sample_count) VALUES ($1, $2, $3, 1)`,
        [residentId, metric, newValue]
      );
    }

    const alpha = existing.sample_count < 100 ? 0.2 : 0.05;
    const updated = existing.value * (1 - alpha) + newValue * alpha;
    return db.run(
      `UPDATE baselines SET value = $1, sample_count = sample_count + 1, last_updated = NOW()
       WHERE resident_id = $2 AND metric = $3`,
      [updated, residentId, metric]
    );
  },
};

// ── Sensor Readings ───────────────────────────────────────────────────────────

export const readings = {
  insert: async (reading) =>
    db.run(
      `INSERT INTO sensor_readings
        (resident_id, room, presence, person_count, breathing_rate, heart_rate,
         motion_level, posture, confidence, raw_json)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
      [reading.resident_id, reading.room, reading.presence, reading.person_count,
       reading.breathing_rate, reading.heart_rate, reading.motion_level,
       reading.posture, reading.confidence, reading.raw_json]
    ),

  getRecent: async (room, minutes = 30) =>
    db.all(
      `SELECT * FROM sensor_readings
       WHERE room = $1 AND recorded_at > NOW() - ($2 || ' minutes')::INTERVAL
       ORDER BY recorded_at DESC`,
      [room, minutes]
    ),

  getLastN: async (room, n = 20) =>
    db.all(
      `SELECT * FROM sensor_readings WHERE room = $1 ORDER BY recorded_at DESC LIMIT $2`,
      [room, n]
    ),

  getDailyStats: async (residentId, date) =>
    db.get(
      `SELECT
        AVG(breathing_rate) AS avg_breathing,
        AVG(heart_rate)     AS avg_heart_rate,
        AVG(motion_level)   AS avg_motion,
        COUNT(*)            AS reading_count,
        SUM(CASE WHEN presence = 1 THEN 1 ELSE 0 END) AS presence_count
       FROM sensor_readings
       WHERE resident_id = $1 AND recorded_at::DATE = $2::DATE`,
      [residentId, date]
    ),
};

// ── Alerts ────────────────────────────────────────────────────────────────────

export const alerts = {
  insert: async (alert) =>
    db.run(
      `INSERT INTO alerts
        (resident_id, room, alert_type, urgency, message, ai_reasoning, sent, suppressed, suppressed_reason)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [alert.resident_id, alert.room, alert.alert_type, alert.urgency,
       alert.message, alert.ai_reasoning, alert.sent, alert.suppressed,
       alert.suppressed_reason]
    ),

  getRecent: async (residentId, hours = 24) =>
    db.all(
      `SELECT * FROM alerts
       WHERE resident_id = $1 AND created_at > NOW() - ($2 || ' hours')::INTERVAL
       ORDER BY created_at DESC`,
      [residentId, hours]
    ),

  getLastOfType: async (residentId, alertType) =>
    db.get(
      `SELECT * FROM alerts
       WHERE resident_id = $1 AND alert_type = $2 AND sent = 1
       ORDER BY created_at DESC LIMIT 1`,
      [residentId, alertType]
    ),

  acknowledge: async (id, by) =>
    db.run(
      `UPDATE alerts SET acknowledged = 1, acknowledged_by = $1 WHERE id = $2`,
      [by, id]
    ),

  getAll: async (limit = 50) =>
    db.all(
      `SELECT a.*, r.name AS resident_name FROM alerts a
       LEFT JOIN residents r ON a.resident_id = r.id
       ORDER BY a.created_at DESC LIMIT $1`,
      [limit]
    ),

  // For escalation agent
  getUnacknowledgedSent: async (olderThanMinutes) =>
    db.all(
      `SELECT a.*, r.name AS resident_name, r.emergency_contacts
       FROM alerts a
       LEFT JOIN residents r ON a.resident_id = r.id
       WHERE a.sent = 1
         AND a.acknowledged = 0
         AND a.suppressed = 0
         AND a.escalation_tier < 2
         AND a.created_at < NOW() - ($1 || ' minutes')::INTERVAL
       ORDER BY a.urgency DESC, a.created_at ASC`,
      [olderThanMinutes]
    ),

  markEscalated: async (id, tier) =>
    db.run(
      `UPDATE alerts SET escalated = 1, escalated_at = NOW(), escalation_tier = $1 WHERE id = $2`,
      [tier, id]
    ),
};

// ── Activity Log ──────────────────────────────────────────────────────────────

export const activityLog = {
  insert: async (entry) =>
    db.run(
      `INSERT INTO activity_log (resident_id, date, summary, metrics) VALUES ($1,$2,$3,$4)`,
      [entry.resident_id, entry.date, entry.summary, entry.metrics]
    ),

  getForResident: async (residentId, days = 7) =>
    db.all(
      `SELECT * FROM activity_log WHERE resident_id = $1 ORDER BY date DESC LIMIT $2`,
      [residentId, days]
    ),
};

// ── Users ─────────────────────────────────────────────────────────────────────

export const users = {
  getByEmail: async (email) =>
    db.get(`SELECT * FROM users WHERE email = $1 AND active = 1`, [email]),

  getById: async (id) =>
    db.get(`SELECT * FROM users WHERE id = $1`, [id]),

  create: async (user) =>
    db.run(
      `INSERT INTO users (id, email, password_hash, name, role, resident_ids)
       VALUES ($1,$2,$3,$4,$5,$6)`,
      [user.id, user.email, user.password_hash, user.name, user.role,
       user.resident_ids || '[]']
    ),

  getAll: async () =>
    db.all(`SELECT id, email, name, role, resident_ids, active, created_at FROM users ORDER BY name`),

  // Get caregivers/family assigned to a resident
  getForResident: async (residentId) =>
    db.all(
      `SELECT id, email, name, role FROM users
       WHERE active = 1 AND resident_ids::jsonb ? $1`,
      [residentId]
    ),
};

// ── Push Subscriptions ────────────────────────────────────────────────────────

export const pushSubs = {
  save: async (userId, sub) =>
    db.run(
      `INSERT INTO push_subscriptions (user_id, endpoint, p256dh, auth)
       VALUES ($1,$2,$3,$4)
       ON CONFLICT (endpoint) DO UPDATE SET p256dh = $3, auth = $4`,
      [userId, sub.endpoint, sub.keys.p256dh, sub.keys.auth]
    ),

  remove: async (endpoint) =>
    db.run(`DELETE FROM push_subscriptions WHERE endpoint = $1`, [endpoint]),

  getForUser: async (userId) =>
    db.all(`SELECT * FROM push_subscriptions WHERE user_id = $1`, [userId]),

  getForResident: async (residentId) =>
    db.all(
      `SELECT ps.* FROM push_subscriptions ps
       JOIN users u ON ps.user_id = u.id
       WHERE u.active = 1 AND u.resident_ids::jsonb ? $1`,
      [residentId]
    ),
};

// ── Nodes ─────────────────────────────────────────────────────────────────────

export const nodes = {
  getAll: async () =>
    db.all(`SELECT * FROM nodes ORDER BY created_at`),

  getById: async (id) =>
    db.get(`SELECT * FROM nodes WHERE id = $1`, [id]),

  getByMac: async (mac) =>
    db.get(`SELECT * FROM nodes WHERE mac_address = $1`, [mac]),

  getByRoom: async (room) =>
    db.all(`SELECT * FROM nodes WHERE room = $1 ORDER BY label`, [room]),

  getOnline: async () =>
    db.all(`SELECT * FROM nodes WHERE status = 'online' ORDER BY room, label`),

  create: async (node) =>
    db.run(
      `INSERT INTO nodes (id, label, mac_address, ip_address, room, position_x, position_y, position_z, firmware_version, status, config)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
       ON CONFLICT (id) DO UPDATE SET
         label = EXCLUDED.label,
         mac_address = EXCLUDED.mac_address,
         ip_address = EXCLUDED.ip_address,
         room = EXCLUDED.room,
         position_x = EXCLUDED.position_x,
         position_y = EXCLUDED.position_y,
         position_z = EXCLUDED.position_z,
         firmware_version = EXCLUDED.firmware_version,
         status = EXCLUDED.status,
         config = EXCLUDED.config`,
      [node.id, node.label, node.mac_address || null, node.ip_address || null,
       node.room || 'default', node.position_x ?? 0, node.position_y ?? 0, node.position_z ?? 1.5,
       node.firmware_version || null, node.status || 'online', node.config || '{}']
    ),

  update: async (id, fields) =>
    db.run(
      `UPDATE nodes SET label = COALESCE($1, label), room = COALESCE($2, room),
       position_x = COALESCE($3, position_x), position_y = COALESCE($4, position_y),
       position_z = COALESCE($5, position_z), config = COALESCE($6, config)
       WHERE id = $7`,
      [fields.label, fields.room, fields.position_x, fields.position_y,
       fields.position_z, fields.config, id]
    ),

  heartbeat: async (id, ip) =>
    db.run(
      `UPDATE nodes SET status = 'online', last_heartbeat = NOW(), ip_address = COALESCE($1, ip_address)
       WHERE id = $2`,
      [ip, id]
    ),

  recordFrame: async (id) =>
    db.run(
      `UPDATE nodes SET last_frame_at = NOW(), frames_total = frames_total + 1, status = 'online'
       WHERE id = $1`,
      [id]
    ),

  markOffline: async (id) =>
    db.run(`UPDATE nodes SET status = 'offline' WHERE id = $1`, [id]),

  // Mark nodes offline if no heartbeat in given minutes
  markStaleOffline: async (minutes = 2) =>
    db.run(
      `UPDATE nodes SET status = 'offline'
       WHERE status = 'online' AND last_heartbeat < NOW() - ($1 || ' minutes')::INTERVAL`,
      [minutes]
    ),

  remove: async (id) =>
    db.run(`DELETE FROM nodes WHERE id = $1`, [id]),
};
