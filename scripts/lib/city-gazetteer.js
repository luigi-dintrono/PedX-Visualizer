'use strict';

/**
 * Offline city gazetteer / resolver.
 *
 * Answers "do we already know this city?" WITHOUT any network call, using two offline layers:
 *   1. the PROJECT gazetteer (scripts/data/known-cities.json) — the app's own canonical city
 *      rows, authoritative (your exact coords / continent labels / curated aliases); and
 *   2. a WORLD fallback (the `all-the-cities` package, ~135k cities pop >1000) for cities not
 *      yet in the project set — so big cities worldwide resolve even before they're studied.
 * The project layer always wins; the world layer only fills the gaps.
 *
 * Given a raw name like "NewYork" it returns the canonical record so ingestion can:
 *   1. confirm the city exists,
 *   2. backfill missing country / continent / coordinates, and
 *   3. canonicalise BOTH halves of the (city, country) key ("NewYork"/"USA" -> "New York"/
 *      "United States") so the row merges with the known row instead of duplicating.
 *
 * Geography is only ever rewritten on a CONFIDENT match (exact/alias name AND either a single
 * candidate or a supplied country/iso3 hint that matches one). Fuzzy and country-mismatched
 * matches are reported but never mutate a row — a wrong guess is worse than leaving it for the
 * GeoNames fallback. The module is pure/offline and degrades to "not found" if data is absent.
 */

const fs = require('fs');
const path = require('path');
const { countryName, iso2ToIso3, continentForIso2, toIso2 } = require('./country-data');

const DATA_PATH = path.join(__dirname, '..', 'data', 'known-cities.json');

// Confidence policy (surfaced so it's tunable without editing logic).
const FUZZY_MIN_LEN = 7;       // never fuzzy-match names shorter than this
const FUZZY_MAX_DISTANCE = 1;  // max Levenshtein distance for a fuzzy candidate

// Non-decomposable Latin letters NFD leaves intact — map to an ASCII base so "Łódź" ≈ "Lodz".
const SPECIAL_LETTERS = {
  'ł': 'l', 'đ': 'd', 'ø': 'o', 'ß': 'ss', 'æ': 'ae', 'œ': 'oe',
  'þ': 'th', 'ð': 'd', 'ħ': 'h', 'ı': 'i', 'ĸ': 'k', 'ŋ': 'n',
};

/** Fold a city name to a comparison key: strip accents, lowercase, drop non-alphanumerics. */
function normalizeCityName(name) {
  if (name == null) return '';
  let s = String(name).toLowerCase();
  s = s.replace(/[łđøßæœþðħıĸŋ]/g, (ch) => SPECIAL_LETTERS[ch] || ch);
  s = s.normalize('NFD').replace(/[̀-ͯ]/g, ''); // strip combining accents
  s = s.replace(/[^a-z0-9]+/g, '');
  return s;
}

// ---------------------------------------------------------------- project layer
let _proj = null;

function buildProjectIndex() {
  let raw = { cities: [], aliases: {}, meta: {} };
  try {
    raw = JSON.parse(fs.readFileSync(DATA_PATH, 'utf8'));
  } catch (err) {
    if (err.code !== 'ENOENT') console.warn(`[city-gazetteer] could not read ${DATA_PATH}: ${err.message}`);
  }
  const byName = new Map();   // normName -> record[]
  const aliases = new Map();  // normAlias -> normCanonicalName
  for (const rec of raw.cities || []) {
    const key = normalizeCityName(rec.city);
    if (!key) continue;
    if (!byName.has(key)) byName.set(key, []);
    byName.get(key).push(rec);
  }
  for (const [alias, canonical] of Object.entries(raw.aliases || {})) {
    const ak = normalizeCityName(alias), ck = normalizeCityName(canonical);
    if (ak && ck) aliases.set(ak, ck);
  }
  // Global alternate/historical name aliases (may target world-layer cities, not just project ones).
  try {
    const extra = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data', 'city-aliases.json'), 'utf8'));
    for (const [alias, canonical] of Object.entries(extra)) {
      if (alias.startsWith('_')) continue; // skip _comment
      const ak = normalizeCityName(alias), ck = normalizeCityName(canonical);
      if (ak && ck) aliases.set(ak, ck);
    }
  } catch (err) {
    if (err.code !== 'ENOENT') console.warn(`[city-gazetteer] could not read city-aliases.json: ${err.message}`);
  }
  return { byName, aliases, meta: raw.meta || {}, size: byName.size };
}
function projIndex() { if (!_proj) _proj = buildProjectIndex(); return _proj; }

