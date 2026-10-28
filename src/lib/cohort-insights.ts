import { generateCityInsights } from '../../scripts/generate-city-insights';
export function cohortInsights(row: Record<string, unknown>, experimental = false) {
  return generateCityInsights({ ...row, city_id: row.id, video_count: row.total_videos, pedestrian_count: row.total_pedestrians, experimental });
}
