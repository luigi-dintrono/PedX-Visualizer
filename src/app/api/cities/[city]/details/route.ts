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
      insights: cityResult.rows[0].insights ?? null
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

