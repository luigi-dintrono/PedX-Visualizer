const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');
const { publishRelease, validateRelease, databaseConfig, ANALYTICS_FILES, CORE_COLUMNS, PUBLISH_LOCK } = require('../scripts/publish-release');
const { runRateModel } = require('../scripts/run-rate-model');

function csvText(rows, columns) {
  const cell = value => {
    const text = value == null ? '' : typeof value === 'object' ? JSON.stringify(value) : String(value);
    return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
  };
  return [columns.join(','), ...rows.map(row => columns.map(column => cell(row[column])).join(','))].join('\n') + '\n';
}

function videoRow(overrides = {}) {
  return { link: 'abcdefghijk', city: 'London', city_id: 'geonames:2643743',
    analysis_run_id: 'synthetic-analysis', analysis_status: 'complete', eligible_for_comparison: 'TRUE',
    source_video_sha256: 'a'.repeat(64),
    metric_validity: { phone_using: { status: 'validated' } }, analyzed_at: '2026-10-27T11:00:00Z',
    analyzed_at_source: 'run_manifest', eligibility_status: 'verified', verified_city_id: 'geonames:2643743',
    location_verification_source: 'human:synthetic-review', ...overrides };
}

function locationRow(overrides = {}) {
  return { link: 'abcdefghijk', status: 'ok', lat: 51.5, lon: -0.1,
    source_video_sha256: 'a'.repeat(64), analysis_run_id: 'synthetic-analysis',
    localization_origin_run_id: 'synthetic-localization-origin', localized_at: '2026-10-27T10:00:00Z', ...overrides };
}

function locationRows(rows = [locationRow()]) {
  return csvText(rows, Object.keys(locationRow()));
}

function pedestrianRows(rows = [{ link: 'abcdefghijk', track_id: '1', analysis_run_id: 'synthetic-analysis' }]) {
  return csvText(rows, CORE_COLUMNS['all_pedestrian_info.csv']);
}

function fixture(t, overrides = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pedx-publish-test-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const content = {
    'all_video_info.csv': csvText([videoRow()], CORE_COLUMNS['all_video_info.csv']),
    'all_pedestrian_info.csv': pedestrianRows(),
    'all_time_info.csv': 'link,analysis_seconds\nabcdefghijk,12\n',
    'all_video_locations.csv': locationRows(),
    'metrics_registry.json': '{"schema_version":1}',
    ...overrides,
  };
  const manifest = { schema_version: 1, dataset_release_id: 'release-20261027',
    created_at: '2026-10-27T12:00:00Z', files: [],
    optional_artifacts: ANALYTICS_FILES.filter(name => !Object.hasOwn(content, name))
      .map(name => ({ path: name, status: 'skipped', reason: 'explicit test skip-stats release' })) };
  for (const [name, text] of Object.entries(content)) {
    fs.writeFileSync(path.join(root, name), text);
    const lines = text.trimEnd().split('\n');
    manifest.files.push({ path: name,
      sha256: crypto.createHash('sha256').update(text).digest('hex'),
      rows: name.endsWith('.csv') ? lines.length - 1 : null,
      columns: name.endsWith('.csv') ? lines[0].split(',') : [] });
  }
  const save = () => fs.writeFileSync(path.join(root, 'release_manifest.json'), JSON.stringify(manifest));
  save();
  return { root, manifest, save };
}

