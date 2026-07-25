import { NextRequest, NextResponse } from 'next/server';
import { pool } from '@/lib/database';
import { READ_CACHE_HEADERS } from '@/lib/http';

interface CityRankings {
  speed_rank?: number;
  risky_rank?: number;
  red_light_rank?: number;
  total_cities_for_speed?: number;
  // MEASURED walking speed (sparse: only cities with dense-tracked videos have a rank)
  measured_walking_speed_rank?: number;
  total_cities_for_measured_speed?: number;
}

interface RiskFactorRow {
  factor?: string;
  risk_increase?: number;
  sample_size?: number;
}

interface AgeRow {
  avg_age?: number;
}

interface EnvironmentRow {
  main_weather?: string;
  percentage?: number;
}

interface DaytimeRow {
  daytime?: string;
  percentage?: number;
}

interface GenderRow {
  gender?: string;
  percentage?: number;
}

interface AgeGroupRow {
  age_group?: string;
  count?: number;
  risky_rate?: number;
  red_light_rate?: number;
}

interface VehicleRow {
  vehicle_type?: string;
  count?: number;
  percentage?: number;
}

// Per-city rollup of the PedX-Insight behavioural modules ([I1] PET conflicts, [V8]/[V11]
// vehicle kinematics, [P10] signal timing, [P11] micro-events, [I2]/[I3] social groups,
// [P12] pose) plus the measured per-pedestrian kinematics from [S1]. Every field is NULL
// when the underlying module never ran for this city's videos — that is reported as
// "not measured", never as zero.
interface MeasuredBehaviorRow {
  dense_v2_videos?: number;
  legacy_videos?: number;
  unversioned_videos?: number;
  crossing_speed_mps?: number;
  crossing_speed_n?: number;
  vehicle_median_speed_mps?: number;
  vehicle_p85_speed_mps?: number;
  vehicle_speed_videos?: number;
  mean_headway_s?: number;
  platoon_frac?: number;
  vehicle_flow_per_min?: number;
  flow_videos?: number;
  pet_severe?: number;
  pet_moderate?: number;
  pet_queued?: number;
  pet_min_s?: number;
  pet_videos?: number;
  anticipatory_start_frac?: number;
  mean_red_exposure_s?: number;
  signal_videos?: number;
  hesitation_rate?: number;
  aborted_start_rate?: number;
  evasive_events?: number;
  micro_event_videos?: number;
  social_groups?: number;
  grouped_pedestrians?: number;
  social_videos?: number;
  look_before_cross_frac?: number;
  looked_both_ways_frac?: number;
  median_cadence_hz?: number;
  cadence_n?: number;
  pose_videos?: number;
  ped_walking_speed_mps?: number;
  ped_crossing_speed_mps?: number;
  ped_decision_delay_s?: number;
  ped_speed_n?: number;
  ped_speed_implausible_n?: number;
  analysed_pedestrians?: number;
  tracked_pedestrians?: number;
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ city: string }> }
) {
  try {
    const { city: cityParam } = await params;
    const city = decodeURIComponent(cityParam);

    // UTF-8 is enforced via the Pool's client_encoding option (src/lib/database.ts).
    // A per-request `SET client_encoding` on the pool is unreliable (it lands on an
    // arbitrary pooled connection, not necessarily the ones used below) and was removed.

    // Get city ID first (plus the per-city insights JSONB: serving it here keeps the huge
    // bulk /api/cities list free of insights — they're only ever shown for the selected city)
    const cityResult = await pool.query(
      `SELECT id, insights FROM cities WHERE city = $1 LIMIT 1`,
      [city]
    );

    if (cityResult.rows.length === 0) {
      return NextResponse.json(
        { success: false, error: 'City not found' },
        { status: 404 }
      );
    }

    const cityId = cityResult.rows[0].id;

    // All primary queries below are independent, so run them CONCURRENTLY instead of as
    // ~8 sequential Neon round-trips (which made this route take >1s warm). Each query keeps
    // its own error isolation: a failure logs and yields empty rows, never a 500. The rare
    // fallback queries (empty MV row, no video weather, missing avg age) still run
    // sequentially afterwards, matching the original behavior.
    const safeQuery = <T,>(label: string, sql: string, params: unknown[]): Promise<{ rows: T[] }> =>
      pool.query(sql, params).then(
        (r) => r as unknown as { rows: T[] },
        (err) => {
          console.error(`Error fetching ${label}:`, err);
          return { rows: [] as T[] };
        }
      );

    const [
      rankingsResult,
      environmentPrimary,
      daytimePrimary,
      genderPrimary,
      agePrimary,
      vehiclesPrimary,
      riskFactorsPrimary,
      citySummaryResult,
      measuredBehaviorPrimary,
    ] = await Promise.all([
      safeQuery<CityRankings>('rankings', `
        SELECT
          speed_rank,
          risky_rank,
          red_light_rank,
          measured_walking_speed_rank,
          (SELECT COUNT(*) FROM mv_city_insights WHERE speed_rank IS NOT NULL) as total_cities_for_speed,
          (SELECT COUNT(*) FROM mv_city_insights WHERE measured_walking_speed_rank IS NOT NULL) as total_cities_for_measured_speed
        FROM mv_city_insights
        WHERE city_id = $1
      `, [cityId]),
      safeQuery<EnvironmentRow>('environment data', `
        SELECT
          main_weather,
          COUNT(*) as video_count,
          COUNT(*)::FLOAT / NULLIF(SUM(COUNT(*)) OVER (), 0) * 100 as percentage
        FROM videos
        WHERE city_id = $1
          AND main_weather IS NOT NULL
          AND main_weather != ''
          AND main_weather NOT IN ('sunrise', 'sunset', 'dawn', 'dusk')
        GROUP BY main_weather
        ORDER BY video_count DESC
      `, [cityId]),
      // daytime is a BOOLEAN column, so compare it as one. The previous
      // `p.daytime = 1 / = '1'` comparisons threw "operator does not exist: boolean = integer",
      // which was swallowed by the catch and left the Day/Night breakdown permanently empty.
      safeQuery<DaytimeRow>('daytime data', `
        SELECT
          CASE WHEN p.daytime THEN 'Day' ELSE 'Night' END as daytime,
          COUNT(*) as count,
          COUNT(*)::FLOAT / NULLIF(SUM(COUNT(*)) OVER (), 0) * 100 as percentage
        FROM pedestrians p
        JOIN videos v ON p.video_id = v.id
        WHERE v.city_id = $1 AND p.daytime IS NOT NULL
        GROUP BY CASE WHEN p.daytime THEN 'Day' ELSE 'Night' END
        ORDER BY count DESC
      `, [cityId]),
      safeQuery<GenderRow>('gender data', `
        SELECT
          gender,
          COUNT(*) as count,
          COUNT(*)::FLOAT / NULLIF(SUM(COUNT(*)) OVER (), 0) * 100 as percentage
        FROM pedestrians p
        JOIN videos v ON p.video_id = v.id
        WHERE v.city_id = $1 AND p.gender IS NOT NULL AND p.gender != ''
        GROUP BY gender
        ORDER BY count DESC
      `, [cityId]),
      safeQuery<AgeGroupRow>('age data', `
        SELECT
          CASE
            WHEN age < 18 THEN 'Under 18'
            WHEN age BETWEEN 18 AND 30 THEN '18-30'
            WHEN age BETWEEN 31 AND 50 THEN '31-50'
            WHEN age > 50 THEN '50+'
            ELSE 'Unknown'
          END as age_group,
          COUNT(*) as count,
          AVG(CASE WHEN risky_crossing THEN 1 ELSE 0 END) * 100 as risky_rate,
          AVG(CASE WHEN run_red_light THEN 1 ELSE 0 END) * 100 as red_light_rate
        FROM pedestrians p
        JOIN videos v ON p.video_id = v.id
        WHERE v.city_id = $1 AND p.age IS NOT NULL
        GROUP BY
          CASE
            WHEN age < 18 THEN 'Under 18'
            WHEN age BETWEEN 18 AND 30 THEN '18-30'
            WHEN age BETWEEN 31 AND 50 THEN '31-50'
            WHEN age > 50 THEN '50+'
            ELSE 'Unknown'
          END
        ORDER BY
          -- Must be an aggregate: this expression differs from the GROUP BY expression, so
          -- bare CASE ... age ... raised 42803 ("p.age must appear in GROUP BY") — silently
          -- swallowed for years, leaving the age breakdown permanently empty. Every row in a
          -- group shares the same bucket, so MIN() picks that bucket's sort key.
          MIN(CASE
            WHEN age < 18 THEN 1
            WHEN age BETWEEN 18 AND 30 THEN 2
            WHEN age BETWEEN 31 AND 50 THEN 3
            WHEN age > 50 THEN 4
            ELSE 5
          END)
      `, [cityId]),
      // Vehicle type distribution over ALL vehicle observations so percentages sum to 100.
      // Single scan with FILTER + unpivot (was 7 UNION ALL scans of pedestrians).
      safeQuery<VehicleRow>('vehicle data', `
        WITH counts AS (
          SELECT
            COUNT(*) FILTER (WHERE p.car)       AS car,
            COUNT(*) FILTER (WHERE p.bus)       AS bus,
            COUNT(*) FILTER (WHERE p.motorbike) AS motorbike,
            COUNT(*) FILTER (WHERE p.bicycle)   AS bicycle,
            COUNT(*) FILTER (WHERE p.truck)     AS truck,
            COUNT(*) FILTER (WHERE p.taxi)      AS taxi,
            COUNT(*) FILTER (WHERE p.suv)       AS suv
          FROM pedestrians p
          JOIN videos v ON p.video_id = v.id
          WHERE v.city_id = $1
        ),
        vehicle_observations AS (
          SELECT t.vehicle_type, t.count
          FROM counts c
          CROSS JOIN LATERAL (VALUES
            ('car', c.car), ('bus', c.bus), ('motorbike', c.motorbike),
            ('bicycle', c.bicycle), ('truck', c.truck), ('taxi', c.taxi), ('suv', c.suv)
          ) AS t(vehicle_type, count)
        )
        SELECT
          vehicle_type,
          count,
          count::FLOAT / NULLIF(SUM(count) OVER (), 0) * 100 as percentage
        FROM vehicle_observations
        WHERE count > 0
        ORDER BY count DESC
        LIMIT 10
      `, [cityId]),
      safeQuery<RiskFactorRow>('risk factors', `
        SELECT
          'Weather: ' || main_weather as factor,
          AVG(risky_crossing_ratio) * 100 as risk_increase,
          COUNT(*) as sample_size
        FROM videos
        WHERE city_id = $1 AND main_weather IS NOT NULL AND main_weather != ''
        GROUP BY main_weather
        HAVING COUNT(*) >= 2
        ORDER BY AVG(risky_crossing_ratio) DESC
        LIMIT 3
      `, [cityId]),
      safeQuery<{ avg_pedestrian_age?: number }>('city summary avg age', `
        SELECT avg_pedestrian_age
        FROM mv_city_summary
        WHERE id = $1
      `, [cityId]),
      // Measured behaviour rollup. Two notes on the statistics:
      //  * Per-video figures that carry their own sample size (crossing speed) are combined
      //    as a sample-weighted mean, not a mean-of-medians, so a 2-crosser video cannot
      //    outvote a 100-crosser one.
      //  * Per-pedestrian kinematics use the MEDIAN, because the raw tracks contain
      //    physically impossible outliers (walking speeds up to ~7.6 m/s). Those rows are
      //    counted separately in *_implausible_n rather than silently averaged in.
      safeQuery<MeasuredBehaviorRow>('measured behavior', `
        WITH vid AS (
          SELECT * FROM videos WHERE city_id = $1
        ), ped AS (
          SELECT p.walking_speed_mps, p.crossing_speed_mps, p.decision_delay_s
          FROM pedestrians p JOIN videos v ON v.id = p.video_id
          WHERE v.city_id = $1
        )
        SELECT
          COUNT(*) FILTER (WHERE pipeline_version = 'dense_v2')   AS dense_v2_videos,
          COUNT(*) FILTER (WHERE pipeline_version = 'legacy_1hz') AS legacy_videos,
          COUNT(*) FILTER (WHERE pipeline_version IS NULL)        AS unversioned_videos,

          SUM(measured_crossing_speed_mps * measured_crossing_speed_n)
            / NULLIF(SUM(measured_crossing_speed_n) FILTER (WHERE measured_crossing_speed_mps IS NOT NULL), 0)
                                                                  AS crossing_speed_mps,
          SUM(measured_crossing_speed_n) FILTER (WHERE measured_crossing_speed_mps IS NOT NULL)
                                                                  AS crossing_speed_n,

          AVG(vehicle_median_speed_mps)                           AS vehicle_median_speed_mps,
          AVG(vehicle_p85_speed_mps)                              AS vehicle_p85_speed_mps,
          COUNT(vehicle_median_speed_mps)                         AS vehicle_speed_videos,

          AVG(mean_headway_s)                                     AS mean_headway_s,
          AVG(platoon_frac)                                       AS platoon_frac,
          AVG(vehicle_flow_per_min)                               AS vehicle_flow_per_min,
          COUNT(vehicle_flow_per_min)                             AS flow_videos,

          SUM(pet_severe_conflicts)                               AS pet_severe,
          SUM(pet_moderate_conflicts)                             AS pet_moderate,
          SUM(pet_queued_interactions)                            AS pet_queued,
          MIN(pet_min_s)                                          AS pet_min_s,
          COUNT(pet_severe_conflicts)                             AS pet_videos,

          AVG(anticipatory_start_frac)                            AS anticipatory_start_frac,
          AVG(mean_red_exposure_s)                                AS mean_red_exposure_s,
          COUNT(anticipatory_start_frac)                          AS signal_videos,

          AVG(hesitation_rate)                                    AS hesitation_rate,
          AVG(aborted_start_rate)                                 AS aborted_start_rate,
          SUM(evasive_event_count)                                AS evasive_events,
          COUNT(hesitation_rate)                                  AS micro_event_videos,

          SUM(n_social_groups)                                    AS social_groups,
          SUM(grouped_pedestrians)                                AS grouped_pedestrians,
          COUNT(n_social_groups)                                  AS social_videos,

          AVG(look_before_cross_frac)                             AS look_before_cross_frac,
          AVG(looked_both_ways_frac)                              AS looked_both_ways_frac,
          SUM(median_cadence_hz * cadence_n) / NULLIF(SUM(cadence_n) FILTER (WHERE median_cadence_hz IS NOT NULL), 0)
                                                                  AS median_cadence_hz,
          SUM(cadence_n) FILTER (WHERE median_cadence_hz IS NOT NULL) AS cadence_n,
          COUNT(look_before_cross_frac)                           AS pose_videos,

          (SELECT PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY walking_speed_mps)
             FROM ped WHERE walking_speed_mps BETWEEN 0.3 AND 3.0)  AS ped_walking_speed_mps,
          (SELECT PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY crossing_speed_mps)
             FROM ped WHERE crossing_speed_mps BETWEEN 0.3 AND 4.0) AS ped_crossing_speed_mps,
          (SELECT PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY decision_delay_s)
             FROM ped WHERE decision_delay_s >= 0)                  AS ped_decision_delay_s,
          (SELECT COUNT(*) FROM ped WHERE walking_speed_mps BETWEEN 0.3 AND 3.0)
                                                                    AS ped_speed_n,
          (SELECT COUNT(*) FROM ped
            WHERE walking_speed_mps IS NOT NULL
              AND walking_speed_mps NOT BETWEEN 0.3 AND 3.0)         AS ped_speed_implausible_n,

          -- Two different populations, deliberately reported side by side: the rows that
          -- exist in the pedestrians table (what every rate metric is computed over) versus
          -- the full tracked count the pipeline reported. Under dense_v2 these differ by
          -- roughly an order of magnitude.
          (SELECT COUNT(*) FROM pedestrians p JOIN videos v ON v.id = p.video_id WHERE v.city_id = $1)
                                                                    AS analysed_pedestrians,
          SUM(total_pedestrians)                                    AS tracked_pedestrians
        FROM vid
      `, [cityId]),
    ]);

    // 1. Rankings (fallback to direct calculation when the MV has no row for this city)
    let rankings: CityRankings = rankingsResult.rows[0] || {};
    try {
      if (!rankings.speed_rank) {
        const directRankings = await pool.query(`
          SELECT 
            (SELECT COUNT(*) + 1 
             FROM (
               SELECT AVG(v.crossing_speed) as avg_speed
               FROM videos v
               WHERE v.city_id != $1 AND v.crossing_speed IS NOT NULL
               GROUP BY v.city_id
               HAVING AVG(v.crossing_speed) > (SELECT AVG(v2.crossing_speed) FROM videos v2 WHERE v2.city_id = $1)
             ) sub) as speed_rank,
            (SELECT COUNT(*) + 1 
             FROM (
               SELECT AVG(v.risky_crossing_ratio) as avg_risky
               FROM videos v
               WHERE v.city_id != $1 AND v.risky_crossing_ratio IS NOT NULL
               GROUP BY v.city_id
               HAVING AVG(v.risky_crossing_ratio) > (SELECT AVG(v2.risky_crossing_ratio) FROM videos v2 WHERE v2.city_id = $1)
             ) sub) as risky_rank,
            (SELECT COUNT(*) + 1 
             FROM (
               SELECT AVG(v.run_red_light_ratio) as avg_red
               FROM videos v
               WHERE v.city_id != $1 AND v.run_red_light_ratio IS NOT NULL
               GROUP BY v.city_id
               HAVING AVG(v.run_red_light_ratio) > (SELECT AVG(v2.run_red_light_ratio) FROM videos v2 WHERE v2.city_id = $1)
             ) sub) as red_light_rank,
            (CASE WHEN EXISTS (SELECT 1 FROM videos v0 WHERE v0.city_id = $1 AND v0.measured_walking_speed_mps IS NOT NULL)
             THEN (SELECT COUNT(*) + 1
               FROM (
                 SELECT AVG(v.measured_walking_speed_mps) as avg_measured
                 FROM videos v
                 WHERE v.city_id != $1 AND v.measured_walking_speed_mps IS NOT NULL
                 GROUP BY v.city_id
                 HAVING AVG(v.measured_walking_speed_mps) > (SELECT AVG(v2.measured_walking_speed_mps) FROM videos v2 WHERE v2.city_id = $1 AND v2.measured_walking_speed_mps IS NOT NULL)
               ) sub)
             ELSE NULL END) as measured_walking_speed_rank,
            (SELECT COUNT(DISTINCT city_id) FROM videos WHERE measured_walking_speed_mps IS NOT NULL) as total_cities_for_measured_speed,
            (SELECT COUNT(DISTINCT city_id) FROM videos WHERE crossing_speed IS NOT NULL) as total_cities_for_speed
        `, [cityId]);
        rankings = directRankings.rows[0] || {};
      }
    } catch (err) {
      console.error('Error fetching rankings:', err);
      // Continue with empty rankings
    }

    // 2. Environment (weather from the parallel batch; fall back to pedestrian-level
    // weather only when the videos table had none) + daytime breakdown.
    let environmentResult: { rows: EnvironmentRow[] } = environmentPrimary;
    if (environmentResult.rows.length === 0) {
      environmentResult = await safeQuery<EnvironmentRow>('environment fallback data', `
        SELECT
          weather as main_weather,
          COUNT(DISTINCT p.video_id) as video_count,
          COUNT(DISTINCT p.video_id)::FLOAT / NULLIF(SUM(COUNT(DISTINCT p.video_id)) OVER (), 0) * 100 as percentage
        FROM pedestrians p
        JOIN videos v ON p.video_id = v.id
        WHERE v.city_id = $1
          AND p.weather IS NOT NULL
          AND p.weather != ''
          AND p.weather NOT IN ('sunrise', 'sunset', 'dawn', 'dusk')
        GROUP BY weather
        ORDER BY video_count DESC
      `, [cityId]);
    }
    const daytimeResult: { rows: DaytimeRow[] } = daytimePrimary;

    // 3.-5. Demographics, vehicles and risk factors come straight from the parallel batch.
    const genderResult: { rows: GenderRow[] } = genderPrimary;
    const ageResult: { rows: AgeGroupRow[] } = agePrimary;
    const vehiclesResult: { rows: VehicleRow[] } = vehiclesPrimary;
    const riskFactorsResult: { rows: RiskFactorRow[] } = riskFactorsPrimary;

    // 6. Average pedestrian age — from v_city_summary (parallel batch), then direct fallbacks.
    let avgAgeResult: { rows: AgeRow[] } = { rows: [] };
    try {
      if (citySummaryResult.rows[0]?.avg_pedestrian_age) {
        avgAgeResult.rows[0] = { avg_age: citySummaryResult.rows[0].avg_pedestrian_age };
      } else {
        // Fallback: calculate directly from pedestrians table
        avgAgeResult = await pool.query(`
          SELECT AVG(age) as avg_age
          FROM pedestrians p
          JOIN videos v ON p.video_id = v.id
          WHERE v.city_id = $1 AND p.age IS NOT NULL AND p.age > 0
        `, [cityId]);
        
        // If still no age data, try to calculate from age groups
        if (!avgAgeResult.rows[0]?.avg_age && ageResult.rows.length > 0) {
          // Calculate weighted average from age groups
          let totalCount = 0;
          let weightedSum = 0;
          for (const ageRow of ageResult.rows) {
            const ageMid = ageRow.age_group === 'Under 18' ? 15 : 
                           ageRow.age_group === '18-30' ? 24 : 
                           ageRow.age_group === '31-50' ? 40.5 : 
                           ageRow.age_group === '50+' ? 60 : 0;
            const count = ageRow.count || 0;
            if (ageMid > 0 && count > 0) {
              weightedSum += ageMid * count;
              totalCount += count;
            }
          }
          if (totalCount > 0) {
            avgAgeResult.rows[0] = { avg_age: weightedSum / totalCount };
          }
        }
      }
    } catch (err) {
      console.error('Error fetching average age:', err);
    }

    // 7. Measured behaviour rollup. Postgres returns NUMERIC/BIGINT as strings over the
    // wire, so every field goes through an explicit coercion that preserves NULL (a module
    // that never ran) instead of collapsing it to 0 (a module that ran and found nothing).
    const mb: MeasuredBehaviorRow = measuredBehaviorPrimary.rows[0] || {};
    const num = (v: unknown, digits = 2): number | null =>
      v === null || v === undefined ? null : parseFloat(Number(v).toFixed(digits));
    const int = (v: unknown): number | null =>
      v === null || v === undefined ? null : Number(v);
    // A group is only reported when at least one video actually carries it.
    const group = <T extends Record<string, unknown>>(videos: number | null, fields: T): (T & { videos: number }) | null =>
      videos && videos > 0 ? { ...fields, videos } : null;

    const measuredBehavior = {
      pipeline: {
        dense_v2: int(mb.dense_v2_videos) ?? 0,
        legacy_1hz: int(mb.legacy_videos) ?? 0,
        unversioned: int(mb.unversioned_videos) ?? 0,
      },
      // Analysed = rows in the pedestrians table (the denominator of every rate metric).
      // Tracked = what the pipeline counted. See the SQL comment above.
      pedestrian_counts: {
        analysed: int(mb.analysed_pedestrians) ?? 0,
        tracked: int(mb.tracked_pedestrians),
      },
      crossing_speed: mb.crossing_speed_mps != null
        ? { mps: num(mb.crossing_speed_mps), n: int(mb.crossing_speed_n) }
        : null,
      vehicle_speed: group(int(mb.vehicle_speed_videos), {
        median_mps: num(mb.vehicle_median_speed_mps),
        p85_mps: num(mb.vehicle_p85_speed_mps),
      }),
      flow: group(int(mb.flow_videos), {
        mean_headway_s: num(mb.mean_headway_s),
        platoon_frac: num(mb.platoon_frac, 3),
        vehicles_per_min: num(mb.vehicle_flow_per_min, 1),
      }),
      conflicts: group(int(mb.pet_videos), {
        severe: int(mb.pet_severe),
        moderate: int(mb.pet_moderate),
        queued: int(mb.pet_queued),
        min_pet_s: num(mb.pet_min_s),
      }),
      signal: group(int(mb.signal_videos), {
        anticipatory_start_frac: num(mb.anticipatory_start_frac, 3),
        mean_red_exposure_s: num(mb.mean_red_exposure_s),
      }),
      micro_events: group(int(mb.micro_event_videos), {
        hesitation_rate: num(mb.hesitation_rate, 3),
        aborted_start_rate: num(mb.aborted_start_rate, 3),
        evasive_events: int(mb.evasive_events),
      }),
      social: group(int(mb.social_videos), {
        groups: int(mb.social_groups),
        grouped_pedestrians: int(mb.grouped_pedestrians),
      }),
      pose: group(int(mb.pose_videos), {
        look_before_cross_frac: num(mb.look_before_cross_frac, 3),
        looked_both_ways_frac: num(mb.looked_both_ways_frac, 3),
        median_cadence_hz: num(mb.median_cadence_hz),
        cadence_n: int(mb.cadence_n),
      }),
      // Medians over a plausibility-filtered population; implausible_n makes the
      // discarded tail visible rather than pretending the data is clean.
      pedestrian_kinematics: (int(mb.ped_speed_n) ?? 0) > 0
        ? {
            walking_speed_mps: num(mb.ped_walking_speed_mps),
            crossing_speed_mps: num(mb.ped_crossing_speed_mps),
            decision_delay_s: num(mb.ped_decision_delay_s),
            n: int(mb.ped_speed_n),
            implausible_n: int(mb.ped_speed_implausible_n) ?? 0,
          }
        : null,
    };

    // Format the response with null checks
    const response = {
      rankings: {
        crossing_speed: {
          rank: rankings.speed_rank ? Number(rankings.speed_rank) : null,
          total_cities: rankings.total_cities_for_speed ? Number(rankings.total_cities_for_speed) : null
        },
        risky_crossing: {
          rank: rankings.risky_rank ? Number(rankings.risky_rank) : null,
          total_cities: rankings.total_cities_for_speed ? Number(rankings.total_cities_for_speed) : null
        },
        run_red_light: {
          rank: rankings.red_light_rank ? Number(rankings.red_light_rank) : null,
          total_cities: rankings.total_cities_for_speed ? Number(rankings.total_cities_for_speed) : null
        },
        // MEASURED walking speed: rank is null unless this city has dense-tracked videos,
        // and total_cities counts only cities with measured data (UI shows "no data", not 0).
        measured_walking_speed: {
          rank: rankings.measured_walking_speed_rank ? Number(rankings.measured_walking_speed_rank) : null,
          total_cities: rankings.total_cities_for_measured_speed ? Number(rankings.total_cities_for_measured_speed) : null
        }
      },
      environment: {
        weather: (environmentResult.rows || []).map(row => ({
          type: row.main_weather || 'Unknown',
          percentage: row.percentage ? parseFloat(Number(row.percentage).toFixed(1)) : 0
        })),
        daytime: (daytimeResult.rows || []).map(row => ({
          type: row.daytime || 'Unknown',
          percentage: row.percentage ? parseFloat(Number(row.percentage).toFixed(1)) : 0
        }))
      },
      demographics: {
        gender: (genderResult.rows || []).map(row => ({
          type: row.gender || 'Unknown',
          percentage: row.percentage ? parseFloat(Number(row.percentage).toFixed(1)) : 0
        })),
        age: (ageResult.rows || []).map(row => ({
          group: row.age_group || 'Unknown',
          risky_rate: row.risky_rate ? parseFloat(Number(row.risky_rate).toFixed(1)) : 0,
          red_light_rate: row.red_light_rate ? parseFloat(Number(row.red_light_rate).toFixed(1)) : 0
        }))
      },
      vehicles: (vehiclesResult.rows || []).map(row => ({
        type: row.vehicle_type || 'Unknown',
        percentage: row.percentage ? parseFloat(Number(row.percentage).toFixed(1)) : 0
      })),
      risk_factors: (riskFactorsResult.rows || []).map(row => ({
        factor: row.factor || 'Unknown',
        risk_increase: row.risk_increase ? parseFloat(Number(row.risk_increase).toFixed(1)) : 0,
        sample_size: row.sample_size ? Number(row.sample_size) : 0
      })),
      avg_pedestrian_age: avgAgeResult.rows[0]?.avg_age ? parseFloat(Number(avgAgeResult.rows[0].avg_age).toFixed(1)) : null,
      // Generated per-city insight texts (cities.insights JSONB); no longer in the bulk list.
      insights: cityResult.rows[0].insights ?? null,
      // PedX-Insight measured behaviour ([S1] kinematics + the six insight modules + pose).
      measured_behavior: measuredBehavior
    };

    return NextResponse.json(
      {
        success: true,
        data: response
      },
      { headers: READ_CACHE_HEADERS }
    );
  } catch (error) {
    console.error('Error fetching city details:', error);
    console.error('Error stack:', error instanceof Error ? error.stack : 'No stack trace');
    // Generic client message only; the real error is logged server-side above.
    return NextResponse.json(
      { success: false, error: 'Failed to fetch city details' },
      { status: 500 }
    );
  }
}

