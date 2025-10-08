#!/usr/bin/env node

/**
 * City Insights Generation Script for PEDX Visualizer
 * 
 * This script generates templated insights for each city based on:
 * - Materialized view data (mv_city_insights, mv_global_insights)
 * - Relevance scoring and thresholds
 * - Minimum 3 insights per city, maximum based on relevance
 * 
 * Usage: node scripts/generate-city-insights.js [--verbose] [--dry-run]
 * --verbose: Show detailed logging
 * --dry-run: Generate insights but don't update database
 */

const { Pool } = require('pg');
require('dotenv').config();

// Configuration
const VERBOSE = process.argv.includes('--verbose');
const DRY_RUN = process.argv.includes('--dry-run');
const MIN_INSIGHTS_PER_CITY = 3;
const MAX_INSIGHTS_PER_CITY = 10;

// Database connection
const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
});

// Helper function for logging
function log(message, data = null) {
    if (VERBOSE) {
        console.log(`[${new Date().toISOString()}] ${message}`);
        if (data) {
            console.log(JSON.stringify(data, null, 2));
        }
    }
}

// Insight Templates with relevance logic
const INSIGHT_TEMPLATES = [
    {
        id: 'speed_vs_global',
        category: 'speed',
        name: 'Crossing Speed vs Global Average',
        evaluate: (cityData, globalData) => {
            if (!cityData.avg_crossing_speed || !globalData.global_avg_crossing_speed || cityData.video_count < 1) {
                return null;
            }
            
            const citySpeed = parseFloat(cityData.avg_crossing_speed);
            const globalSpeed = parseFloat(globalData.global_avg_crossing_speed);
            const delta = ((citySpeed - globalSpeed) / globalSpeed) * 100;
            
            if (Math.abs(delta) < 5) return null; // Only show if delta >= 5% (lowered from 10%)
            
            const comparison = delta > 0 ? 'faster' : 'slower';
            const absDelta = Math.abs(delta).toFixed(1);
            
            return {
                text: `${cityData.city}'s average crossing speed is ${citySpeed.toFixed(2)} m/s, ${absDelta}% ${comparison} than the global average of ${globalSpeed.toFixed(2)} m/s`,
                relevance_score: Math.min(Math.abs(delta) / 50, 1.0), // Higher delta = higher relevance
                metrics: {
                    city_value: citySpeed,
                    comparison_value: globalSpeed,
                    delta_percent: delta
                }
            };
        }
    },
    
    {
        id: 'speed_ranking',
        category: 'rank',
        name: 'Crossing Speed Ranking',
        evaluate: (cityData, globalData) => {
            if (!cityData.speed_rank || cityData.video_count < 1) {
                return null;
            }
            
            const rank = parseInt(cityData.speed_rank);
            const totalCities = parseInt(globalData.total_cities || 50);
            
            // Show if in top 10 or bottom 10 (more lenient)
            if (rank > 10 && rank <= totalCities - 10) return null;
            
            const isTop = rank <= 10;
            const relevance = isTop ? (11 - rank) / 10 : (rank - (totalCities - 10)) / 10;
            
            return {
                text: `${cityData.city} ranks #${rank} out of ${totalCities} cities for crossing speed`,
                relevance_score: 0.6 + (relevance * 0.4), // 0.6 to 1.0
                metrics: {
                    city_value: rank,
                    comparison_value: totalCities,
                    delta_percent: 0
                }
            };
        }
    },
    
    {
        id: 'risk_assessment',
        category: 'behavior',
        name: 'Risky Crossing Assessment',
        evaluate: (cityData, globalData) => {
            if (!cityData.avg_risky_crossing_ratio || !globalData.global_risky_crossing_rate || cityData.pedestrian_count < 10) {
                return null;
            }
            
            const cityRisk = parseFloat(cityData.avg_risky_crossing_ratio) * 100;
            const globalRisk = parseFloat(globalData.global_risky_crossing_rate) * 100;
            const delta = ((cityRisk - globalRisk) / globalRisk) * 100;
            
            if (Math.abs(delta) < 10) return null; // Lowered from 15%
            
            const comparison = delta > 0 ? 'higher' : 'lower';
            const absDelta = Math.abs(delta).toFixed(1);
            
            return {
                text: `${cityData.city} has a ${cityRisk.toFixed(1)}% risky crossing rate, ${absDelta}% ${comparison} than the global average`,
                relevance_score: Math.min(Math.abs(delta) / 100, 1.0),
                metrics: {
                    city_value: cityRisk,
                    comparison_value: globalRisk,
                    delta_percent: delta
                }
            };
        }
    },
    
    {
        id: 'weather_dominance',
        category: 'weather',
        name: 'Dominant Weather Conditions',
        evaluate: (cityData, globalData) => {
            if (!cityData.dominant_weather || cityData.video_count < 1) {
                return null;
            }
            
            // Assuming roughly equal distribution, dominance is when weather appears in 40%+ of videos
            const weatherPercentage = (1 / (cityData.weather_variety || 1)) * 100;
            
            if (weatherPercentage < 30 && cityData.weather_variety > 2) return null; // Lowered from 40%
            
            return {
                text: `${cityData.dominant_weather} conditions are most common in ${cityData.city}`,
                relevance_score: Math.min(weatherPercentage / 100, 0.6),
                metrics: {
                    city_value: weatherPercentage,
                    comparison_value: 0,
                    delta_percent: 0
                }
            };
        }
    },
    
    {
        id: 'top_vehicles',
        category: 'vehicle',
        name: 'Vehicle Composition',
        evaluate: (cityData, globalData) => {
            if (!cityData.vehicles_list || cityData.video_count < 2) {
                return null;
            }
            
            // Parse vehicles list and get top 3
            const vehiclesArray = cityData.vehicles_list.split(',').map(v => v.trim()).filter(v => v);
            const topVehicles = [...new Set(vehiclesArray)].slice(0, 3);
            
            if (topVehicles.length === 0) return null;
            
            return {
                text: `Most common vehicles in ${cityData.city}: ${topVehicles.join(', ')}`,
                relevance_score: 0.5,
                metrics: {
                    city_value: topVehicles.length,
                    comparison_value: 0,
                    delta_percent: 0
                }
            };
        }
    },
    
    {
        id: 'age_demographics',
        category: 'demographic',
        name: 'Age Demographics',
        evaluate: (cityData, globalData) => {
            if (!cityData.avg_age || !globalData.global_median_pedestrian_age || cityData.pedestrian_count < 10) {
                return null;
            }
            
            const cityAge = parseFloat(cityData.avg_age);
            const globalAge = parseFloat(globalData.global_median_pedestrian_age);
            const delta = ((cityAge - globalAge) / globalAge) * 100;
            
            if (Math.abs(delta) < 15) return null; // Lowered from 20%
            
            const comparison = delta > 0 ? 'higher' : 'lower';
            const absDelta = Math.abs(delta).toFixed(1);
            
            return {
                text: `Average pedestrian age in ${cityData.city} is ${cityAge.toFixed(1)} years, ${absDelta}% ${comparison} than the global median`,
                relevance_score: Math.min(Math.abs(delta) / 50, 0.8),
                metrics: {
                    city_value: cityAge,
                    comparison_value: globalAge,
                    delta_percent: delta
                }
            };
        }
    },
    
    {
        id: 'phone_usage',
        category: 'behavior',
        name: 'Phone Usage Pattern',
        evaluate: (cityData, globalData) => {
            if (!cityData.phone_usage_ratio || cityData.pedestrian_count < 10) {
                return null;
            }
            
            const phoneUsage = parseFloat(cityData.phone_usage_ratio) * 100;
            
            if (phoneUsage < 10) return null; // Lowered from 15%
            
            return {
                text: `${phoneUsage.toFixed(1)}% of pedestrians in ${cityData.city} use phones while crossing`,
                relevance_score: Math.min(phoneUsage / 50, 0.9),
                metrics: {
                    city_value: phoneUsage,
                    comparison_value: parseFloat(globalData.global_phone_usage_rate || 0) * 100,
                    delta_percent: 0
                }
            };
        }
    },
    
    {
        id: 'crosswalk_usage',
        category: 'behavior',
        name: 'Crosswalk Usage Pattern',
        evaluate: (cityData, globalData) => {
            if (!cityData.avg_crosswalk_usage_ratio || !globalData.global_crosswalk_usage_rate || cityData.pedestrian_count < 10) {
                return null;
            }
            
            const cityUsage = parseFloat(cityData.avg_crosswalk_usage_ratio) * 100;
            const globalUsage = parseFloat(globalData.global_crosswalk_usage_rate) * 100;
            const delta = ((cityUsage - globalUsage) / globalUsage) * 100;
            
            if (Math.abs(delta) < 15) return null; // Lowered from 25%
            
            const comparison = delta > 0 ? 'higher' : 'lower';
            const absDelta = Math.abs(delta).toFixed(1);
            
            return {
                text: `${cityData.city} shows ${cityUsage.toFixed(1)}% crosswalk usage, ${absDelta}% ${comparison} than the global average`,
                relevance_score: Math.min(Math.abs(delta) / 75, 0.9),
                metrics: {
                    city_value: cityUsage,
                    comparison_value: globalUsage,
                    delta_percent: delta
                }
            };
        }
    },
    
    {
        id: 'continent_leader',
        category: 'rank',
        name: 'Continental Ranking',
        evaluate: (cityData, globalData) => {
            if (!cityData.continent_speed_rank || !cityData.continent || cityData.video_count < 1) {
                return null;
            }
            
            const rank = parseInt(cityData.continent_speed_rank);
            
            // Show for top 3 in continent (more lenient)
            if (rank > 3) return null;
            
            const ordinal = rank === 1 ? 'fastest' : rank === 2 ? '2nd fastest' : '3rd fastest';
            
            return {
                text: `${cityData.city} has the ${ordinal} crossing speed in ${cityData.continent}`,
                relevance_score: 0.7 + (0.15 * (4 - rank)), // Higher for better rank
                metrics: {
                    city_value: rank,
                    comparison_value: parseInt(cityData.cities_in_continent || 1),
                    delta_percent: 0
                }
            };
        }
    },
    
    {
        id: 'gender_balance',
        category: 'demographic',
        name: 'Gender Distribution',
        evaluate: (cityData, globalData) => {
            if (!cityData.male_ratio || cityData.pedestrian_count < 15) {
                return null;
            }
            
            const cityMale = parseFloat(cityData.male_ratio) * 100;
            const globalMale = 50; // Assuming 50% as baseline
            const delta = Math.abs(cityMale - globalMale);
            
            if (delta < 20) return null; // Lowered from 25%
            
            const dominant = cityMale > 50 ? 'male' : 'female';
            
            return {
                text: `${cityMale.toFixed(1)}% of pedestrians in ${cityData.city} are male, showing ${dominant}-dominant crossing patterns`,
                relevance_score: Math.min(delta / 50, 0.7),
                metrics: {
                    city_value: cityMale,
                    comparison_value: globalMale,
                    delta_percent: delta
                }
            };
        }
    },
    
    {
        id: 'red_light_violations',
        category: 'behavior',
        name: 'Red Light Violations',
        evaluate: (cityData, globalData) => {
            if (!cityData.avg_run_red_light_ratio || cityData.pedestrian_count < 10) {
                return null;
            }
            
            const violationRate = parseFloat(cityData.avg_run_red_light_ratio) * 100;
            const rank = parseInt(cityData.red_light_rank || 999);
            
            if (violationRate < 5 && rank > 10) return null; // Lowered from 10%
            
            const rankText = rank <= 10 ? `, ranking #${rank} globally` : '';
            
            return {
                text: `${cityData.city} has a ${violationRate.toFixed(1)}% red light violation rate${rankText}`,
                relevance_score: Math.min(violationRate / 30, 0.9),
                metrics: {
                    city_value: violationRate,
                    comparison_value: rank,
                    delta_percent: 0
                }
            };
        }
    },
    
    {
        id: 'data_confidence',
        category: 'meta',
        name: 'Data Sample Size',
        evaluate: (cityData, globalData) => {
            const videoCount = parseInt(cityData.video_count || 0);
            const pedestrianCount = parseInt(cityData.pedestrian_count || 0);
            
            if (videoCount === 0) return null;
            
            return {
                text: `Based on analysis of ${videoCount} video${videoCount !== 1 ? 's' : ''} and ${pedestrianCount} pedestrian${pedestrianCount !== 1 ? 's' : ''}`,
                relevance_score: 0.3, // Always low priority, shows last
                metrics: {
                    city_value: videoCount,
                    comparison_value: pedestrianCount,
                    delta_percent: 0
                }
            };
        }
    }
];

