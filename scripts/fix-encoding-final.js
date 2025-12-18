#!/usr/bin/env node

/**
 * Final Encoding Fix - Handles multiple encoding scenarios
 * 
 * The issue: CSV file might be in Latin-1 but contains UTF-8 characters
 * Solution: Read as binary, try multiple encodings, use the one that produces valid UTF-8
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

// Known city name corrections (for cities that are commonly corrupted)
// These are the exact corrupted strings as they appear in the database
const CITY_CORRECTIONS = {
    // Cities
    'Asunci¨®n': 'Asunción',
    '?¨®d?': 'Łódź',
    'Balne¨¢rio Cambori¨²': 'Balneário Camboriú',
    'Bia?ystok': 'Białystok',
    'Chi?in?u': 'Chișinău',
    'G?ira': 'Gżira',
    'Kor??': 'Korçë',
    'Lourinh?': 'Lourinhã',
    'Nuku?alofa': 'Nukuʻalofa',
    'P?rnu': 'Pärnu',
    'R?bni?a': 'Rîbnița',
    'Saint-Fran?ois': 'Saint-François',
    'X?rdalan': 'Xırdalan',
    
    // Countries
    'C?te d\'Ivoire': 'Côte d\'Ivoire',
    'T¨¹rkiye': 'Türkiye',
    'Cura?ao': 'Curaçao',
    
    // City parts with special characters
    'Jos¨¦': 'José',
    'Lom¨¦': 'Lomé',
    'Macap¨¢': 'Macapá',
    'Mal¨¦': 'Malé',
    'M¨¹nchen': 'München',
    'Nazar¨¦': 'Nazaré',
    'Noum¨¦a': 'Nouméa',
    'Pointe-¨¤-Pitre': 'Pointe-à-Pitre',
    'Puerto Su¨¢rez': 'Puerto Suárez',
    'Sal¨¦': 'Salé',
    'San Jos¨¦': 'San José',
    'Sant Juli¨¤ de L¨°ria': 'Sant Julià de Lòria',
    'Tulc¨¢n': 'Tulcán',
    'T¨¦touan': 'Tétouan',
    'Yaound¨¦': 'Yaoundé',
};

// Function to fix common encoding issues in a string
function fixEncoding(str) {
    if (!str) return str;
    
    // Apply known corrections - check full string first, then parts
    let fixed = str;
    
    // Check if entire string matches a correction
    if (CITY_CORRECTIONS[fixed]) {
        return CITY_CORRECTIONS[fixed];
    }
    
    // Apply partial corrections
    for (const [wrong, correct] of Object.entries(CITY_CORRECTIONS)) {
        // Escape special regex characters
        const escaped = wrong.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        fixed = fixed.replace(new RegExp(escaped, 'g'), correct);
    }
    
    return fixed;
}

// Read CSV with proper encoding handling
async function readCSVProperly(filePath) {
    return new Promise((resolve, reject) => {
        fs.readFile(filePath, (err, buffer) => {
            if (err) {
                reject(err);
                return;
            }
            
            // Try different encodings
            const attempts = [
                { name: 'utf8', decode: () => buffer.toString('utf8') },
                { name: 'latin1', decode: () => buffer.toString('latin1') },
                { name: 'windows-1252', decode: () => {
                    // Windows-1252 is similar to Latin-1 but has some differences
                    let result = '';
                    for (let i = 0; i < buffer.length; i++) {
                        const byte = buffer[i];
                        // Windows-1252 specific characters
                        if (byte >= 0x80 && byte <= 0x9F) {
                            // These are control characters in Latin-1 but printable in Windows-1252
                            const win1252Map = {
                                0x80: 0x20AC, 0x82: 0x201A, 0x83: 0x0192, 0x84: 0x201E,
                                0x85: 0x2026, 0x86: 0x2020, 0x87: 0x2021, 0x88: 0x02C6,
                                0x89: 0x2030, 0x8A: 0x0160, 0x8B: 0x2039, 0x8C: 0x0152,
                                0x8E: 0x017D, 0x91: 0x2018, 0x92: 0x2019, 0x93: 0x201C,
                                0x94: 0x201D, 0x95: 0x2022, 0x96: 0x2013, 0x97: 0x2014,
                                0x98: 0x02DC, 0x99: 0x2122, 0x9A: 0x0161, 0x9B: 0x203A,
                                0x9C: 0x0153, 0x9E: 0x017E, 0x9F: 0x0178
                            };
                            if (win1252Map[byte]) {
                                result += String.fromCharCode(win1252Map[byte]);
                            } else {
                                result += String.fromCharCode(byte);
                            }
                        } else {
                            result += String.fromCharCode(byte);
                        }
                    }
                    return result;
                }}
            ];
            
            let bestContent = null;
            let bestEncoding = null;
            let minIssues = Infinity;
            
            for (const attempt of attempts) {
                try {
                    const content = attempt.decode();
                    // Count encoding issues (replacement characters, common corruption patterns)
                    const issues = (content.match(/�/g) || []).length + 
                                  (content.match(/[?®¨]/g) || []).length;
                    
                    if (issues < minIssues) {
                        minIssues = issues;
                        bestContent = content;
                        bestEncoding = attempt.name;
                    }
                } catch (e) {
                    continue;
                }
            }
            
            if (!bestContent) {
                reject(new Error('Failed to decode CSV with any encoding'));
                return;
            }
            
            console.log(`✓ Using ${bestEncoding} encoding (${minIssues} potential issues detected)`);
            
            // Parse CSV
            const lines = bestContent.split(/\r?\n/).filter(line => line.trim());
            if (lines.length === 0) {
                reject(new Error('Empty CSV'));
                return;
            }
            
            // Simple CSV parser
            const headers = lines[0].split(',').map(h => h.trim().replace(/^"|"$/g, ''));
            const rows = [];
            
            for (let i = 1; i < lines.length; i++) {
                const line = lines[i];
                if (!line.trim()) continue;
                
                const values = [];
                let current = '';
                let inQuotes = false;
                
                for (let j = 0; j < line.length; j++) {
                    const char = line[j];
                    if (char === '"') {
                        inQuotes = !inQuotes;
                    } else if (char === ',' && !inQuotes) {
                        values.push(current.trim().replace(/^"|"$/g, ''));
                        current = '';
                    } else {
                        current += char;
                    }
                }
                values.push(current.trim().replace(/^"|"$/g, ''));
                
                const row = {};
                headers.forEach((header, idx) => {
                    let value = values[idx] || '';
                    // Apply encoding fixes
                    value = fixEncoding(value);
                    row[header] = value;
                });
                rows.push(row);
            }
            
            resolve(rows);
        });
    });
}

async function main() {
    console.log('🔧 Final Encoding Fix\n');
    
    try {
        await pool.query("SET client_encoding TO 'UTF8'");
        
        // Read CSV
        const csvPath = path.join(SOURCE_DIR, 'all_video_info.csv');
        console.log(`📖 Reading ${csvPath}...\n`);
        const rows = await readCSVProperly(csvPath);
        console.log(`✓ Parsed ${rows.length} rows\n`);
        
        // Extract cities
        const cityMap = new Map();
        for (const row of rows) {
            if (row.city && row.country) {
                const city = fixEncoding(row.city.trim());
                const country = fixEncoding(row.country.trim());
                const key = `${city.toLowerCase()}_${country.toLowerCase()}`;
                cityMap.set(key, { city, country });
            }
        }
        console.log(`✓ Found ${cityMap.size} unique cities\n`);
        
        // Show sample
        console.log('Sample cities (should be properly encoded now):');
        let count = 0;
        for (const [key, data] of cityMap) {
            if (count < 15) {
                if (data.city.includes('Asunci') || data.city.includes('Balneario') || data.city.includes('Lodz') || data.city.includes('Łódź')) {
                    console.log(`  - ${data.city}, ${data.country}`);
                    count++;
                }
            } else {
                break;
            }
        }
        // Also show some random ones
        const sampleCities = Array.from(cityMap.values()).slice(0, 10);
        sampleCities.forEach(c => console.log(`  - ${c.city}, ${c.country}`));
        console.log('');
        
        // Get database cities
        console.log('📥 Fetching cities from database...');
        const dbResult = await pool.query('SELECT id, city, country FROM cities ORDER BY id');
        console.log(`✓ Found ${dbResult.rows.length} cities\n`);
        
        // Normalize function
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
        
        // Find corrupted cities
        console.log('🔍 Finding corrupted cities...\n');
        const updates = [];
        
        for (const dbRow of dbResult.rows) {
            const hasIssue = /[?®¨]/.test(dbRow.city) || /[?®¨]/.test(dbRow.country);
            
            if (hasIssue) {
                const normKey = `${normalize(dbRow.city)}_${normalize(dbRow.country)}`;
                const csvData = csvLookup.get(normKey);
                
                if (csvData && (dbRow.city !== csvData.city || dbRow.country !== csvData.country)) {
                    updates.push({
                        id: dbRow.id,
                        oldCity: dbRow.city,
                        newCity: csvData.city,
                        oldCountry: dbRow.country,
                        newCountry: csvData.country
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
        updates.slice(0, 20).forEach(u => {
            console.log(`  "${u.oldCity}, ${u.oldCountry}" → "${u.newCity}, ${u.newCountry}"`);
        });
        if (updates.length > 20) {
            console.log(`  ... and ${updates.length - 20} more\n`);
        } else {
            console.log('');
        }
        
        // Update
        console.log('💾 Updating database...\n');
        let success = 0;
        
        for (const update of updates) {
            try {
                await pool.query(
                    'UPDATE cities SET city = $1, country = $2, updated_at = CURRENT_TIMESTAMP WHERE id = $3',
                    [update.newCity, update.newCountry, update.id]
                );
                console.log(`✓ "${update.oldCity}" → "${update.newCity}" (${update.newCountry})`);
                success++;
            } catch (err) {
                console.error(`✗ Error:`, err.message);
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

