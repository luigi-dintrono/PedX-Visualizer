#!/usr/bin/env node
// Validate an immutable release before opening a database connection, then publish
// core rows, coordinates, analytics and generated text on one dedicated client.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { parse } = require('csv-parse/sync');
const { validateCoreRows } = require('./lib/import-contract');

const PUBLISH_LOCK = 1735025711;
const CORE_COLUMNS = {
  'all_video_info.csv': ['link', 'city', 'city_id', 'analysis_run_id', 'analysis_status', 'source_video_sha256',
    'eligible_for_comparison', 'metric_validity', 'analyzed_at', 'analyzed_at_source',
    'eligibility_status', 'verified_city_id', 'location_verification_source'],
  'all_pedestrian_info.csv': ['link', 'track_id', 'analysis_run_id'],
  'all_time_info.csv': ['link', 'analysis_seconds'],
  'all_video_locations.csv': ['link', 'status', 'lat', 'lon'],
};
const ANALYTICS_FILES = [
  'accident_road_condition_stats.csv', 'age_stats.csv', 'carried_items_stats.csv',
  'clothing_stats.csv', 'continent_stats.csv', 'crossing_stats.csv', 'crosswalk_coeff.csv',
  'gender_stats.csv', 'phone_stats.csv', 'road_corr.csv', 'time_stats.csv',
  'vehicle_stats.csv', 'weather_daytime_stats.csv',
];
const digest = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const METRIC_STATUSES = new Set(['validated', 'experimental', 'unknown', 'invalid', 'invalid_legacy', 'reference_only']);

function requiredText(value, label) {
  const text = String(value ?? '').trim();
  if (!text || /^(?:null|none|nan|<na>)$/i.test(text)) throw new Error(`Missing ${label}`);
  return text;
}

function validTimestamp(value) {
  const text = String(value ?? '').trim();
  const fields = text.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,9})?(Z|[+-]\d{2}:\d{2})$/);
  if (!fields || !Number.isFinite(Date.parse(text))) return false;
  const [year, month, day, hour, minute, second] = fields.slice(1, 7).map(Number);
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return month >= 1 && month <= 12 && day >= 1 && day <= days[month - 1] && hour < 24 && minute < 60 && second < 60;
}

function eligibilityFlag(value, link) {
  const token = String(value ?? '').trim().toLowerCase();
  if (/^(?:true|1(?:\.0+)?)$/.test(token)) return true;
  if (/^(?:false|0(?:\.0+)?)$/.test(token)) return false;
  throw new Error(`Invalid eligible_for_comparison flag for ${link}`);
}

function canonicalTrackId(token) {
  if (token.length > 128) return null;
  const match = token.match(/^\+?(?:(\d+)(?:\.(\d*))?|\.(\d+))(?:[eE]([+-]?\d+))?$/);
  if (!match) return null;
  const exponent = Number(match[4] || 0);
  if (!Number.isSafeInteger(exponent) || Math.abs(exponent) > 1000) return null;
  const fraction = match[2] ?? match[3] ?? '';
  let coefficient = BigInt((match[1] || '0') + fraction);
  const scale = fraction.length - exponent;
  if (scale > 0) {
    const divisor = 10n ** BigInt(scale);
    if (coefficient % divisor !== 0n) return null;
    coefficient /= divisor;
  } else if (scale < 0) {
    coefficient *= 10n ** BigInt(-scale);
  }
  return coefficient <= 2147483647n ? Number(coefficient) : null;
}

