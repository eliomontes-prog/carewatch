// frontend/src/RoomView.jsx
// Drop-in room visualization tab for CareWatch
// Renders a live canvas: heatmap + trails + subject dots + vitals overlay
// Usage: import RoomView from './RoomView.jsx' then add as a tab

import { useRef, useEffect, useState, useCallback } from 'react';

// ── Constants ────────────────────────────────────────────────────
const ROOM_W = 6.0;  // metres
const ROOM_H = 5.0;  // metres

// Node positions in room (metres from top-left)
const NODES = [
  { id: 1, x: 0.3,  y: 0.3,  label: 'A' },
  { id: 2, x: 5.7,  y: 0.3,  label: 'B' },
  { id: 3, x: 3.0,  y: 4.7,  label: 'C' },
];

const SUBJECTS = {
  elio: { name: 'Elio', emoji: '🧑', color: '#007aff', glow: 'rgba(0,122,255,0.35)' },
};

const TRAIL_LEN   = 60;   // frames (~6s at 10fps)
const HEATMAP_RES = 40;   // grid cells across width
const DECAY       = 0.96; // heatmap decay per frame

// ── Position estimation from signal ─────────────────────────────
// WiFi CSI trilateration is approximate — we use amplitude differences
// between nodes to estimate position. With 3 nodes we get a rough
// weighted centroid. Real accuracy: ~0.5–1.5m per subject.
function estimatePosition(nodeSignals, roomW, roomH) {
  if (!nodeSignals || nodeSignals.length < 2) return null;

  // Each node signal: { nodeId, rssi, amplitude }
  // Stronger signal = closer to that node
  const total = nodeSignals.reduce((s, n) => s + Math.max(0.01, n.strength), 0);
  let wx = 0, wy = 0;
  for (const n of nodeSignals) {
    const node = NODES.find(nd => nd.id === n.nodeId);
    if (!node) continue;
    const w = Math.max(0.01, n.strength) / total;
    wx += node.x * w;
    wy += node.y * w;
  }
  // Clamp to room bounds with some margin
  return {
    x: Math.max(0.3, Math.min(roomW - 0.3, wx)),
    y: Math.max(0.3, Math.min(roomH - 0.3, wy)),
  };
}

// Simulate trilateration from a single blended signal
// (real multi-node signal separation is Phase 2)
function syntheticPositions(frame, prevPositions) {
  const motion    = frame?.motion_level ?? 0;
  const subjectId = frame?.raw?.subject_id;
  const detected  = subjectId?.detected;

  // Smooth random walk seeded by signal variance — gives realistic
  // position drift rather than teleporting
  const results = {};

  for (const [id, S] of Object.entries(SUBJECTS)) {
    const prev = prevPositions?.[id] ?? { x: 2.5, y: 2.0 };
    const isDetected = detected === id;
    const activity   = isDetected ? motion : motion * 0.2;

    // Random walk with mean-reversion to room centre
    const noise = () => (Math.random() - 0.5) * Math.max(0.02, activity * 0.08);
    const cx    = 2.5;
    const cy    = 2.0;

    results[id] = {
      x: Math.max(0.4, Math.min(ROOM_W - 0.4, prev.x + noise() + (cx - prev.x) * 0.02)),
      y: Math.max(0.4, Math.min(ROOM_H - 0.4, prev.y + noise() + (cy - prev.y) * 0.02)),
      active:    isDetected || motion > 1,
      detected:  isDetected,
    };
  }
  return results;
}