function injected(options = {}) {
  const events = [];
  const db = { query: async (sql, values) => {
    events.push({ sql, values });
    if (options.failSQL && sql.includes(options.failSQL)) throw new Error('simulated query failure');
    return { rows: sql.startsWith('SELECT manifest_sha256') && options.priorHash ? [{ manifest_sha256: options.priorHash }] : [] };
  }, end: async () => { throw new Error('Injected client must remain open'); } };
  class Aggregator {
    constructor(config) { this.config = config; assert.equal(config.db, db); events.push({ phase: 'constructed', config }); }
    async initialize() { events.push({ phase: 'initialize' }); }
    async aggregateCoreData() {
      events.push({ phase: 'core' });
      assert.match(fs.readFileSync(path.join(this.config.csvDir, 'all_video_info.csv'), 'utf8'), /abcdefghijk/);
      if (options.failPhase === 'core') throw new Error('core failed');
    }
    async aggregateAnalytics() { events.push({ phase: 'analytics' }); if (options.failPhase === 'analytics') throw new Error('analytics failed'); }
  }
  return { db, Aggregator, events,
    importCoordinates: async config => {
      assert.equal(config.db, db); assert.equal(config.dryRun, false);
      events.push({ phase: 'coordinates', csvPath: config.csvPath });
      if (options.failPhase === 'coordinates') throw new Error('coordinates failed');
    }, generateInsights: async config => {
      assert.equal(config.db, db); assert.equal(config.dryRun, false);
      events.push({ phase: 'insights' });
      if (options.failPhase === 'insights') throw new Error('insights failed');
    } };
}

test('database TLS verifies certificates unless the explicit insecure option is set', () => {
  const env = { DATABASE_URL: 'postgres://fixture.invalid/test?sslmode=require' };
  assert.equal(databaseConfig(env).ssl.rejectUnauthorized, true);
  assert.equal(databaseConfig({ ...env, DB_SSL_INSECURE: '1' }).ssl.rejectUnauthorized, false);
  assert.equal(databaseConfig({ DATABASE_URL: 'postgres://localhost/test', NODE_ENV: 'production' }).ssl.rejectUnauthorized, true);
});

test('validation accepts a complete video with zero observed pedestrians', t => {
  const { root } = fixture(t, { 'all_pedestrian_info.csv': pedestrianRows([]),
    'all_time_info.csv': 'link,analysis_seconds\n', 'all_video_locations.csv': 'link,status,lat,lon\n' });
  assert.deepEqual(validateRelease(root).counts, { videos: 1, pedestrians: 0 });
});

for (const [name, overrides] of [
  ['missing clip hash', { source_video_sha256: '' }],
  ['different clip hash', { source_video_sha256: 'b'.repeat(64) }],
  ['missing target run', { analysis_run_id: '' }],
  ['different target run', { analysis_run_id: 'previous-analysis' }],
  ['trimmed positive status with stale hash', { status: 'ok ', source_video_sha256: 'b'.repeat(64) }],
  ['malformed localization timestamp', { localized_at: '2026-02-30T12:00:00Z' }],
  ['non-ok geographic values', { status: 'source_mismatch' }],
]) {
  test(`localization ${name} is refused before DB connection`, async t => {
    const item = fixture(t, { 'all_video_locations.csv': locationRows([locationRow(overrides)]) });
    let creates = 0;
    await assert.rejects(publishRelease({ csvDir: item.root,
      createClient: () => { creates++; throw new Error('must not connect'); } }));
    assert.equal(creates, 0);
  });
}

test('same clip localization may retain an earlier origin run while targeting the new analysis', t => {
  const item = fixture(t, {
    'all_video_info.csv': csvText([videoRow({ analysis_run_id: 'new-analysis' })], CORE_COLUMNS['all_video_info.csv']),
    'all_pedestrian_info.csv': pedestrianRows([{ link: 'abcdefghijk', track_id: 1, analysis_run_id: 'new-analysis' }]),
    'all_video_locations.csv': locationRows([locationRow({ analysis_run_id: 'new-analysis', localization_origin_run_id: 'old-origin' })]),
  });
  assert.equal(validateRelease(item.root).counts.videos, 1);
});

test('non-ok source-bound localization permits blank geographic evidence', t => {
  const item = fixture(t, { 'all_video_locations.csv': locationRows([locationRow({
    status: 'source_mismatch', lat: '', lon: '', source_video_sha256: '', analysis_run_id: '',
  })]) });
  assert.equal(validateRelease(item.root).counts.videos, 1);
});

