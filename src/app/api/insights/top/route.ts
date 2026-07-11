import { NextRequest, NextResponse } from 'next/server';
import { pool } from '@/lib/database';

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const limitRaw = parseInt(searchParams.get('limit') || '5', 10);
    const limit = Number.isFinite(limitRaw) ? Math.min(Math.max(limitRaw, 1), 50) : 5;

    // Fetch the single highest-relevance, non-meta insight per city, then take the
    // top `limit` cities. The previous query applied LIMIT to the flat list of
    // insight rows BEFORE de-duplicating by city, so if the highest-relevance
    // insights clustered in a few cities it returned far fewer cities than asked.
    // Also: `IS DISTINCT FROM 'meta'` keeps null-category insights, the CASE guards
    // against non-array `insights` values, the regex guard prevents a non-numeric
    // relevance_score from throwing on ::float, and NULLS LAST keeps missing scores last.
    const result = await pool.query(`
      SELECT city, country, continent, insight_text, insight_category,
             relevance_score, data_confidence
      FROM (
        SELECT DISTINCT ON (c.id)
          c.city,
          c.country,
          c.continent,
          insights_item->>'text' AS insight_text,
          insights_item->>'category' AS insight_category,
          (insights_item->>'relevance_score')::float AS relevance_score,
          insights_item->>'data_confidence' AS data_confidence
        FROM cities c
        CROSS JOIN LATERAL jsonb_array_elements(
          CASE WHEN jsonb_typeof(c.insights) = 'array' THEN c.insights ELSE '[]'::jsonb END
        ) AS insights_item
        WHERE insights_item->>'category' IS DISTINCT FROM 'meta'
          AND (insights_item->>'relevance_score') ~ '^-?[0-9]+(\\.[0-9]+)?$'
        ORDER BY c.id, (insights_item->>'relevance_score')::float DESC NULLS LAST
      ) per_city
      ORDER BY relevance_score DESC NULLS LAST
      LIMIT $1
    `, [limit]);

    // Group insights by city and get the top one per city
    const cityInsights = new Map();
    
    result.rows.forEach(row => {
      if (!cityInsights.has(row.city)) {
        cityInsights.set(row.city, {
          city: row.city,
          country: row.country,
          continent: row.continent,
          insight_text: row.insight_text,
          insight_category: row.insight_category,
          relevance_score: parseFloat(row.relevance_score),
          data_confidence: row.data_confidence
        });
      }
    });

    const topInsights = Array.from(cityInsights.values()).slice(0, limit);
    
    return NextResponse.json({
      success: true,
      data: topInsights,
      count: topInsights.length
    });
  } catch (error) {
    console.error('Error fetching top insights:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to fetch top insights' },
      { status: 500 }
    );
  }
}
