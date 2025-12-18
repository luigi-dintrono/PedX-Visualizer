import { NextRequest, NextResponse } from 'next/server';
import { pool } from '@/lib/database';

interface CityRankings {
  speed_rank?: number;
  risky_rank?: number;
  red_light_rank?: number;
  total_cities_for_speed?: number;
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
    
    await pool.query("SET client_encoding TO 'UTF8'");

    // Get city ID first
    const cityResult = await pool.query(
      `SELECT id FROM cities WHERE city = $1 LIMIT 1`,
      [city]
    );

    if (cityResult.rows.length === 0) {
      return NextResponse.json(
        { success: false, error: 'City not found' },
        { status: 404 }
      );
    }

    const cityId = cityResult.rows[0].id;

    // 1. Get Rankings from mv_city_insights (with fallback to direct calculation)
    let rankings: CityRankings = {};
    try {
      const rankingsResult = await pool.query(`
        SELECT 
          speed_rank,
          risky_rank,
          red_light_rank,
          (SELECT COUNT(*) FROM mv_city_insights WHERE speed_rank IS NOT NULL) as total_cities_for_speed
        FROM mv_city_insights
        WHERE city_id = $1
      `, [cityId]);
      rankings = rankingsResult.rows[0] || {};
      
      // If no data in materialized view, calculate directly
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
            (SELECT COUNT(DISTINCT city_id) FROM videos WHERE crossing_speed IS NOT NULL) as total_cities_for_speed
        `, [cityId]);
        rankings = directRankings.rows[0] || {};
      }
    } catch (err) {
      console.error('Error fetching rankings:', err);
      // Continue with empty rankings
    }

    // 2. Get Environment data (weather and daytime breakdown)
    let environmentResult: { rows: EnvironmentRow[] } = { rows: [] };
    let daytimeResult: { rows: DaytimeRow[] } = { rows: [] };
    
    try {
      // Filter out time-based weather labels (sunrise, sunset) and get actual weather
      environmentResult = await pool.query(`
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
      `, [cityId]);
      
      // If no weather data after filtering, try from pedestrians table
      if (environmentResult.rows.length === 0) {
        environmentResult = await pool.query(`
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
    } catch (err) {
      console.error('Error fetching environment data:', err);
    }

    try {
      // Get daytime breakdown from pedestrians table
      // Note: daytime might be stored as 0/1 (0=night, 1=day) or true/false
      daytimeResult = await pool.query(`
        SELECT 
          CASE 
            WHEN p.daytime = true OR p.daytime = 1 OR p.daytime = '1' THEN 'Day'
            WHEN p.daytime = false OR p.daytime = 0 OR p.daytime = '0' THEN 'Night'
            ELSE 'Unknown'
          END as daytime,
          COUNT(*) as count,
          COUNT(*)::FLOAT / NULLIF(SUM(COUNT(*)) OVER (), 0) * 100 as percentage
        FROM pedestrians p
        JOIN videos v ON p.video_id = v.id
        WHERE v.city_id = $1 AND p.daytime IS NOT NULL
        GROUP BY 
          CASE 
            WHEN p.daytime = true OR p.daytime = 1 OR p.daytime = '1' THEN 'Day'
            WHEN p.daytime = false OR p.daytime = 0 OR p.daytime = '0' THEN 'Night'
            ELSE 'Unknown'
          END
        ORDER BY count DESC
      `, [cityId]);
    } catch (err) {
      console.error('Error fetching daytime data:', err);
    }

    // 3. Get Demographics (gender and age breakdown)
    let genderResult: { rows: GenderRow[] } = { rows: [] };
    let ageResult: { rows: AgeGroupRow[] } = { rows: [] };
    
    try {
      genderResult = await pool.query(`
        SELECT 
          gender,
          COUNT(*) as count,
          COUNT(*)::FLOAT / NULLIF(SUM(COUNT(*)) OVER (), 0) * 100 as percentage
        FROM pedestrians p
        JOIN videos v ON p.video_id = v.id
        WHERE v.city_id = $1 AND p.gender IS NOT NULL AND p.gender != ''
        GROUP BY gender
        ORDER BY count DESC
      `, [cityId]);
    } catch (err) {
      console.error('Error fetching gender data:', err);
    }

    try {
      ageResult = await pool.query(`
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
          CASE 
            WHEN age < 18 THEN 1
            WHEN age BETWEEN 18 AND 30 THEN 2
            WHEN age BETWEEN 31 AND 50 THEN 3
            WHEN age > 50 THEN 4
            ELSE 5
          END
      `, [cityId]);
    } catch (err) {
      console.error('Error fetching age data:', err);
    }

    // 4. Get Vehicles breakdown
    // Calculate vehicle type distribution - what percentage of all vehicle observations are each type
    // This ensures percentages add up to 100%
    let vehiclesResult: { rows: VehicleRow[] } = { rows: [] };
    
