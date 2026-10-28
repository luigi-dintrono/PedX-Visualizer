import { NextRequest, NextResponse } from 'next/server';
import { pool } from '@/lib/database';
import { resolveCityId, AmbiguousCityError } from '@/lib/city-identity';
import { buildCohortQuery } from '@/lib/cohort';
import { METRICS } from '@/lib/metrics';
export async function GET(request: NextRequest, { params }: { params: Promise<{ city: string; metric: string }> }) {
  try {
    const { city, metric } = await params;
    const keys: Record<string, string> = { 'crossing-speed': 'crossing_speed', 'crossing-time': 'crossing_time', 'measured-walking-speed': 'measured_walking_speed', 'measured-crossing-speed': 'measured_crossing_speed', 'risky-crossing': 'risky_crossing', 'red-light': 'run_red_light', 'crosswalk-usage': 'crosswalk_usage' };
    const key = keys[metric], definition = METRICS[key];
    if (!definition) return NextResponse.json({ success: false, error: 'Unknown metric' }, { status: 400 });
    const id = await resolveCityId(city);
    if (id == null) return NextResponse.json({ success: false, error: 'City not found' }, { status: 404 });
    const search = new URL(request.url).searchParams;
    const months = Math.max(1, Math.min(60, Number(search.get('months')) || 6));
    const end = new Date(), start = new Date(); start.setUTCMonth(start.getUTCMonth() - months);
    const timelineBasis = search.get('basis') === 'recorded' ? 'recorded' : 'analysis';
    const notice = timelineBasis === 'analysis' ? 'Grouped by analysis date. Changes reflect which clips were processed, not changes in pedestrian behavior over time.' : 'Grouped only by a sourced recording date. Clips with unknown recording dates are excluded; these are observational samples.';
    const empty = () => NextResponse.json({ success: true, data: { metric: { key, name: definition.name, unit: definition.unit }, chartData: [], dateRange: { start: start.toISOString(), end: end.toISOString(), months }, timelineBasis, notice: definition.referenceOnly ? 'Imported city constants have no observational time series.' : notice } });
    if (definition.referenceOnly) return empty();
    search.set('cityId', String(id)); search.set('metric', key);
    const cohort = buildCohortQuery(search);
    const date = timelineBasis === 'recorded' ? 'v.recorded_at' : 'v.analyzed_at';
    const field = definition.flag || (key === 'measured_walking_speed' ? 'walking_speed_mps' : 'crossing_speed_mps');
    const expression = definition.flag ? `COUNT(*) FILTER (WHERE p.${field} IS TRUE)::float / NULLIF(COUNT(p.${field}), 0)` : `AVG(p.${field}) FILTER (WHERE p.${field} BETWEEN 0.1 AND 4)`;
    const n = definition.flag ? `COUNT(p.${field})` : `COUNT(p.${field}) FILTER (WHERE p.${field} BETWEEN 0.1 AND 4)`;
    const values = [...cohort.values, start.toISOString(), end.toISOString()];
    const result = await pool.query(`${cohort.ctes} SELECT date_trunc('month', ${date}) AS month, ${expression} AS value, ${n}::int AS n,
        COUNT(DISTINCT v.id)::int AS videos FROM eligible_videos v JOIN population p ON p.video_id = v.id
        JOIN observations o ON o.city_id = v.city_id
        WHERE ${date} BETWEEN $${values.length - 1}::timestamptz AND $${values.length}::timestamptz
        ${timelineBasis === 'recorded' ? "AND LOWER(NULLIF(TRIM(v.recording_date_source), '')) NOT IN ('unknown', 'unverified', 'unavailable', 'inferred', 'upload_date', 'analysis_date', 'file_mtime', 'download_date', 'import_date')" : ''}
        GROUP BY month HAVING ${n} >= ${definition.minN} ORDER BY month`, values);
    const chartData = result.rows.filter(row => row.value != null).map(row => ({ date: new Date(row.month).toLocaleDateString('en-GB', { month: 'short', year: 'numeric', timeZone: 'UTC' }), fullDate: new Date(row.month).toISOString(), value: Number(row.value) * (definition.unit === '%' ? 100 : 1), n: row.n, videos: row.videos }));
    return NextResponse.json({ success: true, data: { metric: { key, name: definition.name, unit: definition.unit }, chartData, dateRange: { start: start.toISOString(), end: end.toISOString(), months }, timelineBasis, notice } });
  } catch (error) { console.error(error); return NextResponse.json({ success: false, error: error instanceof AmbiguousCityError ? error.message : 'Analysis history unavailable' }, { status: error instanceof AmbiguousCityError ? 409 : 503 }); }
}
