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
    const sourceAllowed = (keys: string[], family?: string) => {
      // Match Insight's detector policy: absent components inherit the family,
      // while a present invalid family cannot be overridden by a component.
      if (family && Object.hasOwn(registry, family) && !expected.includes(registry[family]?.status || 'unknown')) return false;
      return keys.every(key => {
        const rule = Object.hasOwn(registry, key) ? registry[key] : family ? registry[family] : undefined;
        return expected.includes(rule?.status || 'unknown');
      });
    };
    if (!sourceAllowed([definition.validityKey || metric])) return empty('This metric does not meet the selected release validity policy.');
    const relationships = rows.rows.flatMap(row => {
      // An allowed outcome cannot make an invalid subgroup classifier usable.
      // Keep an explicit source contract so new/unknown artifact types fail closed.
      const clothing: Record<string, string[]> = {
        shirt: ['short_sleeved_shirt', 'long_sleeved_shirt'], outerwear: ['short_sleeved_outwear', 'long_sleeved_outwear'],
        dress: ['short_sleeved_dress', 'long_sleeved_dress'], vest: ['vest'], sling: ['sling'],
        shorts: ['shorts'], trousers: ['trousers'], skirt: ['skirt'],
      };
      const environment: Record<string, string[]> = {
        police_car: ['police_car'], arrow_board: ['arrow_board'],
        cones: ['cones'], accident: ['accident'], crack: ['crack'], potholes: ['potholes'],
      };
      const carried = ['backpack', 'umbrella', 'handbag', 'suitcase'];
      const vehicles = ['ambulance', 'army vehicle', 'bicycle', 'bus', 'car', 'garbagevan', 'human hauler',
        'minibus', 'minivan', 'motorbike', 'pickup', 'policecar', 'scooter', 'suv', 'taxi', 'truck', 'van', 'wheelbarrow', 'three wheelers'];
      const required: Record<string, string[] | undefined> = {
        'age_stats.csv': ['age'], 'gender_stats.csv': ['gender'],
        'weather_daytime_stats.csv': ['weather', 'daytime'],
        'phone_stats.csv': row.payload.accessory === 'phone_using' ? ['phone_using'] : undefined,
        'carried_items_stats.csv': carried.includes(row.payload.accessory) ? [row.payload.accessory] : undefined,
        'clothing_stats.csv': clothing[row.payload.clothing_type],
        'vehicle_stats.csv': !vehicles.includes(row.payload.vehicle_type) ? undefined : row.payload.vehicle_type === 'three wheelers'
          ? ['auto rickshaw', 'rickshaw', 'three wheelers -CNG-'] : [row.payload.vehicle_type],
        'accident_road_condition_stats.csv': environment[row.payload.environment_factor],
        'continent_stats.csv': [], 'crosswalk_coeff.csv': ['crosswalk_prob'],
      };
      const families: Record<string, string[]> = {
        gender: ['gender'], age_band: ['age'], phone: ['phone_using'],
        crowd: ['nearby_count_beginning'], daytime: ['daytime'], weather: ['weather'], traffic: ['avg_vehicle_total'],
      };
      const keys = row.file_name === 'inferential_associations.csv' ? families[row.payload.family] : required[row.file_name];
      if (!keys || keys.some(key => !key)) return [];
      const detectorFamily = ({ 'clothing_stats.csv': 'clothing', 'carried_items_stats.csv': 'belongings',
        'vehicle_stats.csv': 'vehicle_type' } as Record<string, string>)[row.file_name]
        || (row.file_name === 'accident_road_condition_stats.csv'
          ? ['crack', 'potholes'].includes(row.payload.environment_factor) ? 'road_condition' : 'accident'
          : row.file_name === 'inferential_associations.csv' && row.payload.family === 'traffic' ? 'vehicle_type' : undefined);
      if (!sourceAllowed(keys, detectorFamily)) return [];
      const evidence = relationshipEvidence(row.file_name, row.payload, metric);
      return evidence ? [{ ...evidence, source: row.file_name, datasetReleaseId: active.dataset_release_id }] : [];
    });
    return NextResponse.json({ success: true, data: { metric, relationships: relationships.slice(0, 24), datasetReleaseId: active.dataset_release_id, notice: relationships.length ? 'Estimates preserve published city-bootstrap intervals, sample sizes and BH-FDR values. They do not establish causal effects.' : 'No adequately powered subgroup estimate with matching validity and confidence intervals is available.' } });
  } catch (error) { console.error(error); return NextResponse.json({ success: false, error: 'Statistical evidence unavailable' }, { status: 503 }); }
}
