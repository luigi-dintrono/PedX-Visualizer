import { NextRequest, NextResponse } from 'next/server';
import { pool } from '@/lib/database';
import { MetricInsight } from '@/types/database';
import { READ_CACHE_HEADERS } from '@/lib/http';

// Real metric insights computed from the materialized views. Replaces the previous hardcoded
// Monaco/Sydney mock that never queried the database. Each entry reports the top and bottom
// city for a metric plus the global average/median. The column names below are a fixed
// server-side whitelist (never user input), so interpolating them into SQL is safe.
const METRICS: {
  metric_type: string;
  cityColumn: string;
  globalAvgColumn: string;
  globalMedianColumn: string;
  description: string;
}[] = [
  {
    metric_type: 'crossing_speed',
    cityColumn: 'avg_crossing_speed',
    globalAvgColumn: 'global_avg_crossing_speed',
    globalMedianColumn: 'global_median_crossing_speed',
    description: 'Average pedestrian crossing speed (m/s) across cities',
  },
  {
    metric_type: 'measured_walking_speed',
    cityColumn: 'avg_measured_walking_speed',
    globalAvgColumn: 'global_avg_measured_walking_speed',
    globalMedianColumn: 'global_median_measured_walking_speed',
    description:
      'Measured walking speed (m/s) — directly measured from dense video tracking, unlike crossing speed which is an imported city-level constant',
  },
  {
    metric_type: 'risky_crossing',
    cityColumn: 'avg_risky_crossing_ratio',
    globalAvgColumn: 'global_avg_risky_crossing_ratio',
    globalMedianColumn: 'global_median_risky_crossing_ratio',
    description: 'Share of pedestrians crossing riskily across cities',
  },
  {
    metric_type: 'run_red_light',
    cityColumn: 'avg_run_red_light_ratio',
    globalAvgColumn: 'global_avg_run_red_light_ratio',
    globalMedianColumn: 'global_median_run_red_light_ratio',
    description: 'Share of pedestrians running red lights across cities',
  },
  {
    metric_type: 'crosswalk_usage',
    cityColumn: 'avg_crosswalk_usage_ratio',
    globalAvgColumn: 'global_avg_crosswalk_usage_ratio',
    globalMedianColumn: 'global_median_crosswalk_usage_ratio',
    description: 'Share of pedestrians using crosswalks across cities',
  },
];

export async function GET(request: NextRequest) {
  try {
    const globalResult = await pool.query('SELECT * FROM mv_global_insights LIMIT 1');
    const global = globalResult.rows[0] || {};

    const num = (v: any): number => (v == null ? 0 : Number(v));

    const metrics: MetricInsight[] = [];
    for (let i = 0; i < METRICS.length; i++) {
      const m = METRICS[i];
      // Top (highest) and bottom (lowest) city for this metric, non-null and non-zero.
      const extremes = await pool.query(
        `WITH ranked AS (
           SELECT city, country, ${m.cityColumn}::float AS value
           FROM mv_city_insights
           WHERE ${m.cityColumn} IS NOT NULL AND ${m.cityColumn} > 0
         )
         SELECT
           (SELECT row_to_json(t) FROM (SELECT city, country, value FROM ranked ORDER BY value DESC LIMIT 1) t) AS top,
           (SELECT row_to_json(t) FROM (SELECT city, country, value FROM ranked ORDER BY value ASC  LIMIT 1) t) AS bottom`
      );
      const top = extremes.rows[0]?.top;
      const bottom = extremes.rows[0]?.bottom;
      if (!top || !bottom) continue;

      metrics.push({
        id: i + 1,
        metric_type: m.metric_type,
        description: m.description,
        top_city: top.city,
        top_city_country: top.country,
        top_city_value: num(top.value),
        last_city: bottom.city,
        last_city_country: bottom.country,
        last_city_value: num(bottom.value),
        global_avg: num(global[m.globalAvgColumn]),
        global_median: num(global[m.globalMedianColumn]),
        insight: `${top.city} leads on ${m.metric_type.replace(/_/g, ' ')}; ${bottom.city} is lowest.`,
      });
    }

    return NextResponse.json(
      { success: true, data: metrics, count: metrics.length },
      { headers: READ_CACHE_HEADERS }
    );
  } catch (error) {
    console.error('Error fetching metric insights:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to fetch metric insights' },
      { status: 500 }
    );
  }
}
