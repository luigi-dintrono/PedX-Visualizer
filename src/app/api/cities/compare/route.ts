import { NextRequest, NextResponse } from 'next/server';
import { pool } from '@/lib/database';

/**
 * Comparison endpoint for city data
 * Compares current data with historical data at a specific date
 * 
 * GET /api/cities/compare?date=2024-01-01&city=Barcelona
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const targetDate = searchParams.get('date');
    const city = searchParams.get('city');

    if (!targetDate) {
      return NextResponse.json(
        { success: false, error: 'Date parameter required. Format: YYYY-MM-DD' },
        { status: 400 }
      );
    }

    // Validate date format
    const date = new Date(targetDate);
    if (isNaN(date.getTime()) || !targetDate.match(/^\d{4}-\d{2}-\d{2}$/)) {
      return NextResponse.json(
        { success: false, error: 'Invalid date format. Use YYYY-MM-DD' },
        { status: 400 }
      );
    }

    const result = await pool.query(
      'SELECT * FROM compare_city_data_current_vs_date($1::DATE, $2)',
      [targetDate, city || null]
    );

    return NextResponse.json({
      success: true,
      data: result.rows,
      comparison_date: targetDate,
      city_filter: city || null,
      metadata: {
        current_date: new Date().toISOString().split('T')[0],
        comparison_date: targetDate,
        period_days: Math.floor((new Date().getTime() - date.getTime()) / (1000 * 60 * 60 * 24))
      }
    });
  } catch (error) {
    console.error('Error comparing city data:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to compare city data' },
      { status: 500 }
    );
  }
}

