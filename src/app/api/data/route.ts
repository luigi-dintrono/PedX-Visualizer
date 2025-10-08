import { NextRequest, NextResponse } from 'next/server';
import { pool } from '@/lib/database';

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const city = searchParams.get('city');
    const country = searchParams.get('country');
    const continent = searchParams.get('continent');
    const limit = parseInt(searchParams.get('limit') || '100');
    
    // Granular filter parameters
    const continents = searchParams.get('continents')?.split(',').filter(Boolean) || [];
    const weather = searchParams.get('weather')?.split(',').filter(Boolean) || [];
    const gender = searchParams.get('gender')?.split(',').filter(Boolean) || [];
    const shirtType = searchParams.get('shirtType')?.split(',').filter(Boolean) || [];
    const bottomWear = searchParams.get('bottomWear')?.split(',').filter(Boolean) || [];
    
    // Range filters
    const minPopulation = searchParams.get('minPopulation');
    const maxPopulation = searchParams.get('maxPopulation');
    const minAge = searchParams.get('minAge');
    const maxAge = searchParams.get('maxAge');
    const minCrossingSpeed = searchParams.get('minCrossingSpeed');
    const maxCrossingSpeed = searchParams.get('maxCrossingSpeed');
    const minRoadWidth = searchParams.get('minRoadWidth');
    const maxRoadWidth = searchParams.get('maxRoadWidth');
    
    // Boolean filters
    const riskyCrossing = searchParams.get('riskyCrossing');
    const runRedLight = searchParams.get('runRedLight');
    const crosswalkUse = searchParams.get('crosswalkUse');
    const phoneUse = searchParams.get('phoneUse');
    const backpack = searchParams.get('backpack');
    const umbrella = searchParams.get('umbrella');
    const handbag = searchParams.get('handbag');
    const suitcase = searchParams.get('suitcase');
    const vehiclePresence = searchParams.get('vehiclePresence');

    let query = `
      SELECT 
        id, city, country, continent, latitude, longitude,
        population_city as population,
        total_videos as videos_analyzed,
        total_videos,
        total_pedestrians,
        avg_risky_crossing_ratio,
        avg_run_red_light_ratio,
        avg_crosswalk_usage_ratio,
        avg_pedestrian_age,
        avg_pedestrians_per_video,
        avg_crossing_speed,
        avg_crossing_time,
        avg_phone_usage_ratio,
        avg_road_width,
        risky_crossing_rate,
        run_red_light_rate,
        crosswalk_usage_rate,
        phone_usage_rate,
        traffic_mortality,
        literacy_rate,
        gini,
        risk_intensity
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

    // Granular filters
    if (continents.length > 0) {
      query += ` AND continent = ANY($${++paramCount})`;
      params.push(continents);
    }

    if (minPopulation) {
      query += ` AND population_city >= $${++paramCount}`;
      params.push(parseInt(minPopulation));
    }

    if (maxPopulation) {
      query += ` AND population_city <= $${++paramCount}`;
      params.push(parseInt(maxPopulation));
    }

    if (minAge) {
      query += ` AND avg_pedestrian_age >= $${++paramCount}`;
      params.push(parseFloat(minAge));
    }

    if (maxAge) {
      query += ` AND avg_pedestrian_age <= $${++paramCount}`;
      params.push(parseFloat(maxAge));
    }

    // Crossing speed range
    if (minCrossingSpeed) {
      query += ` AND avg_crossing_speed >= $${++paramCount}`;
      params.push(parseFloat(minCrossingSpeed));
    }

    if (maxCrossingSpeed) {
      query += ` AND avg_crossing_speed <= $${++paramCount}`;
      params.push(parseFloat(maxCrossingSpeed));
    }

    // Road width range
    if (minRoadWidth) {
      query += ` AND avg_road_width >= $${++paramCount}`;
      params.push(parseFloat(minRoadWidth));
    }

    if (maxRoadWidth) {
      query += ` AND avg_road_width <= $${++paramCount}`;
      params.push(parseFloat(maxRoadWidth));
    }

    // Behavior filters - use rates from summary
    if (riskyCrossing === 'true') {
      query += ` AND risky_crossing_rate > 0`;
    }

    if (runRedLight === 'true') {
      query += ` AND run_red_light_rate > 0`;
    }

    if (crosswalkUse === 'true') {
      query += ` AND crosswalk_usage_rate > 0`;
    }

    if (phoneUse === 'true') {
      query += ` AND phone_usage_rate > 0`;
    }

    // Note: For detailed filtering by clothing/accessories/vehicles,
    // we would need to filter cities that have pedestrians matching criteria
    // This requires a more complex subquery, which we can add if needed

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
