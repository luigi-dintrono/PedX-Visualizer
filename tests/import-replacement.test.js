const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const Aggregator = require('../scripts/aggregate-csv-data');
const { importVideoCoordinates, parseCoord } = require('../scripts/import-video-coordinates');
const { assertStandaloneImportAllowed } = require('../scripts/lib/release-guard');

function temporary(t, csv) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pedx-import-test-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const file = path.join(dir, 'locations.csv');
  if (csv != null) fs.writeFileSync(file, csv);
  return { dir, file };
}
test('reanalyzed video replaces disappeared tracks and every pedestrian attribute', async () => {
  const stored = new Map();
  const queries = [];
  const db = { query: async (sql, values) => {
    queries.push(sql);
    if (sql.startsWith('DELETE FROM pedestrians')) stored.clear();
    if (sql.startsWith('INSERT INTO pedestrians')) {
      const columns = sql.match(/\((.*?)\)/)[1].split(',').map(value => value.trim());
      const row = Object.fromEntries(columns.map((column, index) => [column, values[index]]));
      stored.set(row.track_id, row);
    }
    return { rows: [] };
  } };
  const importer = new Aggregator({ db });
  importer.videoCache.set('abcdefghijk', 7);
  await importer.aggregatePedestrians([{ link: 'abcdefghijk', track_id: 1, weather: 'rain', backpack: '1', car: '1' }]);
  assert.equal(stored.get(1).backpack, true);
  await importer.aggregatePedestrians([{ link: 'abcdefghijk', track_id: 2, weather: 'cloudy', backpack: '0', car: '0', avg_road_width: '8.5' }]);
  assert.equal(stored.size, 1);
  assert.equal(stored.has(1), false);
  assert.equal(stored.get(2).weather, 'cloudy');
  assert.equal(stored.get(2).car, false);
  assert.equal(stored.get(2).avg_road_width, 8.5);
  await importer.aggregatePedestrians([]);
  assert.equal(stored.size, 0);
  assert.equal(queries.filter(sql => sql.startsWith('DELETE')).length, 3);
});
test('pedestrian SQL errors propagate to the transaction owner', async () => {
  const importer = new Aggregator({ db: { query: async sql => { if (sql.startsWith('INSERT')) throw new Error('insert rejected'); return { rows: [] }; } } });
  importer.videoCache.set('abcdefghijk', 7);
  await assert.rejects(() => importer.aggregatePedestrians([{ link: 'abcdefghijk', track_id: 1 }]), /Pedestrian import failed/);
});
test('ambiguous legacy cities are refused instead of assigning an arbitrary country/admin row', async () => {
  const importer = new Aggregator({ db: { query: async () => ({ rows: [{ id: 1 }, { id: 2 }] }) } });
  await assert.rejects(() => importer.aggregateCities([{ city_id: 'place:us:il:springfield', city: 'Springfield', country: 'United States', state: 'IL' }]), /Ambiguous legacy city/);
});
test('failed localization clears an old location, uncertainty and route together', async t => {
  const { file } = temporary(t, 'link,status\nabcdefghijk,network_error\n');
  const queries = [];
  const db = { query: async sql => {
    queries.push(sql);
    return { rows: sql.startsWith('UPDATE') ? [{ id: 1 }] : [{ localized_ok: 0, with_coords: 0, total: 1 }] };
  } };
  await importVideoCoordinates({ db, csvPath: file });
  assert.match(queries[0], /latitude = NULL/);
  assert.match(queries[0], /localization_confidence = NULL/);
  assert.match(queries[0], /localization_route = NULL/);
  assert.ok(!queries.some(sql => /^(BEGIN|COMMIT|ROLLBACK)$/.test(sql)));
});
test('malformed localization and unknown video rows reject the whole import', async t => {
  const { file } = temporary(t, 'link,status,lat,lon\nabcdefghijk,ok,50garbage,3\n');
  const db = { query: async () => ({ rows: [] }) };
  await assert.rejects(() => importVideoCoordinates({ db, csvPath: file }), /rejected/);
  fs.writeFileSync(file, 'link,status\nabcdefghijk,network_error\n');
  await assert.rejects(() => importVideoCoordinates({ db, csvPath: file }), /rejected/);
  assert.equal(parseCoord('50garbage', -90, 90), null);
  assert.equal(parseCoord('', -90, 90), null);
  assert.equal(parseCoord('0', -90, 90), 0);
});
test('full statistical rows retain n, confidence intervals and FDR as release evidence', async () => {
  const statements = [];
  const db = { query: async (sql, values) => { statements.push({ sql, values }); return { rows: [{ id: 1 }] }; } };
  const importer = new Aggregator({ db, releaseManifest: { dataset_release_id: 'release-test' } });
  const row = { age: '30-44', risky_crossing: '0', risky_crossing_n: '50', risky_crossing_n_clusters: '7', risky_crossing_ci_low: '0', risky_crossing_ci_high: '0.1', q_value_bh: '0.5' };
  await importer.processStatsFile('age_stats.csv', [row]);
  const snapshot = statements.find(({ sql }) => sql.startsWith('INSERT INTO dataset_statistics'));
  assert.equal(snapshot.values[0], 'release-test');
  assert.deepEqual(JSON.parse(snapshot.values[3]), row);
  assert.ok(statements.findIndex(({ sql }) => sql.startsWith('DELETE FROM dataset_statistics')) < statements.indexOf(snapshot));
});
test('invalid UTF-8 fails before any database writes', async t => {
  const { file } = temporary(t);
  fs.writeFileSync(file, Buffer.from([0xff, 0xfe, 0x61]));
  await assert.rejects(() => Aggregator.readCSV(file), /not valid UTF-8/);
});
test('pandas float boolean tokens are accepted while invalid text is rejected', () => {
  assert.equal(Aggregator.safeBoolean('1.0'), true);
  assert.equal(Aggregator.safeBoolean('0.0'), false);
  assert.equal(Aggregator.safeBoolean('nan'), null);
  assert.throws(() => Aggregator.safeBoolean('unrecognized-value'), /Invalid boolean/);
});
test('standalone imports cannot bypass an active immutable release', async () => {
  const events = [];
  const db = { query: async sql => { events.push(sql); return { rows: sql.includes('FROM dataset_releases') ? [{ dataset_release_id: 'active' }] : [] }; } };
  await assert.rejects(() => assertStandaloneImportAllowed(db), /active dataset release is immutable/);
  assert.match(events[0], /pg_advisory_xact_lock/);
});
test('legacy audit import is allowed only before any release is active', async () => {
  await assert.doesNotReject(() => assertStandaloneImportAllowed({ query: async () => ({ rows: [] }) }));
});
