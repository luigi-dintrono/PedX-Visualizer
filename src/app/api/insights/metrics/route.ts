import { NextRequest, NextResponse } from 'next/server';
import { pool } from '@/lib/database';
import { MetricInsight } from '@/types/database';

export async function GET(request: NextRequest) {
  try {
    // For now, return mock metric data to test the frontend
    const mockMetrics: MetricInsight[] = [
      {
        id: 1,
        metric_type: 'crossing_speed',
        description: 'Average crossing speed across cities',
        top_city: 'Monaco',
        top_city_country: 'Monaco',
        top_city_value: 2.73,
        last_city: 'Sydney',
        last_city_country: 'Australia',
        last_city_value: 0.98,
        global_avg: 1.86,
        global_median: 1.86,
        insight: 'Crossing speed varies significantly between cities, with Monaco showing faster pedestrian movement patterns.'
      }
    ];
    
    return NextResponse.json({
      success: true,
      data: mockMetrics,
      count: mockMetrics.length
    });
  } catch (error) {
    console.error('Error fetching metric insights:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to fetch metric insights' },
      { status: 500 }
    );
  }
}
