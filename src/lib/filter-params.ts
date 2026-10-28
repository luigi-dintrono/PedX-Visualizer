import type { GranularFilters } from '@/contexts/FilterContext';

// One serialized cohort is shared by map, cards, rankings, relationships and videos.
export function filterParams(filters: GranularFilters, metric?: string, cityId?: string | null) {
  const search = new URLSearchParams();
  if (filters.includeExperimental) search.set('includeExperimental', 'true');
  if (metric) search.set('metric', metric);
  if (cityId) search.set('cityId', cityId);
  for (const key of ['continents', 'countries', 'gender', 'weather', 'shirtType', 'bottomWear'] as const) {
    if (filters[key].length) search.set(key, filters[key].join(','));
  }
  for (const key of ['daytime', 'riskyCrossing', 'runRedLight', 'crosswalkUse', 'phoneUse', 'backpack', 'umbrella', 'handbag', 'suitcase'] as const) {
    if (filters[key] !== null) search.set(key, String(filters[key]));
  }
  const ranges = [
    ['population', 'Population', 0, 50000000], ['ageRange', 'Age', 0, 100],
    ['crossingSpeed', 'CrossingSpeed', 0, 5], ['avgRoadWidth', 'RoadWidth', 0, 50],
    ['car', 'Car', 0, 500], ['bus', 'Bus', 0, 100], ['truck', 'Truck', 0, 100],
    ['motorbike', 'Motorbike', 0, 200], ['bicycle', 'Bicycle', 0, 300],
  ] as const;
  for (const [key, name, min, max] of ranges) {
    const range = filters[key];
    if (range[0] !== min) search.set(`min${name}`, String(range[0]));
    if (range[1] !== max) search.set(`max${name}`, String(range[1]));
  }
  return search;
}