for (const column of CORE_COLUMNS['all_video_info.csv']) {
  test(`producer metadata header ${column} is mandatory before connecting`, async t => {
    const columns = CORE_COLUMNS['all_video_info.csv'].filter(value => value !== column);
    const item = fixture(t, { 'all_video_info.csv': csvText([videoRow()], columns) });
    item.manifest.legacy_audit_only = false;
    item.save();
    let creates = 0;
    await assert.rejects(publishRelease({ csvDir: item.root,
      createClient: () => { creates++; throw new Error('must not connect'); } }), /Missing required column/);
    assert.equal(creates, 0);
  });
}

for (const [name, overrides] of [
  ['blank run ID', { analysis_run_id: '' }],
  ['missing source hash', { source_video_sha256: '' }],
  ['malformed source hash', { source_video_sha256: 'unverified-source' }],
  ['noncomplete analysis', { analysis_status: 'legacy_unverified' }],
  ['invalid calendar timestamp', { analyzed_at: '2026-02-30T12:00:00Z' }],
  ['timezone-free timestamp', { analyzed_at: '2026-10-27T12:00:00' }],
  ['mtime timestamp source', { analyzed_at_source: 'file_mtime' }],
  ['import timestamp source', { analyzed_at_source: 'import_date' }],
  ['blank timestamp source', { analyzed_at_source: '' }],
  ['missing validity', { metric_validity: '' }],
  ['array validity', { metric_validity: [] }],
  ['null validity', { metric_validity: 'null' }],
  ['unknown validity status', { metric_validity: { phone_using: { status: 'trusted' } } }],
  ['malformed metric entry', { metric_validity: { phone_using: null } }],
  ['invalid eligibility token', { eligible_for_comparison: '2' }],
  ['blank city identity', { city_id: '' }],
  ['blank eligibility status', { eligibility_status: '' }],
  ['different verified city', { verified_city_id: 'geonames:another' }],
  ['eligible unverified city', { eligibility_status: 'unverified' }],
  ['missing verification evidence', { location_verification_source: '' }],
]) {
  test(`invalid producer ${name} is rejected before any DB client`, async t => {
    const item = fixture(t, { 'all_video_info.csv': csvText([videoRow(overrides)], CORE_COLUMNS['all_video_info.csv']) });
    let creates = 0;
    await assert.rejects(publishRelease({ csvDir: item.root,
      createClient: () => { creates++; throw new Error('must not connect'); } }));
    assert.equal(creates, 0);
  });
}

test('complete but unverified videos can remain in a release with false eligibility', t => {
  const row = videoRow({ eligible_for_comparison: 'FALSE', eligibility_status: 'unverified',
    verified_city_id: '', location_verification_source: '' });
  const item = fixture(t, { 'all_video_info.csv': csvText([row], CORE_COLUMNS['all_video_info.csv']) });
  assert.equal(validateRelease(item.root).counts.videos, 1);
});

test('false eligibility never bypasses completed-run and provenance validation', async t => {
  const row = videoRow({ eligible_for_comparison: 'FALSE', analysis_status: 'legacy_unverified' });
  const item = fixture(t, { 'all_video_info.csv': csvText([row], CORE_COLUMNS['all_video_info.csv']) });
  item.manifest.legacy_audit_only = false;
  item.save();
  let creates = 0;
  await assert.rejects(publishRelease({ csvDir: item.root,
    createClient: () => { creates++; throw new Error('must not connect'); } }), /complete analysis/);
  assert.equal(creates, 0);
});

test('verified attribution may differ from the original searched city', t => {
  const row = videoRow({ searched_city_id: 'geonames:original-search' });
  const columns = [...CORE_COLUMNS['all_video_info.csv'], 'searched_city_id'];
  const item = fixture(t, { 'all_video_info.csv': csvText([row], columns) });
  assert.equal(validateRelease(item.root).counts.videos, 1);
});

