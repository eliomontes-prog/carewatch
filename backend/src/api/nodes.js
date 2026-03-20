// backend/src/api/nodes.js — Dynamic sensor node management API
import { Router } from 'express';
import { randomUUID } from 'crypto';
import { z } from 'zod';
import { nodes } from '../db/queries.js';
import { validate } from './validate.js';

const router = Router();

const registerNodeSchema = z.object({
  id: z.string().min(1).max(100).optional(),
  label: z.string().min(1).max(100),
  mac_address: z.string().max(50).optional().nullable(),
  ip_address: z.string().max(50).optional().nullable(),
  room: z.string().min(1).max(100).optional().default('default'),
  position_x: z.number().optional().default(0),
  position_y: z.number().optional().default(0),
  position_z: z.number().optional().default(1.5),
  firmware_version: z.string().max(50).optional().nullable(),
  config: z.string().max(10000).optional().default('{}'),
});

const updateNodeSchema = z.object({
  label: z.string().min(1).max(100).optional(),
  room: z.string().min(1).max(100).optional(),
  position_x: z.number().optional(),
  position_y: z.number().optional(),
  position_z: z.number().optional(),
  config: z.string().max(10000).optional(),
});

// GET /api/nodes — list all nodes
router.get('/', async (req, res) => {
  const all = await nodes.getAll();
  res.json(all.map(n => ({
    ...n,
    config: tryParse(n.config),
    position: [n.position_x, n.position_y, n.position_z],
  })));
});

// GET /api/nodes/online — list only online nodes
router.get('/online', async (req, res) => {
  const online = await nodes.getOnline();
  res.json(online.map(n => ({
    ...n,
    config: tryParse(n.config),
    position: [n.position_x, n.position_y, n.position_z],
  })));
});

// GET /api/nodes/:id — single node
router.get('/:id', async (req, res) => {
  const node = await nodes.getById(req.params.id);
  if (!node) return res.status(404).json({ error: 'Node not found' });
  res.json({ ...node, config: tryParse(node.config), position: [node.position_x, node.position_y, node.position_z] });
});

// POST /api/nodes — register a new node (or upsert by id)
// Can be called by admin UI or by the ESP32 itself on boot
router.post('/', validate(registerNodeSchema), async (req, res) => {
  const data = { ...req.body, id: req.body.id || randomUUID(), status: 'online' };
  await nodes.create(data);
  await nodes.heartbeat(data.id, data.ip_address);
  const node = await nodes.getById(data.id);
  res.status(201).json({ ...node, config: tryParse(node.config), position: [node.position_x, node.position_y, node.position_z] });
});

// PUT /api/nodes/:id — update node config (admin)
router.put('/:id', validate(updateNodeSchema), async (req, res) => {
  const existing = await nodes.getById(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Node not found' });
  await nodes.update(req.params.id, req.body);
  const updated = await nodes.getById(req.params.id);
  res.json({ ...updated, config: tryParse(updated.config), position: [updated.position_x, updated.position_y, updated.position_z] });
});

// POST /api/nodes/:id/heartbeat — node reports it's alive
// Lightweight endpoint for ESP32 to call periodically (no auth required for sensors)
router.post('/:id/heartbeat', async (req, res) => {
  const ip = req.body?.ip_address || req.ip;
  await nodes.heartbeat(req.params.id, ip);
  // Return current config so node can pick up remote changes
  const node = await nodes.getById(req.params.id);
  if (!node) return res.status(404).json({ error: 'Node not found — register first' });
  res.json({ ok: true, config: tryParse(node.config) });
});

// DELETE /api/nodes/:id — remove a node (admin)
router.delete('/:id', async (req, res) => {
  if (req.user.role !== 'admin') return res.status(403).json({ error: 'Admin only' });
  await nodes.remove(req.params.id);
  res.json({ ok: true });
});

function tryParse(json) {
  try { return JSON.parse(json); } catch { return {}; }
}

export default router;
