#!/usr/bin/env node

/**
 * Script to add mock temporal data for Brooklyn
 * This creates multiple import batches over the last 6 months with varying metric values
 * to test the temporal data visualization
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

async function addMockTemporalDataForBrooklyn() {
  try {
    console.log('Starting to add mock temporal data for Brooklyn...');

    // First, check if temporal columns exist
    const columnCheck = await pool.query(`
      SELECT column_name 
      FROM information_schema.columns 
      WHERE table_name = 'videos' AND column_name = 'data_collected_date'
    `);

    if (columnCheck.rows.length === 0) {
      console.log('⚠️  Temporal tracking columns not found. Please run the migration first:');
      console.log('   make db-migrate-temporal-tracking');
      process.exit(1);
    }

    // Check if Brooklyn exists
    const cityResult = await pool.query(
      "SELECT id, city, country FROM cities WHERE city ILIKE '%brooklyn%' OR city = 'Brooklyn' LIMIT 1"
    );

    let cityId;
    if (cityResult.rows.length === 0) {
      // Create Brooklyn city if it doesn't exist
      console.log('Brooklyn not found. Creating city...');
      const insertResult = await pool.query(`
        INSERT INTO cities (city, country, continent, latitude, longitude, population_city)
        VALUES ('Brooklyn', 'United States', 'North America', 40.6782, -73.9442, 2736074)
        ON CONFLICT (city, country) DO UPDATE SET city = cities.city
        RETURNING id
      `);
      cityId = insertResult.rows[0].id;
      console.log(`Created Brooklyn with ID: ${cityId}`);
    } else {
      cityId = cityResult.rows[0].id;
      console.log(`Found Brooklyn with ID: ${cityId}`);
    }

    // Generate 6 months of data (one import batch per month)
    const months = 6;
    const now = new Date();
    const videosPerMonth = 3; // 3 videos per month

    // Base metric values that will vary over time
    const baseMetrics = {
      crossing_speed: 1.8, // m/s
      crossing_time: 2.5, // seconds
      risky_crossing_ratio: 0.15, // 15%
      run_red_light_ratio: 0.12, // 12%
      crosswalk_usage_ratio: 0.75, // 75%
      phone_usage_ratio: 0.08, // 8%
      total_pedestrians: 50,
      total_vehicles: 30
    };

    for (let monthOffset = months - 1; monthOffset >= 0; monthOffset--) {
      const importDate = new Date(now);
      importDate.setMonth(importDate.getMonth() - monthOffset);
      const dataCollectedDate = new Date(importDate);
      dataCollectedDate.setDate(1); // First day of the month

      // Create import batch
      const batchResult = await pool.query(`
        INSERT INTO import_batches (description, import_date, record_count)
        VALUES ($1, $2, $3)
        RETURNING id
      `, [
        `Mock data for Brooklyn - ${dataCollectedDate.toLocaleDateString('en-US', { month: 'long', year: 'numeric' })}`,
        importDate,
        videosPerMonth
      ]);

      const importBatchId = batchResult.rows[0].id;
      console.log(`Created import batch #${importBatchId} for ${dataCollectedDate.toLocaleDateString('en-US', { month: 'long', year: 'numeric' })}`);

      // Add variation to metrics (trending slightly over time)
      const variation = (monthOffset / months) * 0.2; // 20% variation over 6 months
      const metrics = {
        crossing_speed: baseMetrics.crossing_speed + (variation * 0.3), // Slight increase
        crossing_time: baseMetrics.crossing_time - (variation * 0.2), // Slight decrease
        risky_crossing_ratio: baseMetrics.risky_crossing_ratio - (variation * 0.05), // Slight decrease
        run_red_light_ratio: baseMetrics.run_red_light_ratio + (variation * 0.03), // Slight increase
        crosswalk_usage_ratio: baseMetrics.crosswalk_usage_ratio + (variation * 0.1), // Slight increase
        phone_usage_ratio: baseMetrics.phone_usage_ratio + (variation * 0.02), // Slight increase
        total_pedestrians: baseMetrics.total_pedestrians + Math.floor(variation * 10),
        total_vehicles: baseMetrics.total_vehicles + Math.floor(variation * 5)
      };

      // Create videos for this month
      for (let videoIndex = 0; videoIndex < videosPerMonth; videoIndex++) {
        // Add small random variation to each video
        const randomVariation = () => (Math.random() - 0.5) * 0.1; // ±5% random variation

        const videoLink = `brooklyn_${dataCollectedDate.getFullYear()}_${String(dataCollectedDate.getMonth() + 1).padStart(2, '0')}_${videoIndex + 1}`;
        const videoName = `Brooklyn Video ${dataCollectedDate.toLocaleDateString('en-US', { month: 'short' })} ${videoIndex + 1}`;

        // Insert video with temporal tracking
        await pool.query(`
          INSERT INTO videos (
            city_id, link, video_name, city_link,
            duration_seconds, total_frames, analysis_seconds,
            total_pedestrians, total_crossed_pedestrians,
            average_age, phone_usage_ratio, risky_crossing_ratio,
            run_red_light_ratio, crosswalk_usage_ratio, traffic_signs_ratio,
            total_vehicles, top3_vehicles, main_weather,
            sidewalk_prob, crosswalk_prob, traffic_light_prob, avg_road_width,
            crack_prob, potholes_prob, police_car_prob, arrow_board_prob,
            cones_prob, accident_prob, crossing_time, crossing_speed,
            data_collected_date, import_batch_id, first_imported_at, last_updated_at
          ) VALUES (
            $1, $2, $3, $4,
            $5, $6, $7,
            $8, $9,
            $10, $11, $12,
            $13, $14, $15,
            $16, $17, $18,
            $19, $20, $21, $22,
            $23, $24, $25, $26,
            $27, $28, $29, $30,
            $31, $32, $33, $34
          )
          ON CONFLICT (link) DO UPDATE SET
            crossing_speed = EXCLUDED.crossing_speed,
            crossing_time = EXCLUDED.crossing_time,
            risky_crossing_ratio = EXCLUDED.risky_crossing_ratio,
            run_red_light_ratio = EXCLUDED.run_red_light_ratio,
            crosswalk_usage_ratio = EXCLUDED.crosswalk_usage_ratio,
            phone_usage_ratio = EXCLUDED.phone_usage_ratio,
            total_pedestrians = EXCLUDED.total_pedestrians,
            total_vehicles = EXCLUDED.total_vehicles,
            import_batch_id = EXCLUDED.import_batch_id,
            data_collected_date = EXCLUDED.data_collected_date,
            last_updated_at = EXCLUDED.last_updated_at,
            updated_at = CURRENT_TIMESTAMP
        `, [
          cityId,
          videoLink,
          videoName,
          `brooklyn_${videoLink}`,
          // Video metrics
          120.0 + (Math.random() * 60), // duration_seconds
          3600 + Math.floor(Math.random() * 1800), // total_frames
          5.0 + (Math.random() * 2), // analysis_seconds
          // Pedestrian data
          Math.floor(metrics.total_pedestrians * (1 + randomVariation())),
          Math.floor(metrics.total_pedestrians * 0.8 * (1 + randomVariation())),
          35.0 + (Math.random() * 10), // average_age
          Math.max(0, Math.min(1, metrics.phone_usage_ratio * (1 + randomVariation()))),
          Math.max(0, Math.min(1, metrics.risky_crossing_ratio * (1 + randomVariation()))),
          Math.max(0, Math.min(1, metrics.run_red_light_ratio * (1 + randomVariation()))),
          Math.max(0, Math.min(1, metrics.crosswalk_usage_ratio * (1 + randomVariation()))),
          0.6 + (Math.random() * 0.3), // traffic_signs_ratio
          // Vehicle data
          Math.floor(metrics.total_vehicles * (1 + randomVariation())),
          'car,bus,motorbike', // top3_vehicles
          'sunny', // main_weather
          // Infrastructure
          0.8 + (Math.random() * 0.2), // sidewalk_prob
          0.7 + (Math.random() * 0.3), // crosswalk_prob
          0.9 + (Math.random() * 0.1), // traffic_light_prob
          8.0 + (Math.random() * 4), // avg_road_width
          // Road conditions
          0.1 + (Math.random() * 0.2), // crack_prob
          0.05 + (Math.random() * 0.1), // potholes_prob
          0.02 + (Math.random() * 0.03), // police_car_prob
          0.01 + (Math.random() * 0.02), // arrow_board_prob
          0.03 + (Math.random() * 0.05), // cones_prob
          0.01 + (Math.random() * 0.02), // accident_prob
          // Crossing metrics
          Math.max(0, metrics.crossing_time * (1 + randomVariation())),
          Math.max(0, metrics.crossing_speed * (1 + randomVariation())),
          // Temporal tracking
          dataCollectedDate.toISOString().split('T')[0],
          importBatchId,
          importDate,
          importDate
        ]);

        // Add some pedestrian data for each video
        const videoIdResult = await pool.query('SELECT id FROM videos WHERE link = $1', [videoLink]);
        if (videoIdResult.rows.length > 0) {
          const videoId = videoIdResult.rows[0].id;
          const pedestrianCount = Math.floor(metrics.total_pedestrians * (1 + randomVariation()) / videosPerMonth);

          for (let p = 0; p < Math.min(pedestrianCount, 20); p++) { // Limit to 20 pedestrians per video
            await pool.query(`
              INSERT INTO pedestrians (
                video_id, track_id, age, gender, risky_crossing, run_red_light,
                crosswalk_use_or_not, phone_using
              ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
              ON CONFLICT (video_id, track_id) DO NOTHING
            `, [
              videoId,
              p + 1,
              20 + Math.floor(Math.random() * 50), // age
              Math.random() > 0.5 ? 'male' : 'female',
              Math.random() < metrics.risky_crossing_ratio,
              Math.random() < metrics.run_red_light_ratio,
              Math.random() < metrics.crosswalk_usage_ratio,
              Math.random() < metrics.phone_usage_ratio
            ]);
          }
        }
      }

      console.log(`  Added ${videosPerMonth} videos for ${dataCollectedDate.toLocaleDateString('en-US', { month: 'long', year: 'numeric' })}`);
    }

    // Update import batch record counts
    await pool.query(`
      UPDATE import_batches 
      SET record_count = (
        SELECT COUNT(*) FROM videos WHERE import_batch_id = import_batches.id
      )
      WHERE id IN (
        SELECT id FROM import_batches 
        WHERE description LIKE 'Mock data for Brooklyn%'
      )
    `);

    console.log('\n✅ Successfully added mock temporal data for Brooklyn!');
    console.log(`   - ${months} months of data`);
    console.log(`   - ${months * videosPerMonth} total videos`);
    console.log(`   - ${months} import batches created`);
  } catch (error) {
    console.error('Error adding mock temporal data:', error);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

addMockTemporalDataForBrooklyn();

