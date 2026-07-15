import { NextRequest, NextResponse } from 'next/server';
import { pool } from '@/lib/database';
import { READ_CACHE_HEADERS } from '@/lib/http';

interface MetricConfig {
  name: string;
  unit: string;
  description: string;
  column_name: string;
  rank_column: string | null;
  higher_is_better: boolean | null;
}

const METRIC_CONFIGS: Record<string, MetricConfig> = {
  risky_crossing: {
    name: 'Risky Crossing Rate',
    unit: '%',
    description: 'Percentage of pedestrians crossing in unsafe conditions without proper precautions',
    column_name: 'avg_risky_crossing_ratio',
    rank_column: 'risky_rank',
    higher_is_better: false,
  },
  run_red_light: {
    name: 'Run Red Light Rate',
    unit: '%',
    description: 'Percentage of pedestrians ignoring traffic signals and crossing against red lights',
    column_name: 'avg_run_red_light_ratio',
    rank_column: 'red_light_rank',
    higher_is_better: false,
  },
  crosswalk_usage: {
    name: 'Crosswalk Usage Rate',
    unit: '%',
    description: 'Percentage of pedestrians using designated crosswalks when available',
    column_name: 'avg_crosswalk_usage_ratio',
    rank_column: 'crosswalk_usage_rank',
    higher_is_better: true,
  },
  phone_usage: {
    name: 'Phone Usage Rate',
    unit: '%',
    description: 'Percentage of pedestrians distracted by mobile phones while crossing',
    column_name: 'phone_usage_ratio',
    rank_column: null,
    higher_is_better: false,
  },
  crossing_speed: {
    name: 'Crossing Speed',
    unit: 'm/s',
    description: 'Average speed of pedestrians while crossing the road',
    column_name: 'avg_crossing_speed',
    rank_column: 'speed_rank',
    higher_is_better: true,
  },
  crossing_time: {
    name: 'Crossing Time',
    unit: 's',
    description: 'Average time taken to complete a road crossing',
    column_name: 'avg_crossing_time',
    rank_column: null,
    higher_is_better: false,
  },
  avg_age: {
    name: 'Average Age',
    unit: 'years',
    description: 'Average age of pedestrians observed crossing',
    column_name: 'avg_age',
    rank_column: null,
    higher_is_better: null,
  },
  pedestrian_density: {
    name: 'Pedestrian Density',
    unit: 'peds/video',
    description: 'Average number of pedestrians observed per video',
    column_name: 'pedestrian_count',
    rank_column: null,
    higher_is_better: null,
  },
  road_width: {
    name: 'Road Width',
    unit: 'm',
    description: 'Average width of roads at crossing locations',
    column_name: 'avg_road_width',
    rank_column: null,
    higher_is_better: null,
  },
};

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ metric: string }> }
) {
  try {
    const { metric } = await params;
    const config = METRIC_CONFIGS[metric];

    if (!config) {
      return NextResponse.json(
        { success: false, error: 'Invalid metric' },
        { status: 400 }
      );
    }

    // Fetch global baseline
    const globalResult = await pool.query(`
      SELECT 
        global_avg_crossing_speed,
        global_avg_risky_crossing_ratio,
        global_avg_run_red_light_ratio,
        global_avg_crosswalk_usage_ratio,
        global_avg_pedestrian_age,
        global_median_crossing_speed,
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

    const globalBaseline = globalResult.rows[0];

    // Rate metrics are stored as 0-1 ratios but displayed with a '%' unit, so scale them by
    // 100 (city value AND global baseline) — otherwise the UI renders "0.15 %" instead of
    // "15.0 %". deltaVsGlobal is a ratio and is unaffected by scaling both sides equally.
    const isRateMetric = ['risky_crossing', 'run_red_light', 'crosswalk_usage', 'phone_usage'].includes(metric);
    const scale = isRateMetric ? 100 : 1;

    // Map each metric to the matching GLOBAL baseline column. Rate metrics use the global
    // mean-of-ratios (global_avg_*_ratio) to match the per-city estimator
    // (mv_city_insights.avg_*_ratio); phone_usage uses the pooled rate to match its pooled
    // per-city column. crossing_time has no column in mv_global_insights and is fetched below.
    const globalColumnMap: Record<string, string | null> = {
      risky_crossing: 'global_avg_risky_crossing_ratio',
      run_red_light: 'global_avg_run_red_light_ratio',
      crosswalk_usage: 'global_avg_crosswalk_usage_ratio',
      phone_usage: 'global_phone_usage_rate',
      crossing_speed: 'global_avg_crossing_speed',
      crossing_time: null, // fetched separately (mv_global_insights has no crossing_time)
      avg_age: 'global_avg_pedestrian_age',
      pedestrian_density: null,
      road_width: null,
    };

    let globalRaw: number | null = globalColumnMap[metric]
      ? parseFloat(globalBaseline[globalColumnMap[metric] as string])
      : null;

    // Real global crossing-time baseline (seconds) — not the old crossing_speed (m/s) proxy,
    // which compared inversely-related quantities in different units.
    if (metric === 'crossing_time') {
      const ctResult = await pool.query(
        `SELECT AVG(crossing_time) AS value FROM videos WHERE crossing_time IS NOT NULL`
      );
      const raw = ctResult.rows[0]?.value;
      globalRaw = raw == null ? null : Number(raw);
    }

    const globalValue =
      globalRaw === null || Number.isNaN(globalRaw) ? null : globalRaw * scale;

    // Fetch top cities
    // Exclude cities with 0.00% for rate metrics (risky_crossing, run_red_light, crosswalk_usage, phone_usage)
    const rankColumn = config.rank_column ? `, ${config.rank_column}` : '';
    const orderDirection = config.higher_is_better ? 'DESC' : 'ASC';

    // Build WHERE clause to exclude 0.00% values for rate metrics
    let whereClause = `${config.column_name} IS NOT NULL`;
    if (isRateMetric) {
      // Exclude exactly 0.00% (accounting for potential floating point precision)
      whereClause += ` AND ${config.column_name} > 0.0001`;
    }
    
    const citiesResult = await pool.query(`
      SELECT 
        city,
        country,
        continent,
        ${config.column_name} as value,
        video_count,
        pedestrian_count
        ${rankColumn}
      FROM mv_city_insights
      WHERE ${whereClause}
      ORDER BY ${config.column_name} ${orderDirection} NULLS LAST
      LIMIT 100
    `);

    // Calculate delta vs global for each city
    const cities = citiesResult.rows.map((row, index) => {
      const cityValue = parseFloat(row.value) * scale;
      const deltaPercent = globalValue
        ? ((cityValue - globalValue) / globalValue) * 100
        : null;
      
      return {
        rank: index + 1,
        city: row.city,
        country: row.country,
        continent: row.continent,
        value: cityValue,
        videoCount: parseInt(row.video_count, 10) || 0,
        pedestrianCount: parseInt(row.pedestrian_count, 10) || 0,
        // Explicit null check so a delta of exactly 0 (city == global) is kept as 0, not "N/A".
        deltaVsGlobal: deltaPercent === null ? null : parseFloat(deltaPercent.toFixed(1)),
        rankValue: config.rank_column ? (row[config.rank_column] || null) : null,
      };
    });

    return NextResponse.json(
      {
        success: true,
        data: {
          metric: {
            key: metric,
            name: config.name,
            unit: config.unit,
            description: config.description,
          },
          global: {
            value: globalValue,
            totalCities: parseInt(globalBaseline.total_cities),
            totalVideos: parseInt(globalBaseline.total_videos),
            totalPedestrians: parseInt(globalBaseline.total_pedestrians),
          },
          cities,
        },
      },
      { headers: READ_CACHE_HEADERS }
    );
  } catch (error) {
    console.error('Error fetching metric data:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to fetch metric data' },
      { status: 500 }
    );
  }
}

