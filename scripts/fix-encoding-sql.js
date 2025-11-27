#!/usr/bin/env node

/**
 * SQL-based Encoding Fix
 * 
 * This script uses PostgreSQL's encoding conversion functions
 * to fix corrupted city names directly in the database
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

// Read CSV and extract city mappings
async function getCityMappings() {
    const csvPath = path.join(SOURCE_DIR, 'all_video_info.csv');
    
    // Try different encodings
    const encodings = ['utf8', 'latin1'];
    let data = null;
    
    for (const encoding of encodings) {
        try {
            data = await new Promise((resolve, reject) => {
                const results = [];
                const stream = fs.createReadStream(csvPath, { encoding });
                stream
                    .pipe(csv({ skipEmptyLines: true }))
                    .on('data', (row) => {
                        if (row.city && row.country) {
                            results.push({
                                city: row.city.trim().normalize('NFC'),
                                country: row.country.trim().normalize('NFC')
                            });
                        }
                    })
                    .on('end', () => resolve(results))
                    .on('error', reject);
            });
            
            if (data && data.length > 0) {
                console.log(`✓ Read CSV with ${encoding} encoding: ${data.length} rows`);
                break;
            }
        } catch (err) {
            if (VERBOSE) console.log(`✗ Failed with ${encoding}`);
            continue;
        }
    }
    
    if (!data || data.length === 0) {
        throw new Error('Failed to read CSV file');
    }
    
    // Create unique city map
    const cityMap = new Map();
    for (const item of data) {
        const key = `${item.city.toLowerCase()}_${item.country.toLowerCase()}`;
        if (!cityMap.has(key)) {
            cityMap.set(key, item);
        }
    }
    
    return cityMap;
}

async function fixWithSQL() {
    console.log('🔧 SQL-based Encoding Fix\n');
    
    try {
        await pool.query("SET client_encoding TO 'UTF8'");
        
        // Get city mappings from CSV
        console.log('📖 Reading CSV file...');
        const cityMap = await getCityMappings();
        console.log(`✓ Found ${cityMap.size} unique cities\n`);
        
        // Get all cities from database
        console.log('📥 Fetching cities from database...');
        const dbResult = await pool.query(`
            SELECT id, city, country 
            FROM cities 
            ORDER BY id
        `);
        console.log(`✓ Found ${dbResult.rows.length} cities in database\n`);
        
        // Normalize function
        const normalize = (str) => {
            if (!str) return '';
            return str.toLowerCase()
                .normalize('NFD')
                .replace(/[\u0300-\u036f]/g, '')
                .replace(/[^a-z0-9]/g, '')
                .trim();
        };
        
        // Build CSV lookup map
        const csvLookup = new Map();
        for (const [key, data] of cityMap) {
            const normKey = `${normalize(data.city)}_${normalize(data.country)}`;
            csvLookup.set(normKey, data);
        }
        
        // Find and fix corrupted cities
        console.log('🔍 Finding corrupted cities...\n');
        const updates = [];
        
        for (const dbRow of dbResult.rows) {
            const dbCity = dbRow.city;
            const dbCountry = dbRow.country;
            
            // Check if city name has encoding issues
            const hasEncodingIssue = /[?®¨]/.test(dbCity) || /[?®¨]/.test(dbCountry);
            
            if (hasEncodingIssue) {
                const normKey = `${normalize(dbCity)}_${normalize(dbCountry)}`;
                const csvData = csvLookup.get(normKey);
                
                if (csvData) {
                    updates.push({
                        id: dbRow.id,
                        oldCity: dbCity,
                        newCity: csvData.city,
                        oldCountry: dbCountry,
                        newCountry: csvData.country
                    });
                } else {
                    // Try fuzzy match
                    for (const [csvKey, csvData] of csvLookup) {
                        if (normalize(csvData.country) === normalize(dbCountry)) {
                            const dbNorm = normalize(dbCity);
                            const csvNorm = normalize(csvData.city);
                            
                            if (dbNorm && csvNorm && 
                                (dbNorm.includes(csvNorm) || csvNorm.includes(dbNorm))) {
                                updates.push({
                                    id: dbRow.id,
                                    oldCity: dbCity,
                                    newCity: csvData.city,
                                    oldCountry: dbCountry,
                                    newCountry: csvData.country
                                });
                                break;
                            }
                        }
                    }
                }
            }
        }
        
        console.log(`📊 Found ${updates.length} cities with encoding issues\n`);
        
        if (updates.length === 0) {
            console.log('✅ No encoding issues found!');
            return;
        }
        
        // Show what will be updated
        console.log('🔄 Cities to update:\n');
        updates.forEach(u => {
            console.log(`   "${u.oldCity}" → "${u.newCity}" (${u.newCountry})`);
        });
        console.log('');
        
        // Perform updates
        console.log('💾 Updating database...\n');
        let success = 0;
        let failed = 0;
        
        for (const update of updates) {
            try {
                await pool.query(`
                    UPDATE cities 
                    SET city = $1, country = $2, updated_at = CURRENT_TIMESTAMP
                    WHERE id = $3
                `, [update.newCity, update.newCountry, update.id]);
                
                console.log(`✓ Updated ID ${update.id}: "${update.oldCity}" → "${update.newCity}"`);
                success++;
            } catch (error) {
                console.error(`✗ Failed to update ID ${update.id}:`, error.message);
                failed++;
            }
        }
        
        console.log(`\n✅ Update complete:`);
        console.log(`   Success: ${success}`);
        console.log(`   Failed: ${failed}`);
        
    } catch (error) {
        console.error('✗ Error:', error);
        throw error;
    }
}

async function main() {
    try {
        await fixWithSQL();
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

module.exports = { fixWithSQL };

