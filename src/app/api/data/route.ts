import { NextRequest, NextResponse } from 'next/server';
import { pool } from '@/lib/database';

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const city = searchParams.get('city');
    const country = searchParams.get('country');
    const continent = searchParams.get('continent');
    const limit = parseInt(searchParams.get('limit') || '100');

    let query = `
      SELECT 
        id, city, country, continent, latitude, longitude,
        population_city as population,
        total_videos as videos_analyzed,
        avg_risky_crossing_ratio as risky_crossing_rate,
        avg_run_red_light_ratio as run_red_light_rate,
        avg_crosswalk_usage_ratio as crosswalk_usage_rate,
        avg_pedestrian_age,
        traffic_mortality,
        literacy_rate,
        gini
      FROM v_city_summary
      WHERE latitude IS NOT NULL AND longitude IS NOT NULL
    `;
    const params: any[] = [];
    let paramCount = 0;

    if (city) {
      query += ` AND city ILIKE $${++paramCount}`;
      params.push(`%${city}%`);
    }

    if (country) {
      query += ` AND country ILIKE $${++paramCount}`;
      params.push(`%${country}%`);
    }

    if (continent) {
      query += ` AND continent ILIKE $${++paramCount}`;
      params.push(`%${continent}%`);
    }

    query += ` ORDER BY city LIMIT $${++paramCount}`;
    params.push(limit);

    const result = await pool.query(query, params);
    
    return NextResponse.json({
      success: true,
      data: result.rows,
      count: result.rows.length
    });
  } catch (error) {
    console.error('Error fetching data:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to fetch data' },
      { status: 500 }
    );
  }
}

// POST method removed - data is now managed through the aggregation script
