#!/usr/bin/env node

/**
 * Script to add mock coordinate data to videos in the database
 * This generates random coordinates within a small radius around each city center
 */

// Try .env.local first, then fall back to .env
require('dotenv').config({ path: '.env.local' });
if (!process.env.DATABASE_URL) {
  require('dotenv').config({ path: '.env' });
}
const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
});

async function addMockVideoCoordinates() {
  try {
    console.log('🔄 Adding mock video coordinates...\n');

    // First, ensure the columns exist
    console.log('1. Ensuring latitude/longitude columns exist...');
    await pool.query(`
      ALTER TABLE videos 
      ADD COLUMN IF NOT EXISTS latitude DECIMAL(10, 8),
      ADD COLUMN IF NOT EXISTS longitude DECIMAL(11, 8);
    `);
    console.log('   ✅ Columns exist\n');

    // Create index if it doesn't exist
    console.log('2. Creating index...');
    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_videos_geographic ON videos(latitude, longitude);
    `);
    console.log('   ✅ Index created\n');

    // Get count of videos without coordinates
    const countResult = await pool.query(`
      SELECT COUNT(*) as count
      FROM videos v
      JOIN cities c ON v.city_id = c.id
      WHERE (v.latitude IS NULL OR v.longitude IS NULL)
        AND c.latitude IS NOT NULL
        AND c.longitude IS NOT NULL
    `);
    const videoCount = parseInt(countResult.rows[0].count);
    console.log(`3. Found ${videoCount} videos without coordinates\n`);

    if (videoCount === 0) {
      console.log('   ℹ️  All videos already have coordinates\n');
    } else {
      // Update videos with mock coordinates
      console.log('4. Adding mock coordinates...');
      const updateResult = await pool.query(`
        UPDATE videos v
        SET 
          latitude = c.latitude + ((random() - 0.5) * 0.1),
          longitude = c.longitude + ((random() - 0.5) * 0.1)
        FROM cities c
        WHERE v.city_id = c.id
          AND (v.latitude IS NULL OR v.longitude IS NULL)
          AND c.latitude IS NOT NULL
          AND c.longitude IS NOT NULL
        RETURNING v.id, v.video_name, c.city
      `);

      console.log(`   ✅ Updated ${updateResult.rows.length} videos with mock coordinates\n`);
      
      // Show some examples
      if (updateResult.rows.length > 0) {
        console.log('   📍 Sample updated videos:');
        updateResult.rows.slice(0, 5).forEach(row => {
          console.log(`      - ${row.video_name} (${row.city})`);
        });
        console.log('');
      }
    }

    // Verify the update
    console.log('5. Verifying updates...');
    const verifyResult = await pool.query(`
      SELECT 
        COUNT(*) FILTER (WHERE v.latitude IS NOT NULL AND v.longitude IS NOT NULL) as with_coords,
        COUNT(*) FILTER (WHERE v.latitude IS NULL OR v.longitude IS NULL) as without_coords,
        COUNT(*) as total
      FROM videos v
      JOIN cities c ON v.city_id = c.id
      WHERE c.latitude IS NOT NULL AND c.longitude IS NOT NULL
    `);
    
    const stats = verifyResult.rows[0];
    console.log(`   ✅ Videos with coordinates: ${stats.with_coords}`);
    console.log(`   ⚠️  Videos without coordinates: ${stats.without_coords}`);
    console.log(`   📊 Total videos: ${stats.total}\n`);

    // Show videos by city
    console.log('6. Videos by city:');
    const cityStats = await pool.query(`
      SELECT 
        c.city,
        c.country,
        COUNT(*) as total_videos,
        COUNT(v.latitude) FILTER (WHERE v.latitude IS NOT NULL) as videos_with_coords
      FROM cities c
      LEFT JOIN videos v ON c.id = v.city_id
      WHERE c.latitude IS NOT NULL AND c.longitude IS NOT NULL
      GROUP BY c.id, c.city, c.country
      HAVING COUNT(*) > 0
      ORDER BY total_videos DESC
      LIMIT 10
    `);

    cityStats.rows.forEach(row => {
      console.log(`   ${row.city}, ${row.country}: ${row.videos_with_coords}/${row.total_videos} videos with coordinates`);
    });
    console.log('');

    console.log('✅ Mock video coordinates added successfully!\n');
    
  } catch (error) {
    console.error('❌ Error adding mock video coordinates:', error);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

// Run the script
addMockVideoCoordinates();

