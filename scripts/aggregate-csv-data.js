#!/usr/bin/env node

/**
 * CSV Data Aggregation Script for PEDX Visualizer
 * 
 * This script reads CSV files from the summary_data directory and aggregates
 * them into PostgreSQL tables using the improved analytics structure.
 * 
 * Usage: node scripts/aggregate-csv-data.js [--fresh] [--verbose]
 * --fresh: Drop and recreate all tables
 * --verbose: Show detailed logging
 */

const fs = require('fs');
const path = require('path');
const csv = require('csv-parser');
const { Pool } = require('pg');
require('dotenv').config();

// Import GeoNames API integration
const GeoNamesAPI = require('./geonames-api');

// Configuration
const CSV_DIR = path.join(__dirname, '..', 'summary_data');
const VERBOSE = process.argv.includes('--verbose');
const FRESH_START = process.argv.includes('--fresh');

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

// Helper function to safely parse numeric values
function safeNumeric(value) {
    if (value === null || value === undefined || value === '') {
        return null;
    }
    const parsed = parseFloat(value);
    return isNaN(parsed) ? null : parsed;
}

// Helper function to safely parse boolean values
function safeBoolean(value) {
    if (value === null || value === undefined || value === '') {
        return null;
    }
    return value === '1' || value === 'true' || value === 'yes';
}

// Helper function to safely parse integer values
function safeInteger(value) {
    if (value === null || value === undefined || value === '') {
        return null;
    }
    const parsed = parseInt(value);
    return isNaN(parsed) ? null : parsed;
}

// Helper function to clean string values
function cleanString(value) {
    if (value === null || value === undefined) {
        return null;
    }
    return value.toString().trim() || null;
}

// Read CSV file and return parsed data
async function readCSV(filePath) {
    return new Promise((resolve, reject) => {
        const results = [];
        fs.createReadStream(filePath)
            .pipe(csv())
            .on('data', (data) => results.push(data))
            .on('end', () => resolve(results))
            .on('error', reject);
    });
}

// Database operations
class DatabaseAggregator {
    constructor() {
        this.cityCache = new Map(); // Cache for city lookups
        this.videoCache = new Map(); // Cache for video lookups
    }

    async initialize() {
        log('Initializing database connection...');
        try {
            await pool.query('SELECT 1');
            log('Database connection successful');
            
            if (FRESH_START) {
                log('Fresh start requested - will recreate schema');
                const schemaPath = path.join(__dirname, '..', 'database', 'schema.sql');
                const schema = fs.readFileSync(schemaPath, 'utf8');
                await pool.query(schema);
                log('Schema recreated successfully');
            }
        } catch (error) {
            console.error('Database initialization failed:', error);
            throw error;
        }
    }

    // Core data aggregation (cities, videos, pedestrians)
    async aggregateCoreData() {
        log('Aggregating core data...');
        
        try {
            // Read CSV files
            const [videoData, timeData, pedestrianData] = await Promise.all([
                readCSV(path.join(CSV_DIR, 'all_video_info.csv')),
                readCSV(path.join(CSV_DIR, 'all_time_info.csv')),
                readCSV(path.join(CSV_DIR, 'all_pedestrian_info.csv'))
            ]);
            
            // Create time data lookup
            const timeMap = new Map();
            for (const row of timeData) {
                timeMap.set(row.duration_seconds, row.analysis_seconds);
            }

            // Process cities first
            await this.aggregateCities(videoData);
            
            // Process videos
            await this.aggregateVideos(videoData, timeMap);
            
            // Process pedestrians
            await this.aggregatePedestrians(pedestrianData);
            
            log(`Processed ${videoData.length} cities, ${videoData.length} videos, ${pedestrianData.length} pedestrians`);
        } catch (error) {
            console.error('Error aggregating core data:', error);
        }
    }

