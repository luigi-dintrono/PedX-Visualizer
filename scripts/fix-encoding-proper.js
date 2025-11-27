#!/usr/bin/env node

/**
 * Proper Encoding Fix
 * 
 * This script properly converts encoding by:
 * 1. Reading CSV as binary
 * 2. Converting from Latin-1 to UTF-8 properly
 * 3. Updating database with correct UTF-8 values
 */

const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');
require('dotenv').config();

const SOURCE_DIR = '/Users/luigi/Downloads/data_code/pedx_crawler_data';

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    client_encoding: 'UTF8',
});

// Read CSV as binary and convert properly
function readCSVProperly(filePath) {
    return new Promise((resolve, reject) => {
        fs.readFile(filePath, (err, buffer) => {
            if (err) {
                reject(err);
                return;
            }
            
            // Try to detect encoding by checking for UTF-8 validity
            let content;
            let encoding = 'utf8';
            
            try {
                // Try UTF-8 first
                content = buffer.toString('utf8');
                // Check if it contains replacement characters (indicates wrong encoding)
                if (content.includes('')) {
                    throw new Error('UTF-8 has replacement chars');
                }
            } catch (e) {
                // If UTF-8 fails or has issues, try Latin-1
                // Latin-1 is a single-byte encoding, so we can convert it to UTF-8
                const latin1Buffer = Buffer.from(buffer);
                // Convert Latin-1 bytes to UTF-8
                content = latin1Buffer.toString('latin1');
                encoding = 'latin1';
            }
            
            // Parse CSV
            const lines = content.split(/\r?\n/).filter(line => line.trim());
            if (lines.length === 0) {
                reject(new Error('Empty CSV'));
                return;
            }
            
            // Parse header
            const headerLine = lines[0];
            const headers = [];
            let current = '';
            let inQuotes = false;
            
            for (let i = 0; i < headerLine.length; i++) {
                const char = headerLine[i];
                if (char === '"') {
                    inQuotes = !inQuotes;
                } else if (char === ',' && !inQuotes) {
                    headers.push(current.trim());
                    current = '';
                } else {
                    current += char;
                }
            }
            headers.push(current.trim());
            
            // Parse rows
            const rows = [];
            for (let i = 1; i < lines.length; i++) {
                const line = lines[i];
                if (!line.trim()) continue;
                
                const values = [];
                current = '';
                inQuotes = false;
                
                for (let j = 0; j < line.length; j++) {
                    const char = line[j];
                    if (char === '"') {
                        inQuotes = !inQuotes;
                    } else if (char === ',' && !inQuotes) {
                        values.push(current.trim());
                        current = '';
                    } else {
                        current += char;
                    }
                }
                values.push(current.trim());
                
                const row = {};
                headers.forEach((header, idx) => {
                    let value = values[idx] || '';
                    // Remove quotes if present
                    if (value.startsWith('"') && value.endsWith('"')) {
                        value = value.slice(1, -1);
                    }
                    row[header] = value;
                });
                rows.push(row);
            }
            
            console.log(`✓ Read CSV with ${encoding} encoding, converted to UTF-8`);
            resolve(rows);
        });
    });
}

