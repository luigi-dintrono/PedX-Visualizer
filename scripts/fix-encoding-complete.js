#!/usr/bin/env node

/**
 * Complete Encoding Fix
 * 
 * This script:
 * 1. Reads the source CSV with proper encoding detection
 * 2. Creates a mapping of correct city names
 * 3. Updates all corrupted city names in the database
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

// Read CSV file with encoding detection
function readCSVFile(filePath) {
    return new Promise((resolve, reject) => {
        // Try UTF-8 first
        fs.readFile(filePath, 'utf8', (err, data) => {
            if (err) {
                // Try Latin-1
                fs.readFile(filePath, 'latin1', (err2, data2) => {
                    if (err2) {
                        reject(err2);
                    } else {
                        resolve(data2);
                    }
                });
            } else {
                resolve(data);
            }
        });
    });
}

// Parse CSV content
function parseCSV(content) {
    const lines = content.split('\n').filter(line => line.trim());
    if (lines.length === 0) return [];
    
    const headers = lines[0].split(',').map(h => h.trim().replace(/^"|"$/g, ''));
    const rows = [];
    
    for (let i = 1; i < lines.length; i++) {
        const values = lines[i].split(',').map(v => v.trim().replace(/^"|"$/g, ''));
        const row = {};
        headers.forEach((header, idx) => {
            row[header] = values[idx] || '';
        });
        rows.push(row);
    }
    
    return rows;
}

async function main() {
    console.log('🔧 Complete Encoding Fix\n');
    
    try {
        await pool.query("SET client_encoding TO 'UTF8'");
        
        // Read CSV
        const csvPath = path.join(SOURCE_DIR, 'all_video_info.csv');
        console.log(`📖 Reading ${csvPath}...`);
        const csvContent = await readCSVFile(csvPath);
        const rows = parseCSV(csvContent);
        console.log(`✓ Read ${rows.length} rows\n`);
        
        // Extract unique cities
        const cityMap = new Map();
        for (const row of rows) {
            if (row.city && row.country) {
                const city = row.city.trim().normalize('NFC');
                const country = row.country.trim().normalize('NFC');
                const key = `${city.toLowerCase()}_${country.toLowerCase()}`;
                cityMap.set(key, { city, country });
            }
        }
        console.log(`✓ Found ${cityMap.size} unique cities\n`);
        
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
        
        // Build lookup
        const csvLookup = new Map();
        for (const [key, data] of cityMap) {
            const normKey = `${normalize(data.city)}_${normalize(data.country)}`;
            csvLookup.set(normKey, data);
        }
        
        // Find corrupted cities and prepare updates
        console.log('🔍 Finding corrupted cities...\n');
        const updates = [];
        
        for (const dbRow of dbResult.rows) {
            const hasIssue = /[?®¨]/.test(dbRow.city) || /[?®¨]/.test(dbRow.country);
            
            if (hasIssue) {
                const normKey = `${normalize(dbRow.city)}_${normalize(dbRow.country)}`;
                const csvData = csvLookup.get(normKey);
                
                if (csvData) {
                    updates.push({
                        id: dbRow.id,
                        old: `${dbRow.city}, ${dbRow.country}`,
                        new: `${csvData.city}, ${csvData.country}`
                    });
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
        updates.slice(0, 10).forEach(u => {
            console.log(`  "${u.old}" → "${u.new}"`);
        });
        if (updates.length > 10) {
            console.log(`  ... and ${updates.length - 10} more\n`);
        } else {
            console.log('');
        }
        
        // Update database
        console.log('💾 Updating database...\n');
        let success = 0;
        
        for (const update of updates) {
            const csvData = csvLookup.get(`${normalize(update.old.split(',')[0])}_${normalize(update.old.split(',')[1])}`);
            if (csvData) {
                try {
                    await pool.query(
                        'UPDATE cities SET city = $1, country = $2, updated_at = CURRENT_TIMESTAMP WHERE id = $3',
                        [csvData.city, csvData.country, update.id]
                    );
                    console.log(`✓ Fixed: "${update.old}" → "${update.new}"`);
                    success++;
                } catch (err) {
                    console.error(`✗ Error updating ID ${update.id}:`, err.message);
                }
            }
        }
        
        console.log(`\n✅ Fixed ${success} cities`);
        
    } catch (error) {
        console.error('✗ Error:', error);
        process.exit(1);
    } finally {
        await pool.end();
    }
}

main();

