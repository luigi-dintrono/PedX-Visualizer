import { NextRequest, NextResponse } from 'next/server';
import { pool } from '@/lib/database';
import path from 'path';
import fs from 'fs';
import { parse } from 'csv-parse/sync';

interface Relationship {
  factor: string;
  category: string;
  value: string;
  effect: string;
  effectSize: number;
  description: string;
}

export async function GET(
  request: NextRequest,
  { params }: { params: { metric: string } }
) {
  try {
    const metric = params.metric;
    const relationships: Relationship[] = [];

    // Load weather/daytime relationships from CSV
    const weatherDaytimePath = path.join(process.cwd(), 'summary_data', 'weather_daytime_stats.csv');
    if (fs.existsSync(weatherDaytimePath)) {
      const csvContent = fs.readFileSync(weatherDaytimePath, 'utf-8');
      const records = parse(csvContent, { columns: true, skip_empty_lines: true });

      for (const record of records) {
        const weather = record.weather;
        const daytime = record.daytime === '1' ? 'Day' : 'Night';
        const riskyProb = parseFloat(record.risky_crossing_prob);
        const redLightProb = parseFloat(record.run_red_light_prob);

        // Only show relationships for the selected metric
        if (metric === 'risky_crossing' && !isNaN(riskyProb)) {
          const baselineRisky = 20; // Approximate baseline
          const effectSize = riskyProb - baselineRisky;
          const direction = effectSize > 0 ? '↑' : '↓';
          
          if (Math.abs(effectSize) > 2) {
            relationships.push({
              factor: `${weather} + ${daytime}`,
              category: 'Environmental',
              value: `${riskyProb.toFixed(1)}%`,
              effect: `${direction} ${Math.abs(effectSize).toFixed(1)}%`,
              effectSize: effectSize,
              description: `${weather.charAt(0).toUpperCase() + weather.slice(1)} weather during ${daytime.toLowerCase()} ${direction === '↑' ? 'increases' : 'decreases'} risky crossing by ${Math.abs(effectSize).toFixed(1)}%`,
            });
          }
        }

        if (metric === 'run_red_light' && !isNaN(redLightProb)) {
          const baselineRedLight = 5; // Approximate baseline
          const effectSize = redLightProb - baselineRedLight;
          const direction = effectSize > 0 ? '↑' : '↓';
          
          if (Math.abs(effectSize) > 1) {
            relationships.push({
              factor: `${weather} + ${daytime}`,
              category: 'Environmental',
              value: `${redLightProb.toFixed(1)}%`,
              effect: `${direction} ${Math.abs(effectSize).toFixed(1)}%`,
              effectSize: effectSize,
              description: `${weather.charAt(0).toUpperCase() + weather.slice(1)} weather during ${daytime.toLowerCase()} ${direction === '↑' ? 'increases' : 'decreases'} red light violations by ${Math.abs(effectSize).toFixed(1)}%`,
            });
          }
        }
      }
    }

    // Load gender relationships from CSV
    const genderStatsPath = path.join(process.cwd(), 'summary_data', 'gender_stats.csv');
    if (fs.existsSync(genderStatsPath)) {
      const csvContent = fs.readFileSync(genderStatsPath, 'utf-8');
      const records = parse(csvContent, { columns: true, skip_empty_lines: true });

      for (const record of records) {
        const gender = record.gender;
        
        if (metric === 'risky_crossing' && record.risky_crossing_prob) {
          const riskyProb = parseFloat(record.risky_crossing_prob);
          const baseline = 20;
          const effectSize = riskyProb - baseline;
          const direction = effectSize > 0 ? '↑' : '↓';

          if (Math.abs(effectSize) > 2) {
            relationships.push({
              factor: gender.charAt(0).toUpperCase() + gender.slice(1),
              category: 'Demographics',
              value: `${riskyProb.toFixed(1)}%`,
              effect: `${direction} ${Math.abs(effectSize).toFixed(1)}%`,
              effectSize: effectSize,
              description: `${gender.charAt(0).toUpperCase() + gender.slice(1)} pedestrians show ${Math.abs(effectSize).toFixed(1)}% ${direction === '↑' ? 'higher' : 'lower'} risky crossing rate`,
            });
          }
        }

        if (metric === 'phone_usage' && record.phone_using_prob) {
          const phoneProb = parseFloat(record.phone_using_prob);
          
          relationships.push({
            factor: gender.charAt(0).toUpperCase() + gender.slice(1),
            category: 'Demographics',
            value: `${phoneProb.toFixed(1)}%`,
            effect: `${phoneProb.toFixed(1)}%`,
            effectSize: phoneProb,
            description: `${gender.charAt(0).toUpperCase() + gender.slice(1)} pedestrians use phones ${phoneProb.toFixed(1)}% of the time while crossing`,
          });
        }
      }
    }

    // Load vehicle relationships from CSV
    const vehicleStatsPath = path.join(process.cwd(), 'summary_data', 'vehicle_stats.csv');
    if (fs.existsSync(vehicleStatsPath)) {
      const csvContent = fs.readFileSync(vehicleStatsPath, 'utf-8');
      const records = parse(csvContent, { columns: true, skip_empty_lines: true });

      for (const record of records) {
        const vehicleType = record.vehicle_type;
        
        if (metric === 'crossing_speed' && record.avg_crossing_speed) {
          const speed = parseFloat(record.avg_crossing_speed);
          const baseline = 1.5; // m/s baseline
          const effectSize = ((speed - baseline) / baseline) * 100;
          const direction = effectSize > 0 ? '↑' : '↓';

          if (Math.abs(effectSize) > 5) {
            relationships.push({
              factor: vehicleType.charAt(0).toUpperCase() + vehicleType.slice(1),
              category: 'Vehicles',
              value: `${speed.toFixed(2)} m/s`,
              effect: `${direction} ${Math.abs(effectSize).toFixed(0)}%`,
              effectSize: effectSize,
              description: `Presence of ${vehicleType} ${direction === '↑' ? 'increases' : 'decreases'} crossing speed by ${Math.abs(effectSize).toFixed(0)}%`,
            });
          }
        }
      }
    }

    // Sort by absolute effect size
    relationships.sort((a, b) => Math.abs(b.effectSize) - Math.abs(a.effectSize));

    return NextResponse.json({
      success: true,
      data: {
        metric,
        relationships: relationships.slice(0, 10), // Top 10 relationships
      },
    });
  } catch (error) {
    console.error('Error fetching metric relationships:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to fetch metric relationships' },
      { status: 500 }
    );
  }
}