function validateProducerMetadata(videos, pedestrians) {
  const parents = new Map();
  for (const row of videos) {
    const link = requiredText(row.link, 'video identity');
    const cityId = requiredText(row.city_id, `city_id for ${link}`);
    const runId = requiredText(row.analysis_run_id, `analysis_run_id for ${link}`);
    if (!/^[a-f0-9]{64}$/i.test(row.source_video_sha256 || '')) throw new Error(`Invalid source_video_sha256 for ${link}`);
    if (String(row.analysis_status).trim() !== 'complete') throw new Error(`Activated video must have complete analysis: ${link}`);
    if (!validTimestamp(row.analyzed_at)) throw new Error(`Invalid analyzed_at timestamp for ${link}`);
    const source = requiredText(row.analyzed_at_source, `analyzed_at_source for ${link}`);
    if (!['run_manifest', 'mode_provenance'].includes(source)) {
      throw new Error(`Analysis timestamp source must be run_manifest or mode_provenance: ${link}`);
    }
    let validity;
    try { validity = JSON.parse(row.metric_validity); } catch { throw new Error(`Invalid metric_validity JSON for ${link}`); }
    if (!validity || typeof validity !== 'object' || Array.isArray(validity)) throw new Error(`metric_validity must be an object: ${link}`);
    for (const [metric, policy] of Object.entries(validity)) {
      if (!policy || typeof policy !== 'object' || Array.isArray(policy) || !METRIC_STATUSES.has(policy.status)) {
        throw new Error(`Invalid metric_validity policy for ${link}/${metric}`);
      }
    }
    const eligible = eligibilityFlag(row.eligible_for_comparison, link);
    const eligibility = requiredText(row.eligibility_status, `eligibility_status for ${link}`);
    if (eligible) {
      const verified = requiredText(row.verified_city_id, `verified_city_id for ${link}`);
      const evidence = requiredText(row.location_verification_source, `location_verification_source for ${link}`);
      if (eligibility !== 'verified' || verified !== cityId || /^(?:unknown|unverified|unavailable)$/i.test(evidence)) {
        throw new Error(`Eligible video lacks consistent verified location evidence: ${link}`);
      }
    }
    parents.set(link, runId);
  }
  const canonicalTracks = new Set();
  for (const row of pedestrians) {
    const link = String(row.link ?? '').trim();
    const idToken = String(row.track_id ?? '').trim();
    const trackId = canonicalTrackId(idToken);
    if (trackId == null) {
      throw new Error(`Invalid canonical track identity: ${link}/${idToken}`);
    }
    const key = `${link}/${trackId}`;
    if (canonicalTracks.has(key)) throw new Error(`Duplicate canonical track identity: ${key}`);
    canonicalTracks.add(key);
    const runId = requiredText(row.analysis_run_id, `pedestrian analysis_run_id for ${link}/${idToken}`);
    if (!parents.has(link) || parents.get(link) !== runId) {
      throw new Error(`Pedestrian analysis_run_id does not match parent video: ${link}/${idToken}`);
    }
  }
}

function databaseConfig(env = process.env) {
  return { connectionString: env.DATABASE_URL,
    ssl: (env.DATABASE_URL || '').includes('sslmode=require') || env.NODE_ENV === 'production'
      ? { rejectUnauthorized: env.DB_SSL_INSECURE !== '1' } : false };
}

function artifactPath(value) {
  if (typeof value !== 'string' || !value || path.isAbsolute(value) ||
      /^[a-z]:/i.test(value) || value.includes('\\') ||
      value.split('/').some(part => !part || part === '.' || part === '..' || !/^[\w.-]+$/.test(part))) {
    throw new Error(`Unsafe release artifact path: ${value}`);
  }
  return value;
}

