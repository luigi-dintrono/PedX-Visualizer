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

// Helper function to calculate baseline from array of values
function calculateBaseline(values: number[]): number {
  if (values.length === 0) return 0;
  const validValues = values.filter(v => !isNaN(v) && isFinite(v));
  if (validValues.length === 0) return 0;
  return validValues.reduce((sum, v) => sum + v, 0) / validValues.length;
}

// Helper function to apply category balancing (max N per category)
function balanceCategories(relationships: Relationship[], maxPerCategory: number = 3): Relationship[] {
  const byCategory: Record<string, Relationship[]> = {};
  
  // Group by category
  for (const rel of relationships) {
    if (!byCategory[rel.category]) {
      byCategory[rel.category] = [];
    }
    byCategory[rel.category].push(rel);
  }
  
  // Take top N from each category (already sorted by effect size)
  const balanced: Relationship[] = [];
  for (const category of Object.keys(byCategory)) {
    const categoryRels = byCategory[category]
      .sort((a, b) => Math.abs(b.effectSize) - Math.abs(a.effectSize))
      .slice(0, maxPerCategory);
    balanced.push(...categoryRels);
  }
  
  // Final sort by absolute effect size
  return balanced.sort((a, b) => Math.abs(b.effectSize) - Math.abs(a.effectSize));
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ metric: string }> }
) {
  try {
    const { metric } = await params;
    const relationships: Relationship[] = [];

    // ===== WEATHER/DAYTIME RELATIONSHIPS =====
    const weatherDaytimePath = path.join(process.cwd(), 'summary_data', 'weather_daytime_stats.csv');
    if (fs.existsSync(weatherDaytimePath)) {
      const csvContent = fs.readFileSync(weatherDaytimePath, 'utf-8');
      const records = parse(csvContent, { columns: true, skip_empty_lines: true });

      // Calculate baselines from data, excluding 0.00% values
      const riskyProbs = records
        .map((r: any) => parseFloat(r.risky_crossing_prob))
        .filter(v => !isNaN(v) && v > 0.0001); // Exclude 0.00% values
      const redLightProbs = records
        .map((r: any) => parseFloat(r.run_red_light_prob))
        .filter(v => !isNaN(v) && v > 0.0001); // Exclude 0.00% values
      
      const baselineRisky = calculateBaseline(riskyProbs) * 100; // Convert to percentage
      const baselineRedLight = calculateBaseline(redLightProbs) * 100;

      for (const record of records) {
        const rec = record as any;
        const weather = rec.weather;
        const daytime = rec.daytime === '1' ? 'Day' : 'Night';
        const riskyProbRaw = parseFloat(rec.risky_crossing_prob);
        const redLightProbRaw = parseFloat(rec.run_red_light_prob);
        
        // Skip records with 0.00% values
        if (metric === 'risky_crossing' && (isNaN(riskyProbRaw) || riskyProbRaw <= 0.0001)) continue;
        if (metric === 'run_red_light' && (isNaN(redLightProbRaw) || redLightProbRaw <= 0.0001)) continue;
        
        const riskyProb = riskyProbRaw * 100; // Convert to percentage
        const redLightProb = redLightProbRaw * 100;

        if (metric === 'risky_crossing' && !isNaN(riskyProb)) {
          const effectSize = riskyProb - baselineRisky;
          const direction = effectSize > 0 ? '↑' : '↓';
          
          if (Math.abs(effectSize) > 2) {
            relationships.push({
              factor: `${weather.charAt(0).toUpperCase() + weather.slice(1)} + ${daytime}`,
              category: 'Environmental',
              value: `${riskyProb.toFixed(1)}%`,
              effect: `${direction} ${Math.abs(effectSize).toFixed(1)}%`,
              effectSize: effectSize,
              description: `${weather.charAt(0).toUpperCase() + weather.slice(1)} weather during ${daytime.toLowerCase()} ${direction === '↑' ? 'increases' : 'decreases'} risky crossing by ${Math.abs(effectSize).toFixed(1)}%`,
            });
          }
        }

        if (metric === 'run_red_light' && !isNaN(redLightProb)) {
          const effectSize = redLightProb - baselineRedLight;
          const direction = effectSize > 0 ? '↑' : '↓';
          
          if (Math.abs(effectSize) > 1) {
            relationships.push({
              factor: `${weather.charAt(0).toUpperCase() + weather.slice(1)} + ${daytime}`,
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

    // ===== GENDER RELATIONSHIPS =====
    const genderStatsPath = path.join(process.cwd(), 'summary_data', 'gender_stats.csv');
    if (fs.existsSync(genderStatsPath)) {
      const csvContent = fs.readFileSync(genderStatsPath, 'utf-8');
      const records = parse(csvContent, { columns: true, skip_empty_lines: true });

      // Calculate baseline from data, excluding 0.00% values
      const riskyProbs = records
        .map((r: any) => parseFloat(r.risky_crossing))
        .filter(v => !isNaN(v) && v > 0.0001); // Exclude 0.00% values
      const baselineRisky = calculateBaseline(riskyProbs) * 100; // Convert to percentage

      for (const record of records) {
        const rec = record as any;
        const gender = rec.gender;
        const riskyProbRaw = parseFloat(rec.risky_crossing);
        
        // Skip records with 0.00% values
        if (metric === 'risky_crossing' && (isNaN(riskyProbRaw) || riskyProbRaw <= 0.0001)) continue;
        
        if (metric === 'risky_crossing' && rec.risky_crossing) {
          const riskyProb = riskyProbRaw * 100;
          const effectSize = riskyProb - baselineRisky;
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
      }
    }

    // ===== AGE RELATIONSHIPS =====
    const ageStatsPath = path.join(process.cwd(), 'summary_data', 'age_stats.csv');
    if (fs.existsSync(ageStatsPath)) {
      const csvContent = fs.readFileSync(ageStatsPath, 'utf-8');
      const records = parse(csvContent, { columns: true, skip_empty_lines: true });

      // Calculate baseline from data, excluding 0.00% values
      const riskyProbs = records
        .map((r: any) => parseFloat(r.risky_crossing))
        .filter(v => !isNaN(v) && v > 0.0001); // Exclude 0.00% values
      const redLightProbs = records
        .map((r: any) => parseFloat(r.run_red_light))
        .filter(v => !isNaN(v) && v > 0.0001); // Exclude 0.00% values
      
      const baselineRisky = calculateBaseline(riskyProbs) * 100;
      const baselineRedLight = calculateBaseline(redLightProbs) * 100;

      // Group ages into ranges for better insights
      const ageGroups: Record<string, { ages: number[], risky: number[], redLight: number[] }> = {
        'Young (18-30)': { ages: [], risky: [], redLight: [] },
        'Middle (31-50)': { ages: [], risky: [], redLight: [] },
        'Older (51+)': { ages: [], risky: [], redLight: [] },
      };

      for (const record of records) {
        const rec = record as any;
        const age = parseInt(rec.age);
        if (isNaN(age)) continue;

        const riskyProb = parseFloat(rec.risky_crossing);
        const redLightProb = parseFloat(rec.run_red_light);
        
        // Skip records with 0.00% values
        const hasValidRisky = !isNaN(riskyProb) && riskyProb > 0.0001;
        const hasValidRedLight = !isNaN(redLightProb) && redLightProb > 0.0001;

        if (age >= 18 && age <= 30) {
          ageGroups['Young (18-30)'].ages.push(age);
          if (hasValidRisky) ageGroups['Young (18-30)'].risky.push(riskyProb);
          if (hasValidRedLight) ageGroups['Young (18-30)'].redLight.push(redLightProb);
        } else if (age >= 31 && age <= 50) {
          ageGroups['Middle (31-50)'].ages.push(age);
          if (hasValidRisky) ageGroups['Middle (31-50)'].risky.push(riskyProb);
          if (hasValidRedLight) ageGroups['Middle (31-50)'].redLight.push(redLightProb);
        } else if (age >= 51) {
          ageGroups['Older (51+)'].ages.push(age);
          if (hasValidRisky) ageGroups['Older (51+)'].risky.push(riskyProb);
          if (hasValidRedLight) ageGroups['Older (51+)'].redLight.push(redLightProb);
        }
      }

      // Create relationships for age groups
      for (const [groupName, groupData] of Object.entries(ageGroups)) {
        if (groupData.risky.length > 0 && metric === 'risky_crossing') {
          const avgRisky = calculateBaseline(groupData.risky) * 100;
          const effectSize = avgRisky - baselineRisky;
          const direction = effectSize > 0 ? '↑' : '↓';

          if (Math.abs(effectSize) > 2) {
            relationships.push({
              factor: groupName,
              category: 'Demographics',
              value: `${avgRisky.toFixed(1)}%`,
              effect: `${direction} ${Math.abs(effectSize).toFixed(1)}%`,
              effectSize: effectSize,
              description: `${groupName} pedestrians show ${Math.abs(effectSize).toFixed(1)}% ${direction === '↑' ? 'higher' : 'lower'} risky crossing rate`,
            });
          }
        }

        if (groupData.redLight.length > 0 && metric === 'run_red_light') {
          const avgRedLight = calculateBaseline(groupData.redLight) * 100;
          const effectSize = avgRedLight - baselineRedLight;
          const direction = effectSize > 0 ? '↑' : '↓';

          if (Math.abs(effectSize) > 1) {
            relationships.push({
              factor: groupName,
              category: 'Demographics',
              value: `${avgRedLight.toFixed(1)}%`,
              effect: `${direction} ${Math.abs(effectSize).toFixed(1)}%`,
              effectSize: effectSize,
              description: `${groupName} pedestrians show ${Math.abs(effectSize).toFixed(1)}% ${direction === '↑' ? 'higher' : 'lower'} red light violation rate`,
            });
          }
        }
      }
    }

    // ===== CLOTHING RELATIONSHIPS =====
    const clothingStatsPath = path.join(process.cwd(), 'summary_data', 'clothing_stats.csv');
    if (fs.existsSync(clothingStatsPath)) {
      const csvContent = fs.readFileSync(clothingStatsPath, 'utf-8');
      const records = parse(csvContent, { columns: true, skip_empty_lines: true });

      // Calculate baseline from data, excluding 0.00% values
      const riskyRates = records
        .map((r: any) => parseFloat(r['risky_crossing_rate(%)']))
        .filter(v => !isNaN(v) && v > 0.01); // Exclude 0.00% values (already in percentage)
      const redLightRates = records
        .map((r: any) => parseFloat(r['run_red_light_rate(%)']))
        .filter(v => !isNaN(v) && v > 0.01); // Exclude 0.00% values (already in percentage)
      
      const baselineRisky = calculateBaseline(riskyRates);
      const baselineRedLight = calculateBaseline(redLightRates);

      for (const record of records) {
        const rec = record as any;
        const clothingType = rec.clothing_type;
        const riskyRate = parseFloat(rec['risky_crossing_rate(%)']);
        const redLightRate = parseFloat(rec['run_red_light_rate(%)']);
        
        // Skip records with 0.00% values
        if (metric === 'risky_crossing' && (isNaN(riskyRate) || riskyRate <= 0.01)) continue;
        if (metric === 'run_red_light' && (isNaN(redLightRate) || redLightRate <= 0.01)) continue;

        if (metric === 'risky_crossing' && !isNaN(riskyRate)) {
          const effectSize = riskyRate - baselineRisky;
          const direction = effectSize > 0 ? '↑' : '↓';

          if (Math.abs(effectSize) > 2) {
            relationships.push({
              factor: clothingType.charAt(0).toUpperCase() + clothingType.slice(1),
              category: 'Demographics',
              value: `${riskyRate.toFixed(1)}%`,
              effect: `${direction} ${Math.abs(effectSize).toFixed(1)}%`,
              effectSize: effectSize,
              description: `Pedestrians wearing ${clothingType} show ${Math.abs(effectSize).toFixed(1)}% ${direction === '↑' ? 'higher' : 'lower'} risky crossing rate`,
            });
          }
        }

        if (metric === 'run_red_light' && !isNaN(redLightRate)) {
          const effectSize = redLightRate - baselineRedLight;
          const direction = effectSize > 0 ? '↑' : '↓';

          if (Math.abs(effectSize) > 1) {
            relationships.push({
              factor: clothingType.charAt(0).toUpperCase() + clothingType.slice(1),
              category: 'Demographics',
              value: `${redLightRate.toFixed(1)}%`,
              effect: `${direction} ${Math.abs(effectSize).toFixed(1)}%`,
              effectSize: effectSize,
              description: `Pedestrians wearing ${clothingType} show ${Math.abs(effectSize).toFixed(1)}% ${direction === '↑' ? 'higher' : 'lower'} red light violation rate`,
            });
          }
        }
      }
    }

    // ===== PHONE USAGE RELATIONSHIPS =====
    const phoneStatsPath = path.join(process.cwd(), 'summary_data', 'phone_stats.csv');
    if (fs.existsSync(phoneStatsPath)) {
      const csvContent = fs.readFileSync(phoneStatsPath, 'utf-8');
      const records = parse(csvContent, { columns: true, skip_empty_lines: true });

      // Calculate baseline from all records, excluding 0.00% values
      const allRiskyRates = records
        .map((r: any) => parseFloat(r['risky_crossing_rate(%)']))
        .filter(v => !isNaN(v) && v > 0.01); // Exclude 0.00% values (already in percentage)
      const allRedLightRates = records
        .map((r: any) => parseFloat(r['run_red_light_rate(%)']))
        .filter(v => !isNaN(v) && v > 0.01); // Exclude 0.00% values (already in percentage)
      const baselineRisky = calculateBaseline(allRiskyRates);
      const baselineRedLight = calculateBaseline(allRedLightRates);

      for (const record of records) {
        const rec = record as any;
        const accessory = rec.accessory;
        const riskyRate = parseFloat(rec['risky_crossing_rate(%)']);
        const redLightRate = parseFloat(rec['run_red_light_rate(%)']);
        
        // Skip records with 0.00% values
        if (metric === 'risky_crossing' && (isNaN(riskyRate) || riskyRate <= 0.01)) continue;
        if (metric === 'run_red_light' && (isNaN(redLightRate) || redLightRate <= 0.01)) continue;

        if (metric === 'risky_crossing' && !isNaN(riskyRate)) {
          const effectSize = riskyRate - baselineRisky;
          const direction = effectSize > 0 ? '↑' : '↓';

          if (Math.abs(effectSize) > 2) {
            relationships.push({
              factor: accessory === 'phone_using' ? 'Phone Users' : accessory.charAt(0).toUpperCase() + accessory.slice(1),
              category: 'Behavior',
              value: `${riskyRate.toFixed(1)}%`,
              effect: `${direction} ${Math.abs(effectSize).toFixed(1)}%`,
              effectSize: effectSize,
              description: `Pedestrians ${accessory === 'phone_using' ? 'using phones' : `with ${accessory}`} show ${Math.abs(effectSize).toFixed(1)}% ${direction === '↑' ? 'higher' : 'lower'} risky crossing rate`,
            });
          }
        }

        if (metric === 'run_red_light' && !isNaN(redLightRate)) {
          const effectSize = redLightRate - baselineRedLight;
          const direction = effectSize > 0 ? '↑' : '↓';

          if (Math.abs(effectSize) > 1) {
            relationships.push({
              factor: accessory === 'phone_using' ? 'Phone Users' : accessory.charAt(0).toUpperCase() + accessory.slice(1),
              category: 'Behavior',
              value: `${redLightRate.toFixed(1)}%`,
              effect: `${direction} ${Math.abs(effectSize).toFixed(1)}%`,
              effectSize: effectSize,
              description: `Pedestrians ${accessory === 'phone_using' ? 'using phones' : `with ${accessory}`} show ${Math.abs(effectSize).toFixed(1)}% ${direction === '↑' ? 'higher' : 'lower'} red light violation rate`,
            });
          }
        }
      }
    }

    // ===== VEHICLE RELATIONSHIPS =====
    const vehicleStatsPath = path.join(process.cwd(), 'summary_data', 'vehicle_stats.csv');
    if (fs.existsSync(vehicleStatsPath)) {
      const csvContent = fs.readFileSync(vehicleStatsPath, 'utf-8');
      const records = parse(csvContent, { columns: true, skip_empty_lines: true });

      // Check if crossing_speed data exists in crossing_stats.csv
      const crossingStatsPath = path.join(process.cwd(), 'summary_data', 'crossing_stats.csv');
      let speedData: Record<string, number> = {};
      
      if (fs.existsSync(crossingStatsPath) && metric === 'crossing_speed') {
        const crossingContent = fs.readFileSync(crossingStatsPath, 'utf-8');
        const crossingRecords = parse(crossingContent, { columns: true, skip_empty_lines: true });
        // Note: crossing_stats.csv has continent-level data, not vehicle-level
        // We'll skip vehicle speed relationships if no direct data
      }

      // Use available columns: risky_crossing_rate and run_red_light_rate
      // Exclude 0.00% values when calculating baselines
      const riskyRates = records
        .map((r: any) => parseFloat(r['risky_crossing_rate(%)']))
        .filter(v => !isNaN(v) && v > 0.01); // Exclude 0.00% values (already in percentage)
      const redLightRates = records
        .map((r: any) => parseFloat(r['run_red_light_rate(%)']))
        .filter(v => !isNaN(v) && v > 0.01); // Exclude 0.00% values (already in percentage)
      
      const baselineRisky = calculateBaseline(riskyRates);
      const baselineRedLight = calculateBaseline(redLightRates);

      for (const record of records) {
        const rec = record as any;
        const vehicleType = rec.vehicle_type;
        const riskyRate = parseFloat(rec['risky_crossing_rate(%)']);
        const redLightRate = parseFloat(rec['run_red_light_rate(%)']);
        
        // Skip records with 0.00% values
        if (metric === 'risky_crossing' && (isNaN(riskyRate) || riskyRate <= 0.01)) continue;
        if (metric === 'run_red_light' && (isNaN(redLightRate) || redLightRate <= 0.01)) continue;

        if (metric === 'risky_crossing' && !isNaN(riskyRate)) {
          const effectSize = riskyRate - baselineRisky;
          const direction = effectSize > 0 ? '↑' : '↓';

          if (Math.abs(effectSize) > 2) {
            relationships.push({
              factor: vehicleType.charAt(0).toUpperCase() + vehicleType.slice(1),
              category: 'Vehicles',
              value: `${riskyRate.toFixed(1)}%`,
              effect: `${direction} ${Math.abs(effectSize).toFixed(1)}%`,
              effectSize: effectSize,
              description: `Presence of ${vehicleType} ${direction === '↑' ? 'increases' : 'decreases'} risky crossing rate by ${Math.abs(effectSize).toFixed(1)}%`,
            });
          }
        }

        if (metric === 'run_red_light' && !isNaN(redLightRate)) {
          const effectSize = redLightRate - baselineRedLight;
          const direction = effectSize > 0 ? '↑' : '↓';

          if (Math.abs(effectSize) > 1) {
            relationships.push({
              factor: vehicleType.charAt(0).toUpperCase() + vehicleType.slice(1),
              category: 'Vehicles',
              value: `${redLightRate.toFixed(1)}%`,
              effect: `${direction} ${Math.abs(effectSize).toFixed(1)}%`,
              effectSize: effectSize,
              description: `Presence of ${vehicleType} ${direction === '↑' ? 'increases' : 'decreases'} red light violation rate by ${Math.abs(effectSize).toFixed(1)}%`,
            });
          }
        }
      }
    }

    // Apply category balancing (max 3 per category)
    const balancedRelationships = balanceCategories(relationships, 3);

    // Return top 10 overall (after balancing)
    return NextResponse.json({
      success: true,
      data: {
        metric,
        relationships: balancedRelationships.slice(0, 10),
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
