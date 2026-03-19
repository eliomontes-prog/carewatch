// backend/src/services/poseStream.js
// Bridges RuView WebSocket → CareWatch frontend clients
// Normalizes RuView's raw CSI frames into clean pose objects for the visualizer

import { WebSocketServer, WebSocket } from 'ws';

const RUVIEW_WS_URL = process.env.RUVIEW_WS_URL || 'ws://localhost:3001/ws/sensing';
const RECONNECT_DELAY_MS = 3000;
const FRAME_THROTTLE_MS = 50; // ~20fps to frontend

let ruviewWs = null;
let wss = null; // frontend WebSocket server (mounted on existing HTTP server)
let lastBroadcast = 0;
let isConnected = false;

// Stats for the /api/rooms status endpoint
export const streamStats = {
  framesReceived: 0,
  framesBroadcast: 0,
  connectedClients: 0,
  ruviewConnected: false,
  lastFrameAt: null,
};

/**
 * Create the pose stream WebSocket server (noServer mode).
 * The frontend connects to ws://localhost:4000/ws/pose
 * Returns the WSS instance for manual upgrade handling.
 */
export function attachPoseStream() {
  wss = new WebSocketServer({ noServer: true });

  wss.on('connection', (ws, req) => {
    streamStats.connectedClients = wss.clients.size;
    console.log(`[PoseStream] Frontend client connected (${wss.clients.size} total)`);

    // Send current connection state immediately
    ws.send(JSON.stringify({
      type: 'CONNECTION_STATE',
      ruviewConnected: streamStats.ruviewConnected,
      timestamp: new Date().toISOString(),
    }));

    ws.on('close', () => {
      streamStats.connectedClients = wss.clients.size;
      console.log(`[PoseStream] Frontend client disconnected (${wss.clients.size} remaining)`);
    });

    ws.on('error', (err) => {
      console.error('[PoseStream] Frontend WS error:', err.message);
    });
  });

  console.log('[PoseStream] Frontend WebSocket server ready at /ws/pose');
  connectToRuView();
  return wss;
}

/**
 * Connect to RuView WebSocket with auto-reconnect.
 */
function connectToRuView() {
  if (ruviewWs) {
    ruviewWs.terminate();
    ruviewWs = null;
  }

  console.log(`[PoseStream] Connecting to RuView at ${RUVIEW_WS_URL}...`);

  try {
    ruviewWs = new WebSocket(RUVIEW_WS_URL);
  } catch (err) {
    console.error('[PoseStream] Failed to create WebSocket:', err.message);
    scheduleReconnect();
    return;
  }

  ruviewWs.on('open', () => {
    isConnected = true;
    streamStats.ruviewConnected = true;
    console.log('[PoseStream] ✅ Connected to RuView');
    broadcastToFrontend({ type: 'CONNECTION_STATE', ruviewConnected: true });
  });

  ruviewWs.on('message', (data) => {
    streamStats.framesReceived++;
    streamStats.lastFrameAt = new Date().toISOString();

    // Throttle to ~20fps for frontend
    const now = Date.now();
    if (now - lastBroadcast < FRAME_THROTTLE_MS) return;
    lastBroadcast = now;

    try {
      const raw = JSON.parse(data.toString());
      const frame = normalizeFrame(raw);
      if (!frame) return;

      // Enrich raw frame with persons array for Observatory visualisation
      const enriched = enrichForObservatory(raw);
      broadcastToFrontend(enriched);
      streamStats.framesBroadcast++;
    } catch (err) {
      console.error('[PoseStream] Frame parse error:', err.message);
    }
  });

  ruviewWs.on('close', () => {
    isConnected = false;
    streamStats.ruviewConnected = false;
    console.log('[PoseStream] RuView disconnected, scheduling reconnect...');
    broadcastToFrontend({ type: 'CONNECTION_STATE', ruviewConnected: false });
    scheduleReconnect();
  });

  ruviewWs.on('error', (err) => {
    console.error('[PoseStream] RuView WS error:', err.message);
    streamStats.ruviewConnected = false;
  });
}

// ── Person position state (smooth drift for simulated presence) ──
let _elioX = 0, _elioZ = 0, _elioFacing = 0;
let _haruX = 1.5, _haruZ = 1.0, _haruFacing = Math.PI, _haruDirTimer = 0;

/**
 * Enrich a raw RuView frame with `persons` and `estimated_persons`
 * so the Observatory can render figures even when RuView only sends
 * classification/vital data without tracking.
 *
 * Detects two entities when variance + motion are high enough
 * (consistent with a person + pet in the same room).
 */
