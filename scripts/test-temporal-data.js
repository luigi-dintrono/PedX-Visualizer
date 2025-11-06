#!/usr/bin/env node

/**
 * Test script to verify temporal data for Brooklyn
 */

require('dotenv').config({ path: '.env.local' });
if (!process.env.DATABASE_URL) {
  require('dotenv').config({ path: '.env' });
}
const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
});

async function testTemporalData() {
  try {
    console.log('Testing temporal data for Brooklyn...\n');

    // Check if Brooklyn exists
    const cityResult = await pool.query(
      "SELECT id, city, country FROM cities WHERE city ILIKE '%brooklyn%' OR city = 'Brooklyn' LIMIT 1"
    );

    if (cityResult.rows.length === 0) {
      console.log('❌ Brooklyn not found in database');
      return;
    }

    const cityId = cityResult.rows[0].id;
    console.log(`✅ Found Brooklyn (ID: ${cityId})\n`);

    // Check videos
    const videosResult = await pool.query(
      'SELECT COUNT(*) as count, MIN(data_collected_date) as min_date, MAX(data_collected_date) as max_date FROM videos WHERE city_id = $1',
      [cityId]
    );
    console.log('Videos:', videosResult.rows[0]);

    // Check import batches
    const batchesResult = await pool.query(
      "SELECT COUNT(*) as count, MIN(import_date) as min_date, MAX(import_date) as max_date FROM import_batches WHERE description LIKE 'Mock data for Brooklyn%'"
    );
    console.log('Import batches:', batchesResult.rows[0]);

    // Test temporal function for current date
    const currentDate = new Date().toISOString().split('T')[0];
    console.log(`\nTesting v_city_summary_at_date('${currentDate}')...`);
    const temporalResult = await pool.query(
      `SELECT city, total_videos, avg_crossing_speed, avg_crossing_time, risky_crossing_rate 
       FROM v_city_summary_at_date($1::DATE) 
       WHERE city = 'Brooklyn'`,
      [currentDate]
    );
    console.log('Temporal result:', temporalResult.rows[0] || 'No data');

    // Test regular view
    console.log(`\nTesting v_city_summary (current)...`);
    const currentResult = await pool.query(
      `SELECT city, total_videos, avg_crossing_speed, avg_crossing_time, risky_crossing_rate 
       FROM v_city_summary 
       WHERE city = 'Brooklyn'`
    );
    console.log('Current result:', currentResult.rows[0] || 'No data');

    // Test a date 3 months ago
    const threeMonthsAgo = new Date();
    threeMonthsAgo.setMonth(threeMonthsAgo.getMonth() - 3);
    const threeMonthsAgoStr = threeMonthsAgo.toISOString().split('T')[0];
    console.log(`\nTesting v_city_summary_at_date('${threeMonthsAgoStr}')...`);
    const pastResult = await pool.query(
      `SELECT city, total_videos, avg_crossing_speed, avg_crossing_time, risky_crossing_rate 
       FROM v_city_summary_at_date($1::DATE) 
       WHERE city = 'Brooklyn'`,
      [threeMonthsAgoStr]
    );
    console.log('Past result:', pastResult.rows[0] || 'No data');

    // Check video dates
    console.log(`\nSample video dates:`);
    const sampleVideos = await pool.query(
      `SELECT link, data_collected_date, first_imported_at, crossing_speed, crossing_time 
       FROM videos 
       WHERE city_id = $1 
       ORDER BY data_collected_date 
       LIMIT 5`,
      [cityId]
    );
    sampleVideos.rows.forEach(v => {
      console.log(`  ${v.link}: collected=${v.data_collected_date}, imported=${v.first_imported_at}, speed=${v.crossing_speed}, time=${v.crossing_time}`);
    });

  } catch (error) {
    console.error('Error testing temporal data:', error);
  } finally {
    await pool.end();
  }
}

testTemporalData();

