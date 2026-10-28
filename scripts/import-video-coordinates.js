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
 * Other rows clear coordinates and their source binding; raw attempts stay in Insight.
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
const { assertStandaloneImportAllowed } = require('./lib/release-guard');

// --- CLI args ---
const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const csvFlagIndex = args.indexOf('--csv');
const defaultCsvPath =
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
  if (value == null || String(value).trim() === '') return null;
  const n = Number(value);
  if (!Number.isFinite(n) || n < min || n > max) return null;
  return n;
}

async function importVideoCoordinates({ db = null, csvPath = defaultCsvPath, dryRun: preview = dryRun } = {}) {
  const ownsClient = !db;
  let ownedPool = null;
  let transactionStarted = false;
  if (!db && !process.env.DATABASE_URL) throw new Error('DATABASE_URL is not set');
  if (!fs.existsSync(csvPath)) {
    throw new Error(`Localization CSV not found: ${csvPath}`);
  }

  if (ownsClient) ownedPool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: (process.env.DATABASE_URL || '').includes('sslmode=require') || process.env.NODE_ENV === 'production'
        ? { rejectUnauthorized: process.env.DB_SSL_INSECURE !== '1' } : false, // honor sslmode=require (e.g. Neon) even outside production
  });

  const pool = db || await ownedPool.connect();
  try {
    if (ownsClient && !preview) {
      await pool.query('BEGIN'); transactionStarted = true;
      await assertStandaloneImportAllowed(pool);
    }
    console.log(`🔄 Importing real video coordinates from ${csvPath}${preview ? ' (DRY RUN)' : ''}\n`);

    const rows = await readCSV(csvPath);
    console.log(`1. Read ${rows.length} localization rows\n`);

    let updatedOk = 0;
    let statusOnly = 0;
    let linkNotFound = 0;
    let skippedBadRows = 0;
    const samples = [];

    console.log('2. Applying updates...');
    const seenLinks = new Set();
    for (const row of rows) {
      const link = (row.link || '').trim();
      const status = (row.status || '').trim();
      if (seenLinks.has(link)) throw new Error(`Duplicate localization row: ${link}`);
      seenLinks.add(link);
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
        const spread = parseFloat(row.confidence_spread_m);
        const spreadM = Number.isFinite(spread) && spread >= 0 ? spread : null;
        // candidates is a JSON array string; store as JSONB (null if absent/unparseable).
        let candidates = null;
        const rawCandidates = (row.candidates || '').trim();
        if (rawCandidates) {
          try {
            const parsed = JSON.parse(rawCandidates);
            if (!Array.isArray(parsed)) throw new Error('Candidates must be an array');
            if (parsed.length) candidates = JSON.stringify(parsed);
          } catch (cause) { throw new Error(`Invalid candidates JSON for ${link}`, { cause }); }
        }

        // route_latlon is a JSON array of [lat, lon] pairs — the camera's estimated path
        // through the city. Absent for rows written before localize.py carried it, and for
        // videos where no route was recovered; both stay NULL rather than becoming '[]',
        // so "no route estimated" is distinguishable from "route estimated as empty".
        let route = null;
        const rawRoute = (row.route_latlon || '').trim();
        if (rawRoute) {
          try {
            const parsed = JSON.parse(rawRoute);
            const points = Array.isArray(parsed)
              ? parsed.filter(p => Array.isArray(p) && p.length >= 2 &&
                  Number.isFinite(Number(p[0])) && Number.isFinite(Number(p[1])) &&
                  Math.abs(Number(p[0])) <= 90 && Math.abs(Number(p[1])) <= 180)
                .map(p => [Number(p[0]), Number(p[1])])
              : [];
            if (!Array.isArray(parsed) || points.length !== parsed.length) throw new Error('Invalid route coordinates');
            // A polyline needs two points; a single point is already the chosen position.
            if (points.length >= 2) route = JSON.stringify(points);
          } catch (cause) { throw new Error(`Invalid route JSON for ${link}`, { cause }); }
        }
        const routeLenRaw = parseFloat(row.route_length_m);
        const routeLen = Number.isFinite(routeLenRaw) && routeLenRaw >= 0 ? routeLenRaw : null;
        const trajSource = (row.trajectory_source || '').trim() || null;
        const sourceHash = (row.source_video_sha256 || '').trim().toLowerCase() || null;
        const analysisRunId = (row.analysis_run_id || '').trim() || null;
        const originRunId = (row.localization_origin_run_id || '').trim() || null;
        const localizedAt = (row.localized_at || '').trim() || null;
        if (sourceHash && !/^[a-f0-9]{64}$/.test(sourceHash)) throw new Error(`Invalid localization source hash for ${link}`);
        if (localizedAt && !Number.isFinite(Date.parse(localizedAt))) throw new Error(`Invalid localized_at for ${link}`);

        if (preview) {
          console.log(`   [dry-run] ${link}: latitude=${lat}, longitude=${lon}, confidence=${confidence}, spread_m=${spreadM}, candidates=${candidates ? JSON.parse(candidates).length : 0}, route=${route ? JSON.parse(route).length : 0} pts, street=${street}`);
          updatedOk++;
          continue;
        }
        const result = await pool.query(
          `UPDATE videos
           SET latitude = $1, longitude = $2, localization_confidence = $3,
               street_name = $4, localization_status = $5,
               localization_spread_m = $6, localization_candidates = $7::jsonb,
               localization_route = $9::jsonb,
               localization_route_length_m = $10,
               localization_trajectory_source = $11,
               localization_source_video_sha256 = $12,
               localization_analysis_run_id = $13,
               localization_origin_run_id = $14,
               localized_at = $15::timestamptz,
               last_updated_at = CURRENT_TIMESTAMP
           WHERE link = $8 AND ($12::text IS NULL OR source_video_sha256 = $12)
             AND ($13::text IS NULL OR analysis_run_id = $13)
           RETURNING id, video_name`,
          [lat, lon, confidence, street ? street.slice(0, 255) : null, status, spreadM, candidates, link,
           route, routeLen, trajSource, sourceHash, analysisRunId, originRunId, localizedAt]
        );
        if (result.rows.length > 0) {
          updatedOk++;
          if (samples.length < 5) samples.push(`${result.rows[0].video_name} → ${lat}, ${lon} (${confidence || 'n/a'})`);
        } else {
          linkNotFound++;
          console.log(`   ⚠️  ${link}: no videos row with this link — run the aggregator first`);
        }
      } else {
        // A failed/unbound result clears the old geographic evidence as one unit.
        if (preview) {
          console.log(`   [dry-run] ${link}: localization_status=${status || 'unknown'} (status only)`);
          statusOnly++;
          continue;
        }
        const result = await pool.query(
          `UPDATE videos SET localization_status = $1, latitude = NULL, longitude = NULL,
             localization_confidence = NULL, localization_spread_m = NULL, street_name = NULL,
             localization_candidates = NULL, localization_route = NULL,
             localization_route_length_m = NULL, localization_trajectory_source = NULL,
             localization_source_video_sha256 = NULL, localization_analysis_run_id = NULL,
             localization_origin_run_id = NULL, localized_at = NULL
           WHERE link = $2 RETURNING id`,
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

    if (linkNotFound || skippedBadRows) throw new Error(`Localization rejected ${linkNotFound + skippedBadRows} rows`);
    if (!preview) {
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

    if (transactionStarted) await pool.query('COMMIT');
    return { updatedOk, statusOnly };

  } catch (error) {
    if (transactionStarted) await pool.query('ROLLBACK');
    throw error;
  } finally {
    if (ownsClient) { pool.release(); await ownedPool.end(); }
  }
}

if (require.main === module) {
  importVideoCoordinates().catch(error => { console.error(error); process.exitCode = 1; });
}
module.exports = { importVideoCoordinates, parseCoord };
