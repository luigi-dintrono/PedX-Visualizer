import { NextRequest, NextResponse } from 'next/server';
import { getCohortCities } from '@/lib/cohort';
import { cohortInsights } from '@/lib/cohort-insights';
export async function GET(request: NextRequest) {
  try {
    const search = new URL(request.url).searchParams;
    const limit = Math.max(1, Math.min(50, Number(search.get('limit')) || 5));
    const cohort = await getCohortCities(search);
    const data = cohort.rows.flatMap(row => {
      const insight = cohortInsights(row, cohort.experimental).find(item => item.category !== 'meta');
      return insight ? [{ city_id: row.id, city: row.city, country: row.country, continent: row.continent, insight_text: insight.text, insight_category: insight.category, relevance_score: insight.relevance_score, data_confidence: insight.data_confidence }] : [];
    }).slice(0, limit);
    return NextResponse.json({ success: true, data, count: data.length, metadata: { scope: cohort.scope } });
  } catch (error) { console.error(error); return NextResponse.json({ success: false, error: 'Sample insights unavailable' }, { status: 503 }); }
}
