#!/usr/bin/env node

/**
 * Run a .sql file against DATABASE_URL — psql-free migration runner.
 * Usage: node scripts/run-sql.js scripts/migrate-add-localization-fields.sql
 */

require('dotenv').config({ path: '.env.local' });
if (!process.env.DATABASE_URL) {
  require('dotenv').config({ path: '.env' });
}
const fs = require('fs');
const { Pool } = require('pg');

const file = process.argv[2];
if (!file || !fs.existsSync(file)) {
  console.error('❌ Usage: node scripts/run-sql.js <path-to-sql-file>');
  process.exit(1);
}
if (!process.env.DATABASE_URL) {
  console.error('❌ DATABASE_URL is not set (checked .env.local and .env)');
  process.exit(1);
}

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: (process.env.DATABASE_URL || '').includes('sslmode=require') || process.env.NODE_ENV === 'production'
      ? { rejectUnauthorized: false } : false, // honor sslmode=require (e.g. Neon) even outside production
});

(async () => {
  // Run the whole file inside one transaction on a single client so a failure
  // half-way through a multi-statement migration rolls back cleanly instead of
  // leaving the schema partly applied. (Postgres DDL is transactional.)
  const client = await pool.connect();
  try {
    const sql = fs.readFileSync(file, 'utf8');
    console.log(`🔄 Executing ${file} (${sql.length} bytes) in a transaction...`);
    await client.query('BEGIN');
    await client.query(sql);
    await client.query('COMMIT');
    console.log('✅ SQL executed successfully (committed)');
  } catch (error) {
    try { await client.query('ROLLBACK'); } catch { /* ignore */ }
    // Surface the fields Postgres provides for SQL errors, not just the message.
    console.error('❌ SQL execution failed (rolled back):', error.message);
    for (const f of ['detail', 'hint', 'where', 'position']) {
      if (error[f]) console.error(`   ${f}: ${error[f]}`);
    }
    process.exitCode = 1;
  } finally {
    client.release();
    await pool.end();
  }
})();
