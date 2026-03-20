// backend/src/middleware/auditMiddleware.js
// Automatically logs API requests to the audit trail
import { logAudit } from '../services/auditLog.js';

// Map route patterns to semantic action + resource type
const ROUTE_MAP = [
  { method: 'POST',   pattern: /^\/api\/auth\/login$/,            action: 'login',               resourceType: 'auth' },
  { method: 'POST',   pattern: /^\/api\/auth\/register$/,         action: 'register',            resourceType: 'auth' },
  { method: 'POST',   pattern: /^\/api\/auth\/logout$/,           action: 'logout',              resourceType: 'auth' },
  { method: 'GET',    pattern: /^\/api\/auth\/me$/,               action: 'view_session',        resourceType: 'auth' },
  { method: 'GET',    pattern: /^\/api\/auth\/users$/,            action: 'list_users',          resourceType: 'user' },
  { method: 'GET',    pattern: /^\/api\/residents$/,              action: 'list_residents',      resourceType: 'resident' },
  { method: 'GET',    pattern: /^\/api\/residents\/([^/]+)$/,     action: 'view_resident',       resourceType: 'resident' },
  { method: 'POST',   pattern: /^\/api\/residents$/,              action: 'create_resident',     resourceType: 'resident' },
  { method: 'PUT',    pattern: /^\/api\/residents\/([^/]+)$/,     action: 'update_resident',     resourceType: 'resident' },
  { method: 'GET',    pattern: /^\/api\/alerts$/,                 action: 'list_alerts',         resourceType: 'alert' },
  { method: 'GET',    pattern: /^\/api\/alerts\/resident\/([^/]+)$/, action: 'view_resident_alerts', resourceType: 'alert' },
  { method: 'POST',   pattern: /^\/api\/alerts\/([^/]+)\/acknowledge$/, action: 'acknowledge_alert', resourceType: 'alert' },
  { method: 'GET',    pattern: /^\/api\/analytics\/resident\/([^/]+)$/, action: 'view_analytics', resourceType: 'analytics' },
  { method: 'POST',   pattern: /^\/api\/wearables\/import$/,     action: 'import_wearables',    resourceType: 'wearable' },
  { method: 'POST',   pattern: /^\/api\/enroll$/,                 action: 'start_enrollment',    resourceType: 'enrollment' },
  { method: 'POST',   pattern: /^\/api\/enroll\/finish$/,         action: 'finish_enrollment',   resourceType: 'enrollment' },
  { method: 'DELETE',  pattern: /^\/api\/enroll$/,                 action: 'clear_enrollment',    resourceType: 'enrollment' },
];

function matchRoute(method, path) {
  for (const route of ROUTE_MAP) {
    if (route.method === method) {
      const match = path.match(route.pattern);
      if (match) {
        return { action: route.action, resourceType: route.resourceType, resourceId: match[1] || null };
      }
    }
  }
  return null;
}

export function auditMiddleware(req, res, next) {
  const start = Date.now();

  res.on('finish', () => {
    const matched = matchRoute(req.method, req.path);
    if (!matched) return; // Skip unmatched routes (health, esp32 frames, etc.)

    const durationMs = Date.now() - start;

    logAudit({
      action: matched.action,
      resourceType: matched.resourceType,
      resourceId: matched.resourceId || req.params?.id || null,
      detail: buildDetail(matched.action, req, res),
      user: req.user || {},
      req,
      statusCode: res.statusCode,
      durationMs,
    });
  });

  next();
}

function buildDetail(action, req, res) {
  if (res.statusCode >= 400) {
    return `Failed with status ${res.statusCode}`;
  }

  switch (action) {
    case 'login':
      return `Login attempt for ${req.body?.email || 'unknown'}`;
    case 'register':
      return `Registered ${req.body?.email || 'unknown'} as ${req.body?.role || 'caregiver'}`;
    case 'create_resident':
      return `Created resident "${req.body?.name}" in room ${req.body?.room}`;
    case 'update_resident':
      return `Updated resident fields: ${Object.keys(req.body || {}).join(', ')}`;
    case 'acknowledge_alert':
      return `Acknowledged by ${req.body?.by || req.user?.name || 'unknown'}`;
    case 'import_wearables':
      return `Imported wearable data`;
    default:
      return null;
  }
}