    async aggregateCities(videoData) {
        log('Aggregating cities data...');
        
        const cityMap = new Map();
        
        // Process video data to extract unique cities
        for (const row of videoData) {
            // Handle missing country data - allow cities with missing data to be added for GeoNames processing
            if (!row.country || row.country.trim() === '') {
                // Handle special cases where we know the location
                if (row.city === 'Brooklyn') {
                    row.country = 'United States';
                    row.state = 'New York';
                    row.iso3 = 'USA';
                    row.continent = 'North America';
                    row.lat = '40.6782';
                    row.lon = '-73.9442';
                    console.log(`Added missing location data for Brooklyn, NY, USA`);
                } else {
                    // Allow cities with missing country data to be added - GeoNames will fill in missing data later
                    console.log(`Adding city ${row.city} with missing country data - will be filled by GeoNames API`);
                    // Set placeholder values to avoid null constraint violations
                    row.country = row.country || 'Unknown';
                    row.iso3 = row.iso3 || '';
                    row.continent = row.continent || 'Unknown';
                    row.state = row.state || '';
                    row.lat = row.lat || null;
                    row.lon = row.lon || null;
                }
            }
            
            const cityKey = `${row.city}_${row.country}`;
            if (!cityMap.has(cityKey)) {
                cityMap.set(cityKey, {
                    city: cleanString(row.city),
                    state: cleanString(row.state),
                    country: cleanString(row.country),
                    iso3: cleanString(row.iso3),
                    continent: cleanString(row.continent),
                    latitude: safeNumeric(row.lat),
                    longitude: safeNumeric(row.lon),
                    gmp: safeNumeric(row.gmp),
                    population_city: safeInteger(row.population_city),
                    population_country: safeInteger(row.population_country),
                    traffic_mortality: safeNumeric(row.traffic_mortality),
                    literacy_rate: safeNumeric(row.literacy_rate),
                    avg_height: safeNumeric(row.avg_height),
                    med_age: safeNumeric(row.med_age),
                    gini: safeNumeric(row.gini)
                });
            }
        }

        // Insert or update cities
        for (const [cityKey, cityData] of cityMap) {
            try {
                const result = await pool.query(`
                    INSERT INTO cities (
                        city, state, country, iso3, continent, latitude, longitude,
                        gmp, population_city, population_country, traffic_mortality,
                        literacy_rate, avg_height, med_age, gini
                    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
                    ON CONFLICT (city, country) 
                    DO UPDATE SET
                        state = EXCLUDED.state,
                        iso3 = EXCLUDED.iso3,
                        continent = EXCLUDED.continent,
                        latitude = EXCLUDED.latitude,
                        longitude = EXCLUDED.longitude,
                        gmp = EXCLUDED.gmp,
                        population_city = EXCLUDED.population_city,
                        population_country = EXCLUDED.population_country,
                        traffic_mortality = EXCLUDED.traffic_mortality,
                        literacy_rate = EXCLUDED.literacy_rate,
                        avg_height = EXCLUDED.avg_height,
                        med_age = EXCLUDED.med_age,
                        gini = EXCLUDED.gini,
                        updated_at = CURRENT_TIMESTAMP
                    RETURNING id
                `, [
                    cityData.city, cityData.state, cityData.country, cityData.iso3,
                    cityData.continent, cityData.latitude, cityData.longitude,
                    cityData.gmp, cityData.population_city, cityData.population_country,
                    cityData.traffic_mortality, cityData.literacy_rate, cityData.avg_height,
                    cityData.med_age, cityData.gini
                ]);
                
                this.cityCache.set(cityKey, result.rows[0].id);
                log(`City processed: ${cityData.city}, ${cityData.country}`);
            } catch (error) {
                console.error(`Error processing city ${cityKey}:`, error);
            }
        }
        
        log(`Processed ${cityMap.size} cities`);
    }

