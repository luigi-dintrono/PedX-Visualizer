import { Pool } from 'pg';

// Parse an optional non-negative integer env var, falling back to a default.
function intFromEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const parsed = parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

// Database configuration
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
  // Ensure UTF-8 encoding for proper character handling
  client_encoding: 'UTF8',
  // Pool sizing (documented in env.example) with sensible serverless defaults.
  max: intFromEnv('DB_POOL_MAX', 10),
  min: intFromEnv('DB_POOL_MIN', 0),
  // Fail fast if the DB is unreachable rather than hanging, and reap idle
  // connections so a constrained / serverless Postgres isn't exhausted.
  connectionTimeoutMillis: intFromEnv('DB_CONNECTION_TIMEOUT_MS', 10000),
  idleTimeoutMillis: intFromEnv('DB_IDLE_TIMEOUT_MS', 30000),
});

// Prevent an error on an idle client from crashing the process.
pool.on('error', (err) => {
  console.error('Unexpected error on idle Postgres client:', err);
});

export { pool };
