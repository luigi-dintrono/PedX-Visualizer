// Real PostgreSQL in WebAssembly, in memory only: schemas, queries, import and rollback.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const vm = require('node:vm');
const ts = require('typescript');
const { PGlite } = require('@electric-sql/pglite');
const metrics = require('../scripts/lib/metric-definitions');
const { publishRelease, ANALYTICS_FILES } = require('../scripts/publish-release');
const Aggregator = require('../scripts/aggregate-csv-data');
const { importVideoCoordinates } = require('../scripts/import-video-coordinates');
const { generateInsights } = require('../scripts/generate-city-insights');
const ROOT = path.join(__dirname, '..');

async function database(t) {
  const engine = new PGlite();
  t.after(async () => engine.close());
  await engine.exec(fs.readFileSync(path.join(ROOT, 'database', 'schema.sql'), 'utf8'));
  for (const filename of ['1793100000000_dataset-release-identity.sql', '1793100000001_dataset-release-publication.sql']) {
    await engine.exec(fs.readFileSync(path.join(ROOT, 'migrations', filename), 'utf8').split(/--\s*Down Migration/i)[0]);
  }
  // node-postgres assigns duplicate result names from left to right (last wins).
  // PGlite's object rows use first wins; retain the real PG field order and map it
  // exactly as the production driver does rather than changing query semantics.
  return { query: async (sql, values) => {
    const result = await engine.query(sql, values, { rowMode: 'array' });
    return { ...result, rows: result.rows.map(row => Object.fromEntries(
      result.fields.map((field, index) => [field.name, row[index]]))) };
  }, engine };
}

function cohortModule(db) {
  const filename = path.join(ROOT, 'src', 'lib', 'cohort.ts');
  const compiled = { exports: {} };
  const source = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  vm.runInNewContext(source, { module: compiled, exports: compiled.exports, URLSearchParams, console,
    require: name => {
      if (name === '@/lib/database') return { pool: db };
      if (name === '@/lib/metrics') return metrics;
      throw new Error(`Unexpected dependency: ${name}`);
    } }, { filename });
  return compiled.exports;
}

async function register(db, id, active) {
  await db.query(`INSERT INTO dataset_releases(dataset_release_id,schema_version,manifest_sha256,manifest,created_at,is_active)
    VALUES($1,1,$2,'{}','2026-10-27T12:00:00Z',$3)`, [id, 'a'.repeat(64), active]);
}

async function seedVideo(db, cityId, link, validity, extra = {}) {
  return (await db.query(`INSERT INTO videos(city_id,link,video_name,total_pedestrians,total_crossed_pedestrians,
      dataset_release_id,analysis_status,eligible_for_comparison,metric_validity,eligibility_status,
      searched_city_id,verified_city_id,location_verification_source,pipeline_version,risky_crossing_coverage)
    VALUES($1,$2,$2,3,2,$3,$4,$5,$6::jsonb,$7,$8,$8,'human:fixture','dense_v2',1) RETURNING id`,
  [cityId, link, extra.release || 'active-release', extra.analysis || 'complete', extra.eligible !== false,
    JSON.stringify(validity), extra.eligible === false ? 'unverified' : 'verified', `place:test:${cityId}:london`])).rows[0].id;
}

async function pedestrian(db, videoId, id, values) {
  const row = { video_id: videoId, track_id: id, ...values };
  const columns = Object.keys(row);
  await db.query(`INSERT INTO pedestrians(${columns.join(',')}) VALUES(${columns.map((_, index) => `$${index + 1}`).join(',')})`, Object.values(row));
}

