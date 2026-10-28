import { NextRequest, NextResponse } from 'next/server';
import { pool } from '@/lib/database';
import { resolveCityId, AmbiguousCityError } from '@/lib/city-identity';
import { buildCohortQuery } from '@/lib/cohort';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ city: string }> }
) {
  try {
    const { city } = await params;
    const cityId = await resolveCityId(city);
    if (cityId == null) return NextResponse.json({ success: false, error: 'City not found' }, { status: 404 });
    const search = new URL(request.url).searchParams;
    search.set('cityId', String(cityId));
    const cohort = buildCohortQuery(search);
    const limitRaw = parseInt(request.nextUrl.searchParams.get('limit') || '5', 10);
    const limit = Number.isFinite(limitRaw) ? Math.min(Math.max(limitRaw, 1), 500) : 5;

    const query = `${cohort.ctes}
      SELECT 
        v.id,
        v.video_name,
        v.link,
        v.duration_seconds,
        v.total_pedestrians,
        v.latitude,
        v.longitude,
        v.localization_confidence,
        v.street_name,
        v.localization_status,
        v.localization_spread_m,
        v.localization_candidates,
        v.localization_route,
        v.localization_route_length_m,
        v.localization_trajectory_source,
        v.risky_crossing_ratio,
        v.run_red_light_ratio,
        v.crosswalk_usage_ratio,
        v.phone_usage_ratio,
        v.discovery_run_id, v.sampling_strategy, v.search_order,
        v.main_weather, v.dataset_release_id, v.analysis_status, v.eligibility_status,
        v.metric_validity, v.searched_city_id, v.verified_city_id, v.recorded_at, v.analyzed_at,
        c.city,
        c.country,
        c.latitude as city_latitude,
        c.longitude as city_longitude
      FROM eligible_videos v
      JOIN cities c ON v.city_id = c.id
      JOIN observations o ON o.city_id = v.city_id
      WHERE ${cohort.hasPedestrianFilters ? 'EXISTS (SELECT 1 FROM population matching WHERE matching.video_id = v.id)' : 'TRUE'}
      ORDER BY v.created_at DESC
      LIMIT ${limit}
    `;

    const result = await pool.query(query, cohort.values);
    
    // Convert decimal/numeric types to numbers for JSON response
    // Use explicit null checks so a valid 0 coordinate (equator / prime meridian)
    // is not dropped to null by a truthiness test.
    const videos = result.rows.map(row => ({
      ...row,
      latitude: row.latitude != null ? parseFloat(row.latitude) : null,
      longitude: row.longitude != null ? parseFloat(row.longitude) : null,
      // Localization uncertainty radius (m) and ranked candidate locations (JSONB → already parsed)
      localization_spread_m: row.localization_spread_m != null ? parseFloat(row.localization_spread_m) : null,
      localization_candidates: row.localization_candidates ?? null,
      // Estimated camera route [[lat,lon], ...] (JSONB → already parsed). Stays null when
      // no route was recovered, so the Globe can distinguish that from an empty route.
      localization_route: row.localization_route ?? null,
      localization_route_length_m: row.localization_route_length_m != null ? parseFloat(row.localization_route_length_m) : null,
      localization_trajectory_source: row.localization_trajectory_source ?? null,
      city_latitude: row.city_latitude != null ? parseFloat(row.city_latitude) : null,
      city_longitude: row.city_longitude != null ? parseFloat(row.city_longitude) : null,
      risky_crossing_ratio: row.risky_crossing_ratio != null ? parseFloat(row.risky_crossing_ratio) : null,
      run_red_light_ratio: row.run_red_light_ratio != null ? parseFloat(row.run_red_light_ratio) : null,
      crosswalk_usage_ratio: row.crosswalk_usage_ratio != null ? parseFloat(row.crosswalk_usage_ratio) : null,
      phone_usage_ratio: row.phone_usage_ratio != null ? parseFloat(row.phone_usage_ratio) : null,
    }));
    
    return NextResponse.json({
      success: true,
      data: videos,
      count: videos.length
    });
  } catch (error) {
    console.error('Error fetching city videos:', error);
    return NextResponse.json(
      { success: false, error: error instanceof AmbiguousCityError ? error.message : 'Failed to fetch city videos' },
      { status: error instanceof AmbiguousCityError ? 409 : 503 }
    );
  }
}

