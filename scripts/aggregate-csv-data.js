#!/usr/bin/env node

/**
 * CSV Data Aggregation Script for PEDX Visualizer
 * 
 * This script reads CSV files from the summary_data directory and aggregates
 * them into PostgreSQL tables using the improved analytics structure.
 * 
 * Usage: node scripts/aggregate-csv-data.js [--fresh] [--verbose]
 * --fresh: Drop and recreate all tables
 * --verbose: Show detailed logging
 */

const fs = require('fs');
const path = require('path');
const csv = require('csv-parser');
const { Readable } = require('stream');
const { Pool } = require('pg');

// Load environment variables from .env.local (for Next.js projects) or .env
require('dotenv').config({ path: '.env.local' });
require('dotenv').config(); // Fallback to .env if .env.local doesn't exist

// Import GeoNames API integration
// Network geography enrichment is a separate job, outside publication.
// Offline city resolver (no network) — the PRIMARY geo backfill, run before GeoNames.
const { enrichCityRow } = require('./lib/city-gazetteer');
const { validateCoreRows } = require('./lib/import-contract');
const { assertStandaloneImportAllowed } = require('./lib/release-guard');

// Configuration
const CSV_DIR = process.env.PEDX_CSV_DIR || path.join(__dirname, '..', 'summary_data');
const VERBOSE = process.argv.includes('--verbose');
const FRESH_START = process.argv.includes('--fresh');

// Database connection
const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: (process.env.DATABASE_URL || '').includes('sslmode=require') || process.env.NODE_ENV === 'production'
        ? { rejectUnauthorized: process.env.DB_SSL_INSECURE !== '1' } : false, // honor sslmode=require (e.g. Neon) even outside production
});

// Helper function for logging
function log(message, data = null) {
    if (VERBOSE) {
        console.log(`[${new Date().toISOString()}] ${message}`);
        if (data) {
            console.log(JSON.stringify(data, null, 2));
        }
    }
}

// Helper function to safely parse numeric values
function safeNumeric(value) {
    if (value === null || value === undefined || value === '') {
        return null;
    }
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
}

// Helper function to safely parse boolean values.
//
// Accepts numeric encodings, not just the literal '1'. pandas widens an integer column
// to float64 the moment a single NA appears, so `to_csv` then writes '1.0'/'0.0' instead
// of '1'/'0'. That is exactly what happened on 2026-09-07: making per-pedestrian
// risky_crossing nullable flipped the token from '1' to '1.0', the old strict comparison
// returned false for every one of them, and 156 risky pedestrians were published to the
// database as NOT risky. The producer has since been pinned to Int64, but this stays
// tolerant because the same widening can hit any of the 40+ boolean columns here.
//
// 'none'/'nan' are treated as unknown (null), NOT false -- an undetermined observation is
// not a negative one.
function safeBoolean(value) {
    if (value === null || value === undefined || value === '') {
        return null;
    }
    const s = String(value).trim().toLowerCase();
    if (s === '' || s === 'none' || s === 'nan' || s === 'na' || s === '<na>' || s === 'null') {
        return null;
    }
    const n = Number(s);
    if (Number.isFinite(n)) {
        return n !== 0;
    }
    if (['true', 'yes', 't', 'y'].includes(s)) return true;
    if (['false', 'no', 'f', 'n'].includes(s)) return false;
    throw new Error(`Invalid boolean token: ${value}`);
}

// Helper function to safely parse integer values
function safeInteger(value) {
    if (value === null || value === undefined || value === '') {
        return null;
    }
    const parsed = Number(value);
    return Number.isSafeInteger(parsed) ? parsed : null;
}

// Helper function to parse age values (handles both numeric and age group strings like "Age18-60")
function safeAge(value) {
    if (value === null || value === undefined || value === '') {
        return null;
    }
    
    // Try direct integer parsing first
    const directParsed = parseInt(value);
    if (!isNaN(directParsed) && directParsed > 0) {
        return directParsed;
    }
    
    // Try to parse age group strings like "Age18-60", "Age18-30", etc.
    const ageGroupMatch = value.toString().match(/Age(\d+)-(\d+)/i);
    if (ageGroupMatch) {
        const minAge = parseInt(ageGroupMatch[1]);
        const maxAge = parseInt(ageGroupMatch[2]);
        if (!isNaN(minAge) && !isNaN(maxAge) && minAge > 0 && maxAge > 0) {
            // Return the midpoint of the age range
            return Math.round((minAge + maxAge) / 2);
        }
    }
    
    // Try other common age group formats
    const otherMatch = value.toString().match(/(\d+)-(\d+)/);
    if (otherMatch) {
        const minAge = parseInt(otherMatch[1]);
        const maxAge = parseInt(otherMatch[2]);
        if (!isNaN(minAge) && !isNaN(maxAge) && minAge > 0 && maxAge > 0) {
            return Math.round((minAge + maxAge) / 2);
        }
    }
    
    return null;
}

// Helper function to clean string values
function cleanString(value) {
    if (value === null || value === undefined) {
        return null;
    }
    return value.toString().trim() || null;
}

// Strict UTF-8 decoder (WHATWG Encoding, built into Node). fatal:true makes invalid bytes
// throw instead of silently becoming U+FFFD; the BOM, if any, is stripped.
const UTF8_STRICT = new TextDecoder('utf-8', { fatal: true });

// Read a CSV file and return its rows.
//
// The file must be UTF-8. The old reader opened the stream as 'utf8' -- which never errors,
// it just substitutes U+FFFD -- so its Latin-1 "fallback" never ran, and a GBK-encoded
// export reached the database as 'Asunci¨®n'-style mojibake that seven fix-encoding scripts
// then patched by hand from a list of known names. Guessing an encoding is what caused that
// damage, so a non-UTF-8 file is now rejected with the line to look at.
async function readCSV(filePath) {
    const bytes = fs.readFileSync(filePath);
    let text;
    try {
        text = UTF8_STRICT.decode(bytes);
    } catch {
        const lossy = bytes.toString('utf8');
        const at = lossy.indexOf('\uFFFD');
        const line = at >= 0 ? lossy.slice(0, at).split('\n').length : '?';
        throw new Error(
            `${filePath} is not valid UTF-8 (first bad byte on line ${line}). ` +
            'Re-export it as UTF-8; it is not imported, so nothing is half-written.'
        );
    }
    return new Promise((resolve, reject) => {
        const results = [];
        Readable.from([text])
            .pipe(csv({ skipEmptyLines: true, skipLinesWithError: false }))
            .on('data', (data) => {
                // NFC so visually identical names (precomposed vs combining accents)
                // compare equal in the city lookup.
                const row = {};
                for (const [key, value] of Object.entries(data)) {
                    row[key] = typeof value === 'string' ? value.normalize('NFC') : value;
                }
                results.push(row);
            })
            .on('end', () => resolve(results))
            .on('error', reject);
    });
}

