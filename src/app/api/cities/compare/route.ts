import { NextRequest, NextResponse } from 'next/server';
import { getCohortCities } from '@/lib/cohort';
import { resolveCityId, AmbiguousCityError } from '@/lib/city-identity';
import { METRICS, finite } from '@/lib/metrics';
export async function GET(request: NextRequest) {
  try {
    const search = new URL(request.url).searchParams;
    const date = search.get('date') || '';
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(Date.parse(date)) || new Date(date).toISOString().slice(0, 10) !== date) return NextResponse.json({ success: false, error: 'A valid analysis cutoff date (YYYY-MM-DD) is required' }, { status: 400 });
    const identity = search.get('cityId') || search.get('city');
    if (identity) {
      const id = await resolveCityId(identity);
      if (id == null) return NextResponse.json({ success: false, error: 'City not found' }, { status: 404 });
      search.set('cityId', String(id));
    }
    search.delete('city'); search.delete('date');
    const before = new URLSearchParams(search);
    before.set('analyzedBefore', `${date}T23:59:59.999Z`);
    const [current, historical] = await Promise.all([getCohortCities(search), getCohortCities(before)]);
    const previous = new Map(historical.rows.map(row => [Number(row.id), row]));
    const values = (row: Record<string, unknown> | undefined) => Object.fromEntries(Object.entries(METRICS).filter(([, definition]) => !definition.referenceOnly).map(([key, definition]) => [key, { value: row ? finite(row[definition.property]) : null, unit: definition.unit, n: row && definition.sample ? Number(row[definition.sample] || 0) : null }]));
    const data = current.rows.map(row => ({ cityId: row.id, city: row.city, country: row.country, current: values(row), asOfAnalysisDate: values(previous.get(Number(row.id))) }));
    return NextResponse.json({ success: true, data, comparison_date: date, metadata: { timeline_basis: 'analysis', scope: current.scope, notice: 'Both populations come from the current release. The earlier population includes only clips already analyzed by the cutoff; it is not a reconstruction of behavior on a filming date or a prior published release.' } });
  } catch (error) { console.error(error); return NextResponse.json({ success: false, error: error instanceof AmbiguousCityError ? error.message : 'Analysis comparison unavailable' }, { status: error instanceof AmbiguousCityError ? 409 : 503 }); }
}