    async aggregateVideos(videoData, timeMap) {
        log('Aggregating videos data...');

        for (const row of videoData) {
            try {
                const cityKey = `${row.city}_${row.country}`;
                const cityId = this.cityCache.get(cityKey);
                
                if (!cityId) {
                    console.warn(`City not found for video ${row.link}: ${cityKey}`);
                    continue;
                }

                const videoData = {
                    city_id: cityId,
                    link: cleanString(row.link),
                    video_name: cleanString(row.video_name),
                    city_link: cleanString(row.city_link || `${row.city}_${row.link}`),
                    duration_seconds: safeNumeric(row.duration_seconds),
                    total_frames: safeInteger(row.total_frames),
                    analysis_seconds: safeNumeric(timeMap.get(row.duration_seconds)),
                    total_pedestrians: safeInteger(row.total_pedestrians),
                    total_crossed_pedestrians: safeInteger(row.total_crossed_pedestrians),
                    average_age: safeNumeric(row.average_age),
                    phone_usage_ratio: safeNumeric(row.phone_usage_ratio),
                    risky_crossing_ratio: safeNumeric(row.risky_crossing_ratio),
                    run_red_light_ratio: safeNumeric(row.run_red_light_ratio),
                    crosswalk_usage_ratio: safeNumeric(row.crosswalk_usage_ratio),
                    traffic_signs_ratio: safeNumeric(row.traffic_signs_ratio),
                    total_vehicles: safeInteger(row.total_vehicles),
                    top3_vehicles: cleanString(row.top3_vehicles),
                    main_weather: cleanString(row.main_weather),
                    sidewalk_prob: safeNumeric(row.sidewalk_prob),
                    crosswalk_prob: safeNumeric(row.crosswalk_prob),
                    traffic_light_prob: safeNumeric(row.traffic_light_prob),
                    avg_road_width: safeNumeric(row.avg_road_width),
                    crack_prob: safeNumeric(row.Crack_prob),
                    potholes_prob: safeNumeric(row.Potholes_prob),
                    police_car_prob: safeNumeric(row.police_car_prob),
                    arrow_board_prob: safeNumeric(row['Arrow Board_prob']),
                    cones_prob: safeNumeric(row.cones_prob),
                    accident_prob: safeNumeric(row.accident_prob),
                    crossing_time: safeNumeric(row.crossing_time),
                    crossing_speed: safeNumeric(row.crossing_speed)
                };

                const result = await pool.query(`
                    INSERT INTO videos (
                        city_id, link, video_name, city_link, duration_seconds, total_frames,
                        analysis_seconds, total_pedestrians, total_crossed_pedestrians,
                        average_age, phone_usage_ratio, risky_crossing_ratio, run_red_light_ratio,
                        crosswalk_usage_ratio, traffic_signs_ratio, total_vehicles, top3_vehicles,
                        main_weather, sidewalk_prob, crosswalk_prob, traffic_light_prob,
                        avg_road_width, crack_prob, potholes_prob, police_car_prob,
                        arrow_board_prob, cones_prob, accident_prob, crossing_time, crossing_speed
                    ) VALUES (
                        $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15,
                        $16, $17, $18, $19, $20, $21, $22, $23, $24, $25, $26, $27, $28, $29, $30
                    )
                    ON CONFLICT (link) 
                    DO UPDATE SET
                        city_id = EXCLUDED.city_id,
                        video_name = EXCLUDED.video_name,
                        city_link = EXCLUDED.city_link,
                        duration_seconds = EXCLUDED.duration_seconds,
                        total_frames = EXCLUDED.total_frames,
                        analysis_seconds = EXCLUDED.analysis_seconds,
                        total_pedestrians = EXCLUDED.total_pedestrians,
                        total_crossed_pedestrians = EXCLUDED.total_crossed_pedestrians,
                        average_age = EXCLUDED.average_age,
                        phone_usage_ratio = EXCLUDED.phone_usage_ratio,
                        risky_crossing_ratio = EXCLUDED.risky_crossing_ratio,
                        run_red_light_ratio = EXCLUDED.run_red_light_ratio,
                        crosswalk_usage_ratio = EXCLUDED.crosswalk_usage_ratio,
                        traffic_signs_ratio = EXCLUDED.traffic_signs_ratio,
                        total_vehicles = EXCLUDED.total_vehicles,
                        top3_vehicles = EXCLUDED.top3_vehicles,
                        main_weather = EXCLUDED.main_weather,
                        sidewalk_prob = EXCLUDED.sidewalk_prob,
                        crosswalk_prob = EXCLUDED.crosswalk_prob,
                        traffic_light_prob = EXCLUDED.traffic_light_prob,
                        avg_road_width = EXCLUDED.avg_road_width,
                        crack_prob = EXCLUDED.crack_prob,
                        potholes_prob = EXCLUDED.potholes_prob,
                        police_car_prob = EXCLUDED.police_car_prob,
                        arrow_board_prob = EXCLUDED.arrow_board_prob,
                        cones_prob = EXCLUDED.cones_prob,
                        accident_prob = EXCLUDED.accident_prob,
                        crossing_time = EXCLUDED.crossing_time,
                        crossing_speed = EXCLUDED.crossing_speed,
                        updated_at = CURRENT_TIMESTAMP
                    RETURNING id
                `, Object.values(videoData));
                
                this.videoCache.set(row.link, result.rows[0].id);
                log(`Video processed: ${row.video_name}`);
            } catch (error) {
                console.error(`Error processing video ${row.link}:`, error);
            }
        }
        
        log(`Processed ${videoData.length} videos`);
    }

