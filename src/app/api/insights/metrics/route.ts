import { NextRequest, NextResponse } from 'next/server';
import { pool } from '@/lib/database';
import { MetricInsight } from '@/types/database';

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const metricType = searchParams.get('type'); // e.g., 'crossing_speed', 'time_to_start', etc.

    let query = `
      SELECT * FROM MetricInsight
      WHERE 1=1
    `;
    const params: any[] = [];
    let paramCount = 0;

    if (metricType) {
      query += ` AND metric_type = $${++paramCount}`;
      params.push(metricType);
    }

    query += ` ORDER BY id`;

    const result = await pool.query(query, params);
    
    return NextResponse.json({
      success: true,
      data: result.rows as MetricInsight[],
      count: result.rows.length
    });
  } catch (error) {
    console.error('Error fetching metric insights:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to fetch metric insights' },
      { status: 500 }
    );
  }
}
