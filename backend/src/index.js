// backend/src/index.js
import dotenv from 'dotenv';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: resolve(__dirname, '../../.env') });

import express from 'express';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import rateLimit from 'express-rate-limit';
import { createServer } from 'http';
import { WebSocketServer } from 'ws';
import cron from 'node-cron';

import { initSchema } from './db/schema.js';
import { RuViewClient } from './services/ruviewClient.js';
import { processFrame } from './agents/alertAgent.js';
import { generateDailySummaries } from './agents/summaryAgent.js';
import { runEscalationCheck } from './agents/escalationAgent.js';
import residentsRouter  from './api/residents.js';
import alertsRouter     from './api/alerts.js';
import wearablesRouter  from './api/wearables.js';
import authRouter       from './api/auth.js';
import pushRouter       from './api/push.js';
import analyticsRouter  from './api/analytics.js';
import auditRouter     from './api/audit.js';
import { attachPoseStream, streamStats, feedESP32Frame } from './services/poseStream.js';
import { requireAuth } from './middleware/requireAuth.js';
import { auditMiddleware } from './middleware/auditMiddleware.js';
import { z } from 'zod';
import { validate } from './api/validate.js';
import './services/esp32-bridge.js';

const enrollSchema = z.object({
  subject:  z.enum(['elio']),
  duration: z.number().int().min(10).max(300).optional().default(60),
});

const PORT = process.env.PORT || 4000;

// ── Express App ───────────────────────────────────────────────────
const app = express();

const ALLOWED_ORIGINS = (process.env.CORS_ORIGIN || 'http://localhost:5173,http://localhost:4000')
  .split(',').map(s => s.trim());

app.use(cors({
  origin(origin, cb) {
    if (!origin || ALLOWED_ORIGINS.includes(origin)) return cb(null, true);
    cb(new Error('Not allowed by CORS'));
  },
  credentials: true,
}));

app.use(cookieParser());

// ── Rate limiting ─────────────────────────────────────────────────
const apiLimiter   = rateLimit({ windowMs: 60_000,  max: 200, standardHeaders: true, legacyHeaders: false, message: { error: 'Too many requests' } });
const frameLimiter = rateLimit({ windowMs:  1_000,  max: 30,  standardHeaders: true, legacyHeaders: false });
const enrollLimiter= rateLimit({ windowMs: 60_000,  max: 5,   message: { error: 'Enrollment rate limited' } });
const authLimiter  = rateLimit({ windowMs: 15 * 60_000, max: 20, message: { error: 'Too many login attempts' } });

app.use('/api', (req, res, next) => {
  if (req.path.startsWith('/esp32')) return next();
  return apiLimiter(req, res, next);
});

// ── Request logging ───────────────────────────────────────────────
app.use((req, res, next) => {
  const start = Date.now();
  res.on('finish', () => {
    const ms = Date.now() - start;
    if (req.path !== '/health' && !req.path.startsWith('/api/esp32')) {
      console.log(`${req.method} ${req.path} ${res.statusCode} ${ms}ms`);
    }
  });
  next();
});

app.use(express.json());

// ── Audit logging ────────────────────────────────────────────────
app.use(auditMiddleware);

// ── Health ────────────────────────────────────────────────────────
app.get('/health', (req, res) => res.json({
  status:    'ok',
  timestamp: new Date().toISOString(),
  ruview:    ruviewClient?.connected ?? false,
}));

// ── Auth (no requireAuth guard on these) ─────────────────────────
app.use('/api/auth', authLimiter, authRouter);

// ── Push (subscribe requires auth, VAPID key is public) ──────────
app.use('/api/push', pushRouter);

// ── Protected routes ──────────────────────────────────────────────
app.use('/api/residents',  requireAuth, residentsRouter);
app.use('/api/alerts',     requireAuth, alertsRouter);
app.use('/api/wearables',  requireAuth, wearablesRouter);
app.use('/api/analytics',  analyticsRouter);  // router handles auth internally
app.use('/api/audit',      requireAuth, auditRouter);

// Live room status
app.get('/api/rooms', requireAuth, (req, res) => {
  res.json(Object.fromEntries([...roomStatus.entries()]));
});

