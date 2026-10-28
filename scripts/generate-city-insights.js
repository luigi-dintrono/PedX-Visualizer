#!/usr/bin/env node
// All observational sentences use pooled known pedestrian flags, matching the API/map.
// Imported city constants are reference material and never create speed leaderboards.
const { METRICS, displayValue, finite } = require('./lib/metric-definitions');

function generateCityInsights(city) {
  const sampleLabel = city.experimental ? 'experimental' : 'eligible';
  const videos = Number(city.video_count || 0);
  const pedestrians = Number(city.pedestrian_count || 0);
  const insights = [{
    id: `${city.city_id}_coverage`, category: 'meta',
    text: videos ? `${sampleLabel} sample: ${videos} videos and ${pedestrians} tracked observations. These clips are not a representative city survey.` : 'No eligible observations with validated measurements in the current release.',
    relevance_score: 0.2, data_confidence: 'low',
    metrics: { city_value: pedestrians, comparison_value: videos, delta_percent: 0 },
  }];
  for (const [key, definition] of Object.entries(METRICS)) {
    if (!definition.flag || definition.referenceOnly) continue;
    const value = finite(city[definition.property]);
    const n = Number(city[definition.sample] || 0);
    if (value == null || n < definition.minN) continue;
    insights.unshift({
      id: `${city.city_id}_${key}`, category: 'behavior',
      text: `Among ${n} ${sampleLabel} observations with a known ${definition.name.toLowerCase()} flag in ${city.city}, ${displayValue(value, '%')}% were positive. This is an observational sample; a confidence interval is not yet available for this release.`,
      relevance_score: 0.5, data_confidence: 'low',
      metrics: { city_value: value, comparison_value: 0, delta_percent: 0, n, estimator: 'pooled_known_flags' },
    });
  }
  return insights;
}

async function generateInsights({ db, dryRun = false } = {}) {
  if (!db) throw new Error('generateInsights requires a dedicated query client');
  const expressions = Object.entries(METRICS).filter(([, d]) => d.flag).flatMap(([metric, d]) => {
    const keys = [...new Set([d.validityKey, metric, d.property].filter(Boolean))];
    const status = `COALESCE(${keys.map(key => `v.metric_validity->'${key}'->>'status'`).join(', ')}, 'unknown') = 'validated'`;
    return [
      `COUNT(p.${d.flag}) FILTER (WHERE ${status})::int AS ${d.sample}`,
      `COUNT(*) FILTER (WHERE p.${d.flag} IS TRUE AND ${status})::float / NULLIF(COUNT(p.${d.flag}) FILTER (WHERE ${status}), 0) AS ${d.property}`,
    ];
  });
  const result = await db.query(`SELECT c.id AS city_id, c.city,
      COUNT(DISTINCT v.id)::int AS video_count, COUNT(p.id)::int AS pedestrian_count,
      ${expressions.join(', ')}
      FROM cities c LEFT JOIN videos v ON v.city_id = c.id AND v.eligible_for_comparison IS TRUE
        AND v.dataset_release_id = (SELECT dataset_release_id FROM dataset_releases WHERE is_active)
      LEFT JOIN pedestrians p ON p.video_id = v.id GROUP BY c.id ORDER BY c.id`);
  for (const city of result.rows) {
    // Always replace, even with no eligible rows, so old claims cannot survive a rerun.
    if (!dryRun) await db.query('UPDATE cities SET insights = $1::jsonb WHERE id = $2', [JSON.stringify(generateCityInsights(city)), city.city_id]);
  }
  return { processed: result.rows.length };
}
async function main() {
  require('dotenv').config({ path: '.env.local' });
  require('dotenv').config();
  const { Pool } = require('pg');
  const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: (process.env.DATABASE_URL || '').includes('sslmode=require') || process.env.NODE_ENV === 'production' ? { rejectUnauthorized: process.env.DB_SSL_INSECURE !== '1' } : false });
  const db = await pool.connect();
  try {
    await db.query('BEGIN');
    await generateInsights({ db, dryRun: process.argv.includes('--dry-run') });
    await db.query('SELECT refresh_materialized_views()');
    await db.query('COMMIT');
  } catch (error) { await db.query('ROLLBACK'); throw error; }
  finally { db.release(); await pool.end(); }
}
if (require.main === module) main().catch(error => { console.error(error); process.exitCode = 1; });
module.exports = { generateInsights, generateCityInsights, INSIGHT_TEMPLATES: [] };
