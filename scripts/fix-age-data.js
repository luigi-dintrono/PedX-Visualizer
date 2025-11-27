#!/usr/bin/env node

/**
 * Fix Age Data Script
 * 
 * This script updates age values in the pedestrians table by parsing age group strings
 * like "Age18-60" into numeric values (midpoint of the range).
 * 
 * Usage: node scripts/fix-age-data.js
 */

const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
    client_encoding: 'UTF8'
});

// Helper function to parse age values (handles both numeric and age group strings)
function parseAge(value) {
    if (value === null || value === undefined || value === '') {
        return null;
    }
    
    // If it's already a number, return it
    if (typeof value === 'number' && value > 0) {
        return value;
    }
    
    const strValue = value.toString().trim();
    
    // Try direct integer parsing first
    const directParsed = parseInt(strValue);
    if (!isNaN(directParsed) && directParsed > 0) {
        return directParsed;
    }
    
    // Try to parse age group strings like "Age18-60", "Age18-30", etc.
    const ageGroupMatch = strValue.match(/Age(\d+)-(\d+)/i);
    if (ageGroupMatch) {
        const minAge = parseInt(ageGroupMatch[1]);
        const maxAge = parseInt(ageGroupMatch[2]);
        if (!isNaN(minAge) && !isNaN(maxAge) && minAge > 0 && maxAge > 0) {
            // Return the midpoint of the age range
            return Math.round((minAge + maxAge) / 2);
        }
    }
    
    // Try other common age group formats
    const otherMatch = strValue.match(/(\d+)-(\d+)/);
    if (otherMatch) {
        const minAge = parseInt(otherMatch[1]);
        const maxAge = parseInt(otherMatch[2]);
        if (!isNaN(minAge) && !isNaN(maxAge) && minAge > 0 && maxAge > 0) {
            return Math.round((minAge + maxAge) / 2);
        }
    }
    
    return null;
}

async function fixAgeData() {
    try {
        await pool.query("SET client_encoding TO 'UTF8'");
        
        console.log('Fetching pedestrians with null or zero age values...');
        
        // First, let's check what age values we have
        const checkResult = await pool.query(`
            SELECT 
                COUNT(*) as total,
                COUNT(age) FILTER (WHERE age IS NOT NULL AND age > 0) as with_valid_age,
                COUNT(age) FILTER (WHERE age IS NULL OR age = 0) as with_null_or_zero_age
            FROM pedestrians
        `);
        
        console.log('Current age data status:');
        console.log(`  Total pedestrians: ${checkResult.rows[0].total}`);
        console.log(`  With valid age: ${checkResult.rows[0].with_valid_age}`);
        console.log(`  With null/zero age: ${checkResult.rows[0].with_null_or_zero_age}`);
        
        // Since we can't directly read the original CSV values from the database,
        // we need to re-import the data. But let's check if we can find any patterns
        // in the existing data that might help.
        
        console.log('\n⚠️  Note: Age values stored as strings like "Age18-60" cannot be fixed');
        console.log('   from the database alone. You need to re-run the aggregation script');
        console.log('   with the updated safeAge() function to properly import age data.');
        console.log('\n   Run: make db-aggregate');
        
        // Check if v_city_summary has age data
        const viewCheck = await pool.query(`
            SELECT 
                COUNT(*) as total_cities,
                COUNT(avg_pedestrian_age) FILTER (WHERE avg_pedestrian_age IS NOT NULL AND avg_pedestrian_age > 0) as cities_with_age
            FROM v_city_summary
        `);
        
        console.log('\nView data status:');
        console.log(`  Total cities: ${viewCheck.rows[0].total_cities}`);
        console.log(`  Cities with avg age: ${viewCheck.rows[0].cities_with_age}`);
        
        if (viewCheck.rows[0].cities_with_age === 0) {
            console.log('\n❌ No age data found in v_city_summary view.');
            console.log('   This confirms that age values need to be re-imported.');
        }
        
    } catch (error) {
        console.error('Error fixing age data:', error);
        throw error;
    } finally {
        await pool.end();
    }
}

// Run the script
fixAgeData()
    .then(() => {
        console.log('\n✅ Age data check completed!');
        process.exit(0);
    })
    .catch((error) => {
        console.error('\n❌ Error:', error);
        process.exit(1);
    });

