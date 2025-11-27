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

    // Convert to numbers and structure the response
    const globalInsights = {
      crossing_speed: global.global_avg_crossing_speed ? parseFloat(global.global_avg_crossing_speed) : null,
      crossing_time: global.global_avg_crossing_speed ? parseFloat(global.global_avg_crossing_speed) : null, // Using crossing_speed as proxy
      risky_crossing_rate: global.global_risky_crossing_rate ? parseFloat(global.global_risky_crossing_rate) * 100 : null, // Convert to percentage
      run_red_light_rate: global.global_run_red_light_rate ? parseFloat(global.global_run_red_light_rate) * 100 : null, // Convert to percentage
      crosswalk_usage_rate: global.global_crosswalk_usage_rate ? parseFloat(global.global_crosswalk_usage_rate) * 100 : null, // Convert to percentage
      phone_usage_rate: global.global_phone_usage_rate ? parseFloat(global.global_phone_usage_rate) * 100 : null, // Convert to percentage
      avg_pedestrian_age: global.global_avg_pedestrian_age ? parseFloat(global.global_avg_pedestrian_age) : null,
      total_cities: parseInt(global.total_cities) || 0,
      total_videos: parseInt(global.total_videos) || 0,
      total_pedestrians: parseInt(global.total_pedestrians) || 0,
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

