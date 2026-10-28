// Fractions remain fractions in SQL and API responses. Conversion happens once, at display.
const METRICS = {
  risky_crossing: { name: 'Risky crossing', property: 'risky_crossing_rate', flag: 'risky_crossing', sample: 'risky_crossing_determined', minN: 30, unit: '%', validityKey: 'risky_crossing' },
  run_red_light: { name: 'Red light crossing', property: 'run_red_light_rate', flag: 'run_red_light', sample: 'run_red_light_sample', minN: 30, unit: '%', validityKey: 'run_red_light' },
  crosswalk_usage: { name: 'Crosswalk usage', property: 'crosswalk_usage_rate', flag: 'crosswalk_use_or_not', sample: 'crosswalk_usage_sample', minN: 30, unit: '%', validityKey: 'crosswalk_use_or_not' },
  phone_usage: { name: 'Phone usage', property: 'phone_usage_rate', flag: 'phone_using', sample: 'phone_usage_sample', minN: 30, unit: '%', validityKey: 'phone_using' },
  measured_crossing_speed: { name: 'Measured crossing speed', property: 'avg_measured_crossing_speed', sample: 'measured_crossing_sample', minN: 10, unit: 'm/s', validityKey: 'crossing_speed_mps' },
  measured_walking_speed: { name: 'Measured walking speed', property: 'avg_measured_walking_speed', sample: 'measured_walking_ped_sample', minN: 30, unit: 'm/s', validityKey: 'walking_speed_mps' },
  look_before_cross: { name: 'Head scanning before crossing', property: 'avg_look_before_cross', sample: 'look_before_cross_sample', minN: 30, unit: '%', validityKey: 'look_before_cross_frac' },
  severe_conflicts: { name: 'Severe conflicts per 100 pedestrians', property: 'severe_conflicts_per_100_ped', sample: 'pet_exposure_pedestrians', minN: 30, unit: 'per 100 ped', validityKey: 'pet_severe_conflicts' },
  hesitation_rate: { name: 'Hesitation rate', property: 'avg_hesitation_rate_dense', sample: 'hesitation_dense_pedestrians', minN: 30, unit: '%', validityKey: 'hesitation_rate' },
  vehicle_speed: { name: 'Measured vehicle speed', property: 'avg_vehicle_speed', sample: 'vehicle_speed_sample', minN: 30, unit: 'm/s', validityKey: 'vehicle_median_speed_mps' },
  social_groups: { name: 'Pedestrians walking in groups', property: 'grouped_pedestrian_share_dense', sample: 'social_dense_pedestrians', minN: 30, unit: '%', validityKey: 'grouped_pedestrians' },
  avg_age: { name: 'Estimated age', property: 'avg_pedestrian_age', sample: 'age_sample', minN: 30, unit: 'years', validityKey: 'age' },
  pedestrian_density: { name: 'Tracked pedestrians per video', property: 'avg_pedestrians_per_video', sample: 'total_pedestrians', minN: 30, unit: 'peds/video', validityKey: 'total_pedestrians' },
  road_width: { name: 'Estimated road width', property: 'avg_road_width', sample: 'total_pedestrians', minN: 30, unit: 'm', validityKey: 'avg_road_width' },
  crossing_speed: { name: 'Reference crossing speed', property: 'avg_crossing_speed', minN: 0, unit: 'm/s', referenceOnly: true },
  crossing_time: { name: 'Reference crossing time', property: 'avg_crossing_time', minN: 0, unit: 's', referenceOnly: true },
};
function finite(value) {
  if (value == null || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}
function displayValue(value, unit, decimals = 1) {
  const n = finite(value);
  return n == null ? 'N/A' : (unit === '%' ? n * 100 : n).toFixed(decimals);
}
function knownRate(values) {
  const known = values.filter(value => value === true || value === false);
  return { value: known.length ? known.filter(Boolean).length / known.length : null, n: known.length };
}
function comparableValue(row, metric) {
  const definition = METRICS[metric];
  if (!row || !definition || definition.referenceOnly) return null;
  if (definition.sample && (finite(row[definition.sample]) ?? 0) < definition.minN) return null;
  return finite(row[definition.property]);
}
module.exports = { METRICS, finite, displayValue, knownRate, comparableValue };
