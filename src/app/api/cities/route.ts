import { NextRequest, NextResponse } from 'next/server';
import { pool } from '@/lib/database';
import { CityInsight } from '@/types/database';

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const city = searchParams.get('city');
    const country = searchParams.get('country');
    const limit = parseInt(searchParams.get('limit') || '50');

    let query = `
      SELECT * FROM CityInsight
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

    query += ` ORDER BY city LIMIT $${++paramCount}`;
    params.push(limit);

    const result = await pool.query(query, params);
    
    return NextResponse.json({
      success: true,
      data: result.rows as CityInsight[],
      count: result.rows.length
    });
  } catch (error) {
    console.error('Error fetching cities:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to fetch cities' },
      { status: 500 }
    );
  }
}
