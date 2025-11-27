#!/usr/bin/env node

/**
 * Fix Encoding Issues in Database
 * 
 * This script fixes encoding issues in the database by:
 * 1. Re-reading CSV files with proper encoding detection
 * 2. Updating city names in the database with correct UTF-8 encoding
 * 
 * Usage: node scripts/fix-encoding.js [--verbose]
 */

const fs = require('fs');
const path = require('path');
const csv = require('csv-parser');
const { Pool } = require('pg');
require('dotenv').config();

const VERBOSE = process.argv.includes('--verbose');
const CSV_DIR = path.join(__dirname, '..', 'summary_data');
const SOURCE_DIR = '/Users/luigi/Downloads/data_code/pedx_crawler_data';

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
    client_encoding: 'UTF8',
});

// Try multiple encodings when reading CSV
function readCSVWithEncoding(filePath, encodings = ['utf8', 'latin1']) {
    return new Promise((resolve, reject) => {
        const results = [];
        let triedEncodings = [];
        
        function tryEncoding(encodingIndex) {
            if (encodingIndex >= encodings.length) {
                // If all encodings failed, try reading as binary and converting
                fs.readFile(filePath, (err, data) => {
                    if (err) {
                        reject(new Error(`Failed to read CSV. Tried: ${triedEncodings.join(', ')}`));
                        return;
                    }
                    
                    // Try to decode as UTF-8 first
                    let content;
                    try {
                        content = data.toString('utf8');
                    } catch (e) {
                        // If UTF-8 fails, try Latin-1 (ISO-8859-1)
                        content = data.toString('latin1');
                    }
                    
                    // Parse CSV manually
                    const lines = content.split('\n');
                    if (lines.length === 0) {
                        reject(new Error('Empty CSV file'));
                        return;
                    }
                    
                    const headers = lines[0].split(',').map(h => h.trim().replace(/^"|"$/g, ''));
                    
                    for (let i = 1; i < lines.length; i++) {
                        if (!lines[i].trim()) continue;
                        const values = lines[i].split(',').map(v => v.trim().replace(/^"|"$/g, ''));
                        const row = {};
                        headers.forEach((header, idx) => {
                            row[header] = values[idx] || '';
                        });
                        results.push(row);
                    }
                    
                    resolve(results);
                });
                return;
            }
            
            const encoding = encodings[encodingIndex];
            triedEncodings.push(encoding);
            
            try {
                const stream = fs.createReadStream(filePath, { encoding: encoding });
                const csvStream = stream.pipe(csv({
                    skipEmptyLines: true,
                }));
                
                csvStream
                    .on('data', (data) => {
                        results.push(data);
                    })
                    .on('end', () => {
                        if (VERBOSE) {
                            console.log(`Successfully read ${filePath} with encoding: ${encoding}`);
                        }
                        resolve(results);
                    })
                    .on('error', (error) => {
                        if (VERBOSE) {
                            console.log(`Failed to read with ${encoding}, trying next...`);
                        }
                        // Clear results and try next encoding
                        results.length = 0;
                        tryEncoding(encodingIndex + 1);
                    });
                    
                stream.on('error', (error) => {
                    if (VERBOSE) {
                        console.log(`Stream error with ${encoding}, trying next...`);
                    }
                    results.length = 0;
                    tryEncoding(encodingIndex + 1);
                });
            } catch (error) {
                if (VERBOSE) {
                    console.log(`Error with ${encoding}, trying next...`);
                }
                results.length = 0;
                tryEncoding(encodingIndex + 1);
            }
        }
        
        tryEncoding(0);
    });
}

