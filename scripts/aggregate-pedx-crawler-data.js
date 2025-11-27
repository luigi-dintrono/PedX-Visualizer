#!/usr/bin/env node

/**
 * PEDX Crawler Data Aggregation Script
 * 
 * This script aggregates CSV data from the pedx_crawler_data folder into the summary_data folder.
 * 
 * Features:
 * - Copies all_video_info.csv, all_time_info.csv, all_pedestrian_info.csv directly with duplicate checking
 * - Aggregates city folder CSVs into corresponding summary_data files based on column matching
 * - Appends rows without modifying existing data or calculating statistics
 * 
 * Usage: node scripts/aggregate-pedx-crawler-data.js [--source-dir PATH] [--verbose]
 */

const fs = require('fs');
const path = require('path');
const csv = require('csv-parser');

// Configuration
const DEFAULT_SOURCE_DIR = '/Users/luigi/Downloads/data_code/pedx_crawler_data';
const TARGET_DIR = path.join(__dirname, '..', 'summary_data');
const VERBOSE = process.argv.includes('--verbose');

// Get source directory from args or use default
const sourceDirArg = process.argv.indexOf('--source-dir');
const SOURCE_DIR = sourceDirArg !== -1 && process.argv[sourceDirArg + 1] 
    ? process.argv[sourceDirArg + 1]
    : DEFAULT_SOURCE_DIR;

// CSV files to copy directly (ignore in city folders)
const DIRECT_COPY_FILES = ['all_video_info.csv', 'all_time_info.csv', 'all_pedestrian_info.csv'];
const IGNORE_IN_CITY_FOLDERS = ['[A1]video_info.csv', '[A2]pedestrian_info.csv'];

// Helper function for logging
function log(message, data = null) {
    if (VERBOSE) {
        console.log(`[${new Date().toISOString()}] ${message}`);
        if (data) {
            console.log(JSON.stringify(data, null, 2));
        }
    }
}

// Helper function to read CSV file with encoding detection
function readCSV(filePath) {
    return new Promise((resolve, reject) => {
        const results = [];
        if (!fs.existsSync(filePath)) {
            log(`File not found: ${filePath}`);
            resolve(results);
            return;
        }
        
        // Try UTF-8 first, then fallback to Latin-1
        function tryRead(encoding) {
            const stream = fs.createReadStream(filePath, { encoding: encoding });
            const csvStream = stream.pipe(csv());
            
            csvStream
                .on('data', (data) => {
                    // Normalize string values to ensure proper UTF-8 encoding
                    const normalizedData = {};
                    for (const [key, value] of Object.entries(data)) {
                        if (typeof value === 'string') {
                            normalizedData[key] = value.normalize('NFC');
                        } else {
                            normalizedData[key] = value;
                        }
                    }
                    results.push(normalizedData);
                })
                .on('end', () => {
                    if (VERBOSE && encoding !== 'utf8') {
                        log(`Read ${filePath} with encoding: ${encoding}`);
                    }
                    resolve(results);
                })
                .on('error', (error) => {
                    if (encoding === 'utf8') {
                        // Try Latin-1 as fallback
                        results.length = 0;
                        tryRead('latin1');
                    } else {
                        reject(error);
                    }
                });
                
            stream.on('error', (error) => {
                if (encoding === 'utf8') {
                    // Try Latin-1 as fallback
                    results.length = 0;
                    tryRead('latin1');
                } else {
                    reject(error);
                }
            });
        }
        
        tryRead('utf8');
    });
}

// Helper function to get CSV headers
function getCSVHeaders(filePath) {
    return new Promise((resolve, reject) => {
        if (!fs.existsSync(filePath)) {
            resolve([]);
            return;
        }
        
        try {
            // Read just the first line
            const fileContent = fs.readFileSync(filePath, 'utf8');
            const firstLine = fileContent.split('\n')[0];
            if (firstLine) {
                // Parse CSV header (handle quoted fields)
                const headers = [];
                let current = '';
                let inQuotes = false;
                
                for (let i = 0; i < firstLine.length; i++) {
                    const char = firstLine[i];
                    if (char === '"') {
                        inQuotes = !inQuotes;
                    } else if (char === ',' && !inQuotes) {
                        headers.push(current.trim());
                        current = '';
                    } else {
                        current += char;
                    }
                }
                headers.push(current.trim()); // Add last field
                
                resolve(headers.filter(h => h.length > 0));
            } else {
                resolve([]);
            }
        } catch (error) {
            reject(error);
        }
    });
}