for (const runId of ['', 'another-analysis']) {
  test(`pedestrian run identity ${runId || 'missing'} is rejected before connecting`, async t => {
    const item = fixture(t, { 'all_pedestrian_info.csv': pedestrianRows([
      { link: 'abcdefghijk', track_id: 1, analysis_run_id: runId },
    ]) });
    let creates = 0;
    await assert.rejects(publishRelease({ csvDir: item.root,
      createClient: () => { creates++; throw new Error('must not connect'); } }), /analysis_run_id/);
    assert.equal(creates, 0);
  });
}

test('pedestrian run header remains mandatory for a zero-observation file', t => {
  const item = fixture(t, { 'all_pedestrian_info.csv': 'link,track_id\n' });
  assert.throws(() => validateRelease(item.root), /Missing required column analysis_run_id/);
});

for (const alias of ['1.0', '01', '1e0']) {
  test(`canonical track alias ${alias} collides before PostgreSQL casts`, async t => {
    const item = fixture(t, { 'all_pedestrian_info.csv': pedestrianRows([
      { link: 'abcdefghijk', track_id: '1', analysis_run_id: 'synthetic-analysis' },
      { link: 'abcdefghijk', track_id: alias, analysis_run_id: 'synthetic-analysis' },
    ]) });
    let creates = 0;
    await assert.rejects(publishRelease({ csvDir: item.root,
      createClient: () => { creates++; throw new Error('must not connect'); } }), /Duplicate canonical track identity/);
    assert.equal(creates, 0);
  });
}

for (const track of ['2147483648', '-1', '.5', '1.00000000000000001', 'Infinity', '0x1', '']) {
  test(`invalid PostgreSQL track identity ${track || 'empty'} fails before connecting`, async t => {
    const item = fixture(t, { 'all_pedestrian_info.csv': pedestrianRows([
      { link: 'abcdefghijk', track_id: track, analysis_run_id: 'synthetic-analysis' },
    ]) });
    let creates = 0;
    await assert.rejects(publishRelease({ csvDir: item.root,
      createClient: () => { creates++; throw new Error('must not connect'); } }), /Invalid canonical track identity/);
    assert.equal(creates, 0);
  });
}

test('statistics artifacts require their eligible population and metric denominators', t => {
  const item = fixture(t, { 'age_stats.csv': 'metric,n,estimate\nage,0,\n' });
  assert.throws(() => validateRelease(item.root), /explicit eligible statistics population/);
  item.manifest.statistics_scope = 'eligible';
  item.manifest.statistics_population = { eligible_only: true, allowed_metric_statuses: ['validated'],
    filters: {}, metric_specific_denominators: true, invalid_excluded: true };
  item.save();
  assert.equal(validateRelease(item.root).files.has('age_stats.csv'), true);
});

for (const kind of ['checksum', 'columns', 'rows', 'optional', 'unlisted', 'foreign', 'duplicate', 'release', 'audit-only', 'invalid-statistics', 'empty-video', 'bad-coordinates']) {
  test(`invalid ${kind} is refused before creating a DB client`, async t => {
    const person = { link: 'abcdefghijk', track_id: 1, analysis_run_id: 'synthetic-analysis' };
    const overrides = kind === 'foreign' ? { 'all_pedestrian_info.csv': pedestrianRows([{ ...person, link: 'zzzzzzzzzzz' }]) }
      : kind === 'duplicate' ? { 'all_pedestrian_info.csv': pedestrianRows([person, person]) }
      : kind === 'empty-video' ? { 'all_video_info.csv': csvText([], CORE_COLUMNS['all_video_info.csv']) }
      : kind === 'bad-coordinates' ? { 'all_video_locations.csv': 'link,status,lat,lon\nabcdefghijk,ok,999,-0.1\n' } : {};
    const item = fixture(t, overrides);
    if (kind === 'checksum') fs.appendFileSync(path.join(item.root, 'all_video_info.csv'), 'tampered');
    if (kind === 'columns') item.manifest.files[0].columns = ['wrong', 'city'];
    if (kind === 'rows') item.manifest.files[0].rows++;
    if (kind === 'optional') item.manifest.optional_artifacts = [];
    if (kind === 'unlisted') fs.writeFileSync(path.join(item.root, 'age_stats.csv'), 'stale\n');
    if (kind === 'release') item.manifest.schema_version = 2;
    if (kind === 'audit-only') item.manifest.legacy_audit_only = true;
    if (kind === 'invalid-statistics') item.manifest.statistics_population = { eligible_only: false };
    item.save();
    let creates = 0;
    await assert.rejects(publishRelease({ csvDir: item.root, createClient: () => { creates++; throw new Error('must not connect'); } }));
    assert.equal(creates, 0);
  });
}