function validateRelease(csvDir, manifestPath = path.join(csvDir, 'release_manifest.json')) {
  const root = fs.realpathSync(csvDir);
  const manifestBytes = fs.readFileSync(manifestPath);
  const manifest = JSON.parse(manifestBytes.toString('utf8'));
  if (manifest.schema_version !== 1) throw new Error('Release schema_version must be 1');
  if (manifest.legacy_audit_only === true) throw new Error('Audit-only releases cannot be published');
  if (manifest.legacy_audit_only != null && typeof manifest.legacy_audit_only !== 'boolean') {
    throw new Error('legacy_audit_only must be a boolean');
  }
  if (manifest.statistics_scope != null && manifest.statistics_scope !== 'eligible') {
    throw new Error('Published statistics must describe the eligible population');
  }
  if (manifest.statistics_population != null) {
    const population = manifest.statistics_population;
    if (population.eligible_only !== true || population.metric_specific_denominators !== true ||
        population.invalid_excluded !== true || !Array.isArray(population.allowed_metric_statuses) ||
        !population.allowed_metric_statuses.length || population.allowed_metric_statuses.some(status =>
          !['validated', 'experimental', 'unknown'].includes(status))) {
      throw new Error('Invalid statistics population declaration');
    }
  }
  if (typeof manifest.dataset_release_id !== 'string' ||
      !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/.test(manifest.dataset_release_id)) {
    throw new Error('Release dataset_release_id is missing or invalid');
  }
  if (typeof manifest.created_at !== 'string' || !/(Z|[+-]\d\d:\d\d)$/.test(manifest.created_at) ||
      !Number.isFinite(Date.parse(manifest.created_at))) throw new Error('Release created_at must be an ISO timestamp with timezone');
  if (!Array.isArray(manifest.files) || !manifest.files.length) throw new Error('Release files must be a nonempty array');
  const files = new Map();
  const csvRows = new Map();
  const realPaths = new Set();
  for (const entry of manifest.files) {
    const name = artifactPath(entry.path);
    if (files.has(name)) throw new Error(`Duplicate release artifact: ${name}`);
    if (!/^[a-f0-9]{64}$/i.test(entry.sha256 || '')) throw new Error(`Invalid SHA256 for ${name}`);
    const fullPath = fs.realpathSync(path.join(root, name));
    const relative = path.relative(root, fullPath);
    if (relative.startsWith('..') || path.isAbsolute(relative) || realPaths.has(fullPath)) {
      throw new Error(`Artifact escapes release directory or aliases another file: ${name}`);
    }
    realPaths.add(fullPath);
    const bytes = fs.readFileSync(fullPath);
    if (digest(bytes) !== entry.sha256.toLowerCase()) throw new Error(`Checksum mismatch: ${name}`);
    if (name.endsWith('.csv')) {
      if (!Number.isSafeInteger(entry.rows) || entry.rows < 0 || !Array.isArray(entry.columns) ||
          !entry.columns.length || entry.columns.some(column => typeof column !== 'string' || !column.trim()) ||
          new Set(entry.columns).size !== entry.columns.length) throw new Error(`Invalid CSV metadata: ${name}`);
      const records = parse(bytes, { bom: true, skip_empty_lines: true, relax_column_count: false });
      const header = records.shift();
      if (JSON.stringify(header) !== JSON.stringify(entry.columns)) throw new Error(`CSV header mismatch: ${name}`);
      if (records.length !== entry.rows) throw new Error(`CSV row count mismatch: ${name}`);
      const rows = records.map(record => Object.fromEntries(header.map((key, i) => [key, record[i]])));
      for (const column of CORE_COLUMNS[name] || []) {
        if (!header.includes(column)) throw new Error(`Missing required column ${column}: ${name}`);
      }
      if (header.includes('dataset_release_id') && rows.some(row => row.dataset_release_id !== manifest.dataset_release_id)) {
        throw new Error(`Mixed dataset_release_id values: ${name}`);
      }
      csvRows.set(name, rows);
    } else if (name.endsWith('.json')) {
      JSON.parse(bytes.toString('utf8'));
    }
    files.set(name, bytes);
  }
  for (const name of Object.keys(CORE_COLUMNS)) {
    if (!csvRows.has(name)) throw new Error(`Required core artifact missing: ${name}`);
  }
  const optional = new Map();
  if (manifest.optional_artifacts != null && !Array.isArray(manifest.optional_artifacts)) {
    throw new Error('optional_artifacts must be an array');
  }
  for (const item of manifest.optional_artifacts || []) {
    const name = artifactPath(item.path);
    if (optional.has(name) || files.has(name) || Object.hasOwn(CORE_COLUMNS, name) ||
        typeof item.status !== 'string' || !item.status.trim() ||
        typeof item.reason !== 'string' || !item.reason.trim()) throw new Error(`Invalid optional artifact declaration: ${name}`);
    optional.set(name, item);
  }
  for (const name of ANALYTICS_FILES) {
    if (!files.has(name) && !optional.has(name)) throw new Error(`Analytics artifact must be present or explicitly omitted: ${name}`);
  }
  if (ANALYTICS_FILES.some(name => files.has(name)) &&
      (manifest.statistics_scope !== 'eligible' || manifest.statistics_population == null)) {
    throw new Error('Analytics artifacts require an explicit eligible statistics population');
  }
  // The directory is a staged release, not a mutable collection of historical CSVs.
  for (const name of fs.readdirSync(root)) {
    if (name.endsWith('.csv') && !files.has(name)) throw new Error(`Unlisted CSV in release directory: ${name}`);
  }
  const videos = csvRows.get('all_video_info.csv');
  if (!videos.length) throw new Error('Release must contain at least one video');
  validateProducerMetadata(videos, csvRows.get('all_pedestrian_info.csv'));
  const counts = validateCoreRows(videos, csvRows.get('all_pedestrian_info.csv'));
  const links = new Set(videos.map(row => row.link.trim()));
  const sourceVideos = new Map(videos.map(row => [row.link.trim(), row]));
  for (const name of ['all_time_info.csv', 'all_video_locations.csv']) {
    const seen = new Set();
    for (const row of csvRows.get(name)) {
      const link = String(row.link || '').trim();
      const status = String(row.status || '').trim();
      if (!links.has(link) || seen.has(link)) throw new Error(`Absent or duplicate video reference in ${name}: ${link}`);
      seen.add(link);
      if (name === 'all_time_info.csv' && (!String(row.analysis_seconds).trim() ||
          !Number.isFinite(Number(row.analysis_seconds)) || Number(row.analysis_seconds) < 0)) {
        throw new Error(`Invalid analysis_seconds for ${link}`);
      }
      if (name === 'all_video_locations.csv' && status === 'ok' &&
          (!String(row.lat).trim() || !String(row.lon).trim() ||
           !Number.isFinite(Number(row.lat)) || !Number.isFinite(Number(row.lon)) ||
           Math.abs(Number(row.lat)) > 90 || Math.abs(Number(row.lon)) > 180)) {
        throw new Error(`Invalid successful localization for ${link}`);
      }
      if (name === 'all_video_locations.csv' && status === 'ok') {
        const parent = sourceVideos.get(link);
        if (String(row.analysis_run_id || '').trim() !== String(parent.analysis_run_id).trim()) {
          throw new Error(`Localization analysis_run_id does not match parent video: ${link}`);
        }
        if (!/^[a-f0-9]{64}$/i.test(row.source_video_sha256 || '') ||
            row.source_video_sha256.toLowerCase() !== parent.source_video_sha256.toLowerCase()) {
          throw new Error(`Localization source_video_sha256 does not match analyzed clip: ${link}`);
        }
        if (String(row.localized_at || '').trim() && !validTimestamp(row.localized_at)) {
          throw new Error(`Invalid localized_at timestamp for ${link}`);
        }
      } else if (name === 'all_video_locations.csv' && (String(row.lat || '').trim() || String(row.lon || '').trim())) {
        throw new Error(`Non-ok localization must not contain coordinates: ${link}`);
      }
    }
  }
  return { manifest, manifestBytes, manifestSha256: digest(manifestBytes), files,
    omittedAnalytics: ANALYTICS_FILES.filter(name => !files.has(name)), counts };
}