    async aggregatePedestrians(pedestrianData) {
        log('Aggregating pedestrians data...');
        
        let processed = 0;
        for (const row of pedestrianData) {
            try {
                const videoId = this.videoCache.get(row.link);
                if (!videoId) {
                    console.warn(`Video not found for pedestrian ${row.track_id}: ${row.link}`);
                    continue;
                }

                const pedestrianData = {
                    video_id: videoId,
                    track_id: safeInteger(row.track_id),
                    crossed: safeBoolean(row.crossed),
                    nearby_count_beginning: safeInteger(row.nearby_count_beginning),
                    nearby_count_whole: safeInteger(row.nearby_count_whole),
                    risky_crossing: safeBoolean(row.risky_crossing),
                    run_red_light: safeBoolean(row.run_red_light),
                    crosswalk_use_or_not: safeBoolean(row.crosswalk_use_or_not),
                    gender: cleanString(row.gender),
                    age: safeInteger(row.age),
                    phone_using: safeBoolean(row.phone_using),
                    backpack: safeBoolean(row.backpack),
                    umbrella: safeBoolean(row.umbrella),
                    handbag: safeBoolean(row.handbag),
                    suitcase: safeBoolean(row.suitcase),
                    short_sleeved_shirt: safeBoolean(row.short_sleeved_shirt),
                    long_sleeved_shirt: safeBoolean(row.long_sleeved_shirt),
                    short_sleeved_outwear: safeBoolean(row.short_sleeved_outwear),
                    long_sleeved_outwear: safeBoolean(row.long_sleeved_outwear),
                    vest: safeBoolean(row.vest),
                    sling: safeBoolean(row.sling),
                    shorts: safeBoolean(row.shorts),
                    trousers: safeBoolean(row.trousers),
                    skirt: safeBoolean(row.skirt),
                    short_sleeved_dress: safeBoolean(row.short_sleeved_dress),
                    long_sleeved_dress: safeBoolean(row.long_sleeved_dress),
                    vest_dress: safeBoolean(row.vest_dress),
                    sling_dress: safeBoolean(row.sling_dress),
                    weather: cleanString(row.weather),
                    daytime: safeBoolean(row.daytime),
                    police_car: safeBoolean(row.police_car),
                    arrow_board: safeBoolean(row.arrow_board),
                    cones: safeBoolean(row.cones),
                    accident: safeBoolean(row.accident),
                    crack: safeBoolean(row.crack),
                    potholes: safeBoolean(row.potholes),
                    avg_vehicle_total: safeInteger(row.avg_vehicle_total),
                    crossing_sign: safeBoolean(row.crossing_sign),
                    avg_road_width: safeNumeric(row.avg_road_width),
                    crosswalk: safeBoolean(row.crosswalk),
                    sidewalk: safeBoolean(row.sidewalk),
                    // Vehicle types
                    ambulance: safeBoolean(row.ambulance),
                    army_vehicle: safeBoolean(row['army vehicle']),
                    auto_rickshaw: safeBoolean(row['auto rickshaw']),
                    bicycle: safeBoolean(row.bicycle),
                    bus: safeBoolean(row.bus),
                    car: safeBoolean(row.car),
                    garbagevan: safeBoolean(row.garbagevan),
                    human: safeBoolean(row.human),
                    hauler: safeBoolean(row.hauler),
                    minibus: safeBoolean(row.minibus),
                    minivan: safeBoolean(row.minivan),
                    motorbike: safeBoolean(row.motorbike),
                    pickup: safeBoolean(row.pickup),
                    policecar: safeBoolean(row.policecar),
                    rickshaw: safeBoolean(row.rickshaw),
                    scooter: safeBoolean(row.scooter),
                    suv: safeBoolean(row.suv),
                    taxi: safeBoolean(row.taxi),
                    three_wheelers_cng: safeBoolean(row['three wheelers -CNG-']),
                    truck: safeBoolean(row.truck),
                    van: safeBoolean(row.van),
                    wheelbarrow: safeBoolean(row.wheelbarrow)
                };

                await pool.query(`
                    INSERT INTO pedestrians (
                        video_id, track_id, crossed, nearby_count_beginning, nearby_count_whole,
                        risky_crossing, run_red_light, crosswalk_use_or_not, gender, age, phone_using,
                        backpack, umbrella, handbag, suitcase, short_sleeved_shirt, long_sleeved_shirt,
                        short_sleeved_outwear, long_sleeved_outwear, vest, sling, shorts, trousers, skirt,
                        short_sleeved_dress, long_sleeved_dress, vest_dress, sling_dress, weather, daytime,
                        police_car, arrow_board, cones, accident, crack, potholes, avg_vehicle_total,
                        crossing_sign, avg_road_width, crosswalk, sidewalk, ambulance, army_vehicle,
                        auto_rickshaw, bicycle, bus, car, garbagevan, human, hauler, minibus, minivan,
                        motorbike, pickup, policecar, rickshaw, scooter, suv, taxi, three_wheelers_cng,
                        truck, van, wheelbarrow
                    ) VALUES (
                        $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20,
                        $21, $22, $23, $24, $25, $26, $27, $28, $29, $30, $31, $32, $33, $34, $35, $36, $37, $38,
                        $39, $40, $41, $42, $43, $44, $45, $46, $47, $48, $49, $50, $51, $52, $53, $54, $55, $56,
                        $57, $58, $59, $60, $61, $62, $63
                    )
                    ON CONFLICT (video_id, track_id) 
                    DO UPDATE SET
                        crossed = EXCLUDED.crossed,
                        nearby_count_beginning = EXCLUDED.nearby_count_beginning,
                        nearby_count_whole = EXCLUDED.nearby_count_whole,
                        risky_crossing = EXCLUDED.risky_crossing,
                        run_red_light = EXCLUDED.run_red_light,
                        crosswalk_use_or_not = EXCLUDED.crosswalk_use_or_not,
                        gender = EXCLUDED.gender,
                        age = EXCLUDED.age,
                        phone_using = EXCLUDED.phone_using,
                        updated_at = CURRENT_TIMESTAMP
                `, Object.values(pedestrianData));
                
                processed++;
                if (processed % 100 === 0) {
                    log(`Processed ${processed} pedestrians...`);
                }
            } catch (error) {
                console.error(`Error processing pedestrian ${row.track_id} in video ${row.link}:`, error);
            }
        }
        
        log(`Processed ${processed} pedestrians`);
    }

