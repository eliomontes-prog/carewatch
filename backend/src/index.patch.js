// ─────────────────────────────────────────────────────────────────────────────
// ADD TO backend/src/index.js
// ─────────────────────────────────────────────────────────────────────────────
//
// 1. Add this import near the top with your other imports:
//
import { attachPoseStream, streamStats } from './services/poseStream.js';
//
//
// 2. Replace (or update) your existing HTTP server creation.
//    If you currently have: app.listen(PORT, ...)
//    Change it to use http.createServer so the WS server can share the port:

import { createServer } from 'http';

const httpServer = createServer(app);

// Attach pose stream WebSocket server (ws://localhost:4000/ws/pose)
attachPoseStream(httpServer);

// Start listening
const PORT = process.env.PORT || 4000;
httpServer.listen(PORT, () => {
  console.log(`[CareWatch] Backend running on http://localhost:${PORT}`);
  console.log(`[CareWatch] Pose stream WebSocket: ws://localhost:${PORT}/ws/pose`);
});

//
// 3. Add a stats endpoint so you can verify the stream is alive:
//
app.get('/api/stream/stats', (req, res) => {
  res.json(streamStats);
});

// ─────────────────────────────────────────────────────────────────────────────
// ALSO add dashboard route if not already present:
//
import dashboardRouter from './api/dashboard.js';
app.use('/api/dashboard', dashboardRouter);
// ─────────────────────────────────────────────────────────────────────────────
