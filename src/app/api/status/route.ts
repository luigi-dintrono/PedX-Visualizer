import { NextResponse } from 'next/server';
import { pool } from '@/lib/database';
export const dynamic = 'force-dynamic';
export async function GET() {
  try {
    const result = await pool.query(`SELECT
      ARRAY(SELECT dataset_release_id FROM dataset_releases WHERE is_active) AS releases,
      COUNT(*)::int AS videos, COUNT(*) FILTER (WHERE eligible_for_comparison)::int AS eligible_videos,
      COUNT(DISTINCT city_id)::int AS cities, COUNT(DISTINCT city_id) FILTER (WHERE eligible_for_comparison)::int AS eligible_cities,
      COUNT(*) FILTER (WHERE EXISTS (SELECT 1 FROM jsonb_each(metric_validity) e WHERE e.value->>'status' IN ('invalid','invalid_legacy')))::int AS invalid_videos,
      COUNT(*) FILTER (WHERE EXISTS (SELECT 1 FROM jsonb_each(metric_validity) e WHERE e.value->>'status' IN ('experimental','unknown')))::int AS experimental_videos,
      (SELECT COUNT(*)::int FROM pedestrians p JOIN videos v ON v.id = p.video_id WHERE v.dataset_release_id = (SELECT dataset_release_id FROM dataset_releases WHERE is_active)) AS pedestrians,
      (SELECT COUNT(*)::int FROM pedestrians p JOIN videos v ON v.id = p.video_id WHERE v.eligible_for_comparison AND v.dataset_release_id = (SELECT dataset_release_id FROM dataset_releases WHERE is_active)) AS eligible_pedestrians,
      (SELECT model_status FROM dataset_releases WHERE is_active) AS model_status
      FROM videos WHERE dataset_release_id = (SELECT dataset_release_id FROM dataset_releases WHERE is_active)`);
    const row = result.rows[0];
    return NextResponse.json({ success: true, data: {
      datasetReleaseIds: row.releases || [], totalVideos: row.videos, eligibleVideos: row.eligible_videos,
      totalCities: row.cities, eligibleCities: row.eligible_cities, totalPedestrians: row.pedestrians,
      eligiblePedestrians: row.eligible_pedestrians, invalidMetricVideos: row.invalid_videos,
      experimentalMetricVideos: row.experimental_videos, intervalStatus: row.model_status || 'unavailable_pending_current_release_fit',
    } });
  } catch (error) {
    console.error('Dataset status unavailable:', error);
    return NextResponse.json({ success: false, error: 'Dataset release status is unavailable. Apply the release migrations and publish a validated release.' }, { status: 503 });
  }
}