// Helper function to escape CSV field
function escapeCSVField(field) {
    if (field === null || field === undefined) {
        return '';
    }
    const str = String(field);
    // If field contains comma, newline, or quote, wrap in quotes and escape quotes
    if (str.includes(',') || str.includes('\n') || str.includes('"')) {
        return `"${str.replace(/"/g, '""')}"`;
    }
    return str;
}

// Helper function to write CSV file
function writeCSV(filePath, data, headers) {
    return new Promise((resolve, reject) => {
        if (data.length === 0) {
            log(`No data to write to ${filePath}`);
            resolve();
            return;
        }
        
        try {
            // Ensure headers match data keys
            const actualHeaders = headers || Object.keys(data[0]);
            
            // Build CSV content
            let csvContent = actualHeaders.map(escapeCSVField).join(',') + '\n';
            
            for (const row of data) {
                const values = actualHeaders.map(header => escapeCSVField(row[header]));
                csvContent += values.join(',') + '\n';
            }
            
            // Write to file
            fs.writeFileSync(filePath, csvContent, 'utf8');
            log(`Written ${data.length} rows to ${filePath}`);
            resolve();
        } catch (error) {
            reject(error);
        }
    });
}

// Helper function to append CSV rows
function appendCSV(filePath, newRows, headers) {
    return new Promise((resolve, reject) => {
        if (newRows.length === 0) {
            resolve();
            return;
        }
        
        // Read existing data
        readCSV(filePath).then(existingData => {
            // Combine existing and new data
            const allData = [...existingData, ...newRows];
            
            // Use headers from new data if file doesn't exist, otherwise use existing headers
            const actualHeaders = headers || (existingData.length > 0 ? Object.keys(existingData[0]) : Object.keys(newRows[0]));
            
            writeCSV(filePath, allData, actualHeaders)
                .then(resolve)
                .catch(reject);
        }).catch(reject);
    });
}

// Check for duplicates based on unique keys
function checkDuplicates(existingData, newData, uniqueKeys) {
    if (!uniqueKeys || uniqueKeys.length === 0) {
        return newData; // No duplicate checking if no unique keys specified
    }
    
    // Create a set of existing unique combinations
    const existingKeys = new Set();
    for (const row of existingData) {
        const key = uniqueKeys.map(k => String(row[k] || '')).join('|');
        existingKeys.add(key);
    }
    
    // Filter out duplicates
    const filtered = newData.filter(row => {
        const key = uniqueKeys.map(k => String(row[k] || '')).join('|');
        return !existingKeys.has(key);
    });
    
    return filtered;
}

