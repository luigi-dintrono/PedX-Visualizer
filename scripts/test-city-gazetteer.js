#!/usr/bin/env node
'use strict';

/**
 * Offline tests for the city gazetteer resolver (scripts/lib/city-gazetteer.js).
 * No DB / network. Exercises the project dataset (known-cities.json) + world layer (all-the-cities).
 *
 * Usage: node scripts/test-city-gazetteer.js
 */

const assert = require('assert');
const { normalizeCityName, resolveCity, cityExists, enrichCityRow } = require('./lib/city-gazetteer');

let passed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log(`  ✅ ${name}`); }
  catch (err) { console.error(`  ❌ ${name}\n     ${err.message}`); process.exitCode = 1; }
}

console.log('city-gazetteer tests\n');

test('normalizeCityName folds spacing, case, accents, special letters', () => {
  assert.strictEqual(normalizeCityName('New York'), 'newyork');
  assert.strictEqual(normalizeCityName('NewYork'), 'newyork');
  assert.strictEqual(normalizeCityName('new-york'), 'newyork');
  assert.strictEqual(normalizeCityName('München'), normalizeCityName('Munchen'));
  assert.strictEqual(normalizeCityName('Łódź'), 'lodz');
  assert.strictEqual(normalizeCityName(null), '');
});

test('resolveCity: "NewYork" -> canonical New York, US, North America, with coords (project)', () => {
  const r = resolveCity('NewYork');
  assert.ok(r.found && r.confident, 'found + confident');
  assert.strictEqual(r.source, 'project');
  assert.strictEqual(r.canonical.city, 'New York');
  assert.strictEqual(r.canonical.country, 'United States');
  assert.strictEqual(r.canonical.continent, 'North America');
  assert.ok(Number.isFinite(r.canonical.latitude) && Number.isFinite(r.canonical.longitude), 'has coords');
});

test('resolveCity: alias "NYC" resolves to New York', () => {
  const r = resolveCity('NYC');
  assert.ok(r.found && r.matchType === 'alias' && r.canonical.city === 'New York');
});

test('WORLD layer: "Shanghai" (not a studied city) resolves via all-the-cities', () => {
  const r = resolveCity('Shanghai');
  assert.ok(r.found && r.confident, 'found + confident');
  assert.strictEqual(r.source, 'all-the-cities');
  assert.strictEqual(r.canonical.continent, 'Asia');
  assert.ok(/China/i.test(r.canonical.country), `country was ${r.canonical.country}`);
  assert.ok(Number.isFinite(r.canonical.latitude), 'has coords');
});

test('cityExists: known true (project + world), gibberish false', () => {
  assert.strictEqual(cityExists('New York'), true);
  assert.strictEqual(cityExists('Delhi'), true);           // world layer
  assert.strictEqual(cityExists('Zzxqwv Not A City 999'), false);
});

test('enrichCityRow #1: "NewYork"/"USA" canonicalises BOTH key halves (the dedup fix)', () => {
  const row = { city: 'NewYork', country: 'USA', state: '', iso3: '', continent: '', lat: '', lon: '' };
  const e = enrichCityRow(row);
  assert.ok(e.matched && e.changed && e.renamed);
  assert.strictEqual(row.city, 'New York');
  assert.strictEqual(row.country, 'United States');       // "USA" -> canonical, so key merges
  assert.strictEqual(row.continent, 'North America');
  assert.ok(row.lat && row.lon, 'coords filled');
});

test('enrichCityRow: blank-geo world city is completed (Nairobi already project; use Kolkata)', () => {
  const row = { city: 'Kolkata', country: '', continent: '', lat: '', lon: '' };
  const e = enrichCityRow(row);
  assert.ok(e.matched && e.changed);
  assert.ok(/India/i.test(row.country) && row.continent === 'Asia');
  assert.ok(row.lat && row.lon);
});

test('enrichCityRow: complete row is left untouched (no clobbering good CSV data)', () => {
  const row = { city: 'Paris', country: 'France', state: 'X', iso3: 'FRA', continent: 'Europe', lat: '48.85', lon: '2.35' };
  const e = enrichCityRow(row);
  assert.strictEqual(e.changed, false);
  assert.strictEqual(row.lat, '48.85');
  assert.strictEqual(row.state, 'X');
});

test('SAFETY #3: country-hint mismatch is NOT confident and does not mutate the row', () => {
  // Tokyo exists (Japan); a "Canada" hint disagrees -> must not rewrite to Japan/Asia.
  const row = { city: 'Tokyo', country: 'Canada', continent: '', lat: '', lon: '' };
  const e = enrichCityRow(row);
  assert.strictEqual(e.confident, false);
  assert.strictEqual(e.changed, false);
  assert.strictEqual(row.country, 'Canada');   // untouched -> falls through to GeoNames
});

test('SAFETY #4: short typo is not fuzzy-matched (no silent mislocation)', () => {
  const e = enrichCityRow({ city: 'Toyko', country: '', continent: '', lat: '', lon: '' }); // len 5 < FUZZY_MIN_LEN
  assert.strictEqual(e.confident, false);
  assert.strictEqual(e.changed, false);
});

test('enrichCityRow: gibberish city is not matched (falls through to GeoNames placeholder)', () => {
  const e = enrichCityRow({ city: 'Zzxqwvville', country: '', continent: '', lat: '', lon: '' });
  assert.strictEqual(e.matched, false);
  assert.strictEqual(e.changed, false);
});

console.log(`\n${passed} passed${process.exitCode ? ' (with failures)' : ''}`);
