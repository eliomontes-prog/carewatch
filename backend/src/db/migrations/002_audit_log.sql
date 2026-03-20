-- 002_audit_log.sql — HIPAA-ready audit trail

CREATE TABLE IF NOT EXISTS audit_log (
  id BIGSERIAL PRIMARY KEY,
  timestamp TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  user_id TEXT,
  user_email TEXT,
  user_role TEXT,
  action TEXT NOT NULL,
  resource_type TEXT NOT NULL,
  resource_id TEXT,
  detail TEXT,
  ip_address TEXT,
  user_agent TEXT,
  status_code INTEGER,
  duration_ms INTEGER
);

CREATE INDEX IF NOT EXISTS idx_audit_timestamp ON audit_log(timestamp);
CREATE INDEX IF NOT EXISTS idx_audit_user ON audit_log(user_id, timestamp);
CREATE INDEX IF NOT EXISTS idx_audit_resource ON audit_log(resource_type, resource_id, timestamp);
CREATE INDEX IF NOT EXISTS idx_audit_action ON audit_log(action, timestamp);