    // Analytics aggregation with improved structure
    async aggregateAnalytics() {
        log('Aggregating analytics data...');
        
        const statsFiles = [
            'accident_road_condition_stats.csv',
            'age_stats.csv',
            'carried_items_stats.csv',
            'clothing_stats.csv',
            'continent_stats.csv',
            'crossing_stats.csv',
            'crosswalk_coeff.csv',
            'gender_stats.csv',
            'phone_stats.csv',
            'road_corr.csv',
            'time_stats.csv',
            'vehicle_stats.csv',
            'weather_daytime_stats.csv'
        ];

        for (const filename of statsFiles) {
            const filePath = path.join(CSV_DIR, filename);
            if (!fs.existsSync(filePath)) {
                log(`Stats file not found: ${filename}`);
                continue;
            }

            try {
                const data = await readCSV(filePath);
                await this.processStatsFile(filename, data);
            } catch (error) {
                console.error(`Error processing stats file ${filename}:`, error);
            }
        }
    }

    async processStatsFile(filename, data) {
        log(`Processing stats file: ${filename}`);
        
        for (const row of data) {
            try {
                // Process each column in the row
                for (const [columnName, value] of Object.entries(row)) {
                    if (!value || value === '') continue;
                    
                    // Determine fact type and metric name based on column
                    const factConfig = this.getFactConfig(filename, columnName, value, row);
                    if (!factConfig) continue;
                    
                    // Get or create dimension
                    const dimensionId = await this.getOrCreateDimension(factConfig.dimensionType, factConfig.dimensionValue);
                    
                    // Insert fact
                    await pool.query(`
                        INSERT INTO analytics_facts (
                            fact_type, metric_name, dimension_id, value_numeric, 
                            value_percentage, correlation_coefficient, sample_size, data_source
                        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
                    `, [
                        factConfig.factType,
                        factConfig.metricName,
                        dimensionId,
                        factConfig.valueNumeric,
                        factConfig.valuePercentage,
                        factConfig.correlationCoefficient,
                        factConfig.sampleSize,
                        filename
                    ]);
                }
            } catch (error) {
                console.error(`Error processing row in ${filename}:`, error, row);
            }
        }
    }

