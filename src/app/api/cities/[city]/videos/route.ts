import { NextRequest, NextResponse } from 'next/server';
import { pool } from '@/lib/database';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ city: string }> }
) {
  try {
    const { city } = await params;
    const limitRaw = parseInt(request.nextUrl.searchParams.get('limit') || '5', 10);
    const limit = Number.isFinite(limitRaw) ? Math.min(Math.max(limitRaw, 1), 500) : 5;

    const query = `
      SELECT 
        v.id,
        v.video_name,
        v.link,
        v.duration_seconds,
        v.total_pedestrians,
        v.latitude,
        v.longitude,
        v.localization_confidence,
        v.street_name,
        v.localization_status,
        v.risky_crossing_ratio,
        v.run_red_light_ratio,
        v.crosswalk_usage_ratio,
        v.phone_usage_ratio,
        v.main_weather,
        c.city,
        c.country,
        c.latitude as city_latitude,
        c.longitude as city_longitude
      FROM videos v
      JOIN cities c ON v.city_id = c.id
      WHERE c.city = $1
      ORDER BY v.created_at DESC
      LIMIT $2
    `;

    const result = await pool.query(query, [city, limit]);
    
    // Convert decimal/numeric types to numbers for JSON response
    // Use explicit null checks so a valid 0 coordinate (equator / prime meridian)
    // is not dropped to null by a truthiness test.
    const videos = result.rows.map(row => ({
      ...row,
      latitude: row.latitude != null ? parseFloat(row.latitude) : null,
      longitude: row.longitude != null ? parseFloat(row.longitude) : null,
      city_latitude: row.city_latitude != null ? parseFloat(row.city_latitude) : null,
      city_longitude: row.city_longitude != null ? parseFloat(row.city_longitude) : null,
      risky_crossing_ratio: row.risky_crossing_ratio != null ? parseFloat(row.risky_crossing_ratio) : null,
      run_red_light_ratio: row.run_red_light_ratio != null ? parseFloat(row.run_red_light_ratio) : null,
      crosswalk_usage_ratio: row.crosswalk_usage_ratio != null ? parseFloat(row.crosswalk_usage_ratio) : null,
      phone_usage_ratio: row.phone_usage_ratio != null ? parseFloat(row.phone_usage_ratio) : null,
    }));
    
    return NextResponse.json({
      success: true,
      data: videos,
      count: videos.length
    });
  } catch (error) {
    console.error('Error fetching city videos:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to fetch city videos' },
      { status: 500 }
    );
  }
}

