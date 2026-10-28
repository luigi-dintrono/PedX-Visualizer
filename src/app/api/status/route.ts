import { NextResponse } from 'next/server';
import { pool } from '@/lib/database';
export const dynamic = 'force-dynamic';
export async function GET() {
  try {
    const result = await pool.query(`WITH active_release AS (
      SELECT dataset_release_id, model_status FROM dataset_releases WHERE is_active
    ), scoped_videos AS (
      SELECT * FROM videos WHERE dataset_release_id = (SELECT dataset_release_id FROM active_release)
        OR NOT EXISTS (SELECT 1 FROM active_release)
    ) SELECT
      ARRAY(SELECT dataset_release_id FROM active_release) AS releases,
      EXISTS (SELECT 1 FROM active_release) AS has_active_release,
      COUNT(*)::int AS videos, COUNT(*) FILTER (WHERE eligible_for_comparison AND EXISTS (SELECT 1 FROM active_release))::int AS eligible_videos,
      COUNT(DISTINCT city_id)::int AS cities, COUNT(DISTINCT city_id) FILTER (WHERE eligible_for_comparison AND EXISTS (SELECT 1 FROM active_release))::int AS eligible_cities,
      COUNT(*) FILTER (WHERE EXISTS (SELECT 1 FROM jsonb_each(metric_validity) e WHERE e.value->>'status' IN ('invalid','invalid_legacy')))::int AS invalid_videos,
      COUNT(*) FILTER (WHERE EXISTS (SELECT 1 FROM jsonb_each(metric_validity) e WHERE e.value->>'status' IN ('experimental','unknown')))::int AS experimental_videos,
      (SELECT COUNT(*)::int FROM pedestrians p JOIN scoped_videos v ON v.id = p.video_id) AS pedestrians,
      (SELECT COUNT(*)::int FROM pedestrians p JOIN scoped_videos v ON v.id = p.video_id WHERE v.eligible_for_comparison AND EXISTS (SELECT 1 FROM active_release)) AS eligible_pedestrians,
      (SELECT model_status FROM active_release) AS model_status
      FROM scoped_videos`);
    const row = result.rows[0];
    return NextResponse.json({ success: true, data: {
      datasetReleaseIds: row.releases || [],
      coverageScope: row.has_active_release ? 'active_release' : 'audit_archive',
      releaseStatus: row.has_active_release ? 'active' : 'awaiting_validated_release',
      totalVideos: row.videos, eligibleVideos: row.eligible_videos,
      totalCities: row.cities, eligibleCities: row.eligible_cities, totalPedestrians: row.pedestrians,
      eligiblePedestrians: row.eligible_pedestrians, invalidMetricVideos: row.invalid_videos,
      experimentalMetricVideos: row.experimental_videos,
      intervalStatus: row.has_active_release ? row.model_status || 'unavailable_pending_current_release_fit' : 'unavailable_no_active_release',
    } });
  } catch (error) {
    console.error('Dataset status unavailable:', error);
    return NextResponse.json({ success: false, error: 'Dataset release status is unavailable. Apply the release migrations and publish a validated release.' }, { status: 503 });
  }
}