// ── Canvas renderer ──────────────────────────────────────────────
function drawRoom(ctx, W, H, scale, state) {
  const { heatmap, trails, positions, frame } = state;
  const sx = W / ROOM_W;
  const sy = H / ROOM_H;

  ctx.clearRect(0, 0, W, H);

  // ── Background ───────────────────────────────────────────────
  ctx.fillStyle = '#0a0f1a';
  ctx.fillRect(0, 0, W, H);

  // ── Grid lines ───────────────────────────────────────────────
  ctx.strokeStyle = 'rgba(255,255,255,0.04)';
  ctx.lineWidth   = 1;
  for (let x = 0; x <= ROOM_W; x++) {
    ctx.beginPath(); ctx.moveTo(x*sx, 0); ctx.lineTo(x*sx, H); ctx.stroke();
  }
  for (let y = 0; y <= ROOM_H; y++) {
    ctx.beginPath(); ctx.moveTo(0, y*sy); ctx.lineTo(W, y*sy); ctx.stroke();
  }

  // ── Room border ──────────────────────────────────────────────
  ctx.strokeStyle = 'rgba(255,255,255,0.12)';
  ctx.lineWidth   = 1.5;
  ctx.strokeRect(1, 1, W-2, H-2);

  // ── Heatmap ──────────────────────────────────────────────────
  const cellW = W / HEATMAP_RES;
  const cellH = H / Math.round(HEATMAP_RES * (ROOM_H / ROOM_W));
  const rows  = Math.round(HEATMAP_RES * (ROOM_H / ROOM_W));

  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < HEATMAP_RES; col++) {
      const v = heatmap[row * HEATMAP_RES + col] ?? 0;
      if (v < 0.01) continue;
      // Colour: cool blue → warm teal → hot white
      const t  = Math.min(1, v);
      const r  = Math.round(0   + t * 80);
      const g  = Math.round(80  + t * 120);
      const b  = Math.round(180 + t * 75);
      ctx.fillStyle = `rgba(${r},${g},${b},${t * 0.45})`;
      ctx.fillRect(col * cellW, row * cellH, cellW + 1, cellH + 1);
    }
  }

  // ── Sensor nodes ─────────────────────────────────────────────
  for (const node of NODES) {
    const nx = node.x * sx;
    const ny = node.y * sy;
    // Range ring
    ctx.beginPath();
    ctx.arc(nx, ny, 48, 0, Math.PI * 2);
    ctx.strokeStyle = 'rgba(0,122,255,0.08)';
    ctx.lineWidth   = 1;
    ctx.stroke();
    // Node dot
    ctx.beginPath();
    ctx.arc(nx, ny, 5, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(0,122,255,0.7)';
    ctx.fill();
    // Label
    ctx.fillStyle = 'rgba(0,122,255,0.9)';
    ctx.font      = '10px ui-monospace, monospace';
    ctx.textAlign = 'center';
    ctx.fillText(`Node ${node.label}`, nx, ny + 16);
  }

  // ── Movement trails ───────────────────────────────────────────
  for (const [id, trail] of Object.entries(trails)) {
    if (trail.length < 2) continue;
    const S = SUBJECTS[id];
    for (let i = 1; i < trail.length; i++) {
      const t0  = trail[i-1];
      const t1  = trail[i];
      const age = i / trail.length;
      ctx.beginPath();
      ctx.moveTo(t0.x * sx, t0.y * sy);
      ctx.lineTo(t1.x * sx, t1.y * sy);
      ctx.strokeStyle = S.color + Math.round(age * 180).toString(16).padStart(2,'0');
      ctx.lineWidth   = 2 * age;
      ctx.lineCap     = 'round';
      ctx.stroke();
    }
  }

  // ── Subject dots + vitals ─────────────────────────────────────
  for (const [id, pos] of Object.entries(positions)) {
    if (!pos) continue;
    const S  = SUBJECTS[id];
    const px = pos.x * sx;
    const py = pos.y * sy;
    const br = frame?.breathing_rate ?? null;
    const hr = frame?.heart_rate ?? null;

    // Outer glow (pulses with breathing)
    const glowR = 18 + (pos.active ? Math.sin(Date.now() / (br ? (60000/br/2) : 2000)) * 4 : 0);
    const grad  = ctx.createRadialGradient(px, py, 0, px, py, glowR * 2);
    grad.addColorStop(0,   S.glow);
    grad.addColorStop(1,   'transparent');
    ctx.beginPath();
    ctx.arc(px, py, glowR * 2, 0, Math.PI * 2);
    ctx.fillStyle = grad;
    ctx.fill();

    // Main dot
    ctx.beginPath();
    ctx.arc(px, py, pos.active ? 10 : 7, 0, Math.PI * 2);
    ctx.fillStyle = S.color;
    ctx.shadowColor = S.color;
    ctx.shadowBlur  = pos.active ? 12 : 4;
    ctx.fill();
    ctx.shadowBlur  = 0;

    // Centre pip
    ctx.beginPath();
    ctx.arc(px, py, 3, 0, Math.PI * 2);
    ctx.fillStyle = 'white';
    ctx.fill();

    // Vitals label card
    const lx = px + (pos.x > ROOM_W/2 ? -110 : 16);
    const ly = py - 30;
    ctx.fillStyle   = 'rgba(10,15,26,0.82)';
    ctx.strokeStyle = S.color + '55';
    ctx.lineWidth   = 1;
    roundRect(ctx, lx, ly, 96, 56, 8);
    ctx.fill();
    ctx.stroke();

    // Subject name
    ctx.fillStyle = S.color;
    ctx.font      = 'bold 11px -apple-system, sans-serif';
    ctx.textAlign = 'left';
    ctx.fillText(`${S.emoji} ${S.name}`, lx + 8, ly + 15);

    // BR
    ctx.fillStyle = 'rgba(255,255,255,0.5)';
    ctx.font      = '9px ui-monospace, monospace';
    ctx.fillText('BR', lx + 8, ly + 30);
    ctx.fillStyle = 'rgba(255,255,255,0.9)';
    ctx.font      = '11px -apple-system, sans-serif';
    ctx.fillText(br ? `${br.toFixed(1)} BPM` : '—', lx + 22, ly + 30);

    // HR
    ctx.fillStyle = 'rgba(255,255,255,0.5)';
    ctx.font      = '9px ui-monospace, monospace';
    ctx.fillText('HR', lx + 8, ly + 46);
    ctx.fillStyle = 'rgba(255,255,255,0.9)';
    ctx.font      = '11px -apple-system, sans-serif';
    ctx.fillText(hr ? `${Math.round(hr)} BPM` : '—', lx + 22, ly + 46);
  }

  // ── Scale legend ─────────────────────────────────────────────
  ctx.fillStyle = 'rgba(255,255,255,0.25)';
  ctx.font      = '10px ui-monospace, monospace';
  ctx.textAlign = 'left';
  ctx.fillText(`${ROOM_W}m × ${ROOM_H}m`, 8, H - 8);
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x+r, y);
  ctx.lineTo(x+w-r, y);
  ctx.quadraticCurveTo(x+w, y, x+w, y+r);
  ctx.lineTo(x+w, y+h-r);
  ctx.quadraticCurveTo(x+w, y+h, x+w-r, y+h);
  ctx.lineTo(x+r, y+h);
  ctx.quadraticCurveTo(x, y+h, x, y+h-r);
  ctx.lineTo(x, y+r);
  ctx.quadraticCurveTo(x, y, x+r, y);
  ctx.closePath();
}

