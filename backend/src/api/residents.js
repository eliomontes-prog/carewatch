// backend/src/api/residents.js
import { Router } from 'express';
import { randomUUID } from 'crypto';
import { z } from 'zod';
import { residents, baselines, activityLog } from '../db/queries.js';
import { validate } from './validate.js';

const router = Router();

const createResidentSchema = z.object({
  name: z.string().min(1).max(200),
  room: z.string().min(1).max(100),
  date_of_birth: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().nullable(),
  emergency_contacts: z.array(z.object({
    name: z.string().min(1),
    relationship: z.string().optional(),
    phone: z.string().optional(),
  })).optional().default([]),
  notes: z.string().max(5000).optional().nullable(),
});

const updateResidentSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  room: z.string().min(1).max(100).optional(),
  notes: z.string().max(5000).optional().nullable(),
});

// GET /api/residents
router.get('/', async (req, res) => {
  const all = await residents.getAll();
  res.json(all.map(r => ({
    ...r,
    emergency_contacts: JSON.parse(r.emergency_contacts || '[]'),
  })));
});

// GET /api/residents/:id
router.get('/:id', async (req, res) => {
  const resident = await residents.getById(req.params.id);
  if (!resident) return res.status(404).json({ error: 'Resident not found' });
  res.json({
    ...resident,
    emergency_contacts: JSON.parse(resident.emergency_contacts || '[]'),
    baseline: await baselines.get(resident.id),
    recent_summaries: await activityLog.getForResident(resident.id, 7),
  });
});

// POST /api/residents
router.post('/', validate(createResidentSchema), async (req, res) => {
  const { name, room, date_of_birth, emergency_contacts, notes } = req.body;

  const resident = {
    id: randomUUID(),
    name,
    room,
    date_of_birth: date_of_birth || null,
    emergency_contacts: JSON.stringify(emergency_contacts || []),
    notes: notes || null,
  };

  await residents.create(resident);
  res.status(201).json({ ...resident, emergency_contacts: emergency_contacts || [] });
});

// PUT /api/residents/:id
router.put('/:id', validate(updateResidentSchema), async (req, res) => {
  const { name, room, notes } = req.body;
  await residents.update(req.params.id, { name, room, notes });
  res.json({ success: true });
});

export default router;
