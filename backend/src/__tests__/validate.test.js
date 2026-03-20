// Tests for Zod validation middleware and API validation schemas
import { jest } from '@jest/globals';
import { z } from 'zod';

const { validate } = await import('../api/validate.js');

describe('Validation Middleware', () => {
  function createMockReqRes(body) {
    const req = { body };
    const res = {
      statusCode: 200,
      status(code) { this.statusCode = code; return this; },
      json: jest.fn().mockReturnThis(),
    };
    const next = jest.fn();
    return { req, res, next };
  }

  it('should pass valid body through to next()', () => {
    const schema = z.object({ name: z.string().min(1), age: z.number() });
    const middleware = validate(schema);
    const { req, res, next } = createMockReqRes({ name: 'Elio', age: 84 });

    middleware(req, res, next);

    expect(next).toHaveBeenCalled();
    expect(req.body).toEqual({ name: 'Elio', age: 84 });
  });

  it('should return 400 with validation errors for invalid body', () => {
    const schema = z.object({ name: z.string().min(1), age: z.number() });
    const middleware = validate(schema);
    const { req, res, next } = createMockReqRes({ name: '', age: 'not-a-number' });

    middleware(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(400);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
      error: 'Validation failed',
      details: expect.any(Array),
    }));
  });

  it('should apply defaults from schema', () => {
    const schema = z.object({
      name: z.string(),
      role: z.string().optional().default('caregiver'),
    });
    const middleware = validate(schema);
    const { req, res, next } = createMockReqRes({ name: 'Maria' });

    middleware(req, res, next);

    expect(next).toHaveBeenCalled();
    expect(req.body.role).toBe('caregiver');
  });

  it('should reject extra fields when schema is strict', () => {
    const schema = z.object({ name: z.string() }).strict();
    const middleware = validate(schema);
    const { req, res, next } = createMockReqRes({ name: 'Elio', extra: 'bad' });

    middleware(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(400);
  });
});

describe('Resident Schemas', () => {
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

  it('should validate a valid resident', () => {
    const result = createResidentSchema.safeParse({
      name: 'Elio Montes',
      room: 'bedroom-1',
      date_of_birth: '1940-05-15',
      emergency_contacts: [{ name: 'Maria', phone: '+1234567890' }],
    });
    expect(result.success).toBe(true);
  });

  it('should reject empty name', () => {
    const result = createResidentSchema.safeParse({
      name: '',
      room: 'bedroom-1',
    });
    expect(result.success).toBe(false);
  });

  it('should reject invalid date format', () => {
    const result = createResidentSchema.safeParse({
      name: 'Elio',
      room: 'bedroom-1',
      date_of_birth: '05/15/1940',
    });
    expect(result.success).toBe(false);
  });

  it('should default emergency_contacts to empty array', () => {
    const result = createResidentSchema.safeParse({
      name: 'Elio',
      room: 'bedroom-1',
    });
    expect(result.success).toBe(true);
    expect(result.data.emergency_contacts).toEqual([]);
  });
});
