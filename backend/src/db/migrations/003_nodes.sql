-- 003_nodes.sql — Dynamic sensor node management

CREATE TABLE IF NOT EXISTS nodes (
  id TEXT PRIMARY KEY,
  label TEXT NOT NULL,
  mac_address TEXT UNIQUE,
  ip_address TEXT,
  room TEXT NOT NULL DEFAULT 'default',
  position_x REAL NOT NULL DEFAULT 0,
  position_y REAL NOT NULL DEFAULT 0,
  position_z REAL NOT NULL DEFAULT 1.5,
  firmware_version TEXT,
  status TEXT NOT NULL DEFAULT 'offline' CHECK(status IN ('online','offline','provisioning')),
  last_heartbeat TIMESTAMPTZ,
  last_frame_at TIMESTAMPTZ,
  frames_total BIGINT NOT NULL DEFAULT 0,
  config TEXT NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_nodes_room ON nodes(room);
CREATE INDEX IF NOT EXISTS idx_nodes_status ON nodes(status);
CREATE INDEX IF NOT EXISTS idx_nodes_mac ON nodes(mac_address);