function enrichForObservatory(raw) {
  if (!raw) return raw;

  // Already has persons — pass through
  if (raw.persons?.length || raw.tracking?.persons?.length) return raw;

  const isPresent = raw.classification?.presence ?? false;
  if (!isPresent) {
    return { ...raw, persons: [], estimated_persons: 0 };
  }

  const motion   = raw.features?.motion_band_power ?? 0;
  const variance = raw.features?.variance ?? 0;
  const changes  = raw.features?.change_points ?? 0;
  const gaitPower = raw.features?.gait_power ?? 0;

  // ── Elio (human) ──────────────────────────────────────────────
  // Motion thresholds: ~0-15 sitting, ~15-40 standing, 40+ walking
  // Arm gestures: motion elevated (>25) but gait power low (<0.4)
  const elioMotion = Math.min(100, motion);
  const isWalking = motion > 40 && gaitPower > 0.4;
  const isGesturing = !isWalking && motion > 25 && gaitPower < 0.4;
  const isStanding = motion > 15;
  const elioSpeed  = isWalking ? 0.015 : isStanding ? 0.003 : 0.0005;
  _elioFacing += (Math.random() - 0.5) * (isWalking ? 0.2 : 0.05);
  _elioX += Math.cos(_elioFacing) * elioSpeed;
  _elioZ += Math.sin(_elioFacing) * elioSpeed;
  _elioX = Math.max(-2.5, Math.min(2.5, _elioX));
  _elioZ = Math.max(-2.5, Math.min(2.5, _elioZ));

  // Pose priority: walking > gesturing > standing > sitting
  let elioPose, gestureType, gestureIntensity;
  if (isWalking) {
    elioPose = 'walking';
  } else if (isGesturing) {
    elioPose = 'gesturing';
    // Intensity scales from 0.3 (subtle) to 1.0 (vigorous) based on motion
    gestureIntensity = Math.min(1.0, (motion - 25) / 50 + 0.3);
    // Cycle through gesture types based on motion characteristics
    const gestureTypes = ['wave', 'swipe_left', 'circle', 'point'];
    // Use variance to pick gesture type — higher variance = more dynamic gesture
    const gIdx = Math.floor(variance * 10) % gestureTypes.length;
    gestureType = gestureTypes[gIdx];
  } else if (isStanding) {
    elioPose = 'standing';
  } else {
    elioPose = 'sitting';
  }

  const person = {
    id: 'p0',
    entity_type: 'human',
    position: [_elioX, 0, _elioZ],
    motion_score: elioMotion,
    pose: elioPose,
    facing: _elioFacing,
  };
  if (isGesturing) {
    person.gestureType = gestureType;
    person.gestureIntensity = gestureIntensity;
  }
  const persons = [person];

  // ── Haru (Pomsky) — detected when variance & change_points are
  //    elevated, indicating a second moving body in the field ─────
  const haruDetected = variance > 3 && changes >= 3;

  if (haruDetected) {
    // Dog movement — only dart around when motion is actually high
    const haruActive = motion > 30;
    _haruDirTimer += 0.05;
    if (haruActive && Math.random() < 0.08) _haruFacing += (Math.random() - 0.5) * 2.0;
    const haruSpeed = haruActive ? 0.02 : 0.001;
    _haruX += Math.cos(_haruFacing) * haruSpeed;
    _haruZ += Math.sin(_haruFacing) * haruSpeed;
    // Bounce off bounds
    if (_haruX < -2.5 || _haruX > 2.5) { _haruFacing = Math.PI - _haruFacing; _haruX = Math.max(-2.5, Math.min(2.5, _haruX)); }
    if (_haruZ < -2.5 || _haruZ > 2.5) { _haruFacing = -_haruFacing; _haruZ = Math.max(-2.5, Math.min(2.5, _haruZ)); }

    persons.push({
      id: 'p1',
      entity_type: 'dog',
      position: [_haruX, 0, _haruZ],
      motion_score: Math.min(100, motion),
      pose: haruActive ? 'walking' : 'sitting',
      facing: _haruFacing,
    });
  }

  return {
    ...raw,
    persons,
    estimated_persons: persons.length,
  };
}