// Database operations
class DatabaseAggregator {
    constructor({ db = pool, csvDir = CSV_DIR, releaseManifest = null } = {}) {
        this.db = db;
        this.csvDir = csvDir;
        this.releaseManifest = releaseManifest;
        this.cityCache = new Map(); // Cache for city lookups
        this.videoCache = new Map(); // Cache for video lookups
        this.currentImportBatchId = null;
    }

    async initialize() {
        log('Initializing database connection...');
        try {
            // Ensure UTF-8 encoding for the connection
            await this.db.query("SET client_encoding TO 'UTF8'");
            await this.db.query('SELECT 1');
            log('Database connection successful');
            
            if (FRESH_START) {
                log('Fresh start requested - will recreate schema');
                const schemaPath = path.join(__dirname, '..', 'database', 'schema.sql');
                const schema = fs.readFileSync(schemaPath, 'utf8');
                await this.db.query(schema);
                log('Schema recreated successfully');
            }
        } catch (error) {
            console.error('Database initialization failed:', error);
            throw error;
        }
    }

    async startImportBatch(description = null) {
        // Create import batch record
        const batchDescription = description || `Import on ${new Date().toISOString()}`;
        const result = await this.db.query(`
            INSERT INTO import_batches (description, import_date)
            VALUES ($1, CURRENT_TIMESTAMP)
            RETURNING id, import_date
        `, [batchDescription]);
        
        this.currentImportBatchId = result.rows[0].id;
        console.log(`📦 Started import batch #${this.currentImportBatchId} at ${result.rows[0].import_date}`);
        log(`Import batch started: ${batchDescription}`);
        return this.currentImportBatchId;
    }

    async finalizeImportBatch() {
        if (this.currentImportBatchId) {
            // Update batch with final counts
            const result = await this.db.query(`
                UPDATE import_batches 
                SET 
                    record_count = (SELECT COUNT(*) FROM videos WHERE import_batch_id = $1),
                    file_count = (SELECT COUNT(DISTINCT file_name) FROM (
                        SELECT unnest(string_to_array(metadata->>'files', ',')) as file_name
                        FROM import_batches WHERE id = $1
                    ) sub)
                WHERE id = $1
                RETURNING record_count
            `, [this.currentImportBatchId]);
            
            console.log(`✅ Completed import batch #${this.currentImportBatchId} with ${result.rows[0]?.record_count || 0} records`);
            log(`Import batch finalized: ${this.currentImportBatchId}`);
        }
    }

    // Core data aggregation (cities, videos, pedestrians)
    async aggregateCoreData() {
        log('Aggregating core data...');
        
        // Start import batch
        await this.startImportBatch('CSV data aggregation');
        
        try {
            // Read CSV files
            const [videoData, timeData, pedestrianData] = await Promise.all([
                readCSV(path.join(this.csvDir, 'all_video_info.csv')),
                readCSV(path.join(this.csvDir, 'all_time_info.csv')),
                readCSV(path.join(this.csvDir, 'all_pedestrian_info.csv'))
            ]);
            
            validateCoreRows(videoData, pedestrianData);
            if (!videoData.length) throw new Error('Refusing an empty video snapshot');
            if (this.releaseManifest) {
                // Full release replacement: observations absent from the validated snapshot
                // cannot silently remain eligible under the newly activated release.
                await this.db.query('DELETE FROM videos WHERE NOT (link = ANY($1::text[]))', [videoData.map(row => row.link)]);
            }

            // Create time data lookup.
            // Prefer joining by link (YouTube id) — newer all_time_info.csv from
            // PedX-Insight carries it. The old duration_seconds string-equality join is
            // kept only as a fallback for legacy CSVs (it is collision-prone).
            const timeMap = new Map();
            for (const row of timeData) {
                timeMap.set(row.link !== undefined ? row.link : row.duration_seconds, row.analysis_seconds);
            }

            // Process cities first
            await this.aggregateCities(videoData);
            
            // Process videos
            await this.aggregateVideos(videoData, timeMap);
            
            // Process pedestrians
            await this.aggregatePedestrians(pedestrianData);
            
            // Finalize import batch
            await this.finalizeImportBatch();
            
            log(`Processed ${videoData.length} cities, ${videoData.length} videos, ${pedestrianData.length} pedestrians`);
        } catch (error) {
            console.error('Error aggregating core data:', error);
            throw error;
        }
    }