// Copy direct files with duplicate checking
async function copyDirectFiles() {
    log('Copying direct files...');
    
    const fileConfigs = {
        'all_video_info.csv': {
            uniqueKeys: ['video_name'], // Use video_name as unique identifier
            mapColumns: null // Use all columns from source
        },
        'all_time_info.csv': {
            uniqueKeys: ['duration_seconds'], // Use duration_seconds as unique identifier
            mapColumns: ['duration_seconds', 'analysis_seconds'] // Only map these columns to match target structure
        },
        'all_pedestrian_info.csv': {
            uniqueKeys: ['city', 'link', 'track_id'], // Composite key
            mapColumns: null // Use all columns from source
        }
    };
    
    for (const [filename, config] of Object.entries(fileConfigs)) {
        const sourcePath = path.join(SOURCE_DIR, filename);
        const targetPath = path.join(TARGET_DIR, filename);
        
        if (!fs.existsSync(sourcePath)) {
            console.log(`⚠️  Source file not found: ${filename}`);
            continue;
        }
        
        log(`Processing ${filename}...`);
        
        try {
            // Read source and existing target data
            const [sourceData, existingData] = await Promise.all([
                readCSV(sourcePath),
                readCSV(targetPath)
            ]);
            
            // Map columns if needed
            let processedSourceData = sourceData;
            let targetHeaders = sourceData.length > 0 ? Object.keys(sourceData[0]) : [];
            
            if (config.mapColumns && sourceData.length > 0) {
                // Get existing target headers if file exists
                const existingHeaders = existingData.length > 0 ? Object.keys(existingData[0]) : config.mapColumns;
                targetHeaders = existingHeaders;
                
                // Map source data to target columns
                processedSourceData = sourceData.map(row => {
                    const mappedRow = {};
                    for (const header of targetHeaders) {
                        mappedRow[header] = row[header] || '';
                    }
                    return mappedRow;
                });
            } else if (existingData.length > 0) {
                // Use target headers if they exist
                targetHeaders = Object.keys(existingData[0]);
            }
            
            // Check for duplicates
            const newData = checkDuplicates(existingData, processedSourceData, config.uniqueKeys);
            
            if (newData.length === 0) {
                console.log(`✓ ${filename}: No new data to add`);
                continue;
            }
            
            // Append new data
            await appendCSV(targetPath, newData, targetHeaders);
            console.log(`✓ ${filename}: Added ${newData.length} new rows (${sourceData.length - newData.length} duplicates skipped)`);
            
        } catch (error) {
            console.error(`✗ Error processing ${filename}:`, error.message);
            if (VERBOSE) {
                console.error(error.stack);
            }
        }
    }
}