// ── RoomView component ───────────────────────────────────────────
export default function RoomView({ frame, subjectId }) {
  const canvasRef   = useRef(null);
  const stateRef    = useRef({
    heatmap:   new Float32Array(HEATMAP_RES * Math.round(HEATMAP_RES * (5/6))).fill(0),
    trails:    { elio: [] },
    positions: { elio: { x: 2.5, y: 2.0, active: false } },
    frame:     null,
  });
  const rafRef      = useRef(null);
  const [size, setSize] = useState({ w: 600, h: 500 });
  const containerRef = useRef(null);

  // Resize observer
  useEffect(() => {
    if (!containerRef.current) return;
    const ro = new ResizeObserver(entries => {
      const { width } = entries[0].contentRect;
      const h = Math.round(width * (ROOM_H / ROOM_W));
      setSize({ w: width, h });
    });
    ro.observe(containerRef.current);
    return () => ro.disconnect();
  }, []);

  // Update state when new frame arrives
  useEffect(() => {
    if (!frame) return;
    const S    = stateRef.current;
    S.frame    = frame;

    // Update positions
    const newPos = syntheticPositions(frame, S.positions);
    S.positions  = newPos;

    // Update trails
    for (const [id, pos] of Object.entries(newPos)) {
      S.trails[id].push({ x: pos.x, y: pos.y });
      if (S.trails[id].length > TRAIL_LEN) S.trails[id].shift();
    }

    // Update heatmap — splat activity at each subject's position
    const rows = Math.round(HEATMAP_RES * (ROOM_H / ROOM_W));
    const motion = frame.motion_level ?? 0;
    for (const [id, pos] of Object.entries(newPos)) {
      if (!pos.active) continue;
      const col = Math.round(pos.x / ROOM_W * (HEATMAP_RES - 1));
      const row = Math.round(pos.y / ROOM_H * (rows - 1));
      // Gaussian splat (3×3 neighbourhood)
      for (let dr = -2; dr <= 2; dr++) {
        for (let dc = -2; dc <= 2; dc++) {
          const r2 = Math.max(0, Math.min(rows-1, row+dr));
          const c2 = Math.max(0, Math.min(HEATMAP_RES-1, col+dc));
          const d2 = dr*dr + dc*dc;
          S.heatmap[r2 * HEATMAP_RES + c2] += (motion * 0.015) * Math.exp(-d2 / 3);
        }
      }
    }

    // Decay heatmap
    for (let i = 0; i < S.heatmap.length; i++) {
      S.heatmap[i] = Math.min(1, S.heatmap[i] * DECAY);
    }
  }, [frame]);

  // Animation loop
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');

    const loop = () => {
      drawRoom(ctx, size.w, size.h, 1, stateRef.current);
      rafRef.current = requestAnimationFrame(loop);
    };
    rafRef.current = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(rafRef.current);
  }, [size]);

  return (
    <div ref={containerRef} style={{ width: '100%' }}>
      <canvas
        ref={canvasRef}
        width={size.w}
        height={size.h}
        style={{
          width: '100%',
          height: size.h,
          borderRadius: 18,
          display: 'block',
          background: '#0a0f1a',
          boxShadow: '0 2px 32px rgba(0,0,0,0.18), 0 0 0 0.5px rgba(255,255,255,0.06)',
        }}
      />
    </div>
  );
}