// Stream stats
app.get('/api/stream/stats', requireAuth, (req, res) => res.json(streamStats));

// ── HTTP + WebSocket Server ───────────────────────────────────────
const server = createServer(app);
const wss    = new WebSocketServer({ noServer: true });

const dashboardClients = new Set();

wss.on('connection', (ws) => {
  console.log('📊 Dashboard client connected');
  dashboardClients.add(ws);

  ws.on('message', (data) => {
    try {
      const msg = JSON.parse(data);
      if (msg.type === 'ping') ws.send(JSON.stringify({ type: 'pong' }));
    } catch { /* ignore malformed messages */ }
  });

  ws.on('close', () => {
    dashboardClients.delete(ws);
    console.log('📊 Dashboard client disconnected');
  });
  ws.on('error', (err) => {
    console.warn('⚠️ Dashboard WS error:', err.message);
    dashboardClients.delete(ws);
  });
});

const poseWss = attachPoseStream();

server.on('upgrade', (request, socket, head) => {
  const { pathname } = new URL(request.url, 'http://localhost');
  if (pathname === '/ws') {
    wss.handleUpgrade(request, socket, head, (ws) => wss.emit('connection', ws, request));
  } else if (pathname === '/ws/pose') {
    poseWss.handleUpgrade(request, socket, head, (ws) => poseWss.emit('connection', ws, request));
  } else {
    socket.destroy();
  }
});

function broadcast(data) {
  const msg = JSON.stringify(data);
  for (const client of dashboardClients) {
    if (client.readyState === 1) {
      try { client.send(msg); } catch { dashboardClients.delete(client); }
    }
  }
}

// ── Room Status Cache ─────────────────────────────────────────────
const roomStatus = new Map();

// ── Node definitions ──────────────────────────────────────────────
const NODES = [
  { node_id: 1, position: [2.0, 0.0, 1.5] },
  { node_id: 2, position: [0.0, 3.0, 1.5] },
  { node_id: 3, position: [4.0, 3.0, 1.5] },
];

function extractFeaturesFromFrame(frame) {
  const raw = frame.raw;
  if (!raw?.features) return null;
  const f = raw.features;
  const v = raw.vital_signs || {};
  const amp = raw.nodes?.[0]?.amplitude || [];
  const spread = amp.length > 0 ? Math.max(...amp) - Math.min(...amp) : 0;
  return [
    f.motion_band_power ?? 0,
    f.variance ?? 0,
    v.breathing_rate_bpm ?? 14,
    f.mean_rssi ?? 0,
    spread,
    f.gait_freq_hz ?? 0,
    f.subcarrier_activity ?? 0,
  ];
}

// ── Shared frame handler ──────────────────────────────────────────
async function handleFrame(frame) {
  roomStatus.set(frame.room, { ...frame, last_updated: new Date().toISOString() });
  broadcast({ type: 'frame', data: frame });

  if (frame.raw) feedESP32Frame(frame.raw);

  if (bridgeModule) {
    const features = extractFeaturesFromFrame(frame);
    if (features) bridgeModule.addEnrollmentSample(features);
  }

  processFrame(frame).catch(err => console.error('❌ Alert agent error:', err.message));
}

// ── ESP32 Direct Bridge ───────────────────────────────────────────
app.post('/api/esp32/frame', frameLimiter, express.json(), (req, res) => {
  const raw = req.body;
  if (raw && raw.room) {
    const frame = {
      timestamp:      raw.timestamp || new Date().toISOString(),
      room:           raw.room,
      presence:       raw.classification?.presence ?? true,
      person_count:   1,
      breathing_rate: raw.vital_signs?.breathing_rate_bpm ?? null,
      heart_rate:     raw.vital_signs?.heart_rate_bpm ?? null,
      motion_level:   raw.features?.motion_band_power ?? null,
      posture:        null,
      confidence:     raw.vital_signs?.breathing_confidence ?? null,
      persons:        [],
      raw,
    };
    handleFrame(frame);
    res.json({ ok: true });
  } else {
    res.status(400).json({ error: 'invalid frame' });
  }
});