    async aggregateCities(videoData) {
        for (const row of videoData) {
            // Resolution is descriptive context, never proof that the searched city is in the clip.
            // An explicit producer identity always wins over local name lookup.
            const explicit = cleanString(row.city_id || row.searched_city_id);
            if (!explicit) enrichCityRow(row);
            const token = value => String(value || 'unknown').normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-|-$/g, '') || 'unknown';
            const identity = explicit || `place:${token(row.iso3 || row.country)}:${token(row.admin1_code || row.state)}:${token(row.city)}`;
            row._cityIdentity = identity;
            if (this.cityCache.has(identity)) continue;
            const data = {
                external_city_id: identity, city: cleanString(row.city), state: cleanString(row.state),
                country: cleanString(row.country) || 'Unknown', admin1_code: cleanString(row.admin1_code),
                iso3: cleanString(row.iso3), continent: cleanString(row.continent),
                latitude: safeNumeric(row.lat), longitude: safeNumeric(row.lon),
                gmp: safeNumeric(row.gmp), population_city: safeInteger(row.population_city),
                population_country: safeInteger(row.population_country), traffic_mortality: safeNumeric(row.traffic_mortality),
                literacy_rate: safeNumeric(row.literacy_rate), avg_height: safeNumeric(row.avg_height),
                med_age: safeNumeric(row.med_age), gini: safeNumeric(row.gini),
            };
            // Adopt a legacy row only when country/admin/name identify one unambiguous row.
            const legacy = await this.db.query(`SELECT id FROM cities WHERE external_city_id IS NULL
                AND city = $1 AND country = $2 AND COALESCE(state, '') = COALESCE($3, '')`,
                [data.city, data.country, data.state]);
            if (legacy.rows.length === 1) {
                await this.db.query('UPDATE cities SET external_city_id = $1 WHERE id = $2', [identity, legacy.rows[0].id]);
            } else if (legacy.rows.length > 1) throw new Error(`Ambiguous legacy city: ${identity}`);
            const columns = Object.keys(data);
            const update = columns.filter(column => column !== 'external_city_id').map(column => `${column} = EXCLUDED.${column}`).join(', ');
            const result = await this.db.query(`INSERT INTO cities (${columns.join(', ')})
                VALUES (${columns.map((_, i) => `$${i + 1}`).join(', ')})
                ON CONFLICT (external_city_id) DO UPDATE SET ${update}, updated_at = CURRENT_TIMESTAMP RETURNING id`, Object.values(data));
            this.cityCache.set(identity, result.rows[0].id);
        }
    }

    async aggregateVideos(videoData, timeMap) {
        log('Aggregating videos data...');

        if (!this.currentImportBatchId) {
            await this.startImportBatch('Video aggregation');
        }

        const importDate = new Date();

        for (const row of videoData) {
            try {
                // Must match the key built in aggregateCities() AFTER enrichCityRow() mutated
                // row.city/row.country in place — both run over the same shared videoData rows.
                const cityKey = row._cityIdentity;
                const cityId = this.cityCache.get(cityKey);
                
                if (!cityId) {
                    throw new Error(`City not found for video ${row.link}: ${cityKey}`);
                }

                // Parse data_collected_date from CSV if available, otherwise use import date
                let dataCollectedDate = null;
                if (row.data_collected_date) {
                    const parsedDate = new Date(row.data_collected_date);
                    if (!isNaN(parsedDate.getTime())) {
                        dataCollectedDate = parsedDate.toISOString().split('T')[0];
                    }
                }

                const videoDataValues = {
                    city_id: cityId,
                    link: cleanString(row.link),
                    video_name: cleanString(row.video_name),
                    // all_video_info.csv has NO city_link column (only all_pedestrian_info.csv
                    // does), so row.city_link is always undefined here and the old
                    // `${row.city}_${row.link}` fallback produced values that do not match the
                    // pedestrian CSV: it loses the per-city video index and uses the
                    // gazetteer-canonicalised row.city (enrichCityRow() mutated it in
                    // aggregateCities()). e.g. it yielded "London_slTbgnXsBik" where the real
                    // city_link is "London1_slTbgnXsBik".
                    // The authoritative value is the analysis folder name, which
                    // get_all_pede_info.py writes verbatim as city_link and
                    // get_all_video_info.py writes verbatim as video_name — so video_name IS the
                    // city_link. Keep row.city_link first (future CSVs may carry it) and the
                    // legacy concatenation last as a final fallback.
                    city_link: cleanString(row.city_link || row.video_name || `${row.city}_${row.link}`),
                    duration_seconds: safeNumeric(row.duration_seconds),
                    // How the denominator was obtained: video | video_meta | analysis_time.
                    duration_source: cleanString(row.duration_source),
                    // PedX-Insight analysis stamp (git sha + weights + config digests).
                    // Absent/blank = unstamped run; never compare across values.
                    code_version: cleanString(row.code_version),
                    total_frames: safeInteger(row.total_frames),
                    // link-keyed map for new CSVs; duration-keyed fallback for legacy ones
                    analysis_seconds: safeNumeric(timeMap.get(cleanString(row.link)) ?? timeMap.get(row.duration_seconds)),
                    total_pedestrians: safeInteger(row.total_pedestrians),
                    total_crossed_pedestrians: safeInteger(row.total_crossed_pedestrians),
                    average_age: safeNumeric(row.average_age),
                    phone_usage_ratio: safeNumeric(row.phone_usage_ratio),
                    risky_crossing_ratio: safeNumeric(row.risky_crossing_ratio),
                    // Evidence-positive since 2026-09-07 — never read the ratio without
                    // the coverage. See scripts/migrate-add-metric-coverage.sql.
                    risky_crossing_coverage: safeNumeric(row.risky_crossing_coverage),
                    unsignalled_crossing_ratio: safeNumeric(row.unsignalled_crossing_ratio),
                    run_red_light_ratio: safeNumeric(row.run_red_light_ratio),
                    crosswalk_usage_ratio: safeNumeric(row.crosswalk_usage_ratio),
                    traffic_signs_ratio: safeNumeric(row.traffic_signs_ratio),
                    total_vehicles: safeInteger(row.total_vehicles),
                    top3_vehicles: cleanString(row.top3_vehicles),
                    main_weather: cleanString(row.main_weather),
                    sidewalk_prob: safeNumeric(row.sidewalk_prob),
                    crosswalk_prob: safeNumeric(row.crosswalk_prob),
                    traffic_light_prob: safeNumeric(row.traffic_light_prob),
                    avg_road_width: safeNumeric(row.avg_road_width),
                    crack_prob: safeNumeric(row.Crack_prob),
                    potholes_prob: safeNumeric(row.Potholes_prob),
                    police_car_prob: safeNumeric(row.police_car_prob),
                    arrow_board_prob: safeNumeric(row['Arrow Board_prob']),
                    cones_prob: safeNumeric(row.cones_prob),
                    accident_prob: safeNumeric(row.accident_prob),
                    crossing_time: safeNumeric(row.crossing_time),
                    crossing_speed: safeNumeric(row.crossing_speed),
                    // Measured per-video median walking speed from [S1] (reliable tracks only);
                    // NULL for videos analyzed before the dense-tracking pass.
                    measured_walking_speed_mps: safeNumeric(row.measured_avg_walking_speed_mps),
                    measured_crossing_speed_mps: safeNumeric(row.measured_crossing_speed_mps),
                    measured_crossing_speed_n: safeInteger(row.measured_crossing_speed_n),
                    pipeline_version: cleanString(row.pipeline_version),
                    pet_severe_conflicts: safeInteger(row.pet_severe_conflicts),
                    pet_moderate_conflicts: safeInteger(row.pet_moderate_conflicts),
                    pet_queued_interactions: safeInteger(row.pet_queued_interactions),
                    pet_min_s: safeNumeric(row.pet_min_s),
                    vehicle_median_speed_mps: safeNumeric(row.vehicle_median_speed_mps),
                    vehicle_p85_speed_mps: safeNumeric(row.vehicle_p85_speed_mps),
                    mean_headway_s: safeNumeric(row.mean_headway_s),
                    platoon_frac: safeNumeric(row.platoon_frac),
                    vehicle_flow_per_min: safeNumeric(row.vehicle_flow_per_min),
                    anticipatory_start_frac: safeNumeric(row.anticipatory_start_frac),
                    mean_red_exposure_s: safeNumeric(row.mean_red_exposure_s),
                    hesitation_rate: safeNumeric(row.hesitation_rate),
                    aborted_start_rate: safeNumeric(row.aborted_start_rate),
                    evasive_event_count: safeInteger(row.evasive_event_count),
                    n_social_groups: safeInteger(row.n_social_groups),
                    grouped_pedestrians: safeInteger(row.grouped_pedestrians),
                    look_before_cross_frac: safeNumeric(row.look_before_cross_frac),
                    looked_both_ways_frac: safeNumeric(row.looked_both_ways_frac),
                    median_cadence_hz: safeNumeric(row.median_cadence_hz),
                    cadence_n: safeInteger(row.cadence_n),
                    data_collected_date: dataCollectedDate,
                    import_batch_id: this.currentImportBatchId
                };

                // Check if video already exists
                const existing = await this.db.query(
                    'SELECT id, first_imported_at FROM videos WHERE link = $1',
                    [videoDataValues.link]
                );

                const isUpdate = existing.rows.length > 0;
                const firstImportedAt = isUpdate 
                    ? existing.rows[0].first_imported_at 
                    : importDate;

                const result = await this.db.query(`
                    INSERT INTO videos (
                        city_id, link, video_name, city_link, duration_seconds, total_frames,
                        analysis_seconds, total_pedestrians, total_crossed_pedestrians,
                        average_age, phone_usage_ratio, risky_crossing_ratio, run_red_light_ratio,
                        crosswalk_usage_ratio, traffic_signs_ratio, total_vehicles, top3_vehicles,
                        main_weather, sidewalk_prob, crosswalk_prob, traffic_light_prob,
                        avg_road_width, crack_prob, potholes_prob, police_car_prob,
                        arrow_board_prob, cones_prob, accident_prob, crossing_time, crossing_speed,
                        measured_walking_speed_mps,
                        measured_crossing_speed_mps, measured_crossing_speed_n, pipeline_version, pet_severe_conflicts, pet_moderate_conflicts, pet_queued_interactions, pet_min_s, vehicle_median_speed_mps, vehicle_p85_speed_mps, mean_headway_s, platoon_frac, vehicle_flow_per_min, anticipatory_start_frac, mean_red_exposure_s, hesitation_rate, aborted_start_rate, evasive_event_count, n_social_groups, grouped_pedestrians, look_before_cross_frac, looked_both_ways_frac, median_cadence_hz, cadence_n,
                        data_collected_date, import_batch_id, first_imported_at, last_updated_at,
                        risky_crossing_coverage, unsignalled_crossing_ratio, duration_source,
                        code_version
                    ) VALUES (
                        $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15,
                        $16, $17, $18, $19, $20, $21, $22, $23, $24, $25, $26, $27, $28, $29, $30,
                        $31, $32, $33, $34, $35,
                        $36, $37, $38, $39, $40, $41, $42, $43, $44, $45, $46, $47, $48, $49, $50, $51, $52, $53, $54, $55, $56, $57, $58,
                        $59, $60, $61,
                        $62
                    )
                    ON CONFLICT (link)
                    DO UPDATE SET
                        city_id = EXCLUDED.city_id,
                        video_name = EXCLUDED.video_name,
                        city_link = EXCLUDED.city_link,
                        -- Duration ONLY is coalesced. [A1] rows written after the source
                        -- video was deleted carry a blank duration, and re-importing one
                        -- used to erase a good stored value every night. Duration is
                        -- version-independent physics, so a stored value is never stale.
                        -- Do NOT extend this to the metric columns: that would make it
                        -- impossible for a re-import to retract a value, leaving a stale
                        -- legacy_1hz number sitting in a dense_v2 row with nothing marking it.
                        -- The pair must move together: two independent COALESCEs could keep
                        -- a stored duration while adopting the incoming row's source label
                        -- (or vice versa), leaving the provenance describing a value it did
                        -- not produce.
                        duration_seconds = COALESCE(EXCLUDED.duration_seconds, videos.duration_seconds),
                        duration_source = CASE
                            WHEN EXCLUDED.duration_seconds IS NOT NULL THEN EXCLUDED.duration_source
                            ELSE videos.duration_source
                        END,
                        total_frames = EXCLUDED.total_frames,
                        -- Not coalesced: a re-import from an unstamped run must clear the
                        -- stamp, or the row would claim code it was not produced by.
                        code_version = EXCLUDED.code_version,
                        analysis_seconds = EXCLUDED.analysis_seconds,
                        total_pedestrians = EXCLUDED.total_pedestrians,
                        total_crossed_pedestrians = EXCLUDED.total_crossed_pedestrians,
                        average_age = EXCLUDED.average_age,
                        phone_usage_ratio = EXCLUDED.phone_usage_ratio,
                        risky_crossing_ratio = EXCLUDED.risky_crossing_ratio,
                        risky_crossing_coverage = EXCLUDED.risky_crossing_coverage,
                        unsignalled_crossing_ratio = EXCLUDED.unsignalled_crossing_ratio,
                        run_red_light_ratio = EXCLUDED.run_red_light_ratio,
                        crosswalk_usage_ratio = EXCLUDED.crosswalk_usage_ratio,
                        traffic_signs_ratio = EXCLUDED.traffic_signs_ratio,
                        total_vehicles = EXCLUDED.total_vehicles,
                        top3_vehicles = EXCLUDED.top3_vehicles,
                        main_weather = EXCLUDED.main_weather,
                        sidewalk_prob = EXCLUDED.sidewalk_prob,
                        crosswalk_prob = EXCLUDED.crosswalk_prob,
                        traffic_light_prob = EXCLUDED.traffic_light_prob,
                        avg_road_width = EXCLUDED.avg_road_width,
                        crack_prob = EXCLUDED.crack_prob,
                        potholes_prob = EXCLUDED.potholes_prob,
                        police_car_prob = EXCLUDED.police_car_prob,
                        arrow_board_prob = EXCLUDED.arrow_board_prob,
                        cones_prob = EXCLUDED.cones_prob,
                        accident_prob = EXCLUDED.accident_prob,
                        crossing_time = EXCLUDED.crossing_time,
                        crossing_speed = EXCLUDED.crossing_speed,
                        measured_walking_speed_mps = EXCLUDED.measured_walking_speed_mps,
                        measured_crossing_speed_mps = EXCLUDED.measured_crossing_speed_mps,
                        measured_crossing_speed_n = EXCLUDED.measured_crossing_speed_n,
                        pipeline_version = EXCLUDED.pipeline_version,
                        pet_severe_conflicts = EXCLUDED.pet_severe_conflicts,
                        pet_moderate_conflicts = EXCLUDED.pet_moderate_conflicts,
                        pet_queued_interactions = EXCLUDED.pet_queued_interactions,
                        pet_min_s = EXCLUDED.pet_min_s,
                        vehicle_median_speed_mps = EXCLUDED.vehicle_median_speed_mps,
                        vehicle_p85_speed_mps = EXCLUDED.vehicle_p85_speed_mps,
                        mean_headway_s = EXCLUDED.mean_headway_s,
                        platoon_frac = EXCLUDED.platoon_frac,
                        vehicle_flow_per_min = EXCLUDED.vehicle_flow_per_min,
                        anticipatory_start_frac = EXCLUDED.anticipatory_start_frac,
                        mean_red_exposure_s = EXCLUDED.mean_red_exposure_s,
                        hesitation_rate = EXCLUDED.hesitation_rate,
                        aborted_start_rate = EXCLUDED.aborted_start_rate,
                        evasive_event_count = EXCLUDED.evasive_event_count,
                        n_social_groups = EXCLUDED.n_social_groups,
                        grouped_pedestrians = EXCLUDED.grouped_pedestrians,
                        look_before_cross_frac = EXCLUDED.look_before_cross_frac,
                        looked_both_ways_frac = EXCLUDED.looked_both_ways_frac,
                        median_cadence_hz = EXCLUDED.median_cadence_hz,
                        cadence_n = EXCLUDED.cadence_n,
                        data_collected_date = COALESCE(EXCLUDED.data_collected_date, videos.data_collected_date),
                        import_batch_id = EXCLUDED.import_batch_id,
                        last_updated_at = CURRENT_TIMESTAMP,
                        updated_at = CURRENT_TIMESTAMP,
                        -- Preserve first_imported_at if it exists
                        first_imported_at = COALESCE(videos.first_imported_at, CURRENT_TIMESTAMP)
                    RETURNING id, first_imported_at
                `, [
                    videoDataValues.city_id,
                    videoDataValues.link,
                    videoDataValues.video_name,
                    videoDataValues.city_link,
                    videoDataValues.duration_seconds,
                    videoDataValues.total_frames,
                    videoDataValues.analysis_seconds,
                    videoDataValues.total_pedestrians,
                    videoDataValues.total_crossed_pedestrians,
                    videoDataValues.average_age,
                    videoDataValues.phone_usage_ratio,
                    videoDataValues.risky_crossing_ratio,
                    videoDataValues.run_red_light_ratio,
                    videoDataValues.crosswalk_usage_ratio,
                    videoDataValues.traffic_signs_ratio,
                    videoDataValues.total_vehicles,
                    videoDataValues.top3_vehicles,
                    videoDataValues.main_weather,
                    videoDataValues.sidewalk_prob,
                    videoDataValues.crosswalk_prob,
                    videoDataValues.traffic_light_prob,
                    videoDataValues.avg_road_width,
                    videoDataValues.crack_prob,
                    videoDataValues.potholes_prob,
                    videoDataValues.police_car_prob,
                    videoDataValues.arrow_board_prob,
                    videoDataValues.cones_prob,
                    videoDataValues.accident_prob,
                    videoDataValues.crossing_time,
                    videoDataValues.crossing_speed,
                    videoDataValues.measured_walking_speed_mps,
                    videoDataValues.measured_crossing_speed_mps,
                    videoDataValues.measured_crossing_speed_n,
                    videoDataValues.pipeline_version,
                    videoDataValues.pet_severe_conflicts,
                    videoDataValues.pet_moderate_conflicts,
                    videoDataValues.pet_queued_interactions,
                    videoDataValues.pet_min_s,
                    videoDataValues.vehicle_median_speed_mps,
                    videoDataValues.vehicle_p85_speed_mps,
                    videoDataValues.mean_headway_s,
                    videoDataValues.platoon_frac,
                    videoDataValues.vehicle_flow_per_min,
                    videoDataValues.anticipatory_start_frac,
                    videoDataValues.mean_red_exposure_s,
                    videoDataValues.hesitation_rate,
                    videoDataValues.aborted_start_rate,
                    videoDataValues.evasive_event_count,
                    videoDataValues.n_social_groups,
                    videoDataValues.grouped_pedestrians,
                    videoDataValues.look_before_cross_frac,
                    videoDataValues.looked_both_ways_frac,
                    videoDataValues.median_cadence_hz,
                    videoDataValues.cadence_n,
                    videoDataValues.data_collected_date,
                    videoDataValues.import_batch_id,
                    firstImportedAt,
                    importDate,
                    // $59-$61, appended at the end of both the column list and this
                    // array so the existing $1..$58 numbering is untouched (2026-09-07).
                    videoDataValues.risky_crossing_coverage,
                    videoDataValues.unsignalled_crossing_ratio,
                    videoDataValues.duration_source,
                    // $62 (2026-10-10)
                    videoDataValues.code_version
                ]);
                
                // Track update history if video was updated (not first import)
                if (isUpdate) {
                    try {
                        await this.db.query(`
                            INSERT INTO video_update_history (
                                video_id, import_batch_id, updated_at,
                                risky_crossing_ratio, run_red_light_ratio, crosswalk_usage_ratio,
                                total_pedestrians, metrics_snapshot
                            ) VALUES ($1, $2, CURRENT_TIMESTAMP, $3, $4, $5, $6, $7)
                        `, [
                            result.rows[0].id,
                            this.currentImportBatchId,
                            videoDataValues.risky_crossing_ratio,
                            videoDataValues.run_red_light_ratio,
                            videoDataValues.crosswalk_usage_ratio,
                            videoDataValues.total_pedestrians,
                            JSON.stringify(videoDataValues)
                        ]);
                    } catch (historyError) {
                        throw historyError;
                    }
                }
                
                let validity = {};
                if (row.metric_validity) {
                    validity = JSON.parse(row.metric_validity);
                    if (!validity || typeof validity !== 'object' || Array.isArray(validity)) throw new Error('metric_validity must be an object');
                }
                const metadata = {
                    dataset_release_id: this.releaseManifest?.dataset_release_id || null,
                    analysis_run_id: cleanString(row.analysis_run_id),
                    source_video_sha256: cleanString(row.source_video_sha256)?.toLowerCase() || null,
                    analysis_status: cleanString(row.analysis_status) || 'legacy_unverified',
                    searched_city_id: cleanString(row.searched_city_id || row.city_id),
                    verified_city_id: cleanString(row.verified_city_id),
                    eligibility_status: cleanString(row.eligibility_status) || 'unverified',
                    location_verification_source: cleanString(row.location_verification_source),
                    discovery_run_id: cleanString(row.discovery_run_id),
                    sampling_strategy: cleanString(row.sampling_strategy), search_order: cleanString(row.search_order),
                    discovered_at: cleanString(row.discovered_at), analyzed_at: cleanString(row.analyzed_at),
                    analyzed_at_source: cleanString(row.analyzed_at_source),
                    recorded_at: cleanString(row.recorded_at || row.recording_date),
                    recording_date_source: cleanString(row.recording_date_source),
                    clip_start_seconds: safeNumeric(row.clip_start_seconds), clip_end_seconds: safeNumeric(row.clip_end_seconds),
                    eligible_for_comparison: Boolean(this.releaseManifest && safeBoolean(row.eligible_for_comparison)),
                    metric_validity: JSON.stringify(validity),
                };
                for (const column of ['discovered_at', 'analyzed_at', 'recorded_at']) {
                    if (metadata[column] && !Number.isFinite(Date.parse(metadata[column]))) throw new Error(`Invalid ${column} for ${row.link}`);
                }
                const metaColumns = Object.keys(metadata);
                const sourceParameter = metaColumns.indexOf('source_video_sha256') + 1;
                const releaseParameter = metaColumns.indexOf('dataset_release_id') + 1;
                // Coordinates belong to a source snapshot too. A header-only location
                // artifact must not inherit points from a previous clip/release.
                const clearLocation = `$${releaseParameter}::text IS NOT NULL OR source_video_sha256 IS DISTINCT FROM $${sourceParameter}::text`;
                const locationColumns = ['latitude', 'longitude', 'localization_confidence', 'street_name',
                    'localization_status', 'localization_spread_m', 'localization_candidates', 'localization_route',
                    'localization_route_length_m', 'localization_trajectory_source', 'localization_source_video_sha256',
                    'localization_analysis_run_id', 'localization_origin_run_id', 'localized_at'];
                const assignments = metaColumns.map((column, i) => `${column} = $${i + 1}`);
                assignments.push(...locationColumns.map(column => `${column} = CASE WHEN ${clearLocation} THEN NULL ELSE ${column} END`));
                await this.db.query(`UPDATE videos SET ${assignments.join(', ')}
                    WHERE id = $${metaColumns.length + 1}`, [...Object.values(metadata), result.rows[0].id]);
                this.videoCache.set(row.link, result.rows[0].id);
                log(`Video processed: ${row.video_name} (${isUpdate ? 'updated' : 'new'})`);
            } catch (error) {
                throw new Error(`Video import failed: ${row.link}`, { cause: error });
            }
        }
        
        log(`Processed ${videoData.length} videos`);
    }

    async aggregatePedestrians(pedestrianData) {
        log('Aggregating pedestrians data...');
        // Replace the complete partition, including removed tracks and zero-track reruns.
        // The caller owns the transaction and rolls back every change on any failure.
        const videoIds = [...this.videoCache.values()];
        if (videoIds.length) await this.db.query('DELETE FROM pedestrians WHERE video_id = ANY($1::int[])', [videoIds]);
        
        let processed = 0;
        for (const row of pedestrianData) {
            try {
                const videoId = this.videoCache.get(row.link);
                if (!videoId) {
                    throw new Error(`Video not found for pedestrian ${row.track_id}: ${row.link}`);
                }

                const pedestrianData = {
                    video_id: videoId,
                    track_id: safeInteger(row.track_id),
                    crossed: safeBoolean(row.crossed),
                    nearby_count_beginning: safeInteger(row.nearby_count_beginning),
                    nearby_count_whole: safeInteger(row.nearby_count_whole),
                    risky_crossing: safeBoolean(row.risky_crossing),
                    run_red_light: safeBoolean(row.run_red_light),
                    crosswalk_use_or_not: safeBoolean(row.crosswalk_use_or_not),
                    gender: cleanString(row.gender),
                    age: safeAge(row.age),
                    phone_using: safeBoolean(row.phone_using),
                    backpack: safeBoolean(row.backpack),
                    umbrella: safeBoolean(row.umbrella),
                    handbag: safeBoolean(row.handbag),
                    suitcase: safeBoolean(row.suitcase),
                    short_sleeved_shirt: safeBoolean(row.short_sleeved_shirt),
                    long_sleeved_shirt: safeBoolean(row.long_sleeved_shirt),
                    short_sleeved_outwear: safeBoolean(row.short_sleeved_outwear),
                    long_sleeved_outwear: safeBoolean(row.long_sleeved_outwear),
                    vest: safeBoolean(row.vest),
                    sling: safeBoolean(row.sling),
                    shorts: safeBoolean(row.shorts),
                    trousers: safeBoolean(row.trousers),
                    skirt: safeBoolean(row.skirt),
                    short_sleeved_dress: safeBoolean(row.short_sleeved_dress),
                    long_sleeved_dress: safeBoolean(row.long_sleeved_dress),
                    vest_dress: safeBoolean(row.vest_dress),
                    sling_dress: safeBoolean(row.sling_dress),
                    weather: cleanString(row.weather),
                    daytime: safeBoolean(row.daytime),
                    police_car: safeBoolean(row.police_car),
                    arrow_board: safeBoolean(row.arrow_board),
                    cones: safeBoolean(row.cones),
                    accident: safeBoolean(row.accident),
                    crack: safeBoolean(row.crack),
                    potholes: safeBoolean(row.potholes),
                    avg_vehicle_total: safeInteger(row.avg_vehicle_total),
                    crossing_sign: safeBoolean(row.crossing_sign),
                    avg_road_width: safeNumeric(row.avg_road_width),
                    crosswalk: safeBoolean(row.crosswalk),
                    sidewalk: safeBoolean(row.sidewalk),
                    // Vehicle types
                    ambulance: safeBoolean(row.ambulance),
                    army_vehicle: safeBoolean(row['army vehicle']),
                    auto_rickshaw: safeBoolean(row['auto rickshaw']),
                    bicycle: safeBoolean(row.bicycle),
                    bus: safeBoolean(row.bus),
                    car: safeBoolean(row.car),
                    garbagevan: safeBoolean(row.garbagevan),
                    human: safeBoolean(row.human),
                    hauler: safeBoolean(row.hauler),
                    minibus: safeBoolean(row.minibus),
                    minivan: safeBoolean(row.minivan),
                    motorbike: safeBoolean(row.motorbike),
                    pickup: safeBoolean(row.pickup),
                    policecar: safeBoolean(row.policecar),
                    rickshaw: safeBoolean(row.rickshaw),
                    scooter: safeBoolean(row.scooter),
                    suv: safeBoolean(row.suv),
                    taxi: safeBoolean(row.taxi),
                    three_wheelers_cng: safeBoolean(row['three wheelers -CNG-']),
                    truck: safeBoolean(row.truck),
                    van: safeBoolean(row.van),
                    wheelbarrow: safeBoolean(row.wheelbarrow),
                    // The real detector class is the single column "human hauler". The legacy
                    // 'human' / 'hauler' columns above are an old split of that name and are
                    // ALWAYS empty in every CSV (0/1119 rows populated), so they inserted NULL
                    // and the flag never reached the database. They are kept mapped as-is for
                    // backward compatibility; this is the column that actually carries data.
                    human_hauler: safeBoolean(row['human hauler']),
                    // Per-pedestrian measured speeds from PedX-Insight [S1]. Present in
                    // all_pedestrian_info.csv but previously dropped at the DB boundary.
                    // NULL for pedestrians with no reliable trajectory — refuse, don't fabricate.
                    walking_speed_mps: safeNumeric(row.walking_speed_mps),
                    crossing_speed_mps: safeNumeric(row.crossing_speed_mps),
                    decision_delay_s: safeNumeric(row.decision_delay_s)
                };

                const columns = Object.keys(pedestrianData);
                const placeholders = columns.map((_, index) => `$${index + 1}`);
                await this.db.query(
                    `INSERT INTO pedestrians (${columns.join(', ')}) VALUES (${placeholders.join(', ')})`,
                    Object.values(pedestrianData)
                );
                
                processed++;
                if (processed % 100 === 0) {
                    log(`Processed ${processed} pedestrians...`);
                }
            } catch (error) {
                throw new Error(`Pedestrian import failed: ${row.link}/${row.track_id}`, { cause: error });
            }
        }
        
        log(`Processed ${processed} pedestrians`);
    }

    // Analytics aggregation with improved structure
    async aggregateAnalytics() {
        log('Aggregating analytics data...');
        const registryPath = path.join(this.csvDir, 'metrics_registry.json');
        if (this.releaseManifest && fs.existsSync(registryPath)) {
            const registry = JSON.parse(fs.readFileSync(registryPath, 'utf8'));
            if (!registry || typeof registry !== 'object' || Array.isArray(registry)) throw new Error('Invalid metric validity registry');
            await this.db.query('DELETE FROM dataset_statistics WHERE dataset_release_id = $1 AND file_name = $2', [this.releaseManifest.dataset_release_id, 'metrics_registry.json']);
            await this.db.query('INSERT INTO dataset_statistics(dataset_release_id, file_name, row_number, payload) VALUES ($1, $2, 0, $3::jsonb)', [this.releaseManifest.dataset_release_id, 'metrics_registry.json', JSON.stringify(registry)]);
        }
        
        const statsFiles = [
            'accident_road_condition_stats.csv',
            'age_stats.csv',
            'carried_items_stats.csv',
            'clothing_stats.csv',
            'continent_stats.csv',
            'crossing_stats.csv',
            'crosswalk_coeff.csv',
            'gender_stats.csv',
            'phone_stats.csv',
            'road_corr.csv',
            'time_stats.csv',
            'vehicle_stats.csv',
            'weather_daytime_stats.csv',
            'inferential_associations.csv',
            'city_correlations.csv'
        ];

        for (const filename of statsFiles) {
            const filePath = path.join(this.csvDir, filename);
            if (!fs.existsSync(filePath)) {
                log(`Stats file not found: ${filename}`);
                continue;
            }

            try {
                const data = await readCSV(filePath);
                await this.processStatsFile(filename, data);
            } catch (error) {
                throw new Error(`Statistics import failed: ${filename}`, { cause: error });
            }
        }
    }

    async processStatsFile(filename, data) {
        log(`Processing stats file: ${filename}`);
        if (this.releaseManifest) {
            const release = this.releaseManifest.dataset_release_id;
            await this.db.query('DELETE FROM dataset_statistics WHERE dataset_release_id = $1 AND file_name = $2', [release, filename]);
            for (let index = 0; index < data.length; index++) {
                await this.db.query('INSERT INTO dataset_statistics(dataset_release_id, file_name, row_number, payload) VALUES ($1, $2, $3, $4::jsonb)', [release, filename, index + 1, JSON.stringify(data[index])]);
            }
        }

        // Idempotency: facts have no unique constraint, so re-running the aggregator
        // would duplicate every row. Replace this file's facts wholesale (scoped by
        // data_source) before inserting the fresh ones.
        await this.db.query('DELETE FROM analytics_facts WHERE data_source = $1', [filename]);

        for (const row of data) {
            try {
                // Process each column in the row
                for (const [columnName, value] of Object.entries(row)) {
                    if (!value || value === '') continue;
                    
                    // Determine fact type and metric name based on column
                    const factConfig = this.getFactConfig(filename, columnName, value, row);
                    if (!factConfig) continue;
                    
                    // Get or create dimension
                    const dimensionId = await this.getOrCreateDimension(factConfig.dimensionType, factConfig.dimensionValue);
                    
                    // Insert fact
                    await this.db.query(`
                        INSERT INTO analytics_facts (
                            fact_type, metric_name, dimension_id, value_numeric, 
                            value_percentage, correlation_coefficient, sample_size, data_source
                        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
                    `, [
                        factConfig.factType,
                        factConfig.metricName,
                        dimensionId,
                        factConfig.valueNumeric,
                        factConfig.valuePercentage,
                        factConfig.correlationCoefficient,
                        factConfig.sampleSize,
                        filename
                    ]);
                }
            } catch (error) {
                throw new Error(`Statistics row import failed: ${filename}`, { cause: error });
            }
        }
    }

    getFactConfig(filename, columnName, value, row = {}) {
        const numericValue = safeNumeric(value);
        if (numericValue === null) return null;

        // Define mappings for different file types
        const configs = {
            'accident_road_condition_stats.csv': {
                dimensionColumn: 'environment_factor',
                metrics: {
                    'risky_crossing_rate(%)': { factType: 'statistic', metricName: 'risky_crossing_rate', valuePercentage: numericValue },
                    'run_red_light_rate(%)': { factType: 'statistic', metricName: 'run_red_light_rate', valuePercentage: numericValue }
                }
            },
            'age_stats.csv': {
                dimensionColumn: 'age',
                metrics: {
                    'risky_crossing': { factType: 'statistic', metricName: 'risky_crossing_rate', valueNumeric: numericValue },
                    'run_red_light': { factType: 'statistic', metricName: 'run_red_light_rate', valueNumeric: numericValue }
                }
            },
            'carried_items_stats.csv': {
                dimensionColumn: 'accessory',
                metrics: {
                    'risky_crossing_rate(%)': { factType: 'statistic', metricName: 'risky_crossing_rate', valuePercentage: numericValue },
                    'run_red_light_rate(%)': { factType: 'statistic', metricName: 'run_red_light_rate', valuePercentage: numericValue }
                }
            },
            'clothing_stats.csv': {
                dimensionColumn: 'clothing_type',
                metrics: {
                    'risky_crossing_rate(%)': { factType: 'statistic', metricName: 'risky_crossing_rate', valuePercentage: numericValue },
                    'run_red_light_rate(%)': { factType: 'statistic', metricName: 'run_red_light_rate', valuePercentage: numericValue }
                }
            },
            'continent_stats.csv': {
                dimensionColumn: 'continent',
                metrics: {
                    'run_red_light_rate(%)': { factType: 'statistic', metricName: 'run_red_light_rate', valuePercentage: numericValue },
                    'risky_crossing_rate(%)': { factType: 'statistic', metricName: 'risky_crossing_rate', valuePercentage: numericValue }
                }
            },
            'crossing_stats.csv': {
                dimensionColumn: 'continent',
                metrics: {
                    'avg_decision_time': { factType: 'average', metricName: 'decision_time', valueNumeric: numericValue },
                    'avg_crossing_speed': { factType: 'average', metricName: 'crossing_speed', valueNumeric: numericValue }
                }
            },
            'crosswalk_coeff.csv': {
                dimensionColumn: 'continent',
                metrics: {
                    'crosswalk_usage_ratio': { factType: 'ratio', metricName: 'crosswalk_usage', valueNumeric: numericValue },
                    'crosswalk_prob': { factType: 'probability', metricName: 'crosswalk_presence', valueNumeric: numericValue },
                    'crosswalk_coeff': { factType: 'coefficient', metricName: 'crosswalk_coefficient', valueNumeric: numericValue }
                }
            },
            'gender_stats.csv': {
                dimensionColumn: 'gender',
                metrics: {
                    'risky_crossing': { factType: 'statistic', metricName: 'risky_crossing_rate', valueNumeric: numericValue },
                    'run_red_light': { factType: 'statistic', metricName: 'run_red_light_rate', valueNumeric: numericValue }
                }
            },
            'phone_stats.csv': {
                dimensionColumn: 'accessory',
                metrics: {
                    'risky_crossing_rate(%)': { factType: 'statistic', metricName: 'risky_crossing_rate', valuePercentage: numericValue },
                    'run_red_light_rate(%)': { factType: 'statistic', metricName: 'run_red_light_rate', valuePercentage: numericValue }
                }
            },
            'road_corr.csv': {
                dimensionColumn: 'index',
                metrics: {
                    'risky_crossing': { factType: 'correlation', metricName: 'risky_crossing_correlation', correlationCoefficient: numericValue },
                    'run_red_light': { factType: 'correlation', metricName: 'run_red_light_correlation', correlationCoefficient: numericValue }
                }
            },
            'time_stats.csv': {
                dimensionColumn: 'index',
                metrics: {
                    'duration_minutes': { factType: 'average', metricName: 'duration_minutes', valueNumeric: numericValue },
                    'analysis_minutes': { factType: 'average', metricName: 'analysis_minutes', valueNumeric: numericValue }
                }
            },
            'vehicle_stats.csv': {
                dimensionColumn: 'vehicle_type',
                metrics: {
                    'risky_crossing_rate(%)': { factType: 'statistic', metricName: 'risky_crossing_rate', valuePercentage: numericValue },
                    'run_red_light_rate(%)': { factType: 'statistic', metricName: 'run_red_light_rate', valuePercentage: numericValue }
                }
            },
            'weather_daytime_stats.csv': {
                dimensionColumn: 'weather_daytime',
                metrics: {
                    'run_red_light_prob': { factType: 'probability', metricName: 'run_red_light_rate', valuePercentage: numericValue },
                    'risky_crossing_prob': { factType: 'probability', metricName: 'risky_crossing_rate', valuePercentage: numericValue }
                }
            }
        };

        const fileConfig = configs[filename];
        if (!fileConfig) return null;

        const metricConfig = fileConfig.metrics[columnName];
        if (!metricConfig) return null;

        return {
            dimensionType: this.getDimensionType(filename),
            dimensionValue: this.getDimensionValue(row, fileConfig.dimensionColumn),
            ...metricConfig
        };
    }

    getDimensionType(filename) {
        const typeMap = {
            'accident_road_condition_stats.csv': 'environment_factor',
            'age_stats.csv': 'age',
            'gender_stats.csv': 'gender',
            'clothing_stats.csv': 'clothing_type',
            'weather_daytime_stats.csv': 'weather_daytime',
            'road_corr.csv': 'road_metric',
            'continent_stats.csv': 'continent',
            'vehicle_stats.csv': 'vehicle_type',
            'phone_stats.csv': 'phone_usage',
            'carried_items_stats.csv': 'carried_item',
            'crossing_stats.csv': 'crossing_behavior',
            'crosswalk_coeff.csv': 'crosswalk_metric',
            'time_stats.csv': 'time_metric'
        };
        return typeMap[filename] || 'unknown';
    }

    getDimensionValue(row, dimensionColumn) {
        // Only weather_daytime is a genuine composite (built from the weather + daytime
        // columns). Splitting every '_'-containing column name broke real single columns
        // like vehicle_type / clothing_type / environment_factor, whose rows have no
        // 'vehicle'/'type'/... parts — their dimension values silently became ''.
        if (dimensionColumn === 'weather_daytime' && row[dimensionColumn] === undefined) {
            const parts = dimensionColumn.split('_');
            return parts.map(part => row[part]).filter(Boolean).join('_');
        }
        return row[dimensionColumn];
    }

    async getOrCreateDimension(dimensionType, dimensionValue) {
        try {
            // Try to get existing dimension
            const existing = await this.db.query(
                'SELECT id FROM analytics_dimensions WHERE dimension_type = $1 AND dimension_value = $2',
                [dimensionType, dimensionValue]
            );

            if (existing.rows.length > 0) {
                return existing.rows[0].id;
            }

            // Create new dimension
            const result = await this.db.query(`
                INSERT INTO analytics_dimensions (dimension_type, dimension_value, description)
                VALUES ($1, $2, $3)
                ON CONFLICT (dimension_type, dimension_value)
                DO UPDATE SET description = EXCLUDED.description
                RETURNING id
            `, [dimensionType, dimensionValue, `Auto-generated dimension for ${dimensionType}: ${dimensionValue}`]);

            return result.rows[0].id;
        } catch (error) {
            throw new Error(`Dimension import failed: ${dimensionType}:${dimensionValue}`, { cause: error });
        }
    }

    async generateSummary() {
        log('Generating summary statistics...');
        
        try {
            const summary = await this.db.query(`
                SELECT 
                    (SELECT COUNT(*) FROM cities) as total_cities,
                    (SELECT COUNT(*) FROM videos) as total_videos,
                    (SELECT COUNT(*) FROM pedestrians) as total_pedestrians,
                    (SELECT COUNT(*) FROM analytics_dimensions) as total_dimensions,
                    (SELECT COUNT(*) FROM analytics_facts) as total_facts,
                    (SELECT COUNT(*) FROM import_batches) as total_import_batches,
                    (SELECT MAX(import_date) FROM import_batches) as latest_import_date
            `);
            
            console.log('\n=== AGGREGATION SUMMARY ===');
            console.log(`Cities: ${summary.rows[0].total_cities}`);
            console.log(`Videos: ${summary.rows[0].total_videos}`);
            console.log(`Pedestrians: ${summary.rows[0].total_pedestrians}`);
            console.log(`Analytics Dimensions: ${summary.rows[0].total_dimensions}`);
            console.log(`Analytics Facts: ${summary.rows[0].total_facts}`);
            console.log(`Import Batches: ${summary.rows[0].total_import_batches}`);
            console.log(`Latest Import: ${summary.rows[0].latest_import_date || 'N/A'}`);
            console.log('===========================\n');
        } catch (error) {
            throw error;
        }
    }

    async close() {
        if (this.db === pool) await pool.end();
    }
}

// Full releases inject one dedicated client into every publishing step.
async function main() {
    const client = await pool.connect();
    const aggregator = new DatabaseAggregator({ db: client });
    try {
        await client.query('BEGIN');
        await assertStandaloneImportAllowed(client);
        await aggregator.initialize();
        await aggregator.aggregateCoreData();
        await aggregator.aggregateAnalytics();
        await client.query('SELECT refresh_materialized_views()');
        await aggregator.generateSummary();
        await client.query('COMMIT');
        console.log('Data aggregation completed successfully.');
    } catch (error) {
        await client.query('ROLLBACK');
        throw error;
    } finally {
        client.release();
        await pool.end();
    }
}
if (require.main === module) {
    main().catch(error => { console.error('Aggregation failed:', error); process.exitCode = 1; });
}
module.exports = DatabaseAggregator;
module.exports.readCSV = readCSV;
module.exports.safeBoolean = safeBoolean;