// Manual mapping configuration: city folder CSV files → summary_data CSV files
// This mapping is based on semantic similarity and column structure analysis
// Files are mapped to the most similar summary_data file, even if column structures differ
const CSV_MAPPINGS = {
    // Age and Gender mapping - map to both age_stats and gender_stats based on available columns
    '[P6]age_gender.csv': {
        target: 'gender_stats.csv', // Map to gender_stats since it has gender column
        skip: false,
        // Source has: id,age,gender
        // Target has: gender,risky_crossing,run_red_light
        // We can extract unique gender values, but risky_crossing/run_red_light will be empty
        columnMapping: {
            'gender': 'gender'
        }
    },
    
    // Phone usage mapping
    '[P5]phone_usage.csv': {
        target: 'phone_stats.csv',
        skip: false,
        // Source: frame_id,track_id,phone_using (boolean)
        // Target: accessory,risky_crossing_rate(%),run_red_light_rate(%)
        // We extract rows where phone_using is True and map to accessory='phone_using'
        columnMapping: {
            'accessory': 'phone_using' // Will extract True values and use 'phone_using' as the value
        },
        // Special handling: for boolean columns, use the column name as the dimension value
        booleanValue: 'phone_using'
    },
    
    // Clothing mapping - transform multiple boolean columns to clothing_type
    '[P8]clothing.csv': {
        target: 'clothing_stats.csv',
        skip: false,
        // Source has many clothing type columns (short_sleeved_shirt, long_sleeved_shirt, etc.)
        // Target: clothing_type,risky_crossing_rate(%),run_red_light_rate(%)
        // Transform: Extract unique clothing types from boolean columns
        transformType: 'booleanColumns',
        booleanColumns: [
            'short_sleeved_shirt', 'long_sleeved_shirt', 'short_sleeved_outwear', 'long_sleeved_outwear',
            'vest', 'sling', 'shorts', 'trousers', 'skirt',
            'short_sleeved_dress', 'long_sleeved_dress', 'vest_dress', 'sling_dress'
        ],
        dimensionColumn: 'clothing_type'
    },
    
    // Pedestrian belongings mapping - transform multiple boolean columns to accessory
    '[P9]pedestrian_belongings.csv': {
        target: 'carried_items_stats.csv',
        skip: false,
        // Source: frame_id,track_id,backpack,umbrella,handbag,suitcase (booleans)
        // Target: accessory,risky_crossing_rate(%),run_red_light_rate(%)
        transformType: 'booleanColumns',
        booleanColumns: ['backpack', 'umbrella', 'handbag', 'suitcase'],
        dimensionColumn: 'accessory'
    },
    
    // Weather and Daytime - map to weather_daytime_stats via [C9]crossing_env_info
    '[E1]weather.csv': {
        target: 'weather_daytime_stats.csv',
        skip: false,
        // Source: frame_id,weather_label
        // Target: weather,daytime,run_red_light_prob,risky_crossing_prob
        // Extract unique weather values, but daytime will be empty
        columnMapping: {
            'weather': 'weather_label'
        }
    },
    
    '[E6]daytime.csv': {
        target: 'weather_daytime_stats.csv',
        skip: false,
        // Source: frame_id,avg_brightness,daytime_label
        // Target: weather,daytime,run_red_light_prob,risky_crossing_prob
        // Extract unique daytime values, but weather will be empty
        columnMapping: {
            'daytime': 'daytime_label'
        }
    },
    
    // Crossing environment info - this has weather and daytime together
    '[C9]crossing_env_info.csv': {
        target: 'weather_daytime_stats.csv',
        skip: false,
        // Source: track_id,crossed,weather,daytime,police_car,arrow_board,cones,accident,crack,potholes,avg_vehicle_total,crossing_sign,avg_road_width,crosswalk,sidewalk
        // Target: weather,daytime,run_red_light_prob,risky_crossing_prob
        columnMapping: {
            'weather': 'weather',
            'daytime': 'daytime'
            // run_red_light_prob and risky_crossing_prob will be empty (require calculation)
        }
    },
    
    // Vehicle type mapping - extract unique vehicle types from frame-level data
    '[V1]vehicle_type.csv': {
        target: 'vehicle_stats.csv',
        skip: false,
        // Source: frame_id,ambulance,army vehicle,auto rickshaw,bicycle,bus,car,... (many vehicle columns)
        // Target: vehicle_type,risky_crossing_rate(%),run_red_light_rate(%)
        // Transform: Extract unique vehicle types from boolean columns
        transformType: 'booleanColumns',
        // Vehicle columns (excluding frame_id and total)
        booleanColumns: [
            'ambulance', 'army vehicle', 'auto rickshaw', 'bicycle', 'bus', 'car', 'garbagevan',
            'human hauler', 'minibus', 'minivan', 'motorbike', 'pickup', 'policecar', 'rickshaw',
            'scooter', 'suv', 'taxi', 'three wheelers -CNG-', 'truck', 'van', 'wheelbarrow'
        ],
        dimensionColumn: 'vehicle_type'
    },
    
    '[V6]vehicle_count.csv': {
        target: 'vehicle_stats.csv',
        skip: false,
        // Source: Vehicle_Type,Count
        // Target: vehicle_type,risky_crossing_rate(%),run_red_light_rate(%)
        columnMapping: {
            'vehicle_type': 'Vehicle_Type'
            // risky_crossing_rate and run_red_light_rate will be empty
        }
    },
    
    // Road condition mapping - extract unique road condition types
    '[E4]road_condition.csv': {
        target: 'accident_road_condition_stats.csv',
        skip: false,
        // Source: frame_id,Longitudinal Crack,Transverse Crack,Alligator Crack,Potholes
        // Target: environment_factor,risky_crossing_rate(%),run_red_light_rate(%)
        transformType: 'booleanColumns',
        booleanColumns: ['Longitudinal Crack', 'Transverse Crack', 'Alligator Crack', 'Potholes'],
        dimensionColumn: 'environment_factor'
    },
    
    '[E8]accident_detection.csv': {
        target: 'accident_road_condition_stats.csv',
        skip: false,
        // Source: frame_id,police_car,Arrow Board,cones,accident
        // Target: environment_factor,risky_crossing_rate(%),run_red_light_rate(%)
        transformType: 'booleanColumns',
        booleanColumns: ['police_car', 'Arrow Board', 'cones', 'accident'],
        dimensionColumn: 'environment_factor'
    },
    
    // Other files that don't have direct mappings
    '[B1]tracked_pedestrians.csv': {
        target: null,
        skip: true,
        reason: 'No direct mapping to summary_data files'
    },
    
    '[C1]risky_crossing.csv': {
        target: null,
        skip: true,
        reason: 'Raw crossing data, no direct mapping'
    },
    
    '[C3]crossing_judge.csv': {
        target: null,
        skip: true,
        reason: 'No direct mapping to summary_data files'
    },
    
    '[C4]crosswalk_usage.csv': {
        target: null,
        skip: true,
        reason: 'Raw crosswalk data, no direct mapping'
    },
    
    '[C5]red_light_runner.csv': {
        target: null,
        skip: true,
        reason: 'Raw red light data, no direct mapping'
    },
    
    '[C6]crossing_ve_count.csv': {
        target: null,
        skip: true,
        reason: 'No direct mapping to summary_data files'
    },
    
    '[C7]crossing_pe_info.csv': {
        target: null,
        skip: true,
        reason: 'No direct mapping to summary_data files'
    },
    
    '[C10]nearby_count.csv': {
        target: null,
        skip: true,
        reason: 'No direct mapping to summary_data files'
    },
    
    '[E2]traffic_light.csv': {
        target: null,
        skip: true,
        reason: 'No direct mapping to summary_data files'
    },
    
    '[E3]traffic_sign.csv': {
        target: null,
        skip: true,
        reason: 'No direct mapping to summary_data files'
    },
    
    '[E5]road_width.csv': {
        target: null,
        skip: true,
        reason: 'Road width data may be used in road_corr.csv but requires correlation calculation'
    },
    
    '[E7]crosswalk_detection.csv': {
        target: null,
        skip: true,
        reason: 'No direct mapping to summary_data files'
    },
    
    '[E9]sidewalk_detection.csv': {
        target: null,
        skip: true,
        reason: 'No direct mapping to summary_data files'
    }
};

