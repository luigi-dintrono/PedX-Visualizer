import { NextRequest, NextResponse } from 'next/server';
import { getCohortCities } from '@/lib/cohort';
import { METRICS, finite } from '@/lib/metrics';
import { READ_CACHE_HEADERS } from '@/lib/http';
export async function GET(request: NextRequest, { params }: { params: Promise<{ metric: string }> }) {
  const { metric } = await params;
  const definition = METRICS[metric];
  if (!definition) return NextResponse.json({ success: false, error: 'Unknown metric' }, { status: 400 });
  try {
    const search = new URL(request.url).searchParams;
    search.set('metric', metric);
    const cohort = await getCohortCities(search);
    const eligible = definition.referenceOnly ? [] : cohort.rows.filter(row => finite(row[definition.property]) !== null && (!definition.sample || Number(row[definition.sample]) >= definition.minN));
    const scale = definition.unit === '%' ? 100 : 1;
    const baseline = eligible.length ? eligible.reduce((sum, row) => sum + Number(row[definition.property]), 0) / eligible.length * scale : null;
    eligible.sort((a, b) => Number(a[definition.property]) - Number(b[definition.property]) || Number(a.id) - Number(b.id));
    const cities = eligible.map((row, index) => {
      const value = Number(row[definition.property]) * scale;
      return { id: row.id, rank: index + 1, city: row.city, country: row.country, continent: row.continent, value,
        videoCount: Number(row.total_videos), pedestrianCount: Number(row.total_pedestrians),
        sampleSize: definition.sample ? Number(row[definition.sample]) : null,
        deltaVsGlobal: baseline == null || baseline === 0 ? null : (value - baseline) / baseline * 100,
        rankValue: null, estimate: row[`${metric}_est`] == null ? null : {
          mean: Number(row[`${metric}_est`]) * scale, low: Number(row[`${metric}_lo`]) * scale,
          high: Number(row[`${metric}_hi`]) * scale, videos: row[`${metric}_videos`],
          rankLow: row[`${metric}_rank_hi`] == null ? null : Number(row[`${metric}_ranked`]) + 1 - Number(row[`${metric}_rank_hi`]),
          rankHigh: row[`${metric}_rank_lo`] == null ? null : Number(row[`${metric}_ranked`]) + 1 - Number(row[`${metric}_rank_lo`]),
          rankedCities: row[`${metric}_ranked`] ?? null,
        }, datasetReleaseIds: row.dataset_release_ids };
    });
    return NextResponse.json({ success: true, data: {
      metric: { key: metric, name: definition.name, unit: definition.unit, referenceOnly: !!definition.referenceOnly,
        description: definition.referenceOnly ? 'Imported reference value, excluded from observational rankings.' : 'Observed sample; fractions use only known flags. Baselines weight each eligible city equally. Ordering is descriptive, not evidence of a citywide difference.' },
      global: { value: baseline, totalCities: cities.length, totalVideos: eligible.reduce((n, row) => n + Number(row.total_videos), 0), totalPedestrians: eligible.reduce((n, row) => n + Number(row.total_pedestrians), 0) },
      cities, scope: cohort.scope, experimental: cohort.experimental, estimator: 'pooled_known_flags', intervalStatus: cohort.intervalStatus
    } }, { headers: READ_CACHE_HEADERS });
  } catch (error) { console.error(error); return NextResponse.json({ success: false, error: 'Metric unavailable for this cohort.' }, { status: 503 }); }
}
