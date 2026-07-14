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
  try {
    const sql = fs.readFileSync(file, 'utf8');
    console.log(`🔄 Executing ${file} (${sql.length} bytes)...`);
    await pool.query(sql);
    console.log('✅ SQL executed successfully');
  } catch (error) {
    console.error('❌ SQL execution failed:', error.message);
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
})();