// Get all city folders
function getCityFolders() {
    const folders = [];
    if (!fs.existsSync(SOURCE_DIR)) {
        console.error(`Source directory not found: ${SOURCE_DIR}`);
        return folders;
    }
    
    const entries = fs.readdirSync(SOURCE_DIR, { withFileTypes: true });
    for (const entry of entries) {
        if (entry.isDirectory()) {
            folders.push(path.join(SOURCE_DIR, entry.name));
        }
    }
    
    return folders;
}

// Get CSV files in a city folder
function getCityFolderCSVs(cityFolderPath) {
    const csvFiles = [];
    if (!fs.existsSync(cityFolderPath)) {
        return csvFiles;
    }
    
    const entries = fs.readdirSync(cityFolderPath, { withFileTypes: true });
    for (const entry of entries) {
        if (entry.isFile() && entry.name.endsWith('.csv')) {
            // Skip ignored files
            if (!IGNORE_IN_CITY_FOLDERS.includes(entry.name)) {
                csvFiles.push(path.join(cityFolderPath, entry.name));
            }
        }
    }
    
    return csvFiles;
}

// Get all summary_data CSV files and their headers
async function getSummaryDataFiles() {
    const summaryFiles = {};
    if (!fs.existsSync(TARGET_DIR)) {
        return summaryFiles;
    }
    
    const entries = fs.readdirSync(TARGET_DIR);
    for (const entry of entries) {
        if (entry.endsWith('.csv')) {
            const filePath = path.join(TARGET_DIR, entry);
            const headers = await getCSVHeaders(filePath);
            summaryFiles[entry] = {
                path: filePath,
                headers: headers,
                headerSet: new Set(headers.map(h => h.toLowerCase()))
            };
        }
    }
    
    return summaryFiles;
}