// Calculate data confidence level
function getDataConfidence(cityData) {
    const videoCount = parseInt(cityData.video_count || 0);
    const pedestrianCount = parseInt(cityData.pedestrian_count || 0);
    
    if (videoCount >= 5 && pedestrianCount >= 100) return 'high';
    if (videoCount >= 3 && pedestrianCount >= 50) return 'medium';
    return 'low';
}

// Generate insights for a single city
function generateCityInsights(cityData, globalData) {
    const insights = [];
    
    log(`Generating insights for ${cityData.city}...`);
    
    // Evaluate each template
    for (const template of INSIGHT_TEMPLATES) {
        try {
            const result = template.evaluate(cityData, globalData);
            if (result) {
                insights.push({
                    id: `${cityData.city_id}_${template.id}`,
                    category: template.category,
                    text: result.text,
                    relevance_score: result.relevance_score,
                    data_confidence: getDataConfidence(cityData),
                    metrics: result.metrics
                });
                
                log(`  ✓ ${template.name}: ${result.relevance_score.toFixed(2)}`);
            }
        } catch (error) {
            console.error(`Error evaluating template ${template.id} for ${cityData.city}:`, error);
        }
    }
    
    // Sort by relevance score (descending)
    insights.sort((a, b) => b.relevance_score - a.relevance_score);
    
    // Ensure minimum 3 insights, cap at maximum
    const minInsights = Math.min(MIN_INSIGHTS_PER_CITY, insights.length);
    const selectedInsights = insights.slice(0, Math.max(minInsights, Math.min(insights.length, MAX_INSIGHTS_PER_CITY)));
    
    log(`  Selected ${selectedInsights.length} insights (from ${insights.length} candidates)`);
    
    return selectedInsights;
}

