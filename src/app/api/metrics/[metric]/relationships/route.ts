import { NextRequest, NextResponse } from 'next/server';
import { pool } from '@/lib/database';
import { METRICS } from '@/lib/metrics';
import { relationshipEvidence } from '../../../../../../scripts/lib/relationship-evidence';
export async function GET(request: NextRequest, { params }: { params: Promise<{ metric: string }> }) {
  try {
    const { metric } = await params;
    const definition = METRICS[metric];
    if (!definition) return NextResponse.json({ success: false, error: 'Unknown metric' }, { status: 400 });
    const search = new URL(request.url).searchParams;
    const empty = (notice: string) => NextResponse.json({ success: true, data: { metric, relationships: [], notice } });
    if (definition.referenceOnly) return empty('Imported reference values do not establish observational relationships.');
    if ([...search.keys()].some(key => !['metric', 'includeExperimental'].includes(key))) {
      return empty('Published subgroup statistics describe the full eligible dataset. They are hidden for this filtered cohort until its own confidence intervals are computed.');
    }
    const release = await pool.query('SELECT dataset_release_id, manifest FROM dataset_releases WHERE is_active');
    const active = release.rows[0];
    if (!active) return empty('No active dataset release with statistical evidence.');
    const manifest = active.manifest;
    const expected = search.get('includeExperimental') === 'true' ? ['experimental', 'unknown', 'validated'] : ['validated'];
    const population = manifest.statistics_population;
    if (!population?.eligible_only || !population?.invalid_excluded || !population?.metric_specific_denominators || Object.keys(population.filters || {}).length > 0 || JSON.stringify([...(population.allowed_metric_statuses || [])].sort()) !== JSON.stringify(expected)) {
      return empty('Published statistics do not match this cohort and validity policy; subgroup claims are unavailable.');
    }
    const rows = await pool.query('SELECT file_name, payload FROM dataset_statistics WHERE dataset_release_id = $1 ORDER BY file_name, row_number', [active.dataset_release_id]);
    const registry = rows.rows.find(row => row.file_name === 'metrics_registry.json')?.payload?.default_statuses || manifest.metrics || manifest.metric_registry;
    if (!registry) return empty('The active release has no verified metric validity registry; subgroup evidence is unavailable.');
    const sourceAllowed = (keys: string[]) => keys.every(key => expected.includes(registry[key]?.status || 'unknown'));
    if (!sourceAllowed([definition.validityKey || metric])) return empty('This metric does not meet the selected release validity policy.');
    const relationships = rows.rows.flatMap(row => {
      const required: Record<string, string[]> = { 'age_stats.csv': ['age'], 'gender_stats.csv': ['gender'], 'weather_daytime_stats.csv': ['weather', 'daytime'] };
      const keys = required[row.file_name] || [];
      if (!sourceAllowed(keys)) return [];
      if (row.file_name === 'inferential_associations.csv') {
        if (row.payload.family === 'gender' && !sourceAllowed(['gender'])) return [];
        if (row.payload.family === 'age_band' && !sourceAllowed(['age'])) return [];
      }
      const evidence = relationshipEvidence(row.file_name, row.payload, metric);
      return evidence ? [{ ...evidence, source: row.file_name, datasetReleaseId: active.dataset_release_id }] : [];
    });
    return NextResponse.json({ success: true, data: { metric, relationships: relationships.slice(0, 24), datasetReleaseId: active.dataset_release_id, notice: relationships.length ? 'Estimates preserve published city-bootstrap intervals, sample sizes and BH-FDR values. They do not establish causal effects.' : 'No adequately powered subgroup estimate with matching validity and confidence intervals is available.' } });
  } catch (error) { console.error(error); return NextResponse.json({ success: false, error: 'Statistical evidence unavailable' }, { status: 503 }); }
}
