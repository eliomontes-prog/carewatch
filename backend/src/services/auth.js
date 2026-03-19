// backend/src/services/auth.js — JWT helpers
import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';

const SECRET = () => process.env.JWT_SECRET || 'dev-secret-change-in-production';
const EXPIRES = () => process.env.JWT_EXPIRES_IN || '8h';

export function signToken(payload) {
  return jwt.sign(payload, SECRET(), { expiresIn: EXPIRES() });
}

export function verifyToken(token) {
  return jwt.verify(token, SECRET()); // throws on invalid/expired
}

export const hashPassword  = (plain)       => bcrypt.hash(plain, 12);
export const checkPassword = (plain, hash) => bcrypt.compare(plain, hash);
