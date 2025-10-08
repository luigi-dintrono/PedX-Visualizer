import { NextRequest, NextResponse } from 'next/server';
import { pool } from '@/lib/database';

export async function GET(
  request: NextRequest,
  { params }: { params: { city: string } }
) {
  try {
    const city = params.city;
    const limit = parseInt(request.nextUrl.searchParams.get('limit') || '5');

    const query = `
      SELECT 
        v.id,
        v.video_name,
        v.link,
        v.duration_seconds,
        v.total_pedestrians,
        c.city,
        c.country
      FROM videos v
      JOIN cities c ON v.city_id = c.id
      WHERE c.city = $1
      ORDER BY v.created_at DESC
      LIMIT $2
    `;

    const result = await pool.query(query, [city, limit]);
    
    return NextResponse.json({
      success: true,
      data: result.rows,
      count: result.rows.length
    });
  } catch (error) {
    console.error('Error fetching city videos:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to fetch city videos' },
      { status: 500 }
    );
  }
}

