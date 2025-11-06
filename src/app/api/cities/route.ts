import { NextRequest, NextResponse } from 'next/server';
import { pool } from '@/lib/database';
import { CityInsight } from '@/types/database';

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const city = searchParams.get('city');
    const country = searchParams.get('country');
    const limit = parseInt(searchParams.get('limit') || '50');
    
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
      // Use default cumulative view (all data)
      query = `
        SELECT * FROM v_city_summary
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

    const result = await pool.query(query, params);
    
    return NextResponse.json({
      success: true,
      data: result.rows as CityInsight[],
      count: result.rows.length,
      // Include metadata about data range
      metadata: {
        date_filter: targetDate ? targetDate.toISOString().split('T')[0] : null,
        is_temporal: !!targetDate,
        data_range: targetDate 
          ? `Data as of ${targetDate.toISOString().split('T')[0]}` 
          : 'All available data (cumulative)'
      }
    });
  } catch (error) {
    console.error('Error fetching cities:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to fetch cities' },
      { status: 500 }
    );
  }
}