async function main() {
    console.log('🔧 Proper Encoding Fix\n');
    
    try {
        await pool.query("SET client_encoding TO 'UTF8'");
        
        // Read CSV properly
        const csvPath = path.join(SOURCE_DIR, 'all_video_info.csv');
        console.log(`📖 Reading ${csvPath}...`);
        const rows = await readCSVProperly(csvPath);
        console.log(`✓ Parsed ${rows.length} rows\n`);
        
        // Extract unique cities with proper UTF-8
        const cityMap = new Map();
        for (const row of rows) {
            if (row.city && row.country) {
                const city = row.city.trim();
                const country = row.country.trim();
                const key = `${city.toLowerCase()}_${country.toLowerCase()}`;
                cityMap.set(key, { city, country });
            }
        }
        console.log(`✓ Found ${cityMap.size} unique cities\n`);
        
        // Show sample of cities to verify encoding
        console.log('Sample cities from CSV (should be properly encoded):');
        let count = 0;
        for (const [key, data] of cityMap) {
            if (count < 10) {
                console.log(`  - ${data.city}, ${data.country}`);
                count++;
            } else {
                break;
            }
        }
        console.log('');
        
        // Get all database cities
        console.log('📥 Fetching cities from database...');
        const dbResult = await pool.query('SELECT id, city, country FROM cities ORDER BY id');
        console.log(`✓ Found ${dbResult.rows.length} cities in database\n`);
        
        // Normalize for matching
        const normalize = (str) => {
            if (!str) return '';
            return str.toLowerCase()
                .normalize('NFD')
                .replace(/[\u0300-\u036f]/g, '')
                .replace(/[^a-z0-9]/g, '');
        };
        
        // Build lookup map
        const csvLookup = new Map();
        for (const [key, data] of cityMap) {
            const normKey = `${normalize(data.city)}_${normalize(data.country)}`;
            csvLookup.set(normKey, data);
        }
        
        // Find corrupted cities
        console.log('🔍 Finding corrupted cities...\n');
        const updates = [];
        
        for (const dbRow of dbResult.rows) {
            const hasIssue = /[?®¨]/.test(dbRow.city) || /[?®¨]/.test(dbRow.country);
            
            if (hasIssue) {
                const normKey = `${normalize(dbRow.city)}_${normalize(dbRow.country)}`;
                const csvData = csvLookup.get(normKey);
                
                if (csvData) {
                    // Only update if the values are actually different
                    if (dbRow.city !== csvData.city || dbRow.country !== csvData.country) {
                        updates.push({
                            id: dbRow.id,
                            oldCity: dbRow.city,
                            newCity: csvData.city,
                            oldCountry: dbRow.country,
                            newCountry: csvData.country
                        });
                    }
                } else {
                    // Try fuzzy match
                    for (const [csvKey, csvData] of csvLookup) {
                        if (normalize(csvData.country) === normalize(dbRow.country)) {
                            const dbNorm = normalize(dbRow.city);
                            const csvNorm = normalize(csvData.city);
                            
                            if (dbNorm && csvNorm && dbNorm.length > 3 && csvNorm.length > 3) {
                                // Check if they're similar
                                const similarity = Math.min(dbNorm.length, csvNorm.length) / Math.max(dbNorm.length, csvNorm.length);
                                if (similarity > 0.7 || dbNorm.includes(csvNorm) || csvNorm.includes(dbNorm)) {
                                    updates.push({
                                        id: dbRow.id,
                                        oldCity: dbRow.city,
                                        newCity: csvData.city,
                                        oldCountry: dbRow.country,
                                        newCountry: csvData.country
                                    });
                                    break;
                                }
                            }
                        }
                    }
                }
            }
        }
        
        console.log(`📊 Found ${updates.length} cities to fix\n`);
        
        if (updates.length === 0) {
            console.log('✅ No encoding issues found!');
            return;
        }
        
        // Show preview
        console.log('Preview of fixes:');
        updates.slice(0, 15).forEach(u => {
            console.log(`  "${u.oldCity}, ${u.oldCountry}" → "${u.newCity}, ${u.newCountry}"`);
        });
        if (updates.length > 15) {
            console.log(`  ... and ${updates.length - 15} more\n`);
        } else {
            console.log('');
        }
        
        // Update database
        console.log('💾 Updating database...\n');
        let success = 0;
        let failed = 0;
        
        for (const update of updates) {
            try {
                await pool.query(
                    'UPDATE cities SET city = $1, country = $2, updated_at = CURRENT_TIMESTAMP WHERE id = $3',
                    [update.newCity, update.newCountry, update.id]
                );
                console.log(`✓ Fixed: "${update.oldCity}" → "${update.newCity}" (${update.newCountry})`);
                success++;
            } catch (err) {
                console.error(`✗ Error updating ID ${update.id}:`, err.message);
                failed++;
            }
        }
        
        console.log(`\n✅ Update complete:`);
        console.log(`   Success: ${success}`);
        console.log(`   Failed: ${failed}`);
        
    } catch (error) {
        console.error('✗ Error:', error);
        process.exit(1);
    } finally {
        await pool.end();
    }
}

main();

