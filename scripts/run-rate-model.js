#!/usr/bin/env node

// Fitting is separate from atomic publication. Only an explicit, still-active
// dataset release may receive intervals; unversioned writes are disabled.
const { spawnSync } = require('node:child_process');
const path = require('node:path');

function runRateModel(argv = process.argv.slice(2), { env = process.env, spawn = spawnSync, log = console } = {}) {
  const index = argv.indexOf('--dataset-release-id');
  const explicit = argv.find(arg => arg.startsWith('--dataset-release-id='));
  const releaseId = explicit ? explicit.split('=').slice(1).join('=')
    : index >= 0 ? argv[index + 1] : env.PEDX_DATASET_RELEASE_ID;
  if (!releaseId || releaseId.startsWith('--')) {
    const result = { status: 'disabled_unversioned', reason: 'Set --dataset-release-id or PEDX_DATASET_RELEASE_ID; no model was run or written.' };
    log.warn(JSON.stringify(result));
    return result;
  }
  const forwarded = index >= 0 || explicit ? argv : [...argv, '--dataset-release-id', releaseId];
  const candidates = env.PEDX_PYTHON ? [[env.PEDX_PYTHON, []]] : [['python', []], ['py', ['-3']]];
  for (const [cmd, pre] of candidates) {
    const result = spawn(cmd, [...pre, path.join(__dirname, 'estimate_city_rates.py'), ...forwarded], {
      stdio: 'inherit', timeout: 20 * 60 * 1000, windowsHide: true, env,
    });
    if (result.error && result.error.code === 'ENOENT') continue;
    const status = result.status === 0 ? 'completed_for_release' : 'unavailable_for_release';
    const report = { status, dataset_release_id: releaseId,
      reason: result.error ? result.error.message : result.status === 0 ? null : `Model exited ${result.status}; no interval from another release is retained.` };
    (result.status === 0 ? log.log : log.warn).call(log, JSON.stringify(report));
    return report;
  }
  const report = { status: 'unavailable_for_release', dataset_release_id: releaseId, reason: 'No Python interpreter found; no model written.' };
  log.warn(JSON.stringify(report));
  return report;
}
if (require.main === module) {
  const result = runRateModel();
  process.exitCode = result.status === 'completed_for_release' ? 0 : 1;
}
module.exports = { runRateModel };
