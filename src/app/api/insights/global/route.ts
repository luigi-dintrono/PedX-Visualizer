import { NextRequest, NextResponse } from 'next/server';
import { getCohortCities } from '@/lib/cohort';
import { METRICS, finite } from '@/lib/metrics';
export async function GET(request: NextRequest) {
  try {
    const cohort = await getCohortCities(new URL(request.url).searchParams);
    const mean = (metric: string) => {
      const definition = METRICS[metric];
      const rows = cohort.rows.filter(row => finite(row[definition.property]) !== null && (!definition.sample || Number(row[definition.sample]) >= definition.minN));
      return rows.length ? rows.reduce((n, row) => n + Number(row[definition.property]), 0) / rows.length * (definition.unit === '%' ? 100 : 1) : null;
    };
    return NextResponse.json({ success: true, data: {
      crossing_speed: null, crossing_time: null, measured_walking_speed: mean('measured_walking_speed'),
      risky_crossing_rate: mean('risky_crossing'), run_red_light_rate: mean('run_red_light'), crosswalk_usage_rate: mean('crosswalk_usage'), phone_usage_rate: mean('phone_usage'), avg_pedestrian_age: mean('avg_age'),
      total_cities: cohort.rows.length, total_videos: cohort.rows.reduce((n, row) => n + Number(row.total_videos), 0), total_pedestrians: cohort.rows.reduce((n, row) => n + Number(row.total_pedestrians), 0), scope: cohort.scope
    } });
  } catch (error) { console.error(error); return NextResponse.json({ success: false, error: 'Baseline unavailable' }, { status: 503 }); }
}