test('publication uses one transaction and one validated snapshot for every stage', async t => {
  const { root } = fixture(t);
  const api = injected();
  const result = await publishRelease({ csvDir: root, ...api });
  const sql = api.events.filter(item => item.sql);
  assert.equal(sql[0].sql, 'BEGIN');
  assert.deepEqual(sql[1], { sql: 'SELECT pg_advisory_xact_lock($1)', values: [PUBLISH_LOCK] });
  assert.equal(sql.at(-1).sql, 'COMMIT');
  assert.equal(sql.filter(item => item.sql === 'BEGIN').length, 1);
  assert.equal(sql.filter(item => item.sql === 'SELECT refresh_materialized_views()').length, 2);
  const activationIndex = api.events.findIndex(item => item.sql?.includes('SET is_active = TRUE'));
  assert(activationIndex < api.events.findIndex(item => item.sql === 'SELECT refresh_materialized_views()'));
  assert(activationIndex < api.events.findIndex(item => item.phase === 'insights'));
  assert(sql.some(item => item.sql === 'DELETE FROM city_metric_estimates'));
  assert(sql.some(item => item.sql.startsWith('DELETE FROM analytics_facts')));
  const config = api.events.find(item => item.phase === 'constructed').config;
  assert.notEqual(config.csvDir, root);
  assert.equal(config.releaseManifest.dataset_release_id, result.dataset_release_id);
  assert.equal(fs.existsSync(config.csvDir), false, 'private snapshot is cleaned after commit');
  assert.deepEqual(api.events.filter(item => item.phase).map(item => item.phase),
    ['constructed', 'initialize', 'core', 'analytics', 'coordinates', 'insights']);
  assert.equal(result.model_status, 'unavailable_for_release');
});

test('source mutation after validation cannot change imported snapshot', async t => {
  const { root } = fixture(t);
  const api = injected();
  const createClient = () => {
    fs.writeFileSync(path.join(root, 'all_video_info.csv'), 'link,city\nXXXXXXXXXXX,Changed\n');
    return { ...api.db, connect: async () => {}, end: async () => {} };
  };
  // Supply adapters independent of the fixture's injected-client equality check.
  let imported;
  class Aggregator {
    constructor(config) { imported = fs.readFileSync(path.join(config.csvDir, 'all_video_info.csv'), 'utf8'); }
    async initialize() {} async aggregateCoreData() {} async aggregateAnalytics() {}
  }
  await publishRelease({ csvDir: root, createClient, Aggregator,
    importCoordinates: async () => {}, generateInsights: async () => {} });
  assert.match(imported, /abcdefghijk,London/);
});

for (const phase of ['core', 'analytics', 'coordinates', 'insights']) {
  test(`${phase} failure rolls back the entire release`, async t => {
    const { root } = fixture(t);
    const api = injected({ failPhase: phase });
    await assert.rejects(publishRelease({ csvDir: root, ...api }), /failed/);
    const sql = api.events.filter(item => item.sql).map(item => item.sql);
    assert.equal(sql.at(-1), 'ROLLBACK');
    assert(!sql.includes('COMMIT'));
    const config = api.events.find(item => item.phase === 'constructed').config;
    assert.equal(fs.existsSync(config.csvDir), false);
  });
}

