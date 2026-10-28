const { finite, METRICS } = require('./metric-definitions');
function relationshipEvidence(filename, row, metric) {
  if (/not valid/i.test(row.validity_note || '')) return null;
  const definition = METRICS[metric];
  if (!definition || definition.referenceOnly) return null;
  if (filename === 'inferential_associations.csv') {
    if (row.outcome !== metric) return null;
    const value = finite(row.estimate), lo = finite(row.ci_low), hi = finite(row.ci_high);
    const n = finite(row.n_obs), cities = finite(row.n_clusters), q = finite(row.q_value_bh);
    if (value == null || lo == null || hi == null || n == null || cities == null || n < definition.minN || cities < 5 || lo > hi) return null;
    return {
      factor: row.term_label || row.term, category: 'Adjusted associations', value: `${value.toFixed(2)} ${row.scale || ''}`,
      effect: 'Association', effectSize: 0, n, cities, ciLow: lo, ciHigh: hi, qValue: q,
      description: `${row.term_label || row.term}: ${row.scale || 'estimate'} ${value.toFixed(2)} (95% CI ${lo.toFixed(2)}–${hi.toFixed(2)}); n=${n}, ${cities} cities. ${q == null ? 'Multiplicity-adjusted evidence unavailable.' : `BH-FDR q=${q.toPrecision(3)}.`} ${row.adjusted_for ? `Adjusted for ${row.adjusted_for}.` : ''} Observational association, without a causal interpretation. ${row.caveat || ''}`,
    };
  }
  const candidates = metric === 'risky_crossing' ? ['risky_crossing', 'risky_crossing_prob', 'risky_crossing_rate(%)']
    : metric === 'run_red_light' ? ['run_red_light', 'run_red_light_prob', 'run_red_light_rate(%)']
    : metric === 'crosswalk_usage' ? ['crosswalk_usage_ratio'] : [];
  const column = candidates.find(key => Object.hasOwn(row, key));
  if (!column) return null;
  const scale = /prob|\(%\)/.test(column) ? 1 : 100;
  const value = finite(row[column]), lo = finite(row[`${column}_ci_low`]), hi = finite(row[`${column}_ci_high`]);
  const n = finite(row[`${column}_n`]), cities = finite(row[`${column}_n_clusters`]);
  if (value == null || lo == null || hi == null || n == null || cities == null || n < definition.minN || cities < 5 || lo > hi) return null;
  const factor = row.age || row.gender || row.accessory || row.clothing_type || row.vehicle_type || row.environment_factor || [row.weather, row.daytime].filter(Boolean).join(' / ') || row.continent;
  if (!factor) return null;
  return {
    factor, category: 'Observed subgroups', value: `${(value * scale).toFixed(1)}%`,
    effect: 'Observed rate', effectSize: 0, n, cities, ciLow: lo * scale, ciHigh: hi * scale, qValue: null,
    description: `${factor}: ${(value * scale).toFixed(1)}% (95% city-bootstrap CI ${(lo * scale).toFixed(1)}–${(hi * scale).toFixed(1)}%); n=${n}, ${cities} cities. Descriptive subgroup estimate; no adjusted contrast or causal effect is established.`,
  };
}
module.exports = { relationshipEvidence };
