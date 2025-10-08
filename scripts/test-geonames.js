#!/usr/bin/env node

/**
 * Test script for GeoNames API integration
 * This script tests the GeoNames API functionality without affecting the database
 */

require('dotenv').config();
const GeoNamesAPI = require('./geonames-api');

async function testGeoNamesAPI() {
    console.log('🧪 Testing GeoNames API Integration...\n');
    
    const geoNamesAPI = new GeoNamesAPI();
    
    try {
        // Test 1: Check API connectivity
        console.log('1️⃣  Testing API connectivity...');
        const testResult = await geoNamesAPI.searchCityData('New York', 'New York', 'United States');
        
        if (testResult) {
            console.log('✅ API connectivity test passed');
            console.log(`   Found: ${testResult.city}, ${testResult.country}`);
            console.log(`   Coordinates: ${testResult.latitude}, ${testResult.longitude}`);
            console.log(`   Continent: ${testResult.continent}`);
        } else {
            console.log('❌ API connectivity test failed');
        }
        
        // Test 2: Test string similarity
        console.log('\n2️⃣  Testing string similarity...');
        const similarity = geoNamesAPI.calculateSimilarity('new york', 'new york city');
        console.log(`   Similarity between 'new york' and 'new york city': ${similarity.toFixed(3)}`);
        
        // Test 3: Test continent mapping
        console.log('\n3️⃣  Testing continent mapping...');
        const continents = ['USA', 'FRA', 'CHN', 'AUS', 'BRA'];
        continents.forEach(code => {
            const continent = geoNamesAPI.getContinentFromCountryCode(code);
            console.log(`   ${code} → ${continent}`);
        });
        
        // Test 4: Check environment configuration
        console.log('\n4️⃣  Checking configuration...');
        console.log(`   GeoNames Username: ${geoNamesAPI.username}`);
        console.log(`   Base URL: ${geoNamesAPI.baseUrl}`);
        console.log(`   Rate Limit: ${geoNamesAPI.rateLimitDelay}ms`);
        
        if (geoNamesAPI.username === 'demo') {
            console.log('   ⚠️  Using demo username - get a free account at https://www.geonames.org/login');
        }
        
        console.log('\n✅ All tests completed successfully!');
        
    } catch (error) {
        console.error('❌ Test failed:', error.message);
        process.exit(1);
    } finally {
        await geoNamesAPI.close();
    }
}

// Run tests
testGeoNamesAPI();