test('view refresh failure rolls back and release ID cannot be rebound to different bytes', async t => {
  const { root } = fixture(t);
  for (const options of [{ failSQL: 'refresh_materialized_views' }, { priorHash: 'a'.repeat(64) }]) {
    const api = injected(options);
    await assert.rejects(publishRelease({ csvDir: root, ...api }));
    assert.equal(api.events.filter(item => item.sql).at(-1).sql, 'ROLLBACK');
    assert(!api.events.some(item => item.sql === 'COMMIT'));
  }
});

test('validate-only never creates a client and unversioned model launch never spawns', async t => {
  const { root } = fixture(t);
  const result = await publishRelease({ csvDir: root, validateOnly: true,
    createClient: () => { throw new Error('must not connect'); } });
  assert.equal(result.validated, true);
  const log = { warn() {}, log() {} };
  assert.equal(runRateModel([], { env: {}, log, spawn: () => { throw new Error('must not fit'); } }).status, 'disabled_unversioned');
  let received;
  const report = runRateModel([], { env: { PEDX_DATASET_RELEASE_ID: 'release1', PEDX_PYTHON: 'mock-python' }, log,
    spawn: (cmd, args) => { received = [cmd, args]; return { status: 1 }; } });
  assert.equal(report.status, 'unavailable_for_release');
  assert.equal(received[0], 'mock-python');
  assert.deepEqual(received[1].slice(-2), ['--dataset-release-id', 'release1']);
});

test('Python model rejects inactive releases before fitting or writing', t => {
  // Import the real guard with optional scientific/DB packages stubbed. This
  // exercises no inference and cannot open a database or contact a service.
  const code = `
import importlib.util,sys,types
sys.dont_write_bytecode=True
sys.modules['numpy']=types.ModuleType('numpy')
sys.modules['psycopg']=types.ModuleType('psycopg')
spec=importlib.util.spec_from_file_location('pedx_model_under_test',sys.argv[1])
model=importlib.util.module_from_spec(spec)
spec.loader.exec_module(model)
class Fake:
 def __init__(self,active):self.active=active;self.queries=[]
 def execute(self,sql,args):self.queries.append((sql,args));return self
 def fetchone(self):return ('active',) if self.active else None
inactive=Fake(False)
for release_id in (None,'old-release'):
 try:model.require_active_release(inactive,release_id)
 except ValueError:pass
 else:raise AssertionError('Inactive release accepted')
assert len(inactive.queries)==1
assert 'is_active' in inactive.queries[0][0]
try:model.run_metric(inactive,'risky_crossing','risky_crossing',types.SimpleNamespace(dataset_release_id='old-release'))
except ValueError:pass
else:raise AssertionError('Fit proceeded on stale release')
active=Fake(True)
model.require_active_release(active,'active')
assert active.queries[0][1]==('active',)
assert model.PUBLISH_LOCK==${PUBLISH_LOCK}
print('release guards passed without inference or database access')
`;
  const candidates = process.platform === 'win32' ? [['py', ['-3.12']], ['python', []]] : [['python3', []], ['python', []]];
  let result;
  for (const [command, prefix] of candidates) {
    result = spawnSync(command, [...prefix, '-B', '-c', code, path.join(__dirname, '..', 'scripts', 'estimate_city_rates.py')],
      { encoding: 'utf8', timeout: 10000, windowsHide: true });
    if (result.error?.code === 'ENOENT') continue;
    break;
  }
  if (result?.error?.code === 'ENOENT') return t.skip('Python is optional and not installed');
  assert.equal(result.status, 0, result.stderr || result.error?.message);
  assert.match(result.stdout, /release guards passed/);
});
