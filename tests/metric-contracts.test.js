const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const ts = require('typescript');
const metrics = require('../scripts/lib/metric-definitions');
const { relationshipEvidence } = require('../scripts/lib/relationship-evidence');
const { generateCityInsights } = require('../scripts/generate-city-insights');
const { validateCoreRows } = require('../scripts/lib/import-contract');

function loadTs(relative, dependencies = {}) {
  const filename = path.join(__dirname, '..', relative);
  const source = ts.transpileModule(fs.readFileSync(filename, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const compiled = { exports: {} };
  vm.runInNewContext(source, { module: compiled, exports: compiled.exports, require: name => {
    if (Object.hasOwn(dependencies, name)) return dependencies[name];
    throw new Error(`Unexpected dependency: ${name}`);
  }, URL, URLSearchParams, Date, console, process }, { filename });
  return compiled.exports;
}
const cohortModule = (pool = { query: async () => ({ rows: [] }) }) => loadTs('src/lib/cohort.ts', { '@/lib/database': { pool }, '@/lib/metrics': metrics });

test('fractions convert to percent once, including zero and one', () => {
  assert.equal(metrics.displayValue(0.4, '%'), '40.0');
  assert.equal(metrics.displayValue(1, '%'), '100.0');
  assert.equal(metrics.displayValue(0, '%'), '0.0');
  assert.equal(metrics.displayValue(null, '%'), 'N/A');
  assert.deepEqual(metrics.knownRate([true, false, null]), { value: 0.5, n: 2 });
  assert.equal(metrics.comparableValue({ run_red_light_rate: 0.5, run_red_light_sample: 29 }, 'run_red_light'), null);
  assert.equal(metrics.comparableValue({ run_red_light_rate: 0, run_red_light_sample: 30 }, 'run_red_light'), 0);
  assert.equal(metrics.comparableValue({ run_red_light_rate: 0.5 }, 'run_red_light'), null);
});
test('reference constants cannot create speed headlines', () => {
  const insights = generateCityInsights({ city_id: 1, city: 'Example', avg_crossing_speed: 4, speed_rank: 1, continent_speed_rank: 1, video_count: 3, pedestrian_count: 200 });
  assert.equal(insights.length, 1);
  assert.equal(insights[0].category, 'meta');
  assert.doesNotMatch(JSON.stringify(insights), /fastest|ranks|faster/);
});
test('insights use the same pooled flag value and denominator as cards', () => {
  const insights = generateCityInsights({ city_id: 1, city: 'Example', video_count: 2, pedestrian_count: 90, crosswalk_usage_rate: 0.44, crosswalk_usage_sample: 50, avg_crosswalk_usage_ratio: 0.208 });
  assert.match(insights[0].text, /50 eligible observations/);
  assert.match(insights[0].text, /44\.0%/);
  assert.doesNotMatch(insights[0].text, /20\.8%/);
});
test('real source age bands and zero rates keep their evidence', () => {
  const row = { age: '30-44', risky_crossing: '0', risky_crossing_n: '50', risky_crossing_n_clusters: '7', risky_crossing_ci_low: '0', risky_crossing_ci_high: '0.1' };
  const evidence = relationshipEvidence('age_stats.csv', row, 'risky_crossing');
  assert.equal(evidence.factor, '30-44');
  assert.equal(evidence.value, '0.0%');
  assert.equal(evidence.ciLow, 0);
  assert.equal(evidence.ciHigh, 10);
  assert.equal(relationshipEvidence('age_stats.csv', { ...row, risky_crossing: '' }, 'risky_crossing'), null);
  assert.equal(relationshipEvidence('age_stats.csv', { ...row, risky_crossing_n_clusters: '1' }, 'risky_crossing'), null);
});
test('adjusted associations retain FDR without causal wording', () => {
  const evidence = relationshipEvidence('inferential_associations.csv', { outcome: 'run_red_light', term_label: 'A versus B', estimate: '1.2', ci_low: '0.7', ci_high: '2.0', scale: 'odds_ratio', n_obs: '100', n_clusters: '8', q_value_bh: '0.6' }, 'run_red_light');
  assert.equal(evidence.qValue, 0.6);
  assert.match(evidence.description, /BH-FDR/);
  assert.doesNotMatch(evidence.description, /increases|decreases|causes/);
});
test('Day/Night and pedestrian filters share known-flag denominators', () => {
  const query = cohortModule().buildCohortQuery(new URLSearchParams('daytime=false&gender=female&minAge=30&metric=run_red_light'));
  assert.match(query.text, /p\.daytime IS FALSE/);
  assert.match(query.text, /p\.age >=/);
  assert.match(query.text, /COUNT\(p\.run_red_light\) FILTER/);
  assert.match(query.text, /v\.eligible_for_comparison IS TRUE/);
  assert.deepEqual(Array.from(query.values[0]), ['validated']);
  assert.match(query.text, /NULL::float AS severe_conflicts_per_100_ped/);
});
test('experimental mode never permits invalid metric statuses', () => {
  const query = cohortModule().buildCohortQuery(new URLSearchParams('includeExperimental=true'));
  assert.deepEqual(Array.from(query.values[0]), ['validated', 'experimental', 'unknown']);
  assert.ok(!query.values[0].includes('invalid'));
  assert.ok(!query.values[0].includes('invalid_legacy'));
});
test('invalid filters fail before a query executes', () => {
  const { buildCohortQuery } = cohortModule();
  assert.throws(() => buildCohortQuery(new URLSearchParams('minAge=NaN')), /Invalid/);
  assert.throws(() => buildCohortQuery(new URLSearchParams('cityId=London')), /identifier/);
});
test('same-release intervals still need matching observed counts', async () => {
  const row = { id: 1, risky_crossing_rate: 0.4, risky_crossing_determined: 50 };
  let calls = 0;
  const pool = { query: async () => ({ rows: ++calls === 1 ? [row] : [{ city_id: 1, metric: 'risky_crossing', n_obs: 90, n_successes: 36, est_low: 0.1, est_high: 0.8 }] }) };
  const result = await cohortModule(pool).getCohortCities(new URLSearchParams());
  assert.equal(result.rows[0].risky_crossing_lo, undefined);
  assert.equal(result.intervalStatus, 'unavailable_pending_current_release_fit');
});
test('numeric IDs avoid name lookup and ambiguous names are rejected', async () => {
  let calls = 0;
  const identity = loadTs('src/lib/city-identity.ts', { '@/lib/database': { pool: { query: async () => { calls++; return { rows: [{ id: 1 }, { id: 2 }] }; } } } });
  assert.equal(await identity.resolveCityId('42'), 42);
  assert.equal(calls, 0);
  await assert.rejects(() => identity.resolveCityId('Springfield'), /identifier/);
});
test('snapshot rejects duplicate tracks and orphan observations', () => {
  const videos = [{ link: 'abcdefghijk', city: 'Example' }];
  assert.throws(() => validateCoreRows(videos, [{ link: 'lmnopqrstuv', track_id: 1 }]), /absent video/);
  assert.throws(() => validateCoreRows(videos, [{ link: 'abcdefghijk', track_id: '1garbage' }]), /Invalid track/);
  assert.throws(() => validateCoreRows(videos, [{ link: 'abcdefghijk', track_id: 1 }, { link: 'abcdefghijk', track_id: '1.0' }]), /Duplicate track/);
});
test('metric API preserves zeros, scales once, and forwards filters', async () => {
  let received;
  const api = loadTs('src/app/api/metrics/[metric]/route.ts', {
    'next/server': { NextResponse: { json: (body, options) => ({ body, options }) } },
    '@/lib/cohort': { getCohortCities: async search => { received = search; return { rows: [{ id: 1, city: 'A', run_red_light_rate: 0, run_red_light_sample: 30, total_videos: 1, total_pedestrians: 30 }, { id: 2, city: 'B', run_red_light_rate: 1, run_red_light_sample: 300, total_videos: 3, total_pedestrians: 300 }], scope: 'test', experimental: true }; } },
    '@/lib/metrics': metrics, '@/lib/http': { READ_CACHE_HEADERS: {} },
  });
  const response = await api.GET({ url: 'http://localhost/api/metrics/run_red_light?daytime=false&includeExperimental=true' }, { params: Promise.resolve({ metric: 'run_red_light' }) });
  assert.equal(response.body.data.cities[0].value, 0);
  assert.equal(response.body.data.cities[1].value, 100);
  assert.equal(response.body.data.global.value, 50);
  assert.equal(received.get('daytime'), 'false');
});

test('only matching release and observed counts receive model intervals', async () => {
  const run = async release => {
    let calls = 0;
    const pool = { query: async () => ({ rows: ++calls === 1 ? [{ id: 1, dataset_release_ids: ['active'], risky_crossing_rate: 0, risky_crossing_determined: 50 }] : [{ dataset_release_id: release, city_id: 1, metric: 'risky_crossing', n_obs: 50, n_successes: 0, n_videos: 2, est_mean: 0.01, est_low: 0, est_high: 0.05 }] }) };
    return cohortModule(pool).getCohortCities(new URLSearchParams());
  };
  assert.equal((await run('old')).rows[0].risky_crossing_lo, undefined);
  const current = await run('active');
  assert.equal(current.rows[0].risky_crossing_lo, 0);
  assert.equal(current.intervalStatus, 'current_release');
});

test('relationship API reads active snapshot evidence and excludes invalid age', async () => {
  const registry = { risky_crossing: { status: 'experimental' }, age: { status: 'invalid' } };
  const row = { 'risky_crossing_rate(%)': '0', 'risky_crossing_rate(%)_n': '50', 'risky_crossing_rate(%)_n_clusters': '7', 'risky_crossing_rate(%)_ci_low': '0', 'risky_crossing_rate(%)_ci_high': '10' };
  const pool = { query: async sql => ({ rows: sql.includes('FROM dataset_releases') ? [{ dataset_release_id: 'active', manifest: { statistics_population: { eligible_only: true, invalid_excluded: true, metric_specific_denominators: true, allowed_metric_statuses: ['validated', 'experimental', 'unknown'] } } }] : [{ file_name: 'metrics_registry.json', payload: { default_statuses: registry } }, { file_name: 'age_stats.csv', payload: { ...row, age: '30-44' } }, { file_name: 'vehicle_stats.csv', payload: { ...row, vehicle_type: 'bus' } }] }) };
  const api = loadTs('src/app/api/metrics/[metric]/relationships/route.ts', {
    'next/server': { NextResponse: { json: body => ({ body }) } }, '@/lib/database': { pool }, '@/lib/metrics': metrics,
    '../../../../../../scripts/lib/relationship-evidence': { relationshipEvidence },
  });
  const response = await api.GET({ url: 'http://localhost/api/metrics/risky_crossing/relationships?includeExperimental=true' }, { params: Promise.resolve({ metric: 'risky_crossing' }) });
  assert.equal(response.body.data.relationships.length, 1);
  assert.equal(response.body.data.relationships[0].factor, 'bus');
  assert.equal(response.body.data.relationships[0].value, '0.0%');
  assert.equal(response.body.data.datasetReleaseId, 'active');
  const filtered = await api.GET({ url: 'http://localhost/api/metrics/risky_crossing/relationships?minAge=30' }, { params: Promise.resolve({ metric: 'risky_crossing' }) });
  assert.equal(filtered.body.data.relationships.length, 0);
  assert.match(filtered.body.data.notice, /filtered cohort/);
});

test('time series keeps zero observations and identifies analysis-date scope', async () => {
  let sql;
  const api = loadTs('src/app/api/cities/[city]/metrics/[metric]/temporal/route.ts', {
    'next/server': { NextResponse: { json: body => ({ body }) } },
    '@/lib/database': { pool: { query: async text => { sql = text; return { rows: [{ month: '2026-10-01', value: 0, n: 50, videos: 2 }] }; } } },
    '@/lib/city-identity': { resolveCityId: async () => 1, AmbiguousCityError: class extends Error {} },
    '@/lib/cohort': { buildCohortQuery: () => ({ ctes: 'WITH eligible_videos AS (SELECT * FROM videos), population AS (SELECT * FROM pedestrians), observations AS (SELECT 1)', values: [] }) },
    '@/lib/metrics': metrics,
  });
  const response = await api.GET({ url: 'http://localhost/api/cities/1/metrics/red-light/temporal' }, { params: Promise.resolve({ city: '1', metric: 'red-light' }) });
  assert.equal(response.body.data.chartData[0].value, 0);
  assert.equal(response.body.data.timelineBasis, 'analysis');
  assert.match(response.body.data.notice, /not changes in pedestrian behavior/);
  assert.match(sql, /v\.analyzed_at/);
  assert.doesNotMatch(sql, /COALESCE\(v\.analyzed_at|data_collected_date/);
});