test('actual cohort SQL respects release, denominators, filters and identity', { timeout: 90000 }, async t => {
  const db = await database(t);
  await register(db, 'old-release', false);
  await register(db, 'active-release', true);
  const cities = (await db.query(`INSERT INTO cities(city,country,state,admin1_code,external_city_id,latitude,longitude)
    VALUES('London','United Kingdom','ENG','ENG','geonames:2643743',51.5,-0.1),
          ('London','Canada','ON','ON','geonames:6058560',42.98,-81.23) RETURNING id`)).rows;
  const gb = cities[0].id, ca = cities[1].id;
  const validity = {
    risky_crossing: { status: 'validated' }, run_red_light: { status: 'validated' },
    crosswalk_use_or_not: { status: 'validated' }, phone_using: { status: 'validated' },
    age: { status: 'invalid' }, average_age: { status: 'invalid' },
    daytime: { status: 'validated' }, weather: { status: 'invalid' },
    walking_speed_mps: { status: 'validated' }, crossing_speed_mps: { status: 'validated' },
    vehicle_type: { status: 'validated' },
  };
  const good = await seedVideo(db, gb, 'aaaaaaaaaaa', validity);
  const zero = await seedVideo(db, gb, 'bbbbbbbbbbb', validity);
  const unverified = await seedVideo(db, gb, 'ccccccccccc', validity, { eligible: false });
  const invalid = await seedVideo(db, gb, 'ddddddddddd', { ...validity, risky_crossing: { status: 'invalid' } });
  const experimental = await seedVideo(db, ca, 'eeeeeeeeeee', { ...validity, risky_crossing: { status: 'experimental' } });
  const old = await seedVideo(db, gb, 'fffffffffff', validity, { release: 'old-release' });
  await db.query("UPDATE videos SET crossing_speed=1.5,crossing_time=10 WHERE dataset_release_id='active-release'");
  await db.query('UPDATE videos SET crossing_speed=9,crossing_time=99 WHERE id=$1', [old]);
  await db.query('UPDATE videos SET total_pedestrians=0,total_crossed_pedestrians=0 WHERE id=$1', [zero]);
  await pedestrian(db, good, 1, { risky_crossing: true, run_red_light: null, phone_using: false,
    crosswalk_use_or_not: true, daytime: false, age: 40, weather: 'rain', walking_speed_mps: 1.2 });
  await pedestrian(db, good, 2, { risky_crossing: false, run_red_light: true, phone_using: null,
    crosswalk_use_or_not: false, daytime: true, age: 50, weather: 'rain', walking_speed_mps: 1.4 });
  await pedestrian(db, good, 3, { risky_crossing: null, run_red_light: false, phone_using: true,
    crosswalk_use_or_not: null, daytime: false, age: 60, weather: 'clear', walking_speed_mps: null });
  for (const video of [unverified, invalid, old]) await pedestrian(db, video, 1,
    { risky_crossing: true, run_red_light: true, phone_using: true, daytime: false, age: 40, weather: 'rain' });
  await pedestrian(db, experimental, 1, { risky_crossing: false, run_red_light: true, phone_using: false, daytime: true, age: 40 });
  await pedestrian(db, experimental, 2, { risky_crossing: null, run_red_light: false, phone_using: null, daytime: false, age: 50 });
  await db.query('SELECT refresh_materialized_views()');
  const cohort = cohortModule(db);
  const query = async search => (await cohort.getCohortCities(new URLSearchParams(search))).rows;
  await t.test('known flags have their own denominator; zero-person videos remain counted', async () => {
    const rows = await query('metric=risky_crossing');
    assert.equal(rows.length, 1);
    assert.equal(rows[0].id, gb);
    assert.equal(Number(rows[0].total_videos), 2);
    assert.equal(Number(rows[0].total_pedestrians), 3);
    assert.equal(Number(rows[0].risky_crossing_determined), 2);
    assert.equal(Number(rows[0].risky_crossing_rate), 0.5);
    assert.equal(Number(rows[0].run_red_light_sample), 2);
    assert.equal(Number(rows[0].run_red_light_rate), 0.5);
    assert.equal(Number(rows[0].phone_usage_sample), 2);
    assert.equal(Number(rows[0].phone_usage_rate), 0.5);
    assert.equal(Number(rows[0].avg_crossing_speed), 1.5);
    assert.equal(Number(rows[0].avg_crossing_time), 10);
  });
  await t.test('Day/Night and flag filters recompute selected observations', async () => {
    const night = (await query('metric=risky_crossing&daytime=false'))[0];
    assert.equal(Number(night.total_pedestrians), 2);
    assert.equal(Number(night.total_videos), 1);
    assert.equal(Number(night.risky_crossing_determined), 1);
    assert.equal(Number(night.risky_crossing_rate), 1);
    const day = (await query('metric=risky_crossing&daytime=true'))[0];
    assert.equal(Number(day.total_pedestrians), 1);
    assert.equal(Number(day.risky_crossing_rate), 0);
    const positive = (await query('metric=risky_crossing&riskyCrossing=true'))[0];
    assert.equal(Number(positive.total_pedestrians), 1);
    assert.equal(Number(positive.risky_crossing_rate), 1);
  });
  await t.test('invalid age/weather never define a cohort, even in exploratory mode', async () => {
    assert.equal((await query('metric=risky_crossing&includeExperimental=true&minAge=30')).length, 0);
    assert.equal((await query('metric=risky_crossing&includeExperimental=true&weather=rain')).length, 0);
  });
  await t.test('experimental metrics opt in without resurrecting unverified/invalid/inactive data', async () => {
    const rows = await query('metric=risky_crossing&includeExperimental=true');
    assert.equal(rows.length, 2);
    const british = rows.find(row => row.id === gb), canadian = rows.find(row => row.id === ca);
    assert.equal(Number(british.total_pedestrians), 3);
    assert.equal(Number(british.risky_crossing_determined), 2);
    assert.equal(Number(british.risky_crossing_rate), 0.5);
    assert.equal(Number(canadian.risky_crossing_rate), 0);
    assert.notEqual(british.external_city_id, canadian.external_city_id);
    const selected = await query(`metric=risky_crossing&includeExperimental=true&cityId=${ca}`);
    assert.equal(selected.length, 1);
    assert.equal(selected[0].country, 'Canada');
  });
  await t.test('analysis cutoff requires explicit provenance and ignores legacy collected dates', async () => {
    await db.query("UPDATE videos SET analyzed_at=NULL,data_collected_date='2020-01-01'");
    await db.query("UPDATE videos SET analyzed_at='2026-09-01T12:00:00Z' WHERE id=$1", [good]);
    const rows = await query('metric=risky_crossing&analyzedBefore=2026-09-15T23%3A59%3A59Z');
    assert.equal(rows.length, 1);
    assert.equal(Number(rows[0].total_videos), 1);
    assert.equal(Number(rows[0].total_pedestrians), 3);
    assert.equal(Number(rows[0].risky_crossing_rate), 0.5);
    const missing = await query('metric=risky_crossing&analyzedBefore=2020-12-31T23%3A59%3A59Z');
    assert.equal(missing.length, 0, 'legacy collected dates must not fabricate earlier analysis');
  });
  await t.test('vehicle ranges distinguish unknown counts, observed zero and positive presence', async () => {
    assert.equal((await query('metric=risky_crossing&maxCar=0')).length, 0,
      'unknown vehicle flags cannot satisfy a zero-count filter');
    await db.query('UPDATE pedestrians SET car=FALSE WHERE video_id=$1 AND track_id=1', [good]);
    assert.equal((await query('metric=risky_crossing&maxCar=0')).length, 1,
      'an observed negative flag is a real zero and remains eligible');
    await db.query('UPDATE pedestrians SET car=TRUE WHERE video_id=$1 AND track_id=2', [good]);
    assert.equal((await query('metric=risky_crossing&maxCar=0')).length, 0);
    assert.equal((await query('metric=risky_crossing&minCar=1')).length, 1);
  });
});

