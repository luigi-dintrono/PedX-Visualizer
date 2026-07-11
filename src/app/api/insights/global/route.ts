import { NextRequest, NextResponse } from 'next/server';
import { pool } from '@/lib/database';

/**
 * GET /api/insights/global
 * 
 * Fetches global baseline insights for comparison with city-specific data
 * Returns global averages for all key metrics
 */
export async function GET(request: NextRequest) {
  try {
    // Fetch global baseline from materialized view
    const globalResult = await pool.query(`
      SELECT 
        global_avg_crossing_speed,
        global_avg_risky_crossing_ratio,
        global_avg_run_red_light_ratio,
        global_avg_crosswalk_usage_ratio,
        global_avg_pedestrian_age,
        global_risky_crossing_rate,
        global_run_red_light_rate,
        global_crosswalk_usage_rate,
        global_phone_usage_rate,
        total_cities,
        total_videos,
        total_pedestrians
      FROM mv_global_insights
      LIMIT 1
    `);

    if (globalResult.rows.length === 0) {
      return NextResponse.json(
        { success: false, error: 'No global insights available' },
        { status: 404 }
      );
    }

    const global = globalResult.rows[0];

    // mv_global_insights has no crossing_time column. Fetch the real global average
    // crossing time directly instead of proxying crossing_speed (a different,
    // inversely-related quantity) as the previous code did.
    let globalAvgCrossingTime: number | null = null;
    try {
      const ctResult = await pool.query(
        `SELECT AVG(crossing_time) AS value FROM videos WHERE crossing_time IS NOT NULL`
      );
      const raw = ctResult.rows[0]?.value;
      globalAvgCrossingTime = raw == null ? null : Number(raw);
    } catch (ctErr) {
      console.error('Error fetching global crossing time:', ctErr);
    }

    // Use explicit null checks (not truthiness) so a legitimate 0 is preserved
    // rather than being reported as "no data".
    const num = (v: any): number | null => (v == null ? null : Number(v));
    const rate = (v: any): number | null => (v == null ? null : Number(v) * 100); // ratio -> %

    const globalInsights = {
      crossing_speed: num(global.global_avg_crossing_speed),
      crossing_time: globalAvgCrossingTime,
      risky_crossing_rate: rate(global.global_risky_crossing_rate),
      run_red_light_rate: rate(global.global_run_red_light_rate),
      crosswalk_usage_rate: rate(global.global_crosswalk_usage_rate),
      phone_usage_rate: rate(global.global_phone_usage_rate),
      avg_pedestrian_age: num(global.global_avg_pedestrian_age),
      total_cities: parseInt(global.total_cities, 10) || 0,
      total_videos: parseInt(global.total_videos, 10) || 0,
      total_pedestrians: parseInt(global.total_pedestrians, 10) || 0,
    };

    return NextResponse.json({
      success: true,
      data: globalInsights,
    });
  } catch (error) {
    console.error('Error fetching global insights:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to fetch global insights' },
      { status: 500 }
    );
  }
}

