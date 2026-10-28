import { pool } from '@/lib/database';
import { METRICS } from '@/lib/metrics';

// Every map, ranking and city card uses this population. Missing flags stay unknown;
// sample sizes count known flags, rather than silently treating unknown as negative.
export function buildCohortQuery(search: URLSearchParams) {
  const values: unknown[] = [];
  const parameter = (value: unknown) => { values.push(value); return `$${values.length}`; };
  const experimental = search.get('includeExperimental') === 'true';
  const allowed = experimental ? ['validated', 'experimental', 'unknown'] : ['validated'];
  const statusValues = parameter(allowed);
  const status = (metric: string) => {
    const definition = METRICS[metric];
    const keys = [...new Set([definition?.validityKey, metric, definition?.property].filter(Boolean))];
    return `COALESCE(${keys.map(key => `v.metric_validity->'${key}'->>'status'`).join(', ')}, 'unknown')`;
  };
  const gate = (metric: string) => `(${status(metric)} = ANY(${statusValues}::text[]))`;
  // Opting into experimental measurements never bypasses geographic/completion eligibility.
  const videoWhere = ['v.eligible_for_comparison IS TRUE', "v.analysis_status = 'complete'"];
  videoWhere.push('v.dataset_release_id = (SELECT dataset_release_id FROM dataset_releases WHERE is_active)');
  const pedestrianWhere: string[] = [];
  const cityWhere = ['o.cohort_video_count > 0'];
  const list = (name: string) => (search.get(name) || '').split(',').filter(Boolean);
  const continents = list('continents');
  if (continents.length) videoWhere.push(`c.continent = ANY(${parameter(continents)}::text[])`);
  const countries = list('countries');
  if (countries.length) videoWhere.push(`c.country = ANY(${parameter(countries)}::text[])`);
  const cityId = search.get('cityId');
  if (cityId) {
    if (!/^\d+$/.test(cityId)) throw new Error('cityId must be a numeric city identifier');
    videoWhere.push(`c.id = ${parameter(Number(cityId))}`);
  }
  const analyzedBefore = search.get('analyzedBefore');
  if (analyzedBefore) {
    if (!Number.isFinite(Date.parse(analyzedBefore))) throw new Error('Invalid analysis cutoff');
    videoWhere.push(`v.analyzed_at <= ${parameter(analyzedBefore)}::timestamptz`);
  }
  for (const [name, column, source] of [
    ['gender', 'p.gender', 'gender'], ['weather', 'p.weather', 'weather'],
  ]) {
    const selected = list(name);
    if (selected.length) {
      pedestrianWhere.push(`COALESCE(NULLIF(${column}, ''), 'unknown') = ANY(${parameter(selected)}::text[])`);
      // Invalid classifiers are never a basis for a cohort, including experimental mode.
      videoWhere.push(`COALESCE(v.metric_validity->'${source}'->>'status', 'unknown') = ANY(${statusValues}::text[])`);
    }
  }
  const daytime = search.get('daytime');
  if (daytime === 'true' || daytime === 'false') {
    pedestrianWhere.push(`p.daytime IS ${daytime === 'true' ? 'TRUE' : 'FALSE'}`);
    videoWhere.push(`COALESCE(v.metric_validity->'daytime'->>'status', 'unknown') = ANY(${statusValues}::text[])`);
  }
  const columnLists: Record<string, Record<string, string>> = {
    shirtType: { 'short-sleeved': 'short_sleeved_shirt', 'long-sleeved': 'long_sleeved_shirt', vest: 'vest' },
    bottomWear: { shorts: 'shorts', trousers: 'trousers', skirt: 'skirt' },
  };
  for (const [name, columns] of Object.entries(columnLists)) {
    const selected = list(name).map(value => columns[value]).filter(Boolean);
    if (selected.length) {
      pedestrianWhere.push(`(${selected.map(column => `p.${column} IS TRUE`).join(' OR ')})`);
      videoWhere.push(gate('clothing'));
    }
  }
  for (const [name, column] of Object.entries({ riskyCrossing: 'risky_crossing', runRedLight: 'run_red_light', crosswalkUse: 'crosswalk_use_or_not', phoneUse: 'phone_using', backpack: 'backpack', umbrella: 'umbrella', handbag: 'handbag', suitcase: 'suitcase' })) {
    const value = search.get(name);
    if (value === 'true' || value === 'false') {
      pedestrianWhere.push(`p.${column} IS ${value === 'true' ? 'TRUE' : 'FALSE'}`);
      const source = ({ riskyCrossing: 'risky_crossing', runRedLight: 'run_red_light', crosswalkUse: 'crosswalk_usage', phoneUse: 'phone_usage' } as Record<string, string>)[name] || 'belongings';
      videoWhere.push(gate(source));
    }
  }
  for (const [name, column, where] of [
    ['Population', 'c.population_city', videoWhere], ['Age', 'p.age', pedestrianWhere],
    ['CrossingSpeed', 'p.crossing_speed_mps', pedestrianWhere], ['RoadWidth', 'p.avg_road_width', pedestrianWhere],
  ] as const) {
    for (const [prefix, operator] of [['min', '>='], ['max', '<=']]) {
      const raw = search.get(`${prefix}${name}`);
      if (raw !== null) {
        const number = Number(raw);
        if (!Number.isFinite(number) || number < 0) throw new Error(`Invalid ${prefix}${name}`);
        where.push(`${column} ${operator} ${parameter(number)}`);
        const source = ({ Age: 'avg_age', CrossingSpeed: 'measured_crossing_speed', RoadWidth: 'road_width' } as Record<string, string>)[name];
        if (source) videoWhere.push(gate(source));
      }
    }
  }
  const vehicleHaving: string[] = [];
  for (const name of ['Car', 'Bus', 'Truck', 'Motorbike', 'Bicycle']) {
    for (const [prefix, operator] of [['min', '>='], ['max', '<=']]) {
      const raw = search.get(`${prefix}${name}`);
      if (raw !== null) {
        const number = Number(raw);
        if (!Number.isSafeInteger(number) || number < 0) throw new Error(`Invalid ${prefix}${name}`);
        // An unknown-only flag column has no observed count; it is not a measured zero.
        vehicleHaving.push(`COUNT(p.${name.toLowerCase()}) > 0`);
        vehicleHaving.push(`COUNT(*) FILTER (WHERE p.${name.toLowerCase()} IS TRUE) ${operator} ${parameter(number)}`);
        videoWhere.push(gate('vehicle_type'));
      }
    }
  }
  const rates = Object.entries(METRICS).filter(([, definition]) => definition.flag).flatMap(([metric, definition]) => [
    `COUNT(p.${definition.flag}) FILTER (WHERE ${gate(metric)})::int AS ${definition.sample}`,
    `(COUNT(*) FILTER (WHERE p.${definition.flag} IS TRUE AND ${gate(metric)}))::float / NULLIF(COUNT(p.${definition.flag}) FILTER (WHERE ${gate(metric)}), 0) AS ${definition.property}`,
  ]);
  const hasPedestrianFilters = pedestrianWhere.length > 0;
  const selectedMetric = search.get('metric');
  if (selectedMetric && !METRICS[selectedMetric]) throw new Error('Unknown metric');
  if (selectedMetric && !METRICS[selectedMetric].referenceOnly) videoWhere.push(gate(selectedMetric));
  // A whole-video event count cannot be assigned to a filtered pedestrian subset.
  // Such metrics become unavailable instead of presenting a mismatched denominator.
  const videoMetrics = ['avg_look_before_cross', 'total_severe_conflicts', 'avg_hesitation_rate', 'avg_vehicle_speed', 'total_social_groups', 'look_before_cross_sample', 'vehicle_speed_sample', 'pet_exposure_pedestrians', 'social_dense_pedestrians', 'hesitation_dense_pedestrians', 'severe_conflicts_per_100_ped', 'grouped_pedestrians_dense', 'grouped_pedestrian_share_dense', 'avg_hesitation_rate_dense', 'vehicle_p85_speed', 'mean_headway_s', 'platoon_frac', 'vehicle_flow_per_min', 'flow_videos', 'pet_moderate', 'pet_queued', 'pet_min_s', 'signal_videos', 'anticipatory_start_frac', 'mean_red_exposure_s', 'aborted_start_rate', 'evasive_events', 'looked_both_ways_frac', 'median_cadence_hz', 'cadence_n'];
  const supportedVideoMetrics = videoMetrics.map(column => hasPedestrianFilters ? `NULL::float AS ${column}` : `vs.${column}`);
  const ctes = `WITH eligible_videos AS (
      SELECT v.*, c.country, c.continent FROM videos v JOIN cities c ON c.id = v.city_id
      WHERE ${videoWhere.join(' AND ')}
    ), video_summary AS (
      SELECT v.city_id,
        AVG(v.crossing_speed) AS reference_crossing_speed,
        AVG(v.crossing_time) AS reference_crossing_time,
        COUNT(*) FILTER (WHERE v.pipeline_version = 'dense_v2')::int AS dense_videos,
        COUNT(*) FILTER (WHERE v.pipeline_version = 'legacy_1hz')::int AS legacy_videos,
        COUNT(*) FILTER (WHERE v.pipeline_version IS NULL)::int AS unversioned_videos,
        SUM(v.total_pedestrians) AS tracked_pedestrians,
        AVG(v.vehicle_p85_speed_mps) FILTER (WHERE ${gate('vehicle_p85_speed_mps')}) AS vehicle_p85_speed,
        AVG(v.mean_headway_s) FILTER (WHERE ${gate('mean_headway_s')}) AS mean_headway_s,
        AVG(v.platoon_frac) FILTER (WHERE ${gate('platoon_frac')}) AS platoon_frac,
        AVG(v.vehicle_flow_per_min) FILTER (WHERE ${gate('vehicle_flow_per_min')}) AS vehicle_flow_per_min,
        COUNT(v.mean_headway_s) FILTER (WHERE ${gate('mean_headway_s')})::int AS flow_videos,
        SUM(v.pet_moderate_conflicts) FILTER (WHERE ${gate('pet_moderate_conflicts')}) AS pet_moderate,
        SUM(v.pet_queued_interactions) FILTER (WHERE ${gate('pet_queued_interactions')}) AS pet_queued,
        MIN(v.pet_min_s) FILTER (WHERE ${gate('pet_min_s')}) AS pet_min_s,
        COUNT(v.anticipatory_start_frac) FILTER (WHERE ${gate('anticipatory_start_frac')})::int AS signal_videos,
        AVG(v.anticipatory_start_frac) FILTER (WHERE ${gate('anticipatory_start_frac')}) AS anticipatory_start_frac,
        AVG(v.mean_red_exposure_s) FILTER (WHERE ${gate('mean_red_exposure_s')}) AS mean_red_exposure_s,
        AVG(v.aborted_start_rate) FILTER (WHERE ${gate('aborted_start_rate')}) AS aborted_start_rate,
        SUM(v.evasive_event_count) FILTER (WHERE ${gate('evasive_event_count')}) AS evasive_events,
        AVG(v.looked_both_ways_frac) FILTER (WHERE ${gate('looked_both_ways_frac')}) AS looked_both_ways_frac,
        AVG(v.median_cadence_hz) FILTER (WHERE ${gate('median_cadence_hz')}) AS median_cadence_hz,
        SUM(v.cadence_n) FILTER (WHERE ${gate('cadence_n')}) AS cadence_n,
        AVG(v.look_before_cross_frac) FILTER (WHERE ${gate('look_before_cross')}) AS avg_look_before_cross,
        SUM(v.total_crossed_pedestrians) FILTER (WHERE ${gate('look_before_cross')} AND v.look_before_cross_frac IS NOT NULL) AS look_before_cross_sample,
        SUM(v.pet_severe_conflicts) FILTER (WHERE ${gate('severe_conflicts')}) AS total_severe_conflicts,
        SUM(v.total_pedestrians) FILTER (WHERE ${gate('severe_conflicts')} AND v.pet_severe_conflicts IS NOT NULL) AS pet_exposure_pedestrians,
        100.0 * SUM(v.pet_severe_conflicts) FILTER (WHERE ${gate('severe_conflicts')}) /
          NULLIF(SUM(v.total_pedestrians) FILTER (WHERE ${gate('severe_conflicts')} AND v.pet_severe_conflicts IS NOT NULL), 0) AS severe_conflicts_per_100_ped,
        AVG(v.hesitation_rate) FILTER (WHERE ${gate('hesitation_rate')}) AS avg_hesitation_rate,
        AVG(v.hesitation_rate) FILTER (WHERE ${gate('hesitation_rate')} AND v.pipeline_version = 'dense_v2') AS avg_hesitation_rate_dense,
        SUM(v.total_pedestrians) FILTER (WHERE ${gate('hesitation_rate')} AND v.pipeline_version = 'dense_v2' AND v.hesitation_rate IS NOT NULL) AS hesitation_dense_pedestrians,
        AVG(v.vehicle_median_speed_mps) FILTER (WHERE ${gate('vehicle_speed')}) AS avg_vehicle_speed,
        SUM(v.total_vehicles) FILTER (WHERE ${gate('vehicle_speed')} AND v.vehicle_median_speed_mps IS NOT NULL) AS vehicle_speed_sample,
        SUM(v.n_social_groups) FILTER (WHERE ${gate('social_groups')}) AS total_social_groups,
        SUM(v.grouped_pedestrians) FILTER (WHERE ${gate('social_groups')} AND v.pipeline_version = 'dense_v2') AS grouped_pedestrians_dense,
        SUM(v.total_pedestrians) FILTER (WHERE ${gate('social_groups')} AND v.pipeline_version = 'dense_v2' AND v.n_social_groups IS NOT NULL) AS social_dense_pedestrians,
        SUM(v.grouped_pedestrians) FILTER (WHERE ${gate('social_groups')} AND v.pipeline_version = 'dense_v2')::float /
          NULLIF(SUM(v.total_pedestrians) FILTER (WHERE ${gate('social_groups')} AND v.pipeline_version = 'dense_v2' AND v.n_social_groups IS NOT NULL), 0) AS grouped_pedestrian_share_dense
      FROM eligible_videos v GROUP BY v.city_id
    ), population AS (
      SELECT p.* FROM pedestrians p JOIN eligible_videos v ON v.id = p.video_id
      ${pedestrianWhere.length ? `WHERE ${pedestrianWhere.join(' AND ')}` : ''}
    ), observations AS (
      SELECT v.city_id, COUNT(DISTINCT v.id) ${hasPedestrianFilters ? 'FILTER (WHERE p.id IS NOT NULL)' : ''}::int AS cohort_video_count,
        COUNT(p.id)::int AS cohort_pedestrian_count,
        COUNT(DISTINCT v.id) FILTER (WHERE v.pipeline_version = 'dense_v2' ${hasPedestrianFilters ? 'AND p.id IS NOT NULL' : ''})::int AS dense_videos,
        COUNT(DISTINCT v.id) FILTER (WHERE v.pipeline_version = 'legacy_1hz' ${hasPedestrianFilters ? 'AND p.id IS NOT NULL' : ''})::int AS legacy_videos,
        COUNT(DISTINCT v.id) FILTER (WHERE COALESCE(v.pipeline_version, '') NOT IN ('dense_v2', 'legacy_1hz') ${hasPedestrianFilters ? 'AND p.id IS NOT NULL' : ''})::int AS unversioned_videos,
        ${rates.join(',\n')},
        AVG(p.age) FILTER (WHERE ${gate('avg_age')}) AS cohort_age,
        COUNT(p.age) FILTER (WHERE ${gate('avg_age')})::int AS cohort_age_sample,
        AVG(p.walking_speed_mps) FILTER (WHERE ${gate('measured_walking_speed')} AND p.walking_speed_mps BETWEEN 0.1 AND 4) AS cohort_walking_speed,
        COUNT(p.walking_speed_mps) FILTER (WHERE ${gate('measured_walking_speed')} AND p.walking_speed_mps BETWEEN 0.1 AND 4)::int AS cohort_walking_sample,
        AVG(p.crossing_speed_mps) FILTER (WHERE ${gate('measured_crossing_speed')} AND p.crossing_speed_mps BETWEEN 0.1 AND 4) AS cohort_crossing_speed,
        COUNT(p.crossing_speed_mps) FILTER (WHERE ${gate('measured_crossing_speed')} AND p.crossing_speed_mps BETWEEN 0.1 AND 4)::int AS cohort_crossing_sample,
        AVG(p.avg_road_width) FILTER (WHERE ${gate('road_width')}) AS cohort_road_width,
        ARRAY_AGG(DISTINCT v.dataset_release_id) FILTER (WHERE v.dataset_release_id IS NOT NULL) AS dataset_release_ids
      FROM eligible_videos v LEFT JOIN population p ON p.video_id = v.id GROUP BY v.city_id
      ${hasPedestrianFilters || vehicleHaving.length ? `HAVING COUNT(p.id) > 0 ${vehicleHaving.map(condition => `AND ${condition}`).join(' ')}` : ''}
    )`;
  const query = `${ctes} SELECT c.id, c.city, c.country, c.continent, c.latitude, c.longitude,
      c.population_city, c.traffic_mortality, c.literacy_rate, c.gini,
      vs.reference_crossing_speed AS avg_crossing_speed, vs.reference_crossing_time AS avg_crossing_time,
      c.external_city_id, c.admin1_code,
      o.cohort_video_count AS total_videos, o.cohort_pedestrian_count AS total_pedestrians,
      o.cohort_age AS avg_pedestrian_age, o.cohort_age_sample AS age_sample,
      o.cohort_walking_speed AS avg_measured_walking_speed, o.cohort_walking_sample AS measured_walking_ped_sample,
      o.cohort_crossing_speed AS avg_measured_crossing_speed, o.cohort_crossing_sample AS measured_crossing_sample,
      o.cohort_road_width AS avg_road_width,
      o.cohort_pedestrian_count::float / NULLIF(o.cohort_video_count, 0) AS avg_pedestrians_per_video,
      ${Object.values(METRICS).filter(definition => definition.flag).flatMap(definition => [`o.${definition.property}`, `o.${definition.sample}`]).join(', ')},
      o.dataset_release_ids, o.dense_videos, o.legacy_videos, o.unversioned_videos,
      ${hasPedestrianFilters ? 'NULL::int' : 'vs.tracked_pedestrians'} AS tracked_pedestrians
      ${supportedVideoMetrics.length ? `, ${supportedVideoMetrics.join(', ')}` : ''}
      FROM cities c JOIN observations o ON o.city_id = c.id
      JOIN video_summary vs ON vs.city_id = c.id
      WHERE ${cityWhere.join(' AND ')} ORDER BY c.country, c.city, c.id`;
  return { text: query, ctes, values, experimental, hasPedestrianFilters };
}

