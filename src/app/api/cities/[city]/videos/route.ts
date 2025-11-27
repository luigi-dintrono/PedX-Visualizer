import { NextRequest, NextResponse } from 'next/server';
import { pool } from '@/lib/database';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ city: string }> }
) {
  try {
    const { city } = await params;
    const limit = parseInt(request.nextUrl.searchParams.get('limit') || '5');

    const query = `
      SELECT 
        v.id,
        v.video_name,
        v.link,
        v.duration_seconds,
        v.total_pedestrians,
        v.latitude,
        v.longitude,
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
    const videos = result.rows.map(row => ({
      ...row,
      latitude: row.latitude ? parseFloat(row.latitude) : null,
      longitude: row.longitude ? parseFloat(row.longitude) : null,
      city_latitude: row.city_latitude ? parseFloat(row.city_latitude) : null,
      city_longitude: row.city_longitude ? parseFloat(row.city_longitude) : null,
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