// Compare two header sets to see if they match
function headersMatch(sourceHeaders, targetHeaders, threshold = 0.8) {
    const sourceSet = new Set(sourceHeaders.map(h => h.toLowerCase()));
    const targetSet = new Set(targetHeaders.map(h => h.toLowerCase()));
    
    // Check if all source headers exist in target (exact match)
    let matches = 0;
    for (const header of sourceSet) {
        if (targetSet.has(header)) {
            matches++;
        }
    }
    
    // If all source headers match target headers, it's a good match
    if (matches === sourceSet.size && sourceSet.size === targetSet.size) {
        return true;
    }
    
    // If most headers match, consider it a match
    const matchRatio = matches / Math.max(sourceSet.size, targetSet.size);
    return matchRatio >= threshold;
}

// Map CSV file to target summary_data file based on manual mapping and column matching
async function mapCsvToTarget(csvFilePath, summaryFiles) {
    const filename = path.basename(csvFilePath);
    
    // First, check manual mapping
    const manualMapping = CSV_MAPPINGS[filename];
    if (manualMapping) {
        if (manualMapping.skip) {
            log(`Skipping ${filename}: ${manualMapping.reason || 'Marked to skip'}`);
            return null;
        }
        
        if (manualMapping.target) {
            const targetFile = manualMapping.target;
            const targetInfo = summaryFiles[targetFile];
            if (targetInfo) {
                log(`Matched ${filename} to ${targetFile} via manual mapping`);
                return {
                    file: targetFile,
                    path: targetInfo.path,
                    headers: targetInfo.headers,
                    columnMapping: manualMapping.columnMapping || null
                };
            } else {
                log(`Warning: Manual mapping for ${filename} points to ${targetFile} but file not found in summary_data`);
            }
        }
    }
    
    // Get headers from the CSV file
    const sourceHeaders = await getCSVHeaders(csvFilePath);
    if (sourceHeaders.length === 0) {
        return null;
    }
    
    const sourceHeaderSet = new Set(sourceHeaders.map(h => h.toLowerCase()));
    
    // Try to find a matching target file based on column structure
    for (const [targetFile, targetInfo] of Object.entries(summaryFiles)) {
        // Check if headers match
        if (headersMatch(sourceHeaders, targetInfo.headers)) {
            log(`Matched ${filename} to ${targetFile} based on column structure`);
            return { file: targetFile, path: targetInfo.path, headers: targetInfo.headers };
        }
    }
    
    // If no exact match, try semantic matching based on filename patterns
    // Note: Most city folder CSVs are raw data while summary_data CSVs are aggregated stats
    // So direct matches will be rare, but we check anyway
    
    // Check for files that might have similar structures
    if (filename.includes('crossing_env_info') || filename.includes('[C9]')) {
        // This file has weather, daytime, etc. - might match weather_daytime_stats
        if (sourceHeaderSet.has('weather') && sourceHeaderSet.has('daytime')) {
            const target = summaryFiles['weather_daytime_stats.csv'];
            if (target) {
                log(`Matched ${filename} to weather_daytime_stats.csv based on semantic matching`);
                return { file: 'weather_daytime_stats.csv', path: target.path, headers: target.headers };
            }
        }
    }
    
    // Most other files won't match because they're raw data vs aggregated stats
    log(`No mapping found for ${filename}`);
    return null; // No match found
}

