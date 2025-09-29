import { NextRequest, NextResponse } from 'next/server';
import { pool } from '@/lib/database';
import { CoreGlobalCrossingData } from '@/types/database';

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const city = searchParams.get('city');
    const country = searchParams.get('country');
    const limit = parseInt(searchParams.get('limit') || '100');

    let query = `
      SELECT * FROM CoreGlobalCrossingData
      WHERE 1=1
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

    query += ` ORDER BY created_at DESC LIMIT $${++paramCount}`;
    params.push(limit);

    const result = await pool.query(query, params);
    
    return NextResponse.json({
      success: true,
      data: result.rows as CoreGlobalCrossingData[],
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

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    
    const query = `
      INSERT INTO CoreGlobalCrossingData (
        city, country, population, description, videos_analyzed,
        crossing_speed_avg, crossing_speed_median, crossing_speed_min, crossing_speed_max,
        time_to_start_crossing_avg, time_to_start_crossing_median, time_to_start_crossing_min, time_to_start_crossing_max,
        waiting_time_avg, waiting_time_median, crossing_distance_avg, crossing_distance_median,
        latitude, longitude, data_source, notes
      ) VALUES (
        $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22
      ) RETURNING *
    `;

    const params = [
      body.city,
      body.country,
      body.population,
      body.description,
      body.videos_analyzed || 0,
      body.crossing_speed_avg,
      body.crossing_speed_median,
      body.crossing_speed_min,
      body.crossing_speed_max,
      body.time_to_start_crossing_avg,
      body.time_to_start_crossing_median,
      body.time_to_start_crossing_min,
      body.time_to_start_crossing_max,
      body.waiting_time_avg,
      body.waiting_time_median,
      body.crossing_distance_avg,
      body.crossing_distance_median,
      body.latitude,
      body.longitude,
      body.data_source,
      body.notes
    ];

    const result = await pool.query(query, params);
    
    return NextResponse.json({
      success: true,
      data: result.rows[0] as CoreGlobalCrossingData
    });
  } catch (error) {
    console.error('Error inserting data:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to insert data' },
      { status: 500 }
    );
  }
}
