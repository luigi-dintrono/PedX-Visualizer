import { NextRequest, NextResponse } from 'next/server';
import { getCohortCities } from '@/lib/cohort';
import { READ_CACHE_HEADERS } from '@/lib/http';
export async function GET(request: NextRequest) {
  try {
    const result = await getCohortCities(new URL(request.url).searchParams);
    return NextResponse.json({ success: true, data: result.rows.map(row => ({ ...row, population: row.population_city })), count: result.rows.length, metadata: { scope: result.scope, experimental: result.experimental, estimator: 'pooled_known_flags', interval_status: result.intervalStatus } }, { headers: READ_CACHE_HEADERS });
  } catch (error) {
    console.error('Cohort unavailable:', error);
    return NextResponse.json({ success: false, error: 'Data could not be loaded. Check the selected cohort and dataset release.' }, { status: 503 });
  }
}