    getFactConfig(filename, columnName, value, row = {}) {
        const numericValue = safeNumeric(value);
        if (numericValue === null) return null;

        // Define mappings for different file types
        const configs = {
            'accident_road_condition_stats.csv': {
                dimensionColumn: 'environment_factor',
                metrics: {
                    'risky_crossing_rate(%)': { factType: 'statistic', metricName: 'risky_crossing_rate', valuePercentage: numericValue },
                    'run_red_light_rate(%)': { factType: 'statistic', metricName: 'run_red_light_rate', valuePercentage: numericValue }
                }
            },
            'age_stats.csv': {
                dimensionColumn: 'age',
                metrics: {
                    'risky_crossing': { factType: 'statistic', metricName: 'risky_crossing_rate', valueNumeric: numericValue },
                    'run_red_light': { factType: 'statistic', metricName: 'run_red_light_rate', valueNumeric: numericValue }
                }
            },
            'carried_items_stats.csv': {
                dimensionColumn: 'accessory',
                metrics: {
                    'risky_crossing_rate(%)': { factType: 'statistic', metricName: 'risky_crossing_rate', valuePercentage: numericValue },
                    'run_red_light_rate(%)': { factType: 'statistic', metricName: 'run_red_light_rate', valuePercentage: numericValue }
                }
            },
            'clothing_stats.csv': {
                dimensionColumn: 'clothing_type',
                metrics: {
                    'risky_crossing_rate(%)': { factType: 'statistic', metricName: 'risky_crossing_rate', valuePercentage: numericValue },
                    'run_red_light_rate(%)': { factType: 'statistic', metricName: 'run_red_light_rate', valuePercentage: numericValue }
                }
            },
            'continent_stats.csv': {
                dimensionColumn: 'continent',
                metrics: {
                    'run_red_light_rate(%)': { factType: 'statistic', metricName: 'run_red_light_rate', valuePercentage: numericValue },
                    'risky_crossing_rate(%)': { factType: 'statistic', metricName: 'risky_crossing_rate', valuePercentage: numericValue }
                }
            },
            'crossing_stats.csv': {
                dimensionColumn: 'continent',
                metrics: {
                    'avg_decision_time': { factType: 'average', metricName: 'decision_time', valueNumeric: numericValue },
                    'avg_crossing_speed': { factType: 'average', metricName: 'crossing_speed', valueNumeric: numericValue }
                }
            },
            'crosswalk_coeff.csv': {
                dimensionColumn: 'continent',
                metrics: {
                    'crosswalk_usage_ratio': { factType: 'ratio', metricName: 'crosswalk_usage', valueNumeric: numericValue },
                    'crosswalk_prob': { factType: 'probability', metricName: 'crosswalk_presence', valueNumeric: numericValue },
                    'crosswalk_coeff': { factType: 'coefficient', metricName: 'crosswalk_coefficient', valueNumeric: numericValue }
                }
            },
            'gender_stats.csv': {
                dimensionColumn: 'gender',
                metrics: {
                    'risky_crossing': { factType: 'statistic', metricName: 'risky_crossing_rate', valueNumeric: numericValue },
                    'run_red_light': { factType: 'statistic', metricName: 'run_red_light_rate', valueNumeric: numericValue }
                }
            },
            'phone_stats.csv': {
                dimensionColumn: 'accessory',
                metrics: {
                    'risky_crossing_rate(%)': { factType: 'statistic', metricName: 'risky_crossing_rate', valuePercentage: numericValue },
                    'run_red_light_rate(%)': { factType: 'statistic', metricName: 'run_red_light_rate', valuePercentage: numericValue }
                }
            },
            'road_corr.csv': {
                dimensionColumn: 'index',
                metrics: {
                    'risky_crossing': { factType: 'correlation', metricName: 'risky_crossing_correlation', correlationCoefficient: numericValue },
                    'run_red_light': { factType: 'correlation', metricName: 'run_red_light_correlation', correlationCoefficient: numericValue }
                }
            },
            'time_stats.csv': {
                dimensionColumn: 'index',
                metrics: {
                    'duration_minutes': { factType: 'average', metricName: 'duration_minutes', valueNumeric: numericValue },
                    'analysis_minutes': { factType: 'average', metricName: 'analysis_minutes', valueNumeric: numericValue }
                }
            },
            'vehicle_stats.csv': {
                dimensionColumn: 'vehicle_type',
                metrics: {
                    'risky_crossing_rate(%)': { factType: 'statistic', metricName: 'risky_crossing_rate', valuePercentage: numericValue },
                    'run_red_light_rate(%)': { factType: 'statistic', metricName: 'run_red_light_rate', valuePercentage: numericValue }
                }
            },
            'weather_daytime_stats.csv': {
                dimensionColumn: 'weather_daytime',
                metrics: {
                    'run_red_light_prob': { factType: 'probability', metricName: 'run_red_light_rate', valuePercentage: numericValue },
                    'risky_crossing_prob': { factType: 'probability', metricName: 'risky_crossing_rate', valuePercentage: numericValue }
                }
            }
        };

        const fileConfig = configs[filename];
        if (!fileConfig) return null;

        const metricConfig = fileConfig.metrics[columnName];
        if (!metricConfig) return null;

        return {
            dimensionType: this.getDimensionType(filename),
            dimensionValue: this.getDimensionValue(row, fileConfig.dimensionColumn),
            ...metricConfig
        };
    }