export async function getCohortCities(search: URLSearchParams) {
  const query = buildCohortQuery(search);
  const result = await pool.query(query.text, query.values);
  let intervals = 0;
  if (!query.experimental && !query.hasPedestrianFilters) {
    const estimates = await pool.query(`SELECT e.* FROM city_metric_estimates e
      JOIN dataset_releases r ON r.dataset_release_id = e.dataset_release_id AND r.is_active
      JOIN metric_model_runs m ON m.id = e.model_run_id AND m.accepted AND m.dataset_release_id = r.dataset_release_id`);
    const cities = new Map(result.rows.map(row => [Number(row.id), row]));
    for (const estimate of estimates.rows) {
      const definition = METRICS[estimate.metric];
      const row = cities.get(Number(estimate.city_id));
      if (!row || !definition?.flag || !definition.sample) continue;
      if (!Array.isArray(row.dataset_release_ids) || !row.dataset_release_ids.includes(estimate.dataset_release_id)) continue;
      const n = Number(row[definition.sample]);
      if (n !== Number(estimate.n_obs) || Math.abs(Number(row[definition.property]) * n - Number(estimate.n_successes)) > 1e-6) continue;
      const metric = estimate.metric;
      Object.assign(row, { [`${metric}_videos`]: Number(estimate.n_videos), [`${metric}_est`]: Number(estimate.est_mean), [`${metric}_lo`]: Number(estimate.est_low), [`${metric}_hi`]: Number(estimate.est_high) });
      if ([...search.keys()].every(key => key === 'metric')) {
        Object.assign(row, { [`${metric}_rank_lo`]: estimate.rank_low, [`${metric}_rank_hi`]: estimate.rank_high, [`${metric}_ranked`]: estimate.ranked_cities });
      }
      intervals++;
    }
  }
  return {
    rows: result.rows,
    scope: query.experimental ? 'Eligible observations with experimental measures; invalid metrics excluded' : 'Eligible observations with validated metrics',
    experimental: query.experimental,
    hasPedestrianFilters: query.hasPedestrianFilters,
    intervalStatus: intervals ? 'current_release' : 'unavailable_pending_current_release_fit',
  };
}