// ---------------------------------------------------------------- world layer (all-the-cities)
let _world; // undefined = not built; Map = built; null = unavailable

function buildWorldIndex() {
  let all;
  try { all = require('all-the-cities'); }
  catch { return null; } // optional dependency not installed → world layer disabled
  const byName = new Map();
  for (const c of all) {
    const key = normalizeCityName(c.name);
    if (!key || !c.loc || !Array.isArray(c.loc.coordinates)) continue;
    let arr = byName.get(key);
    if (!arr) byName.set(key, arr = []);
    arr.push({ name: c.name, iso2: c.country, population: c.population || 0,
               latitude: c.loc.coordinates[1], longitude: c.loc.coordinates[0] });
  }
  return byName;
}
function worldIndex() { if (_world === undefined) _world = buildWorldIndex(); return _world; }

/** Reset caches (e.g. after regenerating the dataset in a long-running process). */
function reload() { _proj = null; _world = undefined; return projIndex(); }

// ---------------------------------------------------------------- canonical shape + helpers
function projToCanonical(rec) {
  return {
    city: rec.city, state: rec.state || null, country: rec.country, iso3: rec.iso3 || null,
    iso2: toIso2(rec.iso3 || rec.country), continent: rec.continent,
    latitude: rec.latitude, longitude: rec.longitude,
    population_city: rec.population_city ?? null, video_count: rec.video_count || 0, source: 'project',
  };
}
function worldToCanonical(rec) {
  return {
    city: rec.name, state: null, country: countryName(rec.iso2), iso3: iso2ToIso3(rec.iso2),
    iso2: rec.iso2 ? String(rec.iso2).toUpperCase() : null, continent: continentForIso2(rec.iso2),
    latitude: rec.latitude, longitude: rec.longitude,
    population_city: rec.population || null, video_count: 0, source: 'all-the-cities',
  };
}
const bestBy = (cands) =>
  cands.slice().sort((a, b) => (b.video_count || 0) - (a.video_count || 0) ||
                               (b.population_city || 0) - (a.population_city || 0))[0];

/**
 * Pick one canonical record from same-name candidates and decide confidence.
 * A supplied country/iso3 hint that matches a candidate → confident. A hint that matches none
 * (genuine disagreement or wrong homonym) → NOT confident. No hint + a single candidate →
 * confident; no hint + several → not confident (a guess).
 */
function disambiguate(cands, opts) {
  const hintIso2 = toIso2(opts.iso3) || toIso2(opts.country);
  const hintNorm = normalizeCityName(opts.country);
  const hasHint = !!(opts.country || opts.iso3);
  const matches = cands.filter((c) =>
    (hintIso2 && c.iso2 && c.iso2 === hintIso2) ||
    (hintNorm && normalizeCityName(c.country) === hintNorm));

  if (hasHint) {
    if (matches.length) return { rec: bestBy(matches), confident: true, ambiguous: cands.length > 1 };
    return { rec: bestBy(cands), confident: false, ambiguous: true, hintMismatch: true };
  }
  if (cands.length === 1) return { rec: cands[0], confident: true, ambiguous: false };
  return { rec: bestBy(cands), confident: false, ambiguous: true };
}

// Capped Levenshtein for the fuzzy last resort.
function levenshtein(a, b, cap) {
  if (Math.abs(a.length - b.length) > cap) return cap + 1;
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i]; let best = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost);
      if (cur[j] < best) best = cur[j];
    }
    if (best > cap) return cap + 1;
    prev = cur;
  }
  return prev[b.length];
}
// Only returns a match when there is a UNIQUE nearest key within the cap.
function bestFuzzy(norm) {
  if (norm.length < FUZZY_MIN_LEN) return null;
  const idx = projIndex();
  let best = null, bestDist = FUZZY_MAX_DISTANCE + 1, tie = false;
  for (const [key, recs] of idx.byName) {
    const d = levenshtein(norm, key, FUZZY_MAX_DISTANCE);
    if (d < bestDist) { bestDist = d; best = recs; tie = false; }
    else if (d === bestDist && d <= FUZZY_MAX_DISTANCE) tie = true;
  }
  if (!best || bestDist > FUZZY_MAX_DISTANCE || tie) return null;
  return { rec: best[0], ambiguous: best.length > 1 };
}

/**
 * Resolve a raw city name to a canonical record.
 * @param {string} name
 * @param {object} [opts] { country, iso3 }  (used to disambiguate homonyms / confirm a match)
 * @returns {{found, matchType?, source?, confident?, ambiguous?, canonical?, input, reason?}}
 *          matchType: 'exact' | 'alias' | 'world' | 'fuzzy'
 */
