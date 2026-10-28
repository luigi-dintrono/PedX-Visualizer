import { NextRequest, NextResponse } from 'next/server';
import { pool } from '@/lib/database';
import { resolveCityId, AmbiguousCityError } from '@/lib/city-identity';
import { buildCohortQuery, getCohortCities } from '@/lib/cohort';
import { cohortInsights } from '@/lib/cohort-insights';
import { finite } from '@/lib/metrics';
export async function GET(request: NextRequest, { params }: { params: Promise<{ city: string }> }) {
  try {
    const { city } = await params;
    const id = await resolveCityId(city);
    if (id == null) return NextResponse.json({ success: false, error: 'City not found' }, { status: 404 });
    const search = new URL(request.url).searchParams;
    search.set('cityId', String(id));
    const query = buildCohortQuery(search);
    const [cohort, population] = await Promise.all([
      getCohortCities(search),
      pool.query(`${query.ctes} SELECT p.*, v.metric_validity FROM population p JOIN eligible_videos v ON v.id = p.video_id JOIN observations o ON o.city_id = v.city_id`, query.values),
    ]);
    const row = cohort.rows[0];
    if (!row) return NextResponse.json({ success: false, error: 'No eligible observations for this city and cohort' }, { status: 404 });
    const allowed = query.experimental ? ['validated', 'experimental', 'unknown'] : ['validated'];
    const breakdown = (column: string, validity: string) => {
      const rows = population.rows.filter(person => allowed.includes(person.metric_validity?.[validity]?.status || 'unknown') && person[column] != null);
      const counts = new Map<string, number>();
      rows.forEach(person => { const key = String(person[column]); counts.set(key, (counts.get(key) || 0) + 1); });
      return [...counts].map(([type, n]) => ({ type, n, percentage: n / rows.length * 100 }));
    };
    const validPeople = (key: string) => population.rows.filter(person => allowed.includes(person.metric_validity?.[key]?.status || 'unknown'));
    const agePeople = validPeople('age').filter(person => finite(person.age) != null);
    const age = [[18, 29, '18-29'], [30, 44, '30-44'], [45, 64, '45-64'], [65, Infinity, '65+']].map(([min, max, group]) => {
      const people = agePeople.filter(person => Number(person.age) >= Number(min) && Number(person.age) <= Number(max));
      const risky = people.filter(person => allowed.includes(person.metric_validity?.risky_crossing?.status || 'unknown') && person.risky_crossing != null);
      const red = people.filter(person => allowed.includes(person.metric_validity?.run_red_light?.status || 'unknown') && person.run_red_light != null);
      return { group, count: people.length, risky_rate: risky.length >= 30 ? risky.filter(person => person.risky_crossing === true).length / risky.length * 100 : null, risky_n: risky.length, red_light_rate: red.length >= 30 ? red.filter(person => person.run_red_light === true).length / red.length * 100 : null };
    }).filter(group => group.count > 0);
    const vehiclePeople = validPeople('vehicle_type');
    const vehicles = ['car', 'bus', 'truck', 'motorbike', 'bicycle'].flatMap(type => {
      const known = vehiclePeople.filter(person => person[type] != null);
      return known.length ? [{ type, n: known.length, percentage: known.filter(person => person[type] === true).length / known.length * 100 }] : [];
    });
    const emptyRank = { rank: null, total_cities: null };
    const n = Number(row.total_videos);
    return NextResponse.json({ success: true, data: {
      rankings: { crossing_speed: emptyRank, risky_crossing: emptyRank, run_red_light: emptyRank, measured_walking_speed: emptyRank },
      environment: { weather: breakdown('weather', 'weather'), daytime: breakdown('daytime', 'daytime') },
      demographics: { gender: breakdown('gender', 'gender'), age }, vehicles, risk_factors: [],
      avg_pedestrian_age: finite(row.avg_pedestrian_age), insights: cohortInsights(row, query.experimental),
      scope: cohort.scope, estimator: 'pooled_known_flags', dataset_release_ids: row.dataset_release_ids,
      measured_behavior: {
        pipeline: { dense_v2: Number(row.dense_videos || 0), legacy_1hz: Number(row.legacy_videos || 0), unversioned: Number(row.unversioned_videos || 0) },
        pedestrian_counts: { analysed: Number(row.total_pedestrians), tracked: finite(row.tracked_pedestrians) },
        crossing_speed: finite(row.avg_measured_crossing_speed) == null ? null : { mps: finite(row.avg_measured_crossing_speed), n: Number(row.measured_crossing_sample) },
        vehicle_speed: finite(row.avg_vehicle_speed) == null ? null : { median_mps: finite(row.avg_vehicle_speed), p85_mps: finite(row.vehicle_p85_speed), videos: n },
        flow: finite(row.mean_headway_s) == null ? null : { mean_headway_s: finite(row.mean_headway_s), platoon_frac: finite(row.platoon_frac), vehicles_per_min: finite(row.vehicle_flow_per_min), videos: Number(row.flow_videos) }, conflicts: finite(row.total_severe_conflicts) == null ? null : { severe: finite(row.total_severe_conflicts), moderate: finite(row.pet_moderate), queued: finite(row.pet_queued), min_pet_s: finite(row.pet_min_s), videos: n },
        signal: Number(row.signal_videos) ? { anticipatory_start_frac: finite(row.anticipatory_start_frac), mean_red_exposure_s: finite(row.mean_red_exposure_s), videos: Number(row.signal_videos) } : null, micro_events: finite(row.avg_hesitation_rate_dense) == null ? null : { hesitation_rate: finite(row.avg_hesitation_rate_dense), aborted_start_rate: finite(row.aborted_start_rate), evasive_events: finite(row.evasive_events), videos: n },
        social: finite(row.total_social_groups) == null ? null : { groups: finite(row.total_social_groups), grouped_pedestrians: finite(row.grouped_pedestrians_dense), videos: n },
        pose: finite(row.avg_look_before_cross) == null ? null : { look_before_cross_frac: finite(row.avg_look_before_cross), looked_both_ways_frac: finite(row.looked_both_ways_frac), median_cadence_hz: finite(row.median_cadence_hz), cadence_n: finite(row.cadence_n), videos: n },
        pedestrian_kinematics: Number(row.measured_walking_ped_sample) ? { walking_speed_mps: finite(row.avg_measured_walking_speed), crossing_speed_mps: finite(row.avg_measured_crossing_speed), decision_delay_s: null, n: Number(row.measured_walking_ped_sample), implausible_n: 0 } : null,
      }
    } });
  } catch (error) {
    console.error(error);
    return NextResponse.json({ success: false, error: error instanceof AmbiguousCityError ? error.message : 'City evidence unavailable' }, { status: error instanceof AmbiguousCityError ? 409 : 503 });
  }
}