    try {
      // Count total vehicle observations (sum of all vehicle types)
      // Then calculate what percentage each type represents
      vehiclesResult = await pool.query(`
        WITH vehicle_observations AS (
          SELECT 
            'car' as vehicle_type,
            COUNT(*) FILTER (WHERE (p.car IS TRUE OR p.car::int = 1)) as count
          FROM pedestrians p
          JOIN videos v ON p.video_id = v.id
          WHERE v.city_id = $1
          
          UNION ALL
          
          SELECT 
            'bus' as vehicle_type,
            COUNT(*) FILTER (WHERE (p.bus IS TRUE OR p.bus::int = 1)) as count
          FROM pedestrians p
          JOIN videos v ON p.video_id = v.id
          WHERE v.city_id = $1
          
          UNION ALL
          
          SELECT 
            'motorbike' as vehicle_type,
            COUNT(*) FILTER (WHERE (p.motorbike IS TRUE OR p.motorbike::int = 1)) as count
          FROM pedestrians p
          JOIN videos v ON p.video_id = v.id
          WHERE v.city_id = $1
          
          UNION ALL
          
          SELECT 
            'bicycle' as vehicle_type,
            COUNT(*) FILTER (WHERE (p.bicycle IS TRUE OR p.bicycle::int = 1)) as count
          FROM pedestrians p
          JOIN videos v ON p.video_id = v.id
          WHERE v.city_id = $1
          
          UNION ALL
          
          SELECT 
            'truck' as vehicle_type,
            COUNT(*) FILTER (WHERE (p.truck IS TRUE OR p.truck::int = 1)) as count
          FROM pedestrians p
          JOIN videos v ON p.video_id = v.id
          WHERE v.city_id = $1
          
          UNION ALL
          
          SELECT 
            'taxi' as vehicle_type,
            COUNT(*) FILTER (WHERE (p.taxi IS TRUE OR p.taxi::int = 1)) as count
          FROM pedestrians p
          JOIN videos v ON p.video_id = v.id
          WHERE v.city_id = $1
          
          UNION ALL
          
          SELECT 
            'suv' as vehicle_type,
            COUNT(*) FILTER (WHERE (p.suv IS TRUE OR p.suv::int = 1)) as count
          FROM pedestrians p
          JOIN videos v ON p.video_id = v.id
          WHERE v.city_id = $1
        )
        SELECT 
          vehicle_type,
          count,
          -- Calculate percentage of total vehicle observations (not total pedestrians)
          -- This makes percentages add up to 100%
          count::FLOAT / NULLIF(SUM(count) OVER (), 0) * 100 as percentage
        FROM vehicle_observations
        WHERE count > 0
        ORDER BY count DESC
        LIMIT 10
      `, [cityId]);
      
      console.log(`Vehicle query results for city ${cityId}:`, {
        vehicleRows: vehiclesResult.rows.length,
        vehicles: vehiclesResult.rows,
        totalPercentage: vehiclesResult.rows.reduce((sum, row) => sum + (row.percentage || 0), 0)
      });
    } catch (err) {
      console.error('Error fetching vehicle data:', err);
    }

    // 5. Get risk factors (top factors that increase risk)
    let riskFactorsResult: { rows: RiskFactorRow[] } = { rows: [] };
    
    try {
      riskFactorsResult = await pool.query(`
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
      `, [cityId]);
    } catch (err) {
      console.error('Error fetching risk factors:', err);
    }

    // 6. Get average pedestrian age - try from v_city_summary first, then calculate directly
    let avgAgeResult: { rows: AgeRow[] } = { rows: [] };
    try {
      // First try to get from v_city_summary (which already has avg_pedestrian_age calculated)
      const citySummaryResult = await pool.query(`
        SELECT avg_pedestrian_age
        FROM v_city_summary
        WHERE id = $1
      `, [cityId]);
      
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
      
      console.log(`Age query results for city ${cityId}:`, {
        avgAge: avgAgeResult.rows[0]?.avg_age,
        fromSummary: !!citySummaryResult.rows[0]?.avg_pedestrian_age
      });
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
      avg_pedestrian_age: avgAgeResult.rows[0]?.avg_age ? parseFloat(Number(avgAgeResult.rows[0].avg_age).toFixed(1)) : null
    };

    // Log response for debugging
    console.log(`City details for ${city}:`, {
      rankings: response.rankings,
      environment_weather_count: response.environment.weather.length,
      environment_daytime_count: response.environment.daytime.length,
      demographics_gender_count: response.demographics.gender.length,
      demographics_age_count: response.demographics.age.length,
      vehicles_count: response.vehicles.length,
      risk_factors_count: response.risk_factors.length
    });

    return NextResponse.json({
      success: true,
      data: response
    });
  } catch (error) {
    console.error('Error fetching city details:', error);
    console.error('Error stack:', error instanceof Error ? error.stack : 'No stack trace');
    return NextResponse.json(
      { success: false, error: 'Failed to fetch city details', details: error instanceof Error ? error.message : String(error) },
      { status: 500 }
    );
  }
}

