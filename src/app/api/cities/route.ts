import { NextRequest, NextResponse } from 'next/server';
import { pool } from '@/lib/database';
import { CityInsight } from '@/types/database';
import { READ_CACHE_HEADERS } from '@/lib/http';

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const city = searchParams.get('city');
    const country = searchParams.get('country');
    const limitRaw = parseInt(searchParams.get('limit') || '1000', 10);
    const limit = Number.isFinite(limitRaw) ? Math.min(Math.max(limitRaw, 1), 10000) : 1000;
    
    // NEW: Optional date parameter for temporal queries
    // Format: YYYY-MM-DD (e.g., '2024-01-01')
    const dateParam = searchParams.get('date');
    const targetDate = dateParam ? new Date(dateParam) : null;

    // Validate date if provided
    if (dateParam && (isNaN(targetDate!.getTime()) || !dateParam.match(/^\d{4}-\d{2}-\d{2}$/))) {
      return NextResponse.json(
        { success: false, error: 'Invalid date format. Use YYYY-MM-DD' },
        { status: 400 }
      );
    }

    let query: string;
    const params: any[] = [];
    let paramCount = 0;

    if (targetDate) {
      // Use temporal function for historical data
      query = `
        SELECT * FROM v_city_summary_at_date($${++paramCount}::DATE)
        WHERE 1=1
      `;
      params.push(targetDate.toISOString().split('T')[0]);
    } else {
      // Use the materialized snapshot (refreshed after every import) — the plain view
      // re-aggregated cities × videos × pedestrians on every page load. For list
      // requests the heavy per-city insights JSONB is excluded at the SQL level (it was
      // previously fetched from Postgres and discarded in JS); a specific ?city= request
      // keeps it. Column list = mv_city_summary minus insights.
      const cols = city
        ? '*'
        : `id, city, country, continent, latitude, longitude, population_city,
           traffic_mortality, literacy_rate, gini, total_videos, total_pedestrians,
           avg_video_duration, avg_pedestrians_per_video, avg_risky_crossing_ratio,
           avg_run_red_light_ratio, avg_crosswalk_usage_ratio, avg_pedestrian_age,
           avg_crossing_speed, avg_crossing_time, avg_phone_usage_ratio, avg_road_width,
           risky_crossing_rate, run_red_light_rate, crosswalk_usage_rate, phone_usage_rate,
           risk_intensity, earliest_data_date, latest_data_date, earliest_import_date,
           latest_update_date, import_batch_count, avg_measured_walking_speed,
           measured_speed_video_count`;
      query = `
        SELECT ${cols} FROM mv_city_summary
        WHERE 1=1
      `;
    }

    if (city) {
      query += ` AND city ILIKE $${++paramCount}`;
      params.push(`%${city}%`);
    }

    if (country) {
      query += ` AND country ILIKE $${++paramCount}`;
      params.push(`%${country}%`);
    }

    query += ` ORDER BY city LIMIT $${++paramCount}`;
    params.push(limit);

    // Note: UTF-8 is already enforced via the Pool's client_encoding option in
    // src/lib/database.ts. A per-request `SET client_encoding` on the pool is
    // unreliable (it runs on an arbitrary pooled connection) and was removed.
    const result = await pool.query(query, params);
    
    // The per-city `insights` JSONB dominates the bulk payload (~90% of a ~2 MB response
    // for all cities) but is only ever rendered for ONE selected city — and the
    // /api/cities/[city]/details response now carries it. Strip it from list responses;
    // keep it when a specific city was requested.
    const includeInsights = !!city;

    // Ensure all string fields are properly encoded and numeric fields are numbers
    const encodedData = result.rows.map((row: any) => {
      const encodedRow: any = {};
      for (const [key, value] of Object.entries(row)) {
        if (key === 'insights' && !includeInsights) {
          continue;
        }
        if (typeof value === 'string') {
          // Normalize the string to ensure proper UTF-8 encoding
          encodedRow[key] = value.normalize('NFC');
        } else if (typeof value === 'bigint') {
          // Convert BigInt to Number (Neon might return BIGINT as BigInt)
          encodedRow[key] = Number(value);
        } else {
          encodedRow[key] = value;
        }
      }
      return encodedRow;
    });
    
    return NextResponse.json(
      {
        success: true,
        data: encodedData as CityInsight[],
        count: encodedData.length,
        // Include metadata about data range
        metadata: {
          date_filter: targetDate ? targetDate.toISOString().split('T')[0] : null,
          is_temporal: !!targetDate,
          data_range: targetDate
            ? `Data as of ${targetDate.toISOString().split('T')[0]}`
            : 'All available data (cumulative)'
        }
      },
      { headers: READ_CACHE_HEADERS }
    );
  } catch (error) {
    console.error('Error fetching cities:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to fetch cities' },
      { status: 500 }
    );
  }
}
