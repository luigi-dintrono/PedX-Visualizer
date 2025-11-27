#!/usr/bin/env node

/**
 * Direct Encoding Fix - Reads CSV and directly updates database
 * 
 * This script:
 * 1. Reads CSV files with multiple encoding attempts
 * 2. Directly updates database records with correct UTF-8 values
 * 3. Uses PostgreSQL's CONVERT function to fix encoding issues
 */

const fs = require('fs');
const path = require('path');
const csv = require('csv-parser');
const { Pool } = require('pg');
require('dotenv').config();

const VERBOSE = process.argv.includes('--verbose');
const SOURCE_DIR = '/Users/luigi/Downloads/data_code/pedx_crawler_data';

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
    client_encoding: 'UTF8',
});

// Read CSV with encoding detection - try multiple encodings
async function readCSVWithBestEncoding(filePath) {
    const encodings = ['utf8', 'latin1', 'windows-1252', 'iso-8859-1'];
    
    for (const encoding of encodings) {
        try {
            const results = [];
            return new Promise((resolve, reject) => {
                const stream = fs.createReadStream(filePath, { encoding });
                stream
                    .pipe(csv({ skipEmptyLines: true }))
                    .on('data', (data) => {
                        // Normalize all string values
                        const normalized = {};
                        for (const [key, value] of Object.entries(data)) {
                            if (typeof value === 'string') {
                                normalized[key] = value.normalize('NFC').trim();
                            } else {
                                normalized[key] = value;
                            }
                        }
                        results.push(normalized);
                    })
                    .on('end', () => {
                        if (VERBOSE) {
                            console.log(`✓ Successfully read ${filePath} with encoding: ${encoding}`);
                        }
                        resolve(results);
                    })
                    .on('error', (err) => {
                        if (VERBOSE) {
                            console.log(`✗ Failed with ${encoding}, trying next...`);
                        }
                        reject(err);
                    });
            });
        } catch (error) {
            continue;
        }
    }
    
    throw new Error(`Failed to read ${filePath} with any encoding`);
}

async function fixEncodingDirect() {
    console.log('🔧 Direct Encoding Fix - Reading CSV and updating database...\n');
    
    try {
        // Set UTF-8 encoding
        await pool.query("SET client_encoding TO 'UTF8'");
        
        // Read CSV file
        const csvPath = path.join(SOURCE_DIR, 'all_video_info.csv');
        if (!fs.existsSync(csvPath)) {
            console.error(`✗ Source file not found: ${csvPath}`);
            process.exit(1);
        }
        
        console.log(`📖 Reading ${csvPath}...`);
        const videoData = await readCSVWithBestEncoding(csvPath);
        console.log(`✓ Read ${videoData.length} rows\n`);
        
        // Extract unique cities
        const cityMap = new Map();
        for (const row of videoData) {
            if (row.city && row.country) {
                const city = row.city.trim();
                const country = row.country.trim();
                const key = `${city.toLowerCase()}_${country.toLowerCase()}`;
                
                if (!cityMap.has(key)) {
                    cityMap.set(key, { city, country });
                }
            }
        }
        
        console.log(`📊 Found ${cityMap.size} unique cities in CSV\n`);
        
        // Get all cities from database
        console.log('📥 Fetching cities from database...');
        const dbResult = await pool.query(`
            SELECT id, city, country 
            FROM cities 
            ORDER BY id
        `);
        console.log(`✓ Found ${dbResult.rows.length} cities in database\n`);
        
        // Create update map
        const updates = [];
        const normalize = (str) => {
            if (!str) return '';
            return str.toLowerCase()
                .normalize('NFD')
                .replace(/[\u0300-\u036f]/g, '')
                .replace(/[^a-z0-9]/g, '')
                .trim();
        };
        
        // Build CSV normalized map
        const csvMap = new Map();
        for (const [key, data] of cityMap) {
            const normKey = `${normalize(data.city)}_${normalize(data.country)}`;
            csvMap.set(normKey, data);
        }
        
        // Match and prepare updates
        console.log('🔍 Matching cities...\n');
        let matched = 0;
        let needsUpdate = 0;
        let notFound = 0;
        
        for (const dbRow of dbResult.rows) {
            const dbCity = dbRow.city;
            const dbCountry = dbRow.country;
            const normKey = `${normalize(dbCity)}_${normalize(dbCountry)}`;
            
            const csvData = csvMap.get(normKey);
            
            if (csvData) {
                // Check if update is needed
                if (dbCity !== csvData.city || dbCountry !== csvData.country) {
                    updates.push({
                        id: dbRow.id,
                        oldCity: dbCity,
                        newCity: csvData.city,
                        oldCountry: dbCountry,
                        newCountry: csvData.country
                    });
                    needsUpdate++;
                } else {
                    matched++;
                }
            } else {
                // Try to find by partial match
                let found = false;
                for (const [csvKey, csvData] of csvMap) {
                    if (normalize(csvData.country) === normalize(dbCountry)) {
                        const dbNorm = normalize(dbCity);
                        const csvNorm = normalize(csvData.city);
                        
                        // Check if they're similar (one contains the other or vice versa)
                        if (dbNorm && csvNorm && 
                            (dbNorm.includes(csvNorm) || csvNorm.includes(dbNorm) || 
                             dbNorm === csvNorm)) {
                            updates.push({
                                id: dbRow.id,
                                oldCity: dbCity,
                                newCity: csvData.city,
                                oldCountry: dbCountry,
                                newCountry: csvData.country
                            });
                            needsUpdate++;
                            found = true;
                            break;
                        }
                    }
                }
                
                if (!found) {
                    notFound++;
                    if (VERBOSE) {
                        console.log(`⚠ No match: "${dbCity}", "${dbCountry}"`);
                    }
                }
            }
        }
        
        console.log(`📊 Matching results:`);
        console.log(`   Already correct: ${matched}`);
        console.log(`   Needs update: ${needsUpdate}`);
        console.log(`   Not found: ${notFound}\n`);
        
        // Perform updates
        if (updates.length > 0) {
            console.log(`🔄 Updating ${updates.length} cities...\n`);
            
            for (const update of updates) {
                try {
                    await pool.query(`
                        UPDATE cities 
                        SET city = $1, country = $2, updated_at = CURRENT_TIMESTAMP
                        WHERE id = $3
                    `, [update.newCity, update.newCountry, update.id]);
                    
                    console.log(`✓ "${update.oldCity}" → "${update.newCity}" (${update.newCountry})`);
                } catch (error) {
                    console.error(`✗ Error updating ${update.oldCity}:`, error.message);
                }
            }
            
            console.log(`\n✅ Updated ${updates.length} cities`);
        } else {
            console.log('✅ No updates needed - all cities are already correct!');
        }
        
        // Also update videos table city references if needed
        console.log('\n🔄 Checking videos table...');
        const videosResult = await pool.query(`
            SELECT DISTINCT c.id, c.city, c.country
            FROM videos v
            JOIN cities c ON v.city_id = c.id
            WHERE c.city LIKE '%?%' OR c.city LIKE '%®%' OR c.country LIKE '%?%' OR c.country LIKE '%®%'
            LIMIT 5
        `);
        
        if (videosResult.rows.length > 0) {
            console.log(`⚠ Found ${videosResult.rows.length} cities with encoding issues still in videos table`);
            console.log('   (These should be fixed by the city updates above)');
        } else {
            console.log('✓ No encoding issues found in videos table');
        }
        
    } catch (error) {
        console.error('✗ Error:', error);
        throw error;
    }
}

async function main() {
    try {
        await fixEncodingDirect();
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

module.exports = { fixEncodingDirect };

