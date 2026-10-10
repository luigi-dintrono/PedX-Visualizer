#!/usr/bin/env node

/**
 * db:publish step: refit the per-city rate model (scripts/estimate_city_rates.py).
 *
 * Deliberately NON-FATAL. The nightly publish chains its steps with &&, so a missing Python
 * or a non-converged fit must not stop the core import, view refresh or insights. The model
 * script itself only replaces a metric's estimates after a fit passes its checks, so on any
 * failure the previously published intervals stay in place; this launcher just reports it.
 *
 * Python is taken from PEDX_PYTHON, else `python`, else the Windows `py -3` launcher.
 */

const { spawnSync } = require('child_process');
const path = require('path');

const script = path.join(__dirname, 'estimate_city_rates.py');
const candidates = process.env.PEDX_PYTHON
  ? [[process.env.PEDX_PYTHON, []]]
  : [['python', []], ['py', ['-3']]];

for (const [cmd, pre] of candidates) {
  const res = spawnSync(cmd, [...pre, script, ...process.argv.slice(2)], {
    stdio: 'inherit',
    timeout: 20 * 60 * 1000,
    windowsHide: true,
  });
  if (res.error && res.error.code === 'ENOENT') continue; // try the next interpreter
  if (res.status === 0) {
    console.log('✅ City rate model refreshed');
  } else {
    console.warn(`⚠️  City rate model did not complete (${res.error ? res.error.message : `exit ${res.status}`}); ` +
      'previous estimates kept. Publishing continues.');
  }
  process.exit(0);
}
console.warn('⚠️  No Python interpreter found (set PEDX_PYTHON); city rate model skipped. Publishing continues.');
process.exit(0);
