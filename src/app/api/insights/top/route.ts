import { NextRequest, NextResponse } from 'next/server';
import { pool } from '@/lib/database';

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const limit = parseInt(searchParams.get('limit') || '5');

    // Fetch top insights from cities with insights (excluding meta insights)
    const result = await pool.query(`
      SELECT 
        c.city,
        c.country,
        c.continent,
        insights_item->>'text' as insight_text,
        insights_item->>'category' as insight_category,
        insights_item->>'relevance_score' as relevance_score,
        insights_item->>'data_confidence' as data_confidence
      FROM cities c,
      LATERAL jsonb_array_elements(c.insights) AS insights_item
      WHERE c.insights IS NOT NULL 
        AND jsonb_array_length(c.insights) > 0
        AND insights_item->>'category' != 'meta'
      ORDER BY (insights_item->>'relevance_score')::float DESC
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