test('actual timeline SQL excludes unsourced recording dates and missing analysis dates', { timeout: 90000 }, async t => {
  const db = await database(t);
  await register(db, 'active-release', true);
  const city = (await db.query("INSERT INTO cities(city,country,external_city_id) VALUES('Timeline fixture','Synthetic','synthetic:timeline') RETURNING id")).rows[0].id;
  const validity = { crosswalk_use_or_not: { status: 'validated' } };
  const known = await seedVideo(db, city, 'ggggggggggg', validity);
  const unknown = await seedVideo(db, city, 'hhhhhhhhhhh', validity);
  await db.query("UPDATE videos SET recorded_at=now(),recording_date_source='unknown',data_collected_date=CURRENT_DATE");
  await db.query("UPDATE videos SET analyzed_at=now(),recording_date_source='human:documented' WHERE id=$1", [known]);
  for (let index = 0; index < 40; index++) {
    await pedestrian(db, known, index, { crosswalk_use_or_not: index < 16 });
    await pedestrian(db, unknown, index, { crosswalk_use_or_not: true });
  }
  await db.query('SELECT refresh_materialized_views()');
  const filename = path.join(ROOT, 'src/app/api/cities/[city]/metrics/[metric]/temporal/route.ts');
  const compiled = { exports: {} };
  const dependencies = {
    'next/server': { NextResponse: { json: (body, options) => ({ body, options }) } },
    '@/lib/database': { pool: db }, '@/lib/metrics': metrics, '@/lib/cohort': cohortModule(db),
    '@/lib/city-identity': { resolveCityId: async () => city, AmbiguousCityError: class extends Error {} },
  };
  const source = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  vm.runInNewContext(source, { module: compiled, exports: compiled.exports, URL, URLSearchParams, console,
    require: name => { if (Object.hasOwn(dependencies, name)) return dependencies[name]; throw new Error(name); } }, { filename });
  for (const basis of ['analysis', 'recorded']) {
    const response = await compiled.exports.GET({ url: `http://localhost/api/cities/${city}/metrics/crosswalk-usage/temporal?basis=${basis}` },
      { params: Promise.resolve({ city: String(city), metric: 'crosswalk-usage' }) });
    assert.equal(response.body.success, true);
    assert.equal(response.body.data.chartData.length, 1);
    assert.equal(response.body.data.chartData[0].n, 40);
    assert.equal(response.body.data.chartData[0].value, 40);
    assert.equal(response.body.data.timelineBasis, basis);
  }
});

