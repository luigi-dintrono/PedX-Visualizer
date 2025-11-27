#!/usr/bin/env node

const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    client_encoding: 'UTF8',
});

async function testVehicleAPI() {
    console.log('🧪 Testing Vehicle Counts for Ho Chi Minh City\n');
    
    if (!process.env.DATABASE_URL) {
        console.error('❌ DATABASE_URL not set in environment');
        process.exit(1);
    }

    try {
        await pool.query("SET client_encoding TO 'UTF8'");

        // 1. Query vehicle counts directly using the CTE (same as API)
        console.log('1️⃣  Direct Database Query (using CTE):');
        const directQuery = await pool.query(`
            WITH city_vehicle_counts AS (
                SELECT 
                    c.id,
                    COALESCE(COUNT(*) FILTER (WHERE (p.car IS TRUE OR p.car::int = 1)), 0)::INTEGER as car_count,
                    COALESCE(COUNT(*) FILTER (WHERE (p.bus IS TRUE OR p.bus::int = 1)), 0)::INTEGER as bus_count,
                    COALESCE(COUNT(*) FILTER (WHERE (p.truck IS TRUE OR p.truck::int = 1)), 0)::INTEGER as truck_count,
                    COALESCE(COUNT(*) FILTER (WHERE (p.motorbike IS TRUE OR p.motorbike::int = 1)), 0)::INTEGER as motorbike_count,
                    COALESCE(COUNT(*) FILTER (WHERE (p.bicycle IS TRUE OR p.bicycle::int = 1)), 0)::INTEGER as bicycle_count
                FROM cities c
                LEFT JOIN videos v ON c.id = v.city_id
                LEFT JOIN pedestrians p ON v.id = p.video_id
                WHERE c.city = 'Ho Chi Minh City'
                GROUP BY c.id
            )
            SELECT 
                vcs.id,
                vcs.city,
                vcs.country,
                cvc.car_count,
                cvc.bus_count,
                cvc.truck_count,
                cvc.motorbike_count,
                cvc.bicycle_count,
                vcs.total_pedestrians,
                vcs.total_videos
            FROM v_city_summary vcs
            INNER JOIN city_vehicle_counts cvc ON vcs.id = cvc.id
            WHERE vcs.city = 'Ho Chi Minh City'
                AND vcs.latitude IS NOT NULL 
                AND vcs.longitude IS NOT NULL
                AND vcs.total_pedestrians > 0
        `);

        if (directQuery.rows.length === 0) {
            console.log('   ❌ No data found for Ho Chi Minh City');
            return;
        }

        const dbResult = directQuery.rows[0];
        console.log(`   City: ${dbResult.city}, ${dbResult.country}`);
        console.log(`   Car Count: ${dbResult.car_count}`);
        console.log(`   Bus Count: ${dbResult.bus_count}`);
        console.log(`   Truck Count: ${dbResult.truck_count}`);
        console.log(`   Motorbike Count: ${dbResult.motorbike_count}`);
        console.log(`   Bicycle Count: ${dbResult.bicycle_count}`);
        console.log(`   Total Pedestrians: ${dbResult.total_pedestrians}`);
        console.log(`   Total Videos: ${dbResult.total_videos}\n`);

        // 2. Test API query with vehicle filters that should include Ho Chi Minh City
        console.log('2️⃣  Testing API Query with vehicle filters (car: 0-500, bus: 0-500):');
        const apiQuery1 = await pool.query(`
            WITH city_vehicle_counts AS (
                SELECT 
                    c.id,
                    COALESCE(COUNT(*) FILTER (WHERE (p.car IS TRUE OR p.car::int = 1)), 0)::INTEGER as car_count,
                    COALESCE(COUNT(*) FILTER (WHERE (p.bus IS TRUE OR p.bus::int = 1)), 0)::INTEGER as bus_count,
                    COALESCE(COUNT(*) FILTER (WHERE (p.truck IS TRUE OR p.truck::int = 1)), 0)::INTEGER as truck_count,
                    COALESCE(COUNT(*) FILTER (WHERE (p.motorbike IS TRUE OR p.motorbike::int = 1)), 0)::INTEGER as motorbike_count,
                    COALESCE(COUNT(*) FILTER (WHERE (p.bicycle IS TRUE OR p.bicycle::int = 1)), 0)::INTEGER as bicycle_count
                FROM cities c
                LEFT JOIN videos v ON c.id = v.city_id
                LEFT JOIN pedestrians p ON v.id = p.video_id
                GROUP BY c.id
            )
            SELECT 
                vcs.id, vcs.city, vcs.country, vcs.continent, vcs.latitude, vcs.longitude,
                vcs.population_city as population,
                vcs.total_videos as videos_analyzed,
                vcs.total_videos,
                vcs.total_pedestrians,
                cvc.car_count,
                cvc.bus_count,
                cvc.truck_count,
                cvc.motorbike_count,
                cvc.bicycle_count
            FROM v_city_summary vcs
            INNER JOIN city_vehicle_counts cvc ON vcs.id = cvc.id
            WHERE vcs.latitude IS NOT NULL 
              AND vcs.longitude IS NOT NULL
              AND vcs.total_pedestrians > 0
              AND cvc.car_count >= $1
              AND cvc.car_count <= $2
              AND cvc.bus_count >= $3
              AND cvc.bus_count <= $4
            AND vcs.city = 'Ho Chi Minh City'
        `, [0, 500, 0, 500]);

        console.log(`   Found ${apiQuery1.rows.length} result(s)`);
        if (apiQuery1.rows.length > 0) {
            const apiResult = apiQuery1.rows[0];
            console.log(`   City: ${apiResult.city}, ${apiResult.country}`);
            console.log(`   Car Count: ${apiResult.car_count}`);
            console.log(`   Bus Count: ${apiResult.bus_count}`);
            console.log(`   Truck Count: ${apiResult.truck_count}`);
            console.log(`   Motorbike Count: ${apiResult.motorbike_count}`);
            console.log(`   Bicycle Count: ${apiResult.bicycle_count}\n`);
        } else {
            console.log('   ❌ Ho Chi Minh City not found in API query results\n');
        }

        // 3. Test with restrictive filters (should exclude Ho Chi Minh City)
        console.log('3️⃣  Testing API Query with restrictive filters (car: 0-100, bus: 0-50):');
        const apiQuery2 = await pool.query(`
            WITH city_vehicle_counts AS (
                SELECT 
                    c.id,
                    COALESCE(COUNT(*) FILTER (WHERE (p.car IS TRUE OR p.car::int = 1)), 0)::INTEGER as car_count,
                    COALESCE(COUNT(*) FILTER (WHERE (p.bus IS TRUE OR p.bus::int = 1)), 0)::INTEGER as bus_count,
                    COALESCE(COUNT(*) FILTER (WHERE (p.truck IS TRUE OR p.truck::int = 1)), 0)::INTEGER as truck_count,
                    COALESCE(COUNT(*) FILTER (WHERE (p.motorbike IS TRUE OR p.motorbike::int = 1)), 0)::INTEGER as motorbike_count,
                    COALESCE(COUNT(*) FILTER (WHERE (p.bicycle IS TRUE OR p.bicycle::int = 1)), 0)::INTEGER as bicycle_count
                FROM cities c
                LEFT JOIN videos v ON c.id = v.city_id
                LEFT JOIN pedestrians p ON v.id = p.video_id
                GROUP BY c.id
            )
            SELECT 
                vcs.id, vcs.city, vcs.country
            FROM v_city_summary vcs
            INNER JOIN city_vehicle_counts cvc ON vcs.id = cvc.id
            WHERE vcs.latitude IS NOT NULL 
              AND vcs.longitude IS NOT NULL
              AND vcs.total_pedestrians > 0
              AND cvc.car_count >= $1
              AND cvc.car_count <= $2
              AND cvc.bus_count >= $3
              AND cvc.bus_count <= $4
            AND vcs.city = 'Ho Chi Minh City'
        `, [0, 100, 0, 50]);

        console.log(`   Found ${apiQuery2.rows.length} result(s)`);
        if (apiQuery2.rows.length > 0) {
            console.log(`   ⚠️  Ho Chi Minh City should be excluded but was found!`);
            console.log(`   This means the filters are not working correctly.\n`);
        } else {
            console.log(`   ✅ Ho Chi Minh City correctly excluded (car=431 > 100, bus=235 > 50)\n`);
        }

        // 4. Compare values
        console.log('4️⃣  Comparison:');
        if (apiQuery1.rows.length > 0) {
            const apiResult = apiQuery1.rows[0];
            const matches = {
                car: dbResult.car_count === apiResult.car_count,
                bus: dbResult.bus_count === apiResult.bus_count,
                truck: dbResult.truck_count === apiResult.truck_count,
                motorbike: dbResult.motorbike_count === apiResult.motorbike_count,
                bicycle: dbResult.bicycle_count === apiResult.bicycle_count
            };

            console.log(`   Car: ${matches.car ? '✅' : '❌'} (DB: ${dbResult.car_count}, API: ${apiResult.car_count})`);
            console.log(`   Bus: ${matches.bus ? '✅' : '❌'} (DB: ${dbResult.bus_count}, API: ${apiResult.bus_count})`);
            console.log(`   Truck: ${matches.truck ? '✅' : '❌'} (DB: ${dbResult.truck_count}, API: ${apiResult.truck_count})`);
            console.log(`   Motorbike: ${matches.motorbike ? '✅' : '❌'} (DB: ${dbResult.motorbike_count}, API: ${apiResult.motorbike_count})`);
            console.log(`   Bicycle: ${matches.bicycle ? '✅' : '❌'} (DB: ${dbResult.bicycle_count}, API: ${apiResult.bicycle_count})`);

            const allMatch = Object.values(matches).every(v => v === true);
            if (allMatch) {
                console.log('\n   ✅ All vehicle counts match!');
            } else {
                console.log('\n   ❌ Vehicle counts do not match!');
            }
        }

    } catch (error) {
        console.error('❌ Error testing vehicle API:', error);
    } finally {
        await pool.end();
    }
}

testVehicleAPI();

