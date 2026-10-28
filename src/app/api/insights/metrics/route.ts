import { NextRequest, NextResponse } from 'next/server';
import { getCohortCities } from '@/lib/cohort';
import { METRICS, finite } from '@/lib/metrics';
export async function GET(request: NextRequest) {
  try {
    const cohort = await getCohortCities(new URL(request.url).searchParams);
    const data = Object.entries(METRICS).filter(([, d]) => !d.referenceOnly).flatMap(([metric, definition], index) => {
      const rows = cohort.rows.filter(row => finite(row[definition.property]) !== null && (!definition.sample || Number(row[definition.sample]) >= definition.minN));
      if (!rows.length) return [];
      const values = rows.map(row => Number(row[definition.property])).sort((a, b) => a - b);
      const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
      return [{ id: index + 1, metric_type: metric, description: definition.name, top_city: '', top_city_country: '', top_city_value: null,
        last_city: '', last_city_country: '', last_city_value: null, global_avg: mean,
        global_median: (values[Math.floor((values.length - 1) / 2)] + values[Math.ceil((values.length - 1) / 2)]) / 2,
        insight: `Descriptive observations from ${rows.length} eligible cities; citywide differences are not established.`, scope: cohort.scope }];
    });
    return NextResponse.json({ success: true, data, count: data.length });
  } catch (error) { console.error(error); return NextResponse.json({ success: false, error: 'Metric evidence unavailable' }, { status: 503 }); }
}