function csvText(rows, required) {
  const columns = [...new Set([...required, ...rows.flatMap(row => Object.keys(row))])];
  const cell = value => {
    if (value == null) return '';
    const text = typeof value === 'object' ? JSON.stringify(value) : String(value);
    return /[",\n\r]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
  };
  return { text: [columns.map(cell).join(','), ...rows.map(row => columns.map(column => cell(row[column])).join(','))].join('\n') + '\n', columns };
}

function release(t, id, videos, people, options = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pedx-pglite-release-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const content = {
    'all_video_info.csv': [videos, ['link', 'city']],
    'all_pedestrian_info.csv': [people, ['link', 'track_id', 'analysis_run_id']],
    'all_time_info.csv': [videos.map(row => ({ link: row.link, analysis_seconds: 12 })), ['link', 'analysis_seconds']],
    'all_video_locations.csv': [options.locations ?? videos.map(row => ({ link: row.link, status: 'ok', lat: 51.5, lon: -0.1,
      confidence_level: 'low', confidence_spread_m: 2500, source_video_sha256: row.source_video_sha256,
      analysis_run_id: row.analysis_run_id, localization_origin_run_id: 'fixture-location-origin',
      localized_at: '2026-10-26T11:00:00Z' })), ['link', 'status', 'lat', 'lon']],
  };
  const manifest = { schema_version: 1, dataset_release_id: id, created_at: '2026-10-27T12:00:00Z',
    files: [], optional_artifacts: ANALYTICS_FILES.map(name => ({ path: name, status: 'omitted', reason: 'no synthetic statistics' })) };
  for (const [name, [rows, required]] of Object.entries(content)) {
    const { text, columns } = csvText(rows, required);
    fs.writeFileSync(path.join(dir, name), text);
    manifest.files.push({ path: name, columns, rows: rows.length,
      sha256: crypto.createHash('sha256').update(text).digest('hex') });
  }
  fs.writeFileSync(path.join(dir, 'release_manifest.json'), JSON.stringify(manifest));
  return dir;
}

function video(link, country = 'United Kingdom', id = 'geonames:2643743') {
  return { link, city: 'London', country, state: country === 'Canada' ? 'ON' : 'ENG',
    admin1_code: country === 'Canada' ? 'ON' : 'ENG', city_id: id, searched_city_id: id,
    discovery_run_id: 'discovery-fixture', sampling_strategy: 'within-city-random', search_order: '3',
    verified_city_id: id, eligibility_status: 'verified', location_verification_source: 'human:fixture',
    eligible_for_comparison: 'TRUE', analysis_status: 'complete', analysis_run_id: 'fixture-analysis',
    source_video_sha256: 'a'.repeat(64),
    video_name: `London1_${link}`, total_pedestrians: 2, total_crossed_pedestrians: 1,
    duration_seconds: 4, duration_source: 'video_metadata', total_frames: 4,
    risky_crossing_coverage: 1,
    metric_validity: { risky_crossing: { status: 'validated' }, phone_using: { status: 'validated' } },
    analyzed_at: '2026-10-26T12:00:00Z', analyzed_at_source: 'run_manifest', recording_date_source: 'unknown' };
}

function allAttributes(link, track, positive) {
  const flags = ['crossed', 'risky_crossing', 'run_red_light', 'crosswalk_use_or_not', 'phone_using',
    'backpack', 'umbrella', 'handbag', 'suitcase', 'short_sleeved_shirt', 'long_sleeved_shirt',
    'short_sleeved_outwear', 'long_sleeved_outwear', 'vest', 'sling', 'shorts', 'trousers', 'skirt',
    'short_sleeved_dress', 'long_sleeved_dress', 'vest_dress', 'sling_dress', 'daytime', 'police_car',
    'arrow_board', 'cones', 'accident', 'crack', 'potholes', 'crossing_sign', 'crosswalk', 'sidewalk',
    'ambulance', 'army vehicle', 'auto rickshaw', 'bicycle', 'bus', 'car', 'garbagevan', 'human',
    'hauler', 'minibus', 'minivan', 'motorbike', 'pickup', 'policecar', 'rickshaw', 'scooter', 'suv',
    'taxi', 'three wheelers -CNG-', 'truck', 'van', 'wheelbarrow', 'human hauler'];
  return { link, track_id: track, analysis_run_id: 'fixture-analysis',
    ...Object.fromEntries(flags.map(flag => [flag, positive ? '1.0' : '0.0'])),
    nearby_count_beginning: positive ? 1 : 2, nearby_count_whole: positive ? 3 : 4,
    gender: positive ? 'female' : 'unknown', age: positive ? 30 : 40,
    weather: positive ? 'rain' : 'clear', avg_vehicle_total: positive ? 2 : 4,
    avg_road_width: positive ? 8.5 : 9.5, walking_speed_mps: positive ? 1.2 : 2.2,
    crossing_speed_mps: positive ? 1.1 : 2.1, decision_delay_s: positive ? 0.5 : 1.5 };
}

test('actual publisher replaces partitions/attributes, activates atomically and rolls back', { timeout: 90000 }, async t => {
  const db = await database(t);
  const firstVideos = [video('abcdefghijk'), video('lmnopqrstuv', 'Canada', 'geonames:6058560')];
  const first = release(t, 'actual-release-1', firstVideos,
    [allAttributes('abcdefghijk', 1, true), allAttributes('abcdefghijk', 2, true), allAttributes('lmnopqrstuv', 3, true)]);
  const adapters = { db, Aggregator, importCoordinates: importVideoCoordinates, generateInsights };
  await publishRelease({ csvDir: first, ...adapters });
  const lineage = (await db.query('SELECT discovery_run_id, sampling_strategy, search_order FROM videos WHERE link=$1', ['abcdefghijk'])).rows[0];
  assert.deepEqual(lineage, { discovery_run_id: 'discovery-fixture', sampling_strategy: 'within-city-random', search_order: '3' });
  assert.equal((await db.query('SELECT count(*)::int AS n FROM pedestrians')).rows[0].n, 3);
  const second = release(t, 'actual-release-2', [video('abcdefghijk')], [allAttributes('abcdefghijk', 2, false)]);
  await publishRelease({ csvDir: second, ...adapters });
  const people = (await db.query('SELECT * FROM pedestrians')).rows;
  assert.equal(people.length, 1);
  assert.equal(people[0].track_id, 2);
  assert.equal(people[0].risky_crossing, false);
  const renamed = { 'army vehicle': 'army_vehicle', 'auto rickshaw': 'auto_rickshaw',
    'human hauler': 'human_hauler', 'three wheelers -CNG-': 'three_wheelers_cng' };
  for (const [source, value] of Object.entries(allAttributes('abcdefghijk', 2, false))) {
    if (value === '0.0') assert.equal(people[0][renamed[source] || source], false,
      `${source} was missing or retained a stale flag`);
  }
  assert.equal(people[0].weather, 'clear');
  assert.equal(people[0].gender, 'unknown');
  assert.equal(Number(people[0].age), 40);
  assert.equal(people[0].nearby_count_beginning, 2);
  assert.equal(people[0].nearby_count_whole, 4);
  assert.equal(people[0].avg_vehicle_total, 4);
  assert.equal(Number(people[0].avg_road_width), 9.5);
  assert.equal(Number(people[0].walking_speed_mps), 2.2);
  assert.equal(Number(people[0].crossing_speed_mps), 2.1);
  assert.equal(Number(people[0].decision_delay_s), 1.5);
  assert.equal((await db.query('SELECT count(*)::int AS n FROM videos')).rows[0].n, 1);
  const active = (await db.query('SELECT dataset_release_id FROM dataset_releases WHERE is_active')).rows;
  assert.deepEqual(active, [{ dataset_release_id: 'actual-release-2' }]);
  const city = (await db.query("SELECT insights FROM cities WHERE country='United Kingdom'")).rows[0];
  assert.match(JSON.stringify(city.insights), /1 videos and 1 tracked observations/);
  const before = JSON.stringify((await db.query('SELECT link,video_name,dataset_release_id FROM videos ORDER BY link')).rows);
  const third = release(t, 'actual-release-3', [{ ...video('abcdefghijk'), video_name: 'must roll back' }],
    [allAttributes('abcdefghijk', 99, true)]);
  await assert.rejects(publishRelease({ csvDir: third, ...adapters,
    generateInsights: async options => { await generateInsights(options); throw new Error('synthetic late failure'); } }), /synthetic late failure/);
  assert.equal(JSON.stringify((await db.query('SELECT link,video_name,dataset_release_id FROM videos ORDER BY link')).rows), before);
  assert.deepEqual((await db.query('SELECT track_id,weather FROM pedestrians')).rows, [{ track_id: 2, weather: 'clear' }]);
  assert.deepEqual((await db.query('SELECT dataset_release_id FROM dataset_releases WHERE is_active')).rows, active);
  assert.equal((await db.query("SELECT count(*)::int AS n FROM dataset_releases WHERE dataset_release_id='actual-release-3'")).rows[0].n, 0);
});

test('localization provenance follows the analyzed source and absent rows clear previous geography', { timeout: 90000 }, async t => {
  const db = await database(t);
  const link = 'abcdefghijk';
  const adapters = { db, Aggregator, importCoordinates: importVideoCoordinates, generateInsights };
  await publishRelease({ csvDir: release(t, 'source-release-1', [video(link)], [allAttributes(link, 1, true)]), ...adapters });
  const first = (await db.query('SELECT * FROM videos WHERE link=$1', [link])).rows[0];
  assert.equal(first.source_video_sha256, 'a'.repeat(64));
  assert.equal(first.localization_source_video_sha256, first.source_video_sha256);
  assert.equal(first.localization_analysis_run_id, first.analysis_run_id);
  assert.equal(first.localization_origin_run_id, 'fixture-location-origin');
  assert(first.localized_at);

  const sameClip = { ...video(link), analysis_run_id: 'new-code-run' };
  const samePeople = [{ ...allAttributes(link, 1, true), analysis_run_id: 'new-code-run' }];
  const locations = [{ link, status: 'ok', lat: 51.6, lon: -.2, source_video_sha256: 'a'.repeat(64),
    analysis_run_id: 'new-code-run', localization_origin_run_id: 'fixture-location-origin', localized_at: '2026-10-26T11:00:00Z' }];
  await publishRelease({ csvDir: release(t, 'source-release-2', [sameClip], samePeople, { locations }), ...adapters });
  const reused = (await db.query('SELECT * FROM videos WHERE link=$1', [link])).rows[0];
  assert.equal(reused.localization_analysis_run_id, 'new-code-run');
  assert.equal(reused.localization_origin_run_id, 'fixture-location-origin');
  assert.equal(Number(reused.latitude), 51.6);

  const changedClip = { ...video(link), source_video_sha256: 'b'.repeat(64), analysis_run_id: 'new-clip-run' };
  const changedPeople = [{ ...allAttributes(link, 1, true), analysis_run_id: 'new-clip-run' }];
  await publishRelease({ csvDir: release(t, 'source-release-3', [changedClip], changedPeople, { locations: [] }), ...adapters });
  const changed = (await db.query('SELECT * FROM videos WHERE link=$1', [link])).rows[0];
  assert.equal(changed.source_video_sha256, 'b'.repeat(64));
  for (const field of ['latitude', 'longitude', 'localization_confidence', 'localization_source_video_sha256',
    'localization_analysis_run_id', 'localization_origin_run_id', 'localized_at', 'localization_route']) {
    assert.equal(changed[field], null, `${field} retained evidence from a different clip`);
  }
});
