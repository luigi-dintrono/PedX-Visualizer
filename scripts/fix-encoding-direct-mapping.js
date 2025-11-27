#!/usr/bin/env node

/**
 * Direct Encoding Fix with Known Mappings
 * 
 * This script directly fixes known encoding issues using a hardcoded mapping.
 * It doesn't rely on CSV reading, just updates the database directly.
 */

const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    client_encoding: 'UTF8',
});

// Direct mapping of corrupted → correct city/country names
// Based on the actual corrupted values seen in the database
const FIXES = [
    // Cities
    { old: 'Asunci¨®n', new: 'Asunción', type: 'city' },
    { old: '?¨®d?', new: 'Łódź', type: 'city' },
    { old: 'Balne¨¢rio Cambori¨²', new: 'Balneário Camboriú', type: 'city' },
    { old: 'Bia?ystok', new: 'Białystok', type: 'city' },
    { old: 'Chi?in?u', new: 'Chișinău', type: 'city' },
    { old: 'G?ira', new: 'Gżira', type: 'city' },
    { old: 'Kor??', new: 'Korçë', type: 'city' },
    { old: 'Lourinh?', new: 'Lourinhã', type: 'city' },
    { old: 'Nuku?alofa', new: 'Nukuʻalofa', type: 'city' },
    { old: 'P?rnu', new: 'Pärnu', type: 'city' },
    { old: 'R?bni?a', new: 'Rîbnița', type: 'city' },
    { old: 'Saint-Fran?ois', new: 'Saint-François', type: 'city' },
    { old: 'X?rdalan', new: 'Xırdalan', type: 'city' },
    { old: 'Jos¨¦ Pedro Varela', new: 'José Pedro Varela', type: 'city' },
    { old: 'Lom¨¦', new: 'Lomé', type: 'city' },
    { old: 'Macap¨¢', new: 'Macapá', type: 'city' },
    { old: 'Mal¨¦', new: 'Malé', type: 'city' },
    { old: 'M¨¹nchen', new: 'München', type: 'city' },
    { old: 'Nazar¨¦', new: 'Nazaré', type: 'city' },
    { old: 'Noum¨¦a', new: 'Nouméa', type: 'city' },
    { old: 'Pointe-¨¤-Pitre', new: 'Pointe-à-Pitre', type: 'city' },
    { old: 'Puerto Su¨¢rez', new: 'Puerto Suárez', type: 'city' },
    { old: 'Sal¨¦', new: 'Salé', type: 'city' },
    { old: 'San Jos¨¦ de Chiquitos', new: 'San José de Chiquitos', type: 'city' },
    { old: 'San Jos¨¦', new: 'San José', type: 'city' },
    { old: 'Sant Juli¨¤ de L¨°ria', new: 'Sant Julià de Lòria', type: 'city' },
    { old: 'Tulc¨¢n', new: 'Tulcán', type: 'city' },
    { old: 'T¨¦touan', new: 'Tétouan', type: 'city' },
    { old: 'Yaound¨¦', new: 'Yaoundé', type: 'city' },
    
    // Countries
    { old: 'C?te d\'Ivoire', new: 'Côte d\'Ivoire', type: 'country' },
    { old: 'T¨¹rkiye', new: 'Türkiye', type: 'country' },
    { old: 'Cura?ao', new: 'Curaçao', type: 'country' },
];

