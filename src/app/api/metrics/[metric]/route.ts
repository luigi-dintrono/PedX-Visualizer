import { NextRequest, NextResponse } from 'next/server';
import { pool } from '@/lib/database';

interface MetricConfig {
  name: string;
  unit: string;
  description: string;
  column_name: string;
  rank_column: string;
  higher_is_better: boolean;
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
  { params }: { params: { metric: string } }
) {
  try {
    const metric = params.metric;
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

    // Map metric to global baseline column
    const globalColumnMap: Record<string, string> = {
      risky_crossing: 'global_risky_crossing_rate',
      run_red_light: 'global_run_red_light_rate',
      crosswalk_usage: 'global_crosswalk_usage_rate',
      phone_usage: 'global_phone_usage_rate',
      crossing_speed: 'global_avg_crossing_speed',
      crossing_time: 'global_avg_crossing_speed', // proxy
      avg_age: 'global_avg_pedestrian_age',
      pedestrian_density: null,
      road_width: null,
    };

    const globalValue = globalColumnMap[metric] 
      ? parseFloat(globalBaseline[globalColumnMap[metric]]) 
      : null;

    // Fetch top cities
    const rankColumn = config.rank_column ? `, ${config.rank_column}` : '';
    const orderDirection = config.higher_is_better ? 'DESC' : 'ASC';
    
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
      WHERE ${config.column_name} IS NOT NULL
      ORDER BY ${config.column_name} ${orderDirection} NULLS LAST
      LIMIT 100
    `);

    // Calculate delta vs global for each city
    const cities = citiesResult.rows.map((row, index) => {
      const cityValue = parseFloat(row.value);
      const deltaPercent = globalValue 
        ? ((cityValue - globalValue) / globalValue) * 100 
        : null;
      
      return {
        rank: index + 1,
        city: row.city,
        country: row.country,
        continent: row.continent,
        value: cityValue,
        videoCount: parseInt(row.video_count) || 0,
        pedestrianCount: parseInt(row.pedestrian_count) || 0,
        deltaVsGlobal: deltaPercent ? parseFloat(deltaPercent.toFixed(1)) : null,
        rankValue: row[config.rank_column] || null,
      };
    });

    return NextResponse.json({
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
    });
  } catch (error) {
    console.error('Error fetching metric data:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to fetch metric data' },
      { status: 500 }
    );
  }
}