    getDimensionType(filename) {
        const typeMap = {
            'accident_road_condition_stats.csv': 'environment_factor',
            'age_stats.csv': 'age',
            'gender_stats.csv': 'gender',
            'clothing_stats.csv': 'clothing_type',
            'weather_daytime_stats.csv': 'weather_daytime',
            'road_corr.csv': 'road_metric',
            'continent_stats.csv': 'continent',
            'vehicle_stats.csv': 'vehicle_type',
            'phone_stats.csv': 'phone_usage',
            'carried_items_stats.csv': 'carried_item',
            'crossing_stats.csv': 'crossing_behavior',
            'crosswalk_coeff.csv': 'crosswalk_metric',
            'time_stats.csv': 'time_metric'
        };
        return typeMap[filename] || 'unknown';
    }

    getDimensionValue(row, dimensionColumn) {
        if (dimensionColumn.includes('_')) {
            // Handle composite keys like weather_daytime
            const parts = dimensionColumn.split('_');
            return parts.map(part => row[part]).filter(Boolean).join('_');
        }
        return row[dimensionColumn];
    }

    async getOrCreateDimension(dimensionType, dimensionValue) {
        try {
            // Try to get existing dimension
            const existing = await pool.query(
                'SELECT id FROM analytics_dimensions WHERE dimension_type = $1 AND dimension_value = $2',
                [dimensionType, dimensionValue]
            );

            if (existing.rows.length > 0) {
                return existing.rows[0].id;
            }

            // Create new dimension
            const result = await pool.query(`
                INSERT INTO analytics_dimensions (dimension_type, dimension_value, description)
                VALUES ($1, $2, $3)
                ON CONFLICT (dimension_type, dimension_value)
                DO UPDATE SET description = EXCLUDED.description
                RETURNING id
            `, [dimensionType, dimensionValue, `Auto-generated dimension for ${dimensionType}: ${dimensionValue}`]);

            return result.rows[0].id;
        } catch (error) {
            console.error(`Error creating dimension ${dimensionType}:${dimensionValue}:`, error);
            return null;
        }
    }

