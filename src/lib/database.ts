import { Pool } from 'pg';

// Database configuration
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
  // Ensure UTF-8 encoding for proper character handling
  client_encoding: 'UTF8',
});

export { pool };