/**
 * Normalize a raw RuView frame into the pose format the frontend expects.
 *
 * RuView frame shape (may vary by version):
 * {
 *   room_id, timestamp,
 *   vital_signs: { breathing_rate_bpm, heart_rate_bpm },
 *   classification: { presence, posture, activity_level },
 *   pose: { keypoints: [{x,y,confidence}×17] },  // if available
 *   tracking: { persons: [{ id, cx, cy, keypoints }] }
 * }
 */
function normalizeFrame(raw) {
  if (!raw) return null;

  // Support both single-person and multi-person tracking formats
  const persons = extractPersons(raw);

  return {
    roomId: raw.room_id ?? raw.roomId ?? 'room-1',
    timestamp: raw.timestamp ?? new Date().toISOString(),
    presence: raw.classification?.presence ?? raw.presence ?? persons.length > 0,
    posture: raw.classification?.posture ?? raw.posture ?? 'unknown',
    activityLevel: raw.classification?.activity_level ?? raw.activity_level ?? 0,
    vitals: {
      breathingRate: raw.vital_signs?.breathing_rate_bpm
        ?? raw.vital_signs?.breathing_rate
        ?? raw.breathing_rate
        ?? null,
      heartRate: raw.vital_signs?.heart_rate_bpm
        ?? raw.vital_signs?.heart_rate
        ?? raw.heart_rate
        ?? null,
    },
    persons,
  };
}

/**
 * Extract person objects (with keypoints) from various RuView frame formats.
 */
function extractPersons(raw) {
  // Format A: tracking.persons array (multi-person)
  if (raw.tracking?.persons?.length) {
    return raw.tracking.persons.map(p => ({
      id: p.id ?? 'p0',
      cx: p.cx ?? p.x ?? 0.5,
      cy: p.cy ?? p.y ?? 0.5,
      confidence: p.confidence ?? 0.85,
      keypoints: normalizeKeypoints(p.keypoints),
    }));
  }

  // Format B: top-level pose.keypoints (single person)
  if (raw.pose?.keypoints) {
    const kps = normalizeKeypoints(raw.pose.keypoints);
    const cx = avg(kps.map(k => k?.x).filter(Boolean));
    const cy = avg(kps.map(k => k?.y).filter(Boolean));
    return [{
      id: 'p0',
      cx: cx ?? 0.5,
      cy: cy ?? 0.5,
      confidence: raw.pose.confidence ?? 0.85,
      keypoints: kps,
    }];
  }

  // Format C: presence only, no keypoints (simulated mode)
  if (raw.classification?.presence || raw.presence) {
    return [{
      id: 'p0',
      cx: 0.5,
      cy: 0.5,
      confidence: 0.5,
      keypoints: null, // no skeleton in simulated mode
    }];
  }

  return [];
}

/**
 * Normalize keypoints into [{x, y, confidence}×17] format.
 * Handles both array-of-objects and flat array formats.
 */
function normalizeKeypoints(kps) {
  if (!kps || !Array.isArray(kps)) return null;

  return kps.map(kp => {
    if (Array.isArray(kp)) {
      // [x, y, confidence] format
      return { x: kp[0], y: kp[1], confidence: kp[2] ?? 0.8 };
    }
    if (typeof kp === 'object') {
      return {
        x: kp.x ?? kp.px ?? 0,
        y: kp.y ?? kp.py ?? 0,
        confidence: kp.confidence ?? kp.score ?? 0.8,
      };
    }
    return null;
  }).filter(Boolean);
}

/**
 * Feed an ESP32 frame into the pose stream so the Observatory can
 * visualise presence even when RuView is not connected.
 * Called from handleFrame() in index.js.
 */
export function feedESP32Frame(raw) {
  if (!wss || wss.clients.size === 0) return;

  const now = Date.now();
  if (now - lastBroadcast < FRAME_THROTTLE_MS) return;
  lastBroadcast = now;

  const enriched = enrichForObservatory(raw);
  if (enriched) {
    broadcastToFrontend(enriched);
    streamStats.framesBroadcast++;
    streamStats.lastFrameAt = new Date().toISOString();
  }
}

/**
 * Broadcast a message to all connected frontend clients.
 */
function broadcastToFrontend(msg) {
  if (!wss) return;
  const payload = JSON.stringify(msg);
  wss.clients.forEach(client => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(payload);
    }
  });
}

function scheduleReconnect() {
  setTimeout(connectToRuView, RECONNECT_DELAY_MS);
}

function avg(arr) {
  if (!arr.length) return null;
  return arr.reduce((a, b) => a + b, 0) / arr.length;
}
