#!/usr/bin/env node
'use strict';

/**
 * Generate the OFFLINE city gazetteer (scripts/data/known-cities.json) from the app's
 * own canonical city rows in Postgres.
 *
 * Run this occasionally (it needs the DB); the JSON it writes is committed and consumed
 * offline by scripts/lib/city-gazetteer.js during CSV ingestion. Only cities with a real
 * country, continent and coordinates are exported — "Unknown"/placeholder rows are skipped,
 * and homonyms are de-duplicated keeping the most-observed (most videos) canonical row.
 *
 * Usage: node scripts/generate-city-gazetteer.js [--verbose]
 */

const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');
require('dotenv').config({ path: '.env.local' });
if (!process.env.DATABASE_URL) require('dotenv').config();

const { normalizeCityName } = require('./lib/city-gazetteer');

const OUT_PATH = path.join(__dirname, 'data', 'known-cities.json');
const VERBOSE = process.argv.includes('--verbose');

// Curated aliases for true synonyms/translations that name-normalisation alone can't fold
// ("NewYork" already folds to "New York"; "NYC" and "Bombay" do not). Only aliases whose
// target actually exists in the exported set are kept.
const CURATED_ALIASES = {
  'NYC': 'New York',
  'New York City': 'New York',
  'Bombay': 'Mumbai',
  'Calcutta': 'Kolkata',
  'Saigon': 'Ho Chi Minh City',
  'Peking': 'Beijing',
};

function round(n, dp = 6) {
  if (n == null) return null;
  const f = Math.pow(10, dp);
  return Math.round(Number(n) * f) / f;
}

async function main() {
  if (!process.env.DATABASE_URL) {
    console.error('❌ DATABASE_URL not set (expected in .env.local). Cannot generate gazetteer.');
    process.exit(1);
  }
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: (process.env.DATABASE_URL || '').includes('sslmode=require') ? { rejectUnauthorized: false } : false,
    max: 2,
  });

  try {
    const { rows } = await pool.query(`
      SELECT c.id, c.city, c.state, c.country, c.iso3, c.continent,
             c.latitude::float  AS latitude,
             c.longitude::float AS longitude,
             c.population_city,
             (SELECT COUNT(*) FROM videos v WHERE v.city_id = c.id) AS video_count
      FROM cities c
      WHERE c.country   IS NOT NULL AND btrim(c.country)   NOT IN ('', 'Unknown')
        AND c.continent IS NOT NULL AND btrim(c.continent) NOT IN ('', 'Unknown')
        AND c.latitude  IS NOT NULL
        AND c.longitude IS NOT NULL
      ORDER BY c.city, video_count DESC
    `);

    // De-duplicate homonyms by (normalized name + iso3/country), keeping the most-observed row.
    const byKey = new Map();
    let skippedDupes = 0;
    for (const r of rows) {
      const key = `${normalizeCityName(r.city)}|${(r.iso3 || normalizeCityName(r.country)).toUpperCase()}`;
      const prev = byKey.get(key);
      if (!prev || Number(r.video_count) > Number(prev.video_count)) {
        if (prev) skippedDupes++;
        byKey.set(key, r);
      } else {
        skippedDupes++;
      }
    }

    const cities = [...byKey.values()]
      .map((r) => ({
        city: r.city,
        state: r.state || null,
        country: r.country,
        iso3: r.iso3 || null,
        continent: r.continent,
        latitude: round(r.latitude),
        longitude: round(r.longitude),
        population_city: r.population_city != null ? Number(r.population_city) : null,
        video_count: Number(r.video_count) || 0,
      }))
      .sort((a, b) => a.city.localeCompare(b.city));

    // Keep only curated aliases whose canonical target is present.
    const canonicalNorms = new Set(cities.map((c) => normalizeCityName(c.city)));
    const aliases = {};
    for (const [alias, canonical] of Object.entries(CURATED_ALIASES)) {
      if (canonicalNorms.has(normalizeCityName(canonical))) aliases[alias] = canonical;
      else if (VERBOSE) console.log(`   (skipping alias ${alias} -> ${canonical}: target not in dataset)`);
    }

    const dataset = {
      meta: {
        source: 'generated from Postgres cities table by scripts/generate-city-gazetteer.js',
        generated_from_row_count: rows.length,
        city_count: cities.length,
        deduped_homonyms: skippedDupes,
        note: 'Offline reference — regenerate after importing new cities. Do not hand-edit city rows; add synonyms to CURATED_ALIASES in the generator.',
      },
      aliases,
      cities,
    };

    fs.mkdirSync(path.dirname(OUT_PATH), { recursive: true });
    fs.writeFileSync(OUT_PATH, JSON.stringify(dataset, null, 2) + '\n', 'utf8');

    console.log(`✅ Wrote ${cities.length} cities (${Object.keys(aliases).length} aliases, ${skippedDupes} homonyms deduped) to ${path.relative(process.cwd(), OUT_PATH)}`);
    const ny = cities.find((c) => normalizeCityName(c.city) === 'newyork');
    if (ny) console.log(`   sanity: New York -> ${ny.country} / ${ny.continent} @ ${ny.latitude},${ny.longitude}`);
    else console.log('   ⚠️  New York not found among canonical rows — check the source data.');
  } catch (err) {
    console.error('❌ Gazetteer generation failed:', err.message);
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
}

main();
