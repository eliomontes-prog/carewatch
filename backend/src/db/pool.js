// backend/src/db/pool.js — PostgreSQL connection pool
import pg from 'pg';
import dotenv from 'dotenv';
dotenv.config();

const { Pool } = pg;

const pool = new Pool({
  connectionString: process.env.DATABASE_URL || 'postgresql://carewatch:carewatch@localhost:5432/carewatch',
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
  max: 10,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 5_000,
});

pool.on('error', (err) => {
  console.error('Unexpected PostgreSQL pool error:', err.message);
});

// Thin helpers that mirror the old sqlite interface used across the codebase
export const db = {
  /** Run a query and return the first row (or null) */
  get: async (text, params) => {
    const result = await pool.query(text, params);
    return result.rows[0] ?? null;
  },

  /** Run a query and return all rows */
  all: async (text, params) => {
    const result = await pool.query(text, params);
    return result.rows;
  },

  /** Run a query and return the pg Result object */
  run: async (text, params) => {
    return pool.query(text, params);
  },

  /** Expose the pool for transactions */
  pool,
};

export default pool;