async function main() {
    console.log('🔧 Direct Encoding Fix with Known Mappings\n');
    
    try {
        await pool.query("SET client_encoding TO 'UTF8'");
        
        // Get all cities
        const dbResult = await pool.query('SELECT id, city, country FROM cities ORDER BY id');
        console.log(`📥 Found ${dbResult.rows.length} cities in database\n`);
        
        // Find cities that need fixing
        const updates = [];
        
        for (const dbRow of dbResult.rows) {
            let newCity = dbRow.city;
            let newCountry = dbRow.country;
            let needsUpdate = false;
            
            // Check city
            for (const fix of FIXES) {
                if (fix.type === 'city' && dbRow.city === fix.old) {
                    newCity = fix.new;
                    needsUpdate = true;
                    break;
                }
            }
            
            // Check country
            for (const fix of FIXES) {
                if (fix.type === 'country' && dbRow.country === fix.old) {
                    newCountry = fix.new;
                    needsUpdate = true;
                    break;
                }
            }
            
            if (needsUpdate) {
                updates.push({
                    id: dbRow.id,
                    oldCity: dbRow.city,
                    newCity: newCity,
                    oldCountry: dbRow.country,
                    newCountry: newCountry
                });
            }
        }
        
        console.log(`📊 Found ${updates.length} cities to fix\n`);
        
        if (updates.length === 0) {
            console.log('✅ No encoding issues found!');
            return;
        }
        
        // Show preview
        console.log('Preview of fixes:');
        updates.forEach(u => {
            console.log(`  "${u.oldCity}, ${u.oldCountry}" → "${u.newCity}, ${u.newCountry}"`);
        });
        console.log('');
        
        // Check for potential duplicates and handle them by merging data
        console.log('🔍 Checking for potential duplicates...\n');
        const targetMap = new Map(); // Track which city+country combinations we're creating
        const duplicates = [];
        const validUpdates = [];
        
        for (const update of updates) {
            const targetKey = `${update.newCity}_${update.newCountry}`.toLowerCase();
            
            // Check if target already exists in database (from a previous update or existing correct entry)
            const existingCheck = await pool.query(
                'SELECT id, city, country FROM cities WHERE LOWER(city) = LOWER($1) AND LOWER(country) = LOWER($2)',
                [update.newCity, update.newCountry]
            );
            
            if (existingCheck.rows.length > 0) {
                const existing = existingCheck.rows[0];
                // If the existing city is not the one we're trying to update, it's a duplicate
                if (existing.id !== update.id) {
                    duplicates.push({
                        corruptedId: update.id,
                        corruptedCity: update.oldCity,
                        corruptedCountry: update.oldCountry,
                        correctId: existing.id,
                        correctCity: existing.city,
                        correctCountry: existing.country
                    });
                    continue;
                }
            }
            
            // Check if we've already planned to update another city to this target
            if (targetMap.has(targetKey)) {
                const previousUpdate = targetMap.get(targetKey);
                duplicates.push({
                    corruptedId: update.id,
                    corruptedCity: update.oldCity,
                    corruptedCountry: update.oldCountry,
                    correctId: previousUpdate.id,
                    correctCity: previousUpdate.oldCity,
                    correctCountry: previousUpdate.oldCountry
                });
                continue;
            }
            
            targetMap.set(targetKey, update);
            validUpdates.push(update);
        }
        
        if (duplicates.length > 0) {
            console.log(`⚠️  Found ${duplicates.length} duplicates that need data migration:\n`);
            for (const dup of duplicates) {
                // Check how many videos are associated with the corrupted city
                const videoCount = await pool.query(
                    'SELECT COUNT(*) as count FROM videos WHERE city_id = $1',
                    [dup.corruptedId]
                );
                const count = parseInt(videoCount.rows[0].count);
                console.log(`  Corrupted ID ${dup.corruptedId}: "${dup.corruptedCity}, ${dup.corruptedCountry}"`);
                console.log(`    → Correct ID ${dup.correctId}: "${dup.correctCity}, ${dup.correctCountry}"`);
                console.log(`    → Has ${count} videos to migrate`);
            }
            console.log('');
        }
        
        console.log(`📊 Will update ${validUpdates.length} cities directly`);
        console.log(`📊 Will merge and delete ${duplicates.length} duplicate cities\n`);
        
        // Update database
        console.log('💾 Updating database...\n');
        let success = 0;
        let failed = 0;
        let merged = 0;
        let mergeFailed = 0;
        
        // First, handle direct updates (no duplicates)
        for (const update of validUpdates) {
            try {
                await pool.query(
                    'UPDATE cities SET city = $1, country = $2, updated_at = CURRENT_TIMESTAMP WHERE id = $3',
                    [update.newCity, update.newCountry, update.id]
                );
                console.log(`✓ Updated ID ${update.id}: "${update.oldCity}" → "${update.newCity}" (${update.newCountry})`);
                success++;
            } catch (err) {
                console.error(`✗ Error updating ID ${update.id}:`, err.message);
                failed++;
            }
        }
        
        // Then, handle duplicates by migrating data and deleting corrupted entries
        if (duplicates.length > 0) {
            console.log('\n🔄 Migrating data from corrupted duplicates...\n');
            
            for (const dup of duplicates) {
                try {
                    // Check if corrupted city has any videos
                    const videoCheck = await pool.query(
                        'SELECT COUNT(*) as count FROM videos WHERE city_id = $1',
                        [dup.corruptedId]
                    );
                    const videoCount = parseInt(videoCheck.rows[0].count);
                    
                    if (videoCount > 0) {
                        // Migrate videos from corrupted city to correct city
                        await pool.query(
                            'UPDATE videos SET city_id = $1, updated_at = CURRENT_TIMESTAMP WHERE city_id = $2',
                            [dup.correctId, dup.corruptedId]
                        );
                        console.log(`✓ Migrated ${videoCount} videos from ID ${dup.corruptedId} to ID ${dup.correctId}`);
                    }
                    
                    // Delete the corrupted duplicate city
                    // (videos are already migrated, so CASCADE won't delete them)
                    await pool.query('DELETE FROM cities WHERE id = $1', [dup.corruptedId]);
                    console.log(`✓ Deleted corrupted duplicate city ID ${dup.corruptedId}: "${dup.corruptedCity}, ${dup.corruptedCountry}"`);
                    merged++;
                } catch (err) {
                    console.error(`✗ Error merging ID ${dup.corruptedId}:`, err.message);
                    mergeFailed++;
                }
            }
        }
        
        console.log(`\n✅ Update complete:`);
        console.log(`   Direct updates - Success: ${success}, Failed: ${failed}`);
        if (duplicates.length > 0) {
            console.log(`   Duplicate merges - Merged: ${merged}, Failed: ${mergeFailed}`);
        }
        
    } catch (error) {
        console.error('✗ Error:', error);
        process.exit(1);
    } finally {
        await pool.end();
    }
}

main();

