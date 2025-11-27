import { NextRequest, NextResponse } from 'next/server';
import { pool } from '@/lib/database';

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const city = searchParams.get('city');
    const country = searchParams.get('country');
    const continent = searchParams.get('continent');
    const limit = parseInt(searchParams.get('limit') || '1000');
    
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
    
    // Vehicle count filters
    const minCar = searchParams.get('minCar');
    const maxCar = searchParams.get('maxCar');
    const minBus = searchParams.get('minBus');
    const maxBus = searchParams.get('maxBus');
    const minTruck = searchParams.get('minTruck');
    const maxTruck = searchParams.get('maxTruck');
    const minMotorbike = searchParams.get('minMotorbike');
    const maxMotorbike = searchParams.get('maxMotorbike');
    const minBicycle = searchParams.get('minBicycle');
    const maxBicycle = searchParams.get('maxBicycle');

    // Map frontend filter values to database column names
    const shirtTypeMap: Record<string, string> = {
      'short-sleeved': 'short_sleeved_shirt',
      'long-sleeved': 'long_sleeved_shirt',
      'vest': 'vest',
    };
    
    const bottomWearMap: Record<string, string> = {
      'shorts': 'shorts',
      'trousers': 'trousers',
      'skirt': 'skirt',
    };
    
    // Map shirtType and bottomWear arrays to database column names
    const shirtTypeColumns = shirtType.map(st => shirtTypeMap[st]).filter(Boolean);
    const bottomWearColumns = bottomWear.map(bw => bottomWearMap[bw]).filter(Boolean);
    
    // Check if we have clothing & accessories filters
    const hasClothingFilters = shirtTypeColumns.length > 0 || 
                               bottomWearColumns.length > 0 ||
                               backpack === 'true' ||
                               umbrella === 'true' ||
                               handbag === 'true' ||
                               suitcase === 'true';
    
    // Always use CTE when vehicle parameters are provided (we always send them from frontend)
    // This ensures consistent filtering behavior - even at defaults, we want to use the CTE
    // so that filtering works correctly when users adjust the sliders
    const hasVehicleFilters = (minCar !== null && minCar !== undefined) || 
                              (maxCar !== null && maxCar !== undefined) || 
                              (minBus !== null && minBus !== undefined) || 
                              (maxBus !== null && maxBus !== undefined) ||
                              (minTruck !== null && minTruck !== undefined) || 
                              (maxTruck !== null && maxTruck !== undefined) ||
                              (minMotorbike !== null && minMotorbike !== undefined) || 
                              (maxMotorbike !== null && maxMotorbike !== undefined) ||
                              (minBicycle !== null && minBicycle !== undefined) || 
                              (maxBicycle !== null && maxBicycle !== undefined);
    
    // Use CTE if we have vehicle filters OR clothing filters
    const useCTE = hasVehicleFilters || hasClothingFilters;
    
    console.log('[API] Filter check:', {
      hasVehicleFilters,
      hasClothingFilters,
      useCTE,
      shirtTypeColumns,
      bottomWearColumns,
      backpack, umbrella, handbag, suitcase
    });
    
    let query: string;
    const params: any[] = [];
    let paramCount = 0;
    
    if (useCTE) {
      // Build WHERE clause for pedestrian-level filters
      const pedestrianFilters: string[] = [];
      
      // Vehicle count filters (always include if hasVehicleFilters)
      if (hasVehicleFilters) {
        // Vehicle counts are calculated in the CTE, filters applied later
      }
      
      // Clothing & accessories filters
      if (hasClothingFilters) {
        // Shirt type filters
        if (shirtTypeColumns.length > 0) {
          const shirtConditions = shirtTypeColumns.map(col => `p.${col} IS TRUE`).join(' OR ');
          pedestrianFilters.push(`(${shirtConditions})`);
        }
        
        // Bottom wear filters
        if (bottomWearColumns.length > 0) {
          const bottomConditions = bottomWearColumns.map(col => `p.${col} IS TRUE`).join(' OR ');
          pedestrianFilters.push(`(${bottomConditions})`);
        }
        
        // Boolean accessory filters
        if (backpack === 'true') {
          pedestrianFilters.push('p.backpack IS TRUE');
        }
        if (umbrella === 'true') {
          pedestrianFilters.push('p.umbrella IS TRUE');
        }
        if (handbag === 'true') {
          pedestrianFilters.push('p.handbag IS TRUE');
        }
        if (suitcase === 'true') {
          pedestrianFilters.push('p.suitcase IS TRUE');
        }
      }
      
      // Combine all pedestrian filters with AND
      const pedestrianWhereClause = pedestrianFilters.length > 0 
        ? `AND ${pedestrianFilters.join(' AND ')}`
        : '';
      
      // Use CTE to calculate vehicle counts and filter by clothing/accessories per city
      const vehicleCountsSelect = hasVehicleFilters ? `
            COALESCE(COUNT(*) FILTER (WHERE p.car IS TRUE), 0)::INTEGER as car_count,
            COALESCE(COUNT(*) FILTER (WHERE p.bus IS TRUE), 0)::INTEGER as bus_count,
            COALESCE(COUNT(*) FILTER (WHERE p.truck IS TRUE), 0)::INTEGER as truck_count,
            COALESCE(COUNT(*) FILTER (WHERE p.motorbike IS TRUE), 0)::INTEGER as motorbike_count,
            COALESCE(COUNT(*) FILTER (WHERE p.bicycle IS TRUE), 0)::INTEGER as bicycle_count,
            ` : '';
      
      query = `
        WITH city_filtered_counts AS (
          SELECT 
            c.id,
            ${vehicleCountsSelect}
            COUNT(DISTINCT p.video_id) as filtered_video_count,
            COUNT(DISTINCT p.id) as filtered_pedestrian_count
          FROM cities c
          INNER JOIN videos v ON c.id = v.city_id
          INNER JOIN pedestrians p ON v.id = p.video_id
          WHERE 1=1
          ${pedestrianWhereClause}
          GROUP BY c.id
          HAVING COUNT(DISTINCT p.video_id) > 0
        )
        SELECT 
          vcs.id, vcs.city, vcs.country, vcs.continent, vcs.latitude, vcs.longitude,
          vcs.population_city as population,
          vcs.total_videos as videos_analyzed,
          vcs.total_videos,
          vcs.total_pedestrians,
          vcs.avg_risky_crossing_ratio,
          vcs.avg_run_red_light_ratio,
          vcs.avg_crosswalk_usage_ratio,
          vcs.avg_pedestrian_age,
          vcs.avg_pedestrians_per_video,
          vcs.avg_crossing_speed,
          vcs.avg_crossing_time,
          vcs.avg_phone_usage_ratio,
          vcs.avg_road_width,
          vcs.risky_crossing_rate,
          vcs.run_red_light_rate,
          vcs.crosswalk_usage_rate,
          vcs.phone_usage_rate,
          vcs.traffic_mortality,
          vcs.literacy_rate,
          vcs.gini,
          vcs.risk_intensity
        FROM v_city_summary vcs
        INNER JOIN city_filtered_counts cfc ON vcs.id = cfc.id
        WHERE vcs.latitude IS NOT NULL 
          AND vcs.longitude IS NOT NULL
          AND vcs.total_pedestrians > 0
      `;
    } else {
      // Standard query without vehicle counts
      query = `
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
    }

    // Use appropriate table alias based on query type
    const tableAlias = useCTE ? 'vcs' : '';
    const prefix = tableAlias ? `${tableAlias}.` : '';
    
    if (city) {
      query += ` AND ${prefix}city ILIKE $${++paramCount}`;
      params.push(`%${city}%`);
    }

    if (country) {
      query += ` AND ${prefix}country ILIKE $${++paramCount}`;
      params.push(`%${country}%`);
    }

    if (continent) {
      query += ` AND ${prefix}continent ILIKE $${++paramCount}`;
      params.push(`%${continent}%`);
    }

    // Granular filters
    if (continents.length > 0) {
      query += ` AND ${prefix}continent = ANY($${++paramCount})`;
      params.push(continents);
    }

    if (minPopulation) {
      query += ` AND ${prefix}population_city >= $${++paramCount}`;
      params.push(parseInt(minPopulation));
    }

    if (maxPopulation) {
      query += ` AND ${prefix}population_city <= $${++paramCount}`;
      params.push(parseInt(maxPopulation));
    }

    if (minAge) {
      query += ` AND ${prefix}avg_pedestrian_age >= $${++paramCount}`;
      params.push(parseFloat(minAge));
    }

    if (maxAge) {
      query += ` AND ${prefix}avg_pedestrian_age <= $${++paramCount}`;
      params.push(parseFloat(maxAge));
    }

    // Crossing speed range
    if (minCrossingSpeed) {
      query += ` AND ${prefix}avg_crossing_speed >= $${++paramCount}`;
      params.push(parseFloat(minCrossingSpeed));
    }

    if (maxCrossingSpeed) {
      query += ` AND ${prefix}avg_crossing_speed <= $${++paramCount}`;
      params.push(parseFloat(maxCrossingSpeed));
    }

    // Road width range
    if (minRoadWidth) {
      query += ` AND ${prefix}avg_road_width >= $${++paramCount}`;
      params.push(parseFloat(minRoadWidth));
    }

    if (maxRoadWidth) {
      query += ` AND ${prefix}avg_road_width <= $${++paramCount}`;
      params.push(parseFloat(maxRoadWidth));
    }

    // Behavior filters - use rates from summary
    if (riskyCrossing === 'true') {
      query += ` AND ${prefix}risky_crossing_rate > 0`;
    }

    if (runRedLight === 'true') {
      query += ` AND ${prefix}run_red_light_rate > 0`;
    }

    if (crosswalkUse === 'true') {
      query += ` AND ${prefix}crosswalk_usage_rate > 0`;
    }

    if (phoneUse === 'true') {
      query += ` AND ${prefix}phone_usage_rate > 0`;
    }

    // Vehicle count filters - always apply when parameters are provided
    // (parameters are always sent from the frontend, so we always use the CTE)
    if (useCTE && hasVehicleFilters) {
      console.log('[API] Applying vehicle filters with CTE');
      // Apply car filter - apply range filters (min <= value <= max)
      // Always apply both min and max to ensure proper range filtering
      // Check for null/undefined, not falsy values (0 is a valid filter value)
      if (minCar !== null && minCar !== undefined && minCar !== '') {
        const minCarValue = parseInt(minCar);
        if (!isNaN(minCarValue)) {
          query += ` AND cfc.car_count >= $${++paramCount}`;
          params.push(minCarValue);
          console.log('[API] Applied car min filter:', minCarValue);
        }
      }
      
      if (maxCar !== null && maxCar !== undefined && maxCar !== '') {
        const maxCarValue = parseInt(maxCar);
        if (!isNaN(maxCarValue)) {
          query += ` AND cfc.car_count <= $${++paramCount}`;
          params.push(maxCarValue);
          console.log('[API] Applied car max filter:', maxCarValue);
        }
      }
      
      // Apply bus filter - apply range filters (min <= value <= max)
      // Always apply both min and max to ensure proper range filtering
      if (minBus !== null && minBus !== undefined && minBus !== '') {
        const minBusValue = parseInt(minBus);
        if (!isNaN(minBusValue)) {
          query += ` AND cfc.bus_count >= $${++paramCount}`;
          params.push(minBusValue);
        }
      }
      
      if (maxBus !== null && maxBus !== undefined && maxBus !== '') {
        const maxBusValue = parseInt(maxBus);
        if (!isNaN(maxBusValue)) {
          query += ` AND cfc.bus_count <= $${++paramCount}`;
          params.push(maxBusValue);
        }
      }
      
      // Apply truck filter - apply range filters (min <= value <= max)
      // Always apply both min and max to ensure proper range filtering
      if (minTruck !== null && minTruck !== undefined && minTruck !== '') {
        const minTruckValue = parseInt(minTruck);
        if (!isNaN(minTruckValue)) {
          query += ` AND cfc.truck_count >= $${++paramCount}`;
          params.push(minTruckValue);
        }
      }
      
      if (maxTruck !== null && maxTruck !== undefined && maxTruck !== '') {
        const maxTruckValue = parseInt(maxTruck);
        if (!isNaN(maxTruckValue)) {
          query += ` AND cfc.truck_count <= $${++paramCount}`;
          params.push(maxTruckValue);
        }
      }
      
      // Apply motorbike filter - apply range filters (min <= value <= max)
      // Always apply both min and max to ensure proper range filtering
      if (minMotorbike !== null && minMotorbike !== undefined && minMotorbike !== '') {
        const minMotorbikeValue = parseInt(minMotorbike);
        if (!isNaN(minMotorbikeValue)) {
          query += ` AND cfc.motorbike_count >= $${++paramCount}`;
          params.push(minMotorbikeValue);
        }
      }
      
      if (maxMotorbike !== null && maxMotorbike !== undefined && maxMotorbike !== '') {
        const maxMotorbikeValue = parseInt(maxMotorbike);
        if (!isNaN(maxMotorbikeValue)) {
          query += ` AND cfc.motorbike_count <= $${++paramCount}`;
          params.push(maxMotorbikeValue);
        }
      }
      
      // Apply bicycle filter - apply range filters (min <= value <= max)
      // Always apply both min and max to ensure proper range filtering
      if (minBicycle !== null && minBicycle !== undefined && minBicycle !== '') {
        const minBicycleValue = parseInt(minBicycle);
        if (!isNaN(minBicycleValue)) {
          query += ` AND cfc.bicycle_count >= $${++paramCount}`;
          params.push(minBicycleValue);
        }
      }
      
      if (maxBicycle !== null && maxBicycle !== undefined && maxBicycle !== '') {
        const maxBicycleValue = parseInt(maxBicycle);
        if (!isNaN(maxBicycleValue)) {
          query += ` AND cfc.bicycle_count <= $${++paramCount}`;
          params.push(maxBicycleValue);
        }
      }
    }

    query += ` ORDER BY ${prefix}city LIMIT $${++paramCount}`;
    params.push(limit);

    const startTime = Date.now();
    console.log('[API] Executing query with', params.length, 'parameters');
    if (useCTE) {
      console.log('[API] Using optimized CTE for filters:', {
        hasVehicleFilters,
        hasClothingFilters
      });
    }
    
    try {
      // Set a longer timeout for complex queries (30 seconds)
      const client = await pool.connect();
      try {
        await client.query('SET statement_timeout = 30000'); // 30 seconds
        const result = await client.query(query, params);
        const queryTime = Date.now() - startTime;
        console.log(`[API] Query returned ${result.rows.length} cities in ${queryTime}ms`);
        
        if (queryTime > 5000) {
          console.warn(`[API] Slow query detected: ${queryTime}ms - consider optimizing or adding indexes`);
        }
        
        return NextResponse.json({
          success: true,
          data: result.rows,
          count: result.rows.length
        });
      } finally {
        client.release();
      }
    } catch (error: any) {
      const queryTime = Date.now() - startTime;
      console.error(`[API] Query failed after ${queryTime}ms:`, error);
      return NextResponse.json(
        { success: false, error: 'Query timeout or error', details: error.message },
        { status: 500 }
      );
    }
  } catch (error) {
    console.error('Error fetching data:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to fetch data' },
      { status: 500 }
    );
  }
}

// POST method removed - data is now managed through the aggregation script
