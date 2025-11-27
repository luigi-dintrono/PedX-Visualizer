#!/usr/bin/env node

const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    client_encoding: 'UTF8',
});

async function checkVehicleData() {
    console.log('🔍 Checking vehicle data in the database...\n');

    try {
        await pool.query("SET client_encoding TO 'UTF8'");

        // Check if vehicle columns have any data
        const vehicleCheck = await pool.query(`
            SELECT 
                COUNT(*) as total_pedestrians,
                COUNT(*) FILTER (WHERE car IS TRUE OR car::int = 1) as pedestrians_with_car,
                COUNT(*) FILTER (WHERE bus IS TRUE OR bus::int = 1) as pedestrians_with_bus,
                COUNT(*) FILTER (WHERE truck IS TRUE OR truck::int = 1) as pedestrians_with_truck,
                COUNT(*) FILTER (WHERE motorbike IS TRUE OR motorbike::int = 1) as pedestrians_with_motorbike,
                COUNT(*) FILTER (WHERE bicycle IS TRUE OR bicycle::int = 1) as pedestrians_with_bicycle,
                COUNT(*) FILTER (WHERE car IS NULL AND bus IS NULL AND truck IS NULL AND motorbike IS NULL AND bicycle IS NULL) as pedestrians_with_null_vehicles
            FROM pedestrians
        `);

        const stats = vehicleCheck.rows[0];
        console.log('📊 Vehicle Data Statistics:');
        console.log(`  Total pedestrians: ${stats.total_pedestrians}`);
        console.log(`  Pedestrians with car: ${stats.pedestrians_with_car} (${((stats.pedestrians_with_car / stats.total_pedestrians) * 100).toFixed(2)}%)`);
        console.log(`  Pedestrians with bus: ${stats.pedestrians_with_bus} (${((stats.pedestrians_with_bus / stats.total_pedestrians) * 100).toFixed(2)}%)`);
        console.log(`  Pedestrians with truck: ${stats.pedestrians_with_truck} (${((stats.pedestrians_with_truck / stats.total_pedestrians) * 100).toFixed(2)}%)`);
        console.log(`  Pedestrians with motorbike: ${stats.pedestrians_with_motorbike} (${((stats.pedestrians_with_motorbike / stats.total_pedestrians) * 100).toFixed(2)}%)`);
        console.log(`  Pedestrians with bicycle: ${stats.pedestrians_with_bicycle} (${((stats.pedestrians_with_bicycle / stats.total_pedestrians) * 100).toFixed(2)}%)`);
        console.log(`  Pedestrians with NULL vehicles: ${stats.pedestrians_with_null_vehicles} (${((stats.pedestrians_with_null_vehicles / stats.total_pedestrians) * 100).toFixed(2)}%)\n`);

        // Check vehicle counts per city (what the CTE calculates)
        const cityVehicleCounts = await pool.query(`
            WITH city_vehicle_counts AS (
                SELECT 
                    c.id,
                    c.city,
                    COUNT(*) FILTER (WHERE (p.car IS TRUE OR p.car::int = 1)) as car_count,
                    COUNT(*) FILTER (WHERE (p.bus IS TRUE OR p.bus::int = 1)) as bus_count,
                    COUNT(*) FILTER (WHERE (p.truck IS TRUE OR p.truck::int = 1)) as truck_count,
                    COUNT(*) FILTER (WHERE (p.motorbike IS TRUE OR p.motorbike::int = 1)) as motorbike_count,
                    COUNT(*) FILTER (WHERE (p.bicycle IS TRUE OR p.bicycle::int = 1)) as bicycle_count
                FROM cities c
                LEFT JOIN videos v ON c.id = v.city_id
                LEFT JOIN pedestrians p ON v.id = p.video_id
                GROUP BY c.id, c.city
            )
            SELECT 
                city,
                car_count,
                bus_count,
                truck_count,
                motorbike_count,
                bicycle_count
            FROM city_vehicle_counts
            WHERE car_count > 0 OR bus_count > 0 OR truck_count > 0 OR motorbike_count > 0 OR bicycle_count > 0
            ORDER BY car_count DESC
            LIMIT 10
        `);

        console.log('🏙️  Top 10 Cities by Vehicle Counts:');
        if (cityVehicleCounts.rows.length === 0) {
            console.log('  ⚠️  No cities found with vehicle data!');
        } else {
            cityVehicleCounts.rows.forEach((row, idx) => {
                console.log(`  ${idx + 1}. ${row.city}: Car=${row.car_count}, Bus=${row.bus_count}, Truck=${row.truck_count}, Motorbike=${row.motorbike_count}, Bicycle=${row.bicycle_count}`);
            });
        }

        // Test the actual query that the API uses
        console.log('\n🧪 Testing API Query with vehicle filters (car: 0-500, bus: 0-100):');
        const testQuery = await pool.query(`
            WITH city_vehicle_counts AS (
                SELECT 
                    c.id,
                    COUNT(*) FILTER (WHERE (p.car IS TRUE OR p.car::int = 1)) as car_count,
                    COUNT(*) FILTER (WHERE (p.bus IS TRUE OR p.bus::int = 1)) as bus_count,
                    COUNT(*) FILTER (WHERE (p.truck IS TRUE OR p.truck::int = 1)) as truck_count,
                    COUNT(*) FILTER (WHERE (p.motorbike IS TRUE OR p.motorbike::int = 1)) as motorbike_count,
                    COUNT(*) FILTER (WHERE (p.bicycle IS TRUE OR p.bicycle::int = 1)) as bicycle_count
                FROM cities c
                LEFT JOIN videos v ON c.id = v.city_id
                LEFT JOIN pedestrians p ON v.id = p.video_id
                GROUP BY c.id
            )
            SELECT 
                vcs.id, vcs.city, vcs.country,
                cvc.car_count,
                cvc.bus_count,
                cvc.truck_count,
                cvc.motorbike_count,
                cvc.bicycle_count
            FROM v_city_summary vcs
            INNER JOIN city_vehicle_counts cvc ON vcs.id = cvc.id
            WHERE vcs.latitude IS NOT NULL AND vcs.longitude IS NOT NULL
                AND cvc.car_count >= 0
                AND cvc.car_count <= 500
                AND cvc.bus_count >= 0
                AND cvc.bus_count <= 100
            ORDER BY vcs.city
            LIMIT 5
        `);

        console.log(`  Found ${testQuery.rows.length} cities matching the filter`);
        if (testQuery.rows.length > 0) {
            testQuery.rows.forEach(row => {
                console.log(`    - ${row.city}, ${row.country}: Car=${row.car_count}, Bus=${row.bus_count}`);
            });
        }

    } catch (error) {
        console.error('❌ Error checking vehicle data:', error);
    } finally {
        await pool.end();
    }
}

checkVehicleData();