// ── Subject Enrollment API ────────────────────────────────────────
let bridgeModule = null;
async function getBridge() {
  if (!bridgeModule) {
    try { bridgeModule = await import('./services/esp32-bridge.js'); } catch { return null; }
  }
  return bridgeModule;
}

app.post('/api/enroll', requireAuth, enrollLimiter, validate(enrollSchema), async (req, res) => {
  const { subject, duration } = req.body;
  const bridge = await getBridge();
  if (!bridge) return res.status(503).json({ error: 'Bridge not running' });
  bridge.startEnrollment(subject, duration * 1000);
  broadcast({ type: 'enrollment_started', subject, duration });
  res.json({ ok: true, subject, duration, message: `Walk around for ${duration}s` });
});

app.post('/api/enroll/finish', requireAuth, async (req, res) => {
  const bridge = await getBridge();
  if (!bridge) return res.status(503).json({ error: 'Bridge not running' });
  const result = bridge.finishEnrollment();
  broadcast({ type: 'enrollment_finished', result });
  res.json(result ?? { ok: false });
});

app.delete('/api/enroll', requireAuth, async (req, res) => {
  const bridge = await getBridge();
  if (!bridge) return res.status(503).json({ error: 'Bridge not running' });
  res.json(bridge.clearModel());
});

app.get('/api/enroll/status', requireAuth, async (req, res) => {
  const bridge = await getBridge();
  if (!bridge) return res.json({ mlTrained: false, samples: 0, enrolling: null });
  const m = bridge.mlModel;
  res.json({
    mlTrained: m.trained,
    samples:   m.samples.length,
    bySubject: {
      elio: m.samples.filter(s => s.label === 'elio').length,
      haru: m.samples.filter(s => s.label === 'haru').length,
    },
    enrolling: null,
  });
});

// ── RuView Client ─────────────────────────────────────────────────
const ruviewClient = new RuViewClient(
  process.env.RUVIEW_WS_URL,
  process.env.RUVIEW_REST_URL
);
ruviewClient.on('frame',        handleFrame);
ruviewClient.on('connected',    () => broadcast({ type: 'ruview_status', connected: true }));
ruviewClient.on('disconnected', () => broadcast({ type: 'ruview_status', connected: false }));
ruviewClient.connect();

// ── Scheduled Jobs ────────────────────────────────────────────────
// Daily summaries + emails at 8pm
cron.schedule('0 20 * * *', () => {
  console.log('📊 Running daily summary generation...');
  generateDailySummaries().catch(err => console.error('❌ Daily summary error:', err.message));
});

// Escalation check every 5 minutes
cron.schedule('*/5 * * * *', () => {
  runEscalationCheck().catch(err => console.error('❌ Escalation error:', err.message));
});

// ── Start Server ──────────────────────────────────────────────────
async function start() {
  await initSchema();

  server.listen(PORT, '0.0.0.0', () => {
    console.log(`
╔════════════════════════════════════════╗
║   🏥 CareWatch Backend                 ║
╠════════════════════════════════════════╣
║  REST API:  http://localhost:${PORT}     ║
║  WebSocket: ws://localhost:${PORT}/ws    ║
║  Auth:      JWT + httpOnly cookies      ║
║  RuView:    ${(process.env.RUVIEW_WS_URL || 'ws://localhost:3001/ws/sensing').padEnd(22)} ║
╚════════════════════════════════════════╝
    `);
  });
}

start().catch(err => {
  console.error('❌ Failed to start server:', err);
  process.exit(1);
});

// ── Graceful shutdown ─────────────────────────────────────────────
function shutdown(signal) {
  console.log(`\n${signal} received — shutting down gracefully...`);
  ruviewClient.disconnect();
  for (const client of dashboardClients) {
    try { client.close(1001, 'Server shutting down'); } catch {}
  }
  dashboardClients.clear();
  server.close(() => { console.log('Server closed.'); process.exit(0); });
  setTimeout(() => { console.warn('Forcing exit'); process.exit(1); }, 5_000);
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT',  () => shutdown('SIGINT'));
