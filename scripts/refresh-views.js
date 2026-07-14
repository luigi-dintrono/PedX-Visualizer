#!/usr/bin/env node

/**
 * Refresh the database's materialized views without needing psql on PATH.
 * Node replacement for the Makefile's `db-refresh-views` target
 * (`psql $DATABASE_URL -c "SELECT refresh_materialized_views();"`).
 */

// Try .env.local first, then fall back to .env
require('dotenv').config({ path: '.env.local' });
if (!process.env.DATABASE_URL) {
  require('dotenv').config({ path: '.env' });
}
const { Pool } = require('pg');

async function refreshViews() {
  if (!process.env.DATABASE_URL) {
    console.error('❌ DATABASE_URL is not set (checked .env.local and .env)');
    process.exit(1);
  }
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: (process.env.DATABASE_URL || '').includes('sslmode=require') || process.env.NODE_ENV === 'production'
        ? { rejectUnauthorized: false } : false, // honor sslmode=require (e.g. Neon) even outside production
  });
  try {
    console.log('🔄 Refreshing materialized views...');
    await pool.query('SELECT refresh_materialized_views();');
    console.log('✅ Materialized views refreshed');
  } catch (error) {
    console.error('❌ Error refreshing views:', error.message);
    console.error('   (If the function is missing, apply database/schema.sql first.)');
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
}

refreshViews();
