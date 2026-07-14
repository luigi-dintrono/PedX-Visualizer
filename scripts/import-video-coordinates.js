#!/usr/bin/env node

/**
 * Import REAL per-video coordinates produced by PedX-Insight's localization pipeline
 * (Monocular-OSM-Localization) into the videos table — replacing the mock coordinates
 * from add-mock-video-coordinates.js.
 *
 * Input CSV: summary_data/all_video_locations.csv, produced in PedX-Insight by
 *   python main.py --mode localize --source_video_path VIDEO [--city "City, Country"]
 *   python get_all_video_locations.py
 * Columns: city, link, video_name, lat, lon, confidence_level, confidence_spread_m,
 *          street_names, status, source, city_lat, city_lon, result_json, candidates
 * (link = bare YouTube id = videos.link; status 'ok' means lat/lon are real estimates)
 *
 * Usage:
 *   node scripts/import-video-coordinates.js [--csv <path>] [--dry-run]
 *   env VIDEO_LOCATIONS_CSV overrides the default path; --csv beats both.
 *
 * Rows with status='ok': UPDATE latitude, longitude, localization_confidence,
 * street_name, localization_status (deliberately OVERWRITES mock coords).
 * Other rows: only localization_status is recorded; coordinates stay untouched.
 * Run scripts/migrate-add-localization-fields.sql once beforehand.
 */

// Try .env.local first, then fall back to .env
require('dotenv').config({ path: '.env.local' });
if (!process.env.DATABASE_URL) {
  require('dotenv').config({ path: '.env' });
}
const fs = require('fs');
const path = require('path');
const csv = require('csv-parser');
const { Pool } = require('pg');

// --- CLI args ---
const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const csvFlagIndex = args.indexOf('--csv');
const csvPath =
  (csvFlagIndex !== -1 && args[csvFlagIndex + 1]) ||
  process.env.VIDEO_LOCATIONS_CSV ||
  path.join('summary_data', 'all_video_locations.csv');

function readCSV(filePath) {
  return new Promise((resolve, reject) => {
    const results = [];
    fs.createReadStream(filePath, { encoding: 'utf8' })
      .pipe(csv({ skipEmptyLines: true }))
      .on('data', (data) => results.push(data))
      .on('end', () => resolve(results))
      .on('error', reject);
  });
}

function parseCoord(value, min, max) {
  const n = parseFloat(value);
  if (!Number.isFinite(n) || n < min || n > max) return null;
  return n;
}

async function importVideoCoordinates() {
  if (!process.env.DATABASE_URL) {
    console.error('❌ DATABASE_URL is not set (checked .env.local and .env)');
    process.exit(1);
  }
  if (!fs.existsSync(csvPath)) {
    console.error(`❌ CSV not found: ${csvPath}`);
    console.error('   Produce it in PedX-Insight with: python get_all_video_locations.py');
    process.exit(1);
  }

  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
  });

  try {
    console.log(`🔄 Importing real video coordinates from ${csvPath}${dryRun ? ' (DRY RUN)' : ''}\n`);

    const rows = await readCSV(csvPath);
    console.log(`1. Read ${rows.length} localization rows\n`);

    let updatedOk = 0;
    let statusOnly = 0;
    let linkNotFound = 0;
    let skippedBadRows = 0;
    const samples = [];

    console.log('2. Applying updates...');
    for (const row of rows) {
      const link = (row.link || '').trim();
      const status = (row.status || '').trim();
      if (!link) {
        skippedBadRows++;
        continue;
      }

      if (status === 'ok') {
        const lat = parseCoord(row.lat, -90, 90);
        const lon = parseCoord(row.lon, -180, 180);
        if (lat === null || lon === null) {
          skippedBadRows++;
          console.log(`   ⚠️  ${link}: status=ok but unusable lat/lon ('${row.lat}', '${row.lon}') — skipped`);
          continue;
        }
        const confidence = (row.confidence_level || '').trim() || null;
        const street = (row.street_names || '').trim() || null;

        if (dryRun) {
          console.log(`   [dry-run] ${link}: latitude=${lat}, longitude=${lon}, confidence=${confidence}, street=${street}`);
          updatedOk++;
          continue;
        }
        const result = await pool.query(
          `UPDATE videos
           SET latitude = $1, longitude = $2, localization_confidence = $3,
               street_name = $4, localization_status = $5, last_updated_at = CURRENT_TIMESTAMP
           WHERE link = $6
           RETURNING id, video_name`,
          [lat, lon, confidence, street ? street.slice(0, 255) : null, status, link]
        );
        if (result.rows.length > 0) {
          updatedOk++;
          if (samples.length < 5) samples.push(`${result.rows[0].video_name} → ${lat}, ${lon} (${confidence || 'n/a'})`);
        } else {
          linkNotFound++;
          console.log(`   ⚠️  ${link}: no videos row with this link — run the aggregator first`);
        }
      } else {
        // Non-ok statuses: record provenance only; never touch coordinates.
        if (dryRun) {
          console.log(`   [dry-run] ${link}: localization_status=${status || 'unknown'} (status only)`);
          statusOnly++;
          continue;
        }
        const result = await pool.query(
          `UPDATE videos SET localization_status = $1 WHERE link = $2 RETURNING id`,
          [status || 'unknown', link]
        );
        if (result.rows.length > 0) statusOnly++;
        else linkNotFound++;
      }
    }
    console.log('');

    console.log('3. Summary:');
    console.log(`   ✅ Real coordinates written: ${updatedOk}`);
    console.log(`   ℹ️  Status-only updates:     ${statusOnly}`);
    console.log(`   ⚠️  Links not in DB:         ${linkNotFound}`);
    console.log(`   ⚠️  Skipped bad rows:        ${skippedBadRows}\n`);

    if (samples.length > 0) {
      console.log('   📍 Sample updates:');
      samples.forEach((s) => console.log(`      - ${s}`));
      console.log('');
    }

    if (!dryRun) {
      const verify = await pool.query(`
        SELECT
          COUNT(*) FILTER (WHERE localization_status = 'ok') as localized_ok,
          COUNT(*) FILTER (WHERE latitude IS NOT NULL) as with_coords,
          COUNT(*) as total
        FROM videos
      `);
      const stats = verify.rows[0];
      console.log(`4. DB state: ${stats.localized_ok} videos localized (status=ok), ` +
                  `${stats.with_coords}/${stats.total} with coordinates\n`);
    }

    console.log(`✅ Import ${dryRun ? 'dry run ' : ''}finished\n`);
  } catch (error) {
    console.error('❌ Error importing video coordinates:', error);
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
}

importVideoCoordinates();