function resolveCity(name, opts = {}) {
  const norm = normalizeCityName(name);
  if (!norm) return { found: false, reason: 'empty-name', input: name, canonical: null };

  // Resolve an alias to its canonical NAME first, then look that up in project → world,
  // so a historical name (e.g. "Bangalore" -> "Bengaluru") can hit either layer.
  const proj = projIndex();
  let lookup = norm, matchType = 'exact';
  if (!proj.byName.has(lookup) && proj.aliases.has(lookup)) { lookup = proj.aliases.get(lookup); matchType = 'alias'; }

  // 1) project
  const recs = proj.byName.get(lookup);
  if (recs && recs.length) {
    const d = disambiguate(recs.map(projToCanonical), opts);
    return { found: true, matchType, source: 'project', confident: d.confident, ambiguous: d.ambiguous, canonical: d.rec, input: name };
  }

  // 2) world fallback (all-the-cities)
  const wi = worldIndex();
  const wrecs = wi ? wi.get(lookup) : null;
  if (wrecs && wrecs.length) {
    const d = disambiguate(wrecs.map(worldToCanonical), opts);
    return { found: true, matchType: matchType === 'alias' ? 'alias' : 'world', source: 'all-the-cities', confident: d.confident, ambiguous: d.ambiguous, canonical: d.rec, input: name };
  }

  // 3) fuzzy project (unique nearest only) — reported, never confident
  const fz = bestFuzzy(norm);
  if (fz) return { found: true, matchType: 'fuzzy', source: 'project', confident: false, ambiguous: fz.ambiguous, canonical: projToCanonical(fz.rec), input: name };

  return { found: false, reason: 'no-match', input: name, canonical: null };
}

/** Boolean convenience wrapper (true even for a fuzzy/ambiguous hit — "some real city"). */
function cityExists(name, opts = {}) { return resolveCity(name, opts).found; }

/**
 * Enrich a raw CSV row in place from a CONFIDENT gazetteer match: fill blank
 * country/iso3/continent/state/lat/lon and canonicalise BOTH halves of the (city, country)
 * key so it merges with the known row. Non-confident (fuzzy / country-mismatch / ambiguous)
 * matches never mutate the row — they're left for the caller's GeoNames fallback.
 * @returns {{matched, changed, confident, renamed, filledFields:string[], resolution}}
 */
function enrichCityRow(row) {
  const blank = (v) => v == null || String(v).trim() === '' || String(v).trim().toLowerCase() === 'unknown';
  const res = resolveCity(row.city, { country: row.country, iso3: row.iso3 });
  if (!res.found || !res.confident) {
    return { matched: res.found, changed: false, confident: !!res.confident, renamed: false, filledFields: [], resolution: res };
  }
  const c = res.canonical;
  const filled = [];
  const fill = (key, value) => { if (blank(row[key]) && value != null && value !== '') { row[key] = value; filled.push(key); } };

  fill('country', c.country);
  fill('iso3', c.iso3);
  fill('continent', c.continent);
  fill('state', c.state);
  fill('lat', c.latitude);
  fill('lon', c.longitude);

  // Canonicalise the dedup key to the known spelling (confident match only).
  let renamed = false;
  if (c.city && row.city !== c.city) { row.city = c.city; renamed = true; }
  if (c.country && row.country !== c.country) { row.country = c.country; renamed = true; }
  if (c.iso3 && row.iso3 !== c.iso3) { row.iso3 = c.iso3; }

  return { matched: true, changed: renamed || filled.length > 0, confident: true, renamed, filledFields: filled, matchType: res.matchType, canonical: c, resolution: res };
}

module.exports = { normalizeCityName, resolveCity, cityExists, enrichCityRow, reload, FUZZY_MIN_LEN, FUZZY_MAX_DISTANCE };

// ---- CLI: node scripts/lib/city-gazetteer.js "NewYork" [country] ----
if (require.main === module) {
  const [name, country] = process.argv.slice(2);
  if (!name) {
    const wi = worldIndex();
    console.log('Usage: node scripts/lib/city-gazetteer.js "<city name>" [country]');
    console.log(`Project cities: ${projIndex().size} | world layer: ${wi ? wi.size + ' names' : 'unavailable (all-the-cities not installed)'}`);
    process.exit(1);
  }
  const res = resolveCity(name, { country });
  console.log(JSON.stringify(res, null, 2));
  process.exit(res.found ? 0 : 2);
}