function snapshotRelease(validated) {
  const snapshot = fs.mkdtempSync(path.join(os.tmpdir(), 'pedx-validated-release-'));
  try {
    for (const [name, bytes] of validated.files) {
      const target = path.join(snapshot, name);
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.writeFileSync(target, bytes);
    }
    fs.writeFileSync(path.join(snapshot, 'release_manifest.json'), validated.manifestBytes);
    return snapshot;
  } catch (error) {
    fs.rmSync(snapshot, { recursive: true, force: true });
    throw error;
  }
}

async function publishRelease(options = {}) {
  const csvDir = path.resolve(options.csvDir || process.env.PEDX_CSV_DIR || path.join(__dirname, '..', 'summary_data'));
  const validated = validateRelease(csvDir, options.manifestPath);
  if (options.validateOnly) return { dataset_release_id: validated.manifest.dataset_release_id, validated: true, ...validated.counts };
  const snapshot = snapshotRelease(validated);
  let db = options.db;
  const ownsClient = !db;
  let began = false;
  try {
    if (!db) {
      const createClient = options.createClient || (() => {
        require('dotenv').config({ path: process.env.PEDX_ENV_FILE || '.env.local' });
        require('dotenv').config();
        if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is not set');
        const { Client } = require('pg');
        return new Client(databaseConfig());
      });
      db = await createClient();
      await db.connect();
    }
    const Aggregator = options.Aggregator || require('./aggregate-csv-data');
    const coordinates = options.importCoordinates || require('./import-video-coordinates').importVideoCoordinates;
    const insights = options.generateInsights || require('./generate-city-insights').generateInsights;
    await db.query('BEGIN');
    began = true;
    await db.query('SELECT pg_advisory_xact_lock($1)', [PUBLISH_LOCK]);
    const prior = await db.query('SELECT manifest_sha256 FROM dataset_releases WHERE dataset_release_id = $1',
      [validated.manifest.dataset_release_id]);
    if (prior.rows.length && prior.rows[0].manifest_sha256 !== validated.manifestSha256) {
      throw new Error('A dataset_release_id cannot be reused with a different manifest');
    }
    await db.query(`INSERT INTO dataset_releases
      (dataset_release_id, schema_version, manifest_sha256, manifest, created_at)
      VALUES ($1, $2, $3, $4::jsonb, $5::timestamptz) ON CONFLICT (dataset_release_id) DO NOTHING`,
    [validated.manifest.dataset_release_id, 1, validated.manifestSha256, JSON.stringify(validated.manifest), validated.manifest.created_at]);
    const aggregator = new Aggregator({ db, csvDir: snapshot, releaseManifest: validated.manifest });
    await aggregator.initialize();
    await aggregator.aggregateCoreData();
    if (validated.omittedAnalytics.length) {
      await db.query('DELETE FROM analytics_facts WHERE data_source = ANY($1::text[])', [validated.omittedAnalytics]);
    }
    await aggregator.aggregateAnalytics();
    await coordinates({ db, csvPath: path.join(snapshot, 'all_video_locations.csv'), dryRun: false });
    // Fits are a separate release-aware operation. Never expose a previous release's
    // intervals while publishing new denominators, even if Python is unavailable.
    await db.query('DELETE FROM city_metric_estimates');
    // Queries and generated text select the active release. Activate it inside
    // this transaction before deriving those views/text; external readers still
    // see the previous activation until the final COMMIT.
    await db.query('UPDATE dataset_releases SET is_active = FALSE WHERE is_active');
    await db.query(`UPDATE dataset_releases SET is_active = TRUE, activated_at = CURRENT_TIMESTAMP,
      model_status = 'unavailable_for_release' WHERE dataset_release_id = $1`, [validated.manifest.dataset_release_id]);
    await db.query('SELECT refresh_materialized_views()');
    await insights({ db, dryRun: false });
    await db.query('SELECT refresh_materialized_views()');
    await db.query('COMMIT');
    began = false;
    return { dataset_release_id: validated.manifest.dataset_release_id, manifest_sha256: validated.manifestSha256,
      model_status: 'unavailable_for_release', ...validated.counts };
  } catch (error) {
    if (began) {
      try { await db.query('ROLLBACK'); } catch (rollbackError) { error.rollbackError = rollbackError; }
    }
    throw error;
  } finally {
    try { if (ownsClient && db) await db.end(); }
    finally { fs.rmSync(snapshot, { recursive: true, force: true }); }
  }
}

async function main(argv = process.argv.slice(2)) {
  const options = {};
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--validate-only') options.validateOnly = true;
    else if (argv[i] === '--csv-dir' || argv[i] === '--manifest') {
      if (!argv[i + 1] || argv[i + 1].startsWith('--')) throw new Error(`Missing value for ${argv[i]}`);
      options[argv[i] === '--csv-dir' ? 'csvDir' : 'manifestPath'] = argv[++i];
    } else throw new Error(`Unknown publish option: ${argv[i]}`);
  }
  console.log(JSON.stringify(await publishRelease(options)));
}
if (require.main === module) main().catch(error => { console.error(`Release publication failed: ${error.message}`); process.exitCode = 1; });
module.exports = { publishRelease, validateRelease, main, databaseConfig, CORE_COLUMNS, ANALYTICS_FILES, PUBLISH_LOCK };