async function fixCityNames() {
    console.log('🔧 Fixing city name encoding in database...');
    
    try {
        // Set UTF-8 encoding for the connection
        await pool.query("SET client_encoding TO 'UTF8'");
        
        // Read the source CSV file with encoding detection
        const csvPath = path.join(SOURCE_DIR, 'all_video_info.csv');
        if (!fs.existsSync(csvPath)) {
            console.error(`Source file not found: ${csvPath}`);
            return;
        }
        
        console.log(`Reading ${csvPath}...`);
        const videoData = await readCSVWithEncoding(csvPath);
        console.log(`Read ${videoData.length} rows`);
        
        // Get all unique cities from the CSV
        const cityMap = new Map();
        for (const row of videoData) {
            if (row.city && row.country) {
                const cityKey = `${row.city}_${row.country}`;
                if (!cityMap.has(cityKey)) {
                    cityMap.set(cityKey, {
                        city: row.city.trim(),
                        country: row.country.trim()
                    });
                }
            }
        }
        
        console.log(`Found ${cityMap.size} unique cities in CSV`);
        
        // Get all cities from database
        const dbCitiesResult = await pool.query(`
            SELECT id, city, country 
            FROM cities 
            ORDER BY country, city
        `);
        
        console.log(`Found ${dbCitiesResult.rows.length} cities in database`);
        
        // Normalize function for matching
        const normalize = (str) => {
            if (!str) return '';
            return str.toLowerCase()
                .normalize('NFD')
                .replace(/[\u0300-\u036f]/g, '') // Remove diacritics
                .replace(/[^a-z0-9]/g, '')
                .trim();
        };
        
        // Create a map of normalized city names from CSV
        const csvNormalizedMap = new Map();
        for (const [cityKey, cityData] of cityMap) {
            const normalizedKey = `${normalize(cityData.city)}_${normalize(cityData.country)}`;
            csvNormalizedMap.set(normalizedKey, cityData);
        }
        
        // Update city names in database
        let updated = 0;
        let skipped = 0;
        let notFound = 0;
        
        for (const dbRow of dbCitiesResult.rows) {
            try {
                const dbCity = dbRow.city;
                const dbCountry = dbRow.country;
                const normalizedKey = `${normalize(dbCity)}_${normalize(dbCountry)}`;
                
                // Check if we have a match in CSV
                const csvCityData = csvNormalizedMap.get(normalizedKey);
                
                if (csvCityData) {
                    // If they're exactly the same, skip
                    if (dbCity === csvCityData.city && dbCountry === csvCityData.country) {
                        skipped++;
                        continue;
                    }
                    
                    // Update the city name with correct encoding
                    await pool.query(`
                        UPDATE cities 
                        SET city = $1, country = $2, updated_at = CURRENT_TIMESTAMP
                        WHERE id = $3
                    `, [csvCityData.city, csvCityData.country, dbRow.id]);
                    
                    console.log(`✓ Updated: "${dbCity}" → "${csvCityData.city}" (${csvCityData.country})`);
                    updated++;
                } else {
                    // Try fuzzy matching for cities with encoding issues
                    let bestMatch = null;
                    let bestScore = 0;
                    
                    for (const [csvKey, csvData] of csvNormalizedMap) {
                        if (normalize(csvData.country) === normalize(dbCountry)) {
                            // Calculate similarity score
                            const dbNorm = normalize(dbCity);
                            const csvNorm = normalize(csvData.city);
                            
                            // Check if one contains the other (for partial matches)
                            let score = 0;
                            if (dbNorm === csvNorm) {
                                score = 100;
                            } else if (dbNorm.includes(csvNorm) || csvNorm.includes(dbNorm)) {
                                score = Math.min(dbNorm.length, csvNorm.length) / Math.max(dbNorm.length, csvNorm.length) * 80;
                            } else {
                                // Calculate Levenshtein-like similarity
                                const longer = dbNorm.length > csvNorm.length ? dbNorm : csvNorm;
                                const shorter = dbNorm.length > csvNorm.length ? csvNorm : dbNorm;
                                if (longer.includes(shorter)) {
                                    score = (shorter.length / longer.length) * 60;
                                }
                            }
                            
                            if (score > bestScore && score > 50) {
                                bestScore = score;
                                bestMatch = csvData;
                            }
                        }
                    }
                    
                    if (bestMatch) {
                        await pool.query(`
                            UPDATE cities 
                            SET city = $1, country = $2, updated_at = CURRENT_TIMESTAMP
                            WHERE id = $3
                        `, [bestMatch.city, bestMatch.country, dbRow.id]);
                        
                        console.log(`✓ Fuzzy matched: "${dbCity}" → "${bestMatch.city}" (${bestMatch.country}) [score: ${bestScore.toFixed(1)}]`);
                        updated++;
                    } else {
                        if (VERBOSE) {
                            console.log(`⚠ No match found: "${dbCity}", "${dbCountry}"`);
                        }
                        notFound++;
                    }
                }
            } catch (error) {
                console.error(`Error processing ${dbRow.city}:`, error.message);
            }
        }
        
        console.log(`\n✅ Encoding fix complete:`);
        console.log(`   Updated: ${updated} cities`);
        console.log(`   Not found: ${notFound} cities`);
        
    } catch (error) {
        console.error('Error fixing encoding:', error);
        throw error;
    }
}

async function main() {
    try {
        await fixCityNames();
    } catch (error) {
        console.error('Script failed:', error);
        process.exit(1);
    } finally {
        await pool.end();
    }
}

if (require.main === module) {
    main();
}

module.exports = { fixCityNames };