// Main execution
async function main() {
    console.log('🔍 City Insights Generator');
    console.log('==========================\n');
    
    try {
        // Fetch global baseline data
        console.log('📊 Fetching global baseline data...');
        const globalResult = await pool.query('SELECT * FROM mv_global_insights LIMIT 1');
        
        if (globalResult.rows.length === 0) {
            throw new Error('No global insights data found. Run "make db-refresh-views" first.');
        }
        
        const globalData = globalResult.rows[0];
        log('Global baseline data:', globalData);
        
        // Fetch all city data
        console.log('🌍 Fetching city insights data...');
        const citiesResult = await pool.query('SELECT * FROM mv_city_insights ORDER BY city_id');
        
        console.log(`Found ${citiesResult.rows.length} cities to process\n`);
        
        let processedCount = 0;
        let updatedCount = 0;
        
        // Process each city
        for (const cityData of citiesResult.rows) {
            processedCount++;
            
            // Generate insights
            const insights = generateCityInsights(cityData, globalData);
            
            if (insights.length > 0) {
                // Update database
                if (!DRY_RUN) {
                    await pool.query(
                        'UPDATE cities SET insights = $1 WHERE id = $2',
                        [JSON.stringify(insights), cityData.city_id]
                    );
                    updatedCount++;
                }
                
                console.log(`✓ ${cityData.city}: Generated ${insights.length} insights`);
                
                if (VERBOSE) {
                    insights.forEach((insight, idx) => {
                        console.log(`  ${idx + 1}. [${insight.category}] ${insight.text}`);
                    });
                }
            } else {
                console.log(`⚠ ${cityData.city}: No insights generated (insufficient data)`);
            }
        }
        
        console.log('\n==========================');
        console.log('✅ Insights Generation Complete');
        console.log(`   Cities processed: ${processedCount}`);
        console.log(`   Cities updated: ${updatedCount}`);
        
        if (DRY_RUN) {
            console.log('\n⚠️  DRY RUN MODE - No database changes made');
        }
        
    } catch (error) {
        console.error('❌ Error generating insights:', error);
        process.exit(1);
    } finally {
        await pool.end();
    }
}

// Run main function
if (require.main === module) {
    main();
}

module.exports = { generateCityInsights, INSIGHT_TEMPLATES };