    async generateSummary() {
        log('Generating summary statistics...');
        
        try {
            const summary = await pool.query(`
                SELECT 
                    (SELECT COUNT(*) FROM cities) as total_cities,
                    (SELECT COUNT(*) FROM videos) as total_videos,
                    (SELECT COUNT(*) FROM pedestrians) as total_pedestrians,
                    (SELECT COUNT(*) FROM analytics_dimensions) as total_dimensions,
                    (SELECT COUNT(*) FROM analytics_facts) as total_facts
            `);
            
            console.log('\n=== AGGREGATION SUMMARY ===');
            console.log(`Cities: ${summary.rows[0].total_cities}`);
            console.log(`Videos: ${summary.rows[0].total_videos}`);
            console.log(`Pedestrians: ${summary.rows[0].total_pedestrians}`);
            console.log(`Analytics Dimensions: ${summary.rows[0].total_dimensions}`);
            console.log(`Analytics Facts: ${summary.rows[0].total_facts}`);
            console.log('===========================\n');
        } catch (error) {
            console.error('Error generating summary:', error);
        }
    }

    async close() {
        await pool.end();
    }
}

// Main execution
async function main() {
    console.log('Starting CSV data aggregation...');
    
    const aggregator = new DatabaseAggregator();
    
    try {
        await aggregator.initialize();
        
        // Aggregate data
        await aggregator.aggregateCoreData();
        await aggregator.aggregateAnalytics();
        
        // Update missing city data using GeoNames API
        console.log('\n🌍 Updating missing city data with GeoNames API...');
        const geoNamesAPI = new GeoNamesAPI();
        try {
            await geoNamesAPI.processCities();
        } catch (error) {
            console.error('GeoNames API update failed:', error.message);
            console.log('Continuing with aggregation...');
        } finally {
            await geoNamesAPI.close();
        }
        
        // Generate summary
        await aggregator.generateSummary();
        
        console.log('Data aggregation completed successfully!');
        
    } catch (error) {
        console.error('Aggregation failed:', error);
        process.exit(1);
    } finally {
        await aggregator.close();
    }
}

// Run if called directly
if (require.main === module) {
    main().catch(console.error);
}

module.exports = DatabaseAggregator;
