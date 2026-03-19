// backend/src/db/schema.js — PostgreSQL schema initializer
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { db } from './pool.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

// Keep getDb() export so legacy imports (wearables.js) continue to work unchanged
export function getDb() {
  return db;
}

export async function initSchema() {
  const sql = readFileSync(resolve(__dirname, 'migrations/001_initial.sql'), 'utf8');
  await db.run(sql);
  console.log('✅ Database schema initialized (PostgreSQL)');
}
