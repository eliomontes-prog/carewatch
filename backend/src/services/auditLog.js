// backend/src/services/auditLog.js — HIPAA-compliant audit trail service
import { db } from '../db/pool.js';

/**
 * Log an auditable action.
 * @param {Object} entry
 * @param {string} entry.action       - e.g. 'login', 'view_resident', 'acknowledge_alert'
 * @param {string} entry.resourceType - e.g. 'auth', 'resident', 'alert', 'user'
 * @param {string} [entry.resourceId] - ID of the affected resource
 * @param {string} [entry.detail]     - human-readable detail or JSON context
 * @param {Object} [entry.user]       - { id, email, role } from req.user
 * @param {Object} [entry.req]        - Express request (for IP + user-agent)
 * @param {number} [entry.statusCode] - HTTP response status
 * @param {number} [entry.durationMs] - request duration in ms
 */
export async function logAudit(entry) {
  const {
    action,
    resourceType,
    resourceId = null,
    detail = null,
    user = {},
    req = {},
    statusCode = null,
    durationMs = null,
  } = entry;

  try {
    await db.run(
      `INSERT INTO audit_log
        (user_id, user_email, user_role, action, resource_type, resource_id,
         detail, ip_address, user_agent, status_code, duration_ms)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
      [
        user.id || null,
        user.email || null,
        user.role || null,
        action,
        resourceType,
        resourceId,
        detail,
        req.ip || req.headers?.['x-forwarded-for'] || null,
        req.headers?.['user-agent'] || null,
        statusCode,
        durationMs,
      ]
    );
  } catch (err) {
    // Audit logging should never crash the app
    console.error('Audit log write error:', err.message);
  }
}

/**
 * Query audit logs with filters.
 */
export async function queryAuditLog({ userId, resourceType, resourceId, action, startDate, endDate, limit = 100, offset = 0 } = {}) {
  const conditions = [];
  const params = [];
  let paramIdx = 1;

  if (userId) {
    conditions.push(`user_id = $${paramIdx++}`);
    params.push(userId);
  }
  if (resourceType) {
    conditions.push(`resource_type = $${paramIdx++}`);
    params.push(resourceType);
  }
  if (resourceId) {
    conditions.push(`resource_id = $${paramIdx++}`);
    params.push(resourceId);
  }
  if (action) {
    conditions.push(`action = $${paramIdx++}`);
    params.push(action);
  }
  if (startDate) {
    conditions.push(`timestamp >= $${paramIdx++}`);
    params.push(startDate);
  }
  if (endDate) {
    conditions.push(`timestamp <= $${paramIdx++}`);
    params.push(endDate);
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

  params.push(limit, offset);
  const rows = await db.all(
    `SELECT * FROM audit_log ${where} ORDER BY timestamp DESC LIMIT $${paramIdx++} OFFSET $${paramIdx++}`,
    params
  );
  return rows;
}
