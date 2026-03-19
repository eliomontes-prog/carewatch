-- 001_initial.sql — full schema for PostgreSQL

CREATE TABLE IF NOT EXISTS residents (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  room TEXT NOT NULL,
  date_of_birth TEXT,
  emergency_contacts TEXT NOT NULL DEFAULT '[]',
  notes TEXT,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS baselines (
  resident_id TEXT NOT NULL,
  metric TEXT NOT NULL,
  value REAL NOT NULL,
  sample_count INTEGER NOT NULL DEFAULT 1,
  last_updated TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (resident_id, metric),
  FOREIGN KEY (resident_id) REFERENCES residents(id)
);

CREATE TABLE IF NOT EXISTS sensor_readings (
  id BIGSERIAL PRIMARY KEY,
  resident_id TEXT,
  room TEXT NOT NULL,
  presence INTEGER,
  person_count INTEGER,
  breathing_rate REAL,
  heart_rate REAL,
  motion_level REAL,
  posture TEXT,
  confidence REAL,
  raw_json TEXT,
  recorded_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS alerts (
  id BIGSERIAL PRIMARY KEY,
  resident_id TEXT,
  room TEXT NOT NULL,
  alert_type TEXT NOT NULL,
  urgency TEXT NOT NULL,
  message TEXT NOT NULL,
  ai_reasoning TEXT,
  sent INTEGER NOT NULL DEFAULT 0,
  acknowledged INTEGER NOT NULL DEFAULT 0,
  acknowledged_by TEXT,
  suppressed INTEGER NOT NULL DEFAULT 0,
  suppressed_reason TEXT,
  escalated INTEGER NOT NULL DEFAULT 0,
  escalated_at TIMESTAMPTZ,
  escalation_tier INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS activity_log (
  id BIGSERIAL PRIMARY KEY,
  resident_id TEXT NOT NULL,
  date TEXT NOT NULL,
  summary TEXT NOT NULL,
  metrics TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  FOREIGN KEY (resident_id) REFERENCES residents(id)
);

CREATE TABLE IF NOT EXISTS caregivers (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  phone TEXT,
  email TEXT,
  role TEXT NOT NULL DEFAULT 'family',
  resident_ids TEXT NOT NULL DEFAULT '[]',
  active INTEGER NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS wearable_readings (
  id BIGSERIAL PRIMARY KEY,
  source TEXT NOT NULL,
  metric TEXT NOT NULL,
  value REAL NOT NULL,
  recorded_at TIMESTAMPTZ NOT NULL,
  imported_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  name TEXT NOT NULL,
  role TEXT NOT NULL CHECK(role IN ('admin','caregiver','family')),
  resident_ids TEXT NOT NULL DEFAULT '[]',
  active INTEGER NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS push_subscriptions (
  id BIGSERIAL PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  endpoint TEXT NOT NULL UNIQUE,
  p256dh TEXT NOT NULL,
  auth TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_readings_room ON sensor_readings(room, recorded_at);
CREATE INDEX IF NOT EXISTS idx_readings_resident ON sensor_readings(resident_id, recorded_at);
CREATE INDEX IF NOT EXISTS idx_alerts_resident ON alerts(resident_id, created_at);
CREATE INDEX IF NOT EXISTS idx_alerts_type ON alerts(alert_type, created_at);
CREATE INDEX IF NOT EXISTS idx_alerts_unack ON alerts(sent, acknowledged, escalation_tier, created_at)
  WHERE sent = 1 AND acknowledged = 0;
CREATE INDEX IF NOT EXISTS idx_wearable_source ON wearable_readings(source, metric, recorded_at);
