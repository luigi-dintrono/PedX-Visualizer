require('dotenv').config({ path: '.env.local' });
const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');

async function setupDatabase() {
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    client_encoding: 'UTF8',
  });

  try {
    console.log('Setting up CoreGlobalCrossingData database...');
    
    // Ensure UTF-8 encoding
    await pool.query("SET client_encoding TO 'UTF8'");
    
    // Read and execute schema
    const schemaPath = path.join(__dirname, '../database/schema.sql');
    const schema = fs.readFileSync(schemaPath, 'utf8');
    await pool.query(schema);
    console.log('✅ Schema created successfully');

    // Read and execute sample data
    const sampleDataPath = path.join(__dirname, '../database/sample_data.sql');
    const sampleData = fs.readFileSync(sampleDataPath, 'utf8');
    await pool.query(sampleData);
    console.log('✅ Sample data inserted successfully');

    console.log('🎉 CoreGlobalCrossingData database setup completed!');
    console.log('📊 Available views: CityInsight, MetricInsight');
    console.log('🔧 Metric types: crossing_speed, time_to_start, waiting_time, crossing_distance');
  } catch (error) {
    console.error('❌ Database setup failed:', error);
  } finally {
    await pool.end();
  }
}

setupDatabase();