// Aggregate CSV data from city folders
async function aggregateCityFolderCSVs() {
    log('Aggregating city folder CSVs...');
    
    // Get all summary_data files and their structures
    const summaryFiles = await getSummaryDataFiles();
    console.log(`Found ${Object.keys(summaryFiles).length} summary_data files to match against`);
    
    const cityFolders = getCityFolders();
    console.log(`Found ${cityFolders.length} city folders`);
    
    // Track statistics
    let totalProcessed = 0;
    let totalAdded = 0;
    let totalSkipped = 0;
    
    for (const cityFolder of cityFolders) {
        const cityName = path.basename(cityFolder);
        log(`Processing city folder: ${cityName}`);
        
        const csvFiles = getCityFolderCSVs(cityFolder);
        log(`Found ${csvFiles.length} CSV files in ${cityName}`);
        
        for (const csvFile of csvFiles) {
            const filename = path.basename(csvFile);
            totalProcessed++;
            
            try {
                // Map to target file
                const targetInfo = await mapCsvToTarget(csvFile, summaryFiles);
                
                if (!targetInfo) {
                    // No mapping found - this is expected for most files as they're raw data
                    // that doesn't match the aggregated statistics format
                    totalSkipped++;
                    log(`Skipped ${filename} - no matching target file`);
                    continue;
                }
                
                // Read CSV data
                const csvData = await readCSV(csvFile);
                if (csvData.length === 0) {
                    log(`Empty CSV: ${filename}`);
                    continue;
                }
                
                // Read existing target data
                const existingData = await readCSV(targetInfo.path);
                
                // Use target headers to ensure column alignment
                const targetHeaders = targetInfo.headers;
                const sourceHeaders = Object.keys(csvData[0]);
                
                // Get column mapping if specified in manual mapping
                const manualMapping = CSV_MAPPINGS[filename];
                const columnMapping = targetInfo.columnMapping || (manualMapping && manualMapping.columnMapping) || null;
                const transformType = manualMapping && manualMapping.transformType;
                
                // Determine the dimension column (first column in target, typically the category/dimension value)
                const dimensionColumn = targetHeaders.length > 0 ? targetHeaders[0] : null;
                
                // Map source data to target headers
                let mappedData = [];
                
                // Handle booleanColumns transformation (multiple boolean columns -> single dimension column)
                if (transformType === 'booleanColumns' && manualMapping.booleanColumns && dimensionColumn) {
                    const booleanColumns = manualMapping.booleanColumns;
                    const uniqueValues = new Set();
                    
                    // Create a case-insensitive mapping of source headers
                    const sourceHeaderMap = {};
                    for (const header of sourceHeaders) {
                        sourceHeaderMap[header.toLowerCase()] = header;
                    }
                    
                    // Collect unique values from boolean columns
                    for (const row of csvData) {
                        for (const colName of booleanColumns) {
                            // Try exact match first, then case-insensitive
                            let actualColName = colName;
                            if (!(colName in row)) {
                                const lowerColName = colName.toLowerCase();
                                actualColName = sourceHeaderMap[lowerColName] || colName;
                            }
                            
                            // Check if this column exists and is true
                            const value = row[actualColName];
                            if (value === true || value === 'True' || value === 'true' || value === 1 || value === '1') {
                                uniqueValues.add(colName); // Use original column name as the dimension value
                            }
                        }
                    }
                    
                    // Create one row per unique dimension value
                    for (const dimValue of uniqueValues) {
                        const mappedRow = {};
                        for (const header of targetHeaders) {
                            if (header === dimensionColumn) {
                                mappedRow[header] = dimValue;
                            } else {
                                mappedRow[header] = ''; // Stats columns will be empty
                            }
                        }
                        mappedData.push(mappedRow);
                    }
                } else if (dimensionColumn && columnMapping && columnMapping[dimensionColumn]) {
                    // For stats files, we need to extract unique dimension values
                    // e.g., for gender_stats, extract unique gender values
                    const sourceDimensionKey = columnMapping[dimensionColumn];
                    const uniqueValues = new Set();
                    const booleanValue = manualMapping && manualMapping.booleanValue;
                    
                    // Collect unique dimension values from source
                    for (const row of csvData) {
                        let value = row[sourceDimensionKey];
                        
                        // Handle boolean values - convert to string
                        if (value === true || value === 'True' || value === 'true' || value === 1 || value === '1') {
                            // Use the booleanValue if specified, otherwise use the column name
                            value = booleanValue || sourceDimensionKey;
                        } else if (value === false || value === 'False' || value === 'false' || value === 0 || value === '0') {
                            continue; // Skip false values for boolean columns
                        }
                        
                        if (value && value.toString().trim() !== '') {
                            uniqueValues.add(value.toString().trim());
                        }
                    }
                    
                    // Create one row per unique dimension value
                    for (const dimValue of uniqueValues) {
                        const mappedRow = {};
                        for (const header of targetHeaders) {
                            if (header === dimensionColumn) {
                                mappedRow[header] = dimValue;
                            } else if (columnMapping && columnMapping[header]) {
                                // For other mapped columns, try to get a representative value
                                // But for stats files, we typically leave metric columns empty
                                const sourceKey = columnMapping[header];
                                // Extract unique values for this column (if it's also a dimension)
                                const otherValues = new Set();
                                for (const row of csvData) {
                                    const dimVal = row[sourceDimensionKey];
                                    let matches = false;
                                    if (booleanValue && (dimVal === true || dimVal === 'True' || dimVal === 'true' || dimVal === 1 || dimVal === '1')) {
                                        matches = (booleanValue || sourceDimensionKey) === dimValue;
                                    } else {
                                        matches = dimVal && dimVal.toString().trim() === dimValue;
                                    }
                                    if (matches) {
                                        const otherVal = row[sourceKey];
                                        if (otherVal && otherVal.toString().trim() !== '') {
                                            otherValues.add(otherVal.toString().trim());
                                        }
                                    }
                                }
                                // If only one unique value, use it; otherwise leave empty
                                mappedRow[header] = otherValues.size === 1 ? Array.from(otherValues)[0] : '';
                            } else {
                                mappedRow[header] = ''; // Stats columns will be empty
                            }
                        }
                        mappedData.push(mappedRow);
                    }
                } else {
                    // Direct row-by-row mapping
                    mappedData = csvData.map(row => {
                        const mappedRow = {};
                        for (const header of targetHeaders) {
                            let value = '';
                            
                            // First, check if there's a manual column mapping
                            if (columnMapping && columnMapping[header]) {
                                const sourceKey = columnMapping[header];
                                value = row[sourceKey] || '';
                            } else {
                                // Try to find matching column (case-insensitive)
                                const sourceKey = sourceHeaders.find(h => h.toLowerCase() === header.toLowerCase());
                                value = sourceKey ? row[sourceKey] : '';
                            }
                            
                            mappedRow[header] = value;
                        }
                        return mappedRow;
                    });
                }
                
                // Check for duplicates
                // Use a subset of headers that are likely to be unique identifiers
                // For stats files, typically the first column(s) are the dimension values
                const uniqueKeys = targetHeaders.length > 0 ? [targetHeaders[0]] : targetHeaders;
                const newData = checkDuplicates(existingData, mappedData, uniqueKeys);
                
                if (newData.length === 0) {
                    log(`No new data from ${filename}`);
                    continue;
                }
                
                // Append to target
                await appendCSV(targetInfo.path, newData, targetHeaders);
                totalAdded += newData.length;
                console.log(`✓ ${cityName}/${filename} → ${targetInfo.file}: Added ${newData.length} rows`);
                
            } catch (error) {
                console.error(`✗ Error processing ${cityName}/${filename}:`, error.message);
                if (VERBOSE) {
                    console.error(error.stack);
                }
            }
        }
    }
    
    console.log(`\nCity folder aggregation summary:`);
    console.log(`  Processed: ${totalProcessed} files`);
    console.log(`  Added rows: ${totalAdded}`);
    console.log(`  Skipped: ${totalSkipped} files (no matching target)`);
}

// Main execution
async function main() {
    console.log('Starting PEDX Crawler Data Aggregation...');
    console.log(`Source directory: ${SOURCE_DIR}`);
    console.log(`Target directory: ${TARGET_DIR}`);
    console.log('');
    
    // Ensure target directory exists
    if (!fs.existsSync(TARGET_DIR)) {
        fs.mkdirSync(TARGET_DIR, { recursive: true });
        console.log(`Created target directory: ${TARGET_DIR}`);
    }
    
    try {
        // Step 1: Copy direct files
        console.log('Step 1: Copying direct files...');
        await copyDirectFiles();
        console.log('');
        
        // Step 2: Aggregate city folder CSVs
        console.log('Step 2: Aggregating city folder CSVs...');
        await aggregateCityFolderCSVs();
        console.log('');
        
        console.log('✓ Data aggregation completed successfully!');
        
    } catch (error) {
        console.error('✗ Aggregation failed:', error);
        process.exit(1);
    }
}

// Run if called directly
if (require.main === module) {
    main().catch(console.error);
}

module.exports = { main };

