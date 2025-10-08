#!/usr/bin/env node

/**
 * GeoNames API Integration Script
 * Fetches missing city data from GeoNames API and updates the database
 */

require('dotenv').config();
const { Pool } = require('pg');

class GeoNamesAPI {
    constructor(options = {}) {
        this.pool = new Pool({
            connectionString: process.env.DATABASE_URL,
        });
        
        // GeoNames API configuration
        this.baseUrl = 'http://api.geonames.org';
        this.username = process.env.GEONAMES_USERNAME || 'demo'; // Default demo username
        this.rateLimitDelay = 1000; // 1 second between requests to respect API limits
        this.maxRetries = 3;
        
        // Configuration options
        this.forceUpdate = options.forceUpdate || false; // Force update even if only optional data missing
        this.verbose = options.verbose || false;
        
        this.updatedCities = [];
        this.failedCities = [];
        this.skippedCities = [];
    }

    /**
     * Get cities with missing data that need to be updated
     */
    async getCitiesNeedingUpdate() {
        let query;
        
        if (this.forceUpdate) {
            query = `
                SELECT id, city, state, country, iso3, continent, latitude, longitude,
                       gmp, population_city, population_country, traffic_mortality,
                       literacy_rate, avg_height, med_age, gini
                FROM cities 
                WHERE 
                    country IS NULL OR country = '' OR 
                    latitude IS NULL OR longitude IS NULL OR
                    continent IS NULL OR continent = '' OR continent = 'Unknown' OR
                    state IS NULL OR state = '' OR
                    iso3 IS NULL OR iso3 = '' OR
                    population_city IS NULL OR 
                    traffic_mortality IS NULL OR
                    literacy_rate IS NULL OR
                    avg_height IS NULL OR
                    med_age IS NULL OR
                    gini IS NULL OR
                    gmp IS NULL OR
                    population_country IS NULL
                ORDER BY city, country
            `;
        } else {
            query = `
                SELECT id, city, state, country, iso3, continent, latitude, longitude,
                       gmp, population_city, population_country, traffic_mortality,
                       literacy_rate, avg_height, med_age, gini
                FROM cities 
                WHERE 
                    -- Missing critical location data
                    (country IS NULL OR country = '' OR 
                     latitude IS NULL OR longitude IS NULL OR
                     continent IS NULL OR continent = '' OR continent = 'Unknown') OR
                    -- Missing demographic data (optional but useful)
                    (population_city IS NULL OR 
                     traffic_mortality IS NULL OR
                     literacy_rate IS NULL OR
                     avg_height IS NULL OR
                     med_age IS NULL OR
                     gini IS NULL)
                ORDER BY city, country
            `;
        }
        
        const result = await this.pool.query(query);
        return result.rows;
    }

    /**
     * Search for city data using GeoNames API
     */
    async searchCityData(cityName, stateName = null, countryName = null) {
        const searchTerms = [cityName];
        if (stateName && stateName.trim() && stateName !== 'Unknown') searchTerms.push(stateName);
        if (countryName && countryName.trim() && countryName !== 'Unknown') searchTerms.push(countryName);
        
        const query = searchTerms.join(' ');
        const url = `${this.baseUrl}/searchJSON?q=${encodeURIComponent(query)}&maxRows=10&username=${this.username}`;
        
        try {
            console.log(`🔍 Searching GeoNames for: ${query}`);
            
            const response = await fetch(url);
            if (!response.ok) {
                throw new Error(`HTTP ${response.status}: ${response.statusText}`);
            }
            
            const data = await response.json();
            return this.parseGeoNamesResponse(data, cityName);
            
        } catch (error) {
            console.error(`❌ Error searching for ${cityName}:`, error.message);
            return null;
        }
    }

    /**
     * Parse GeoNames API response and find the best match
     */
    parseGeoNamesResponse(data, originalCityName) {
        if (!data.geonames || data.geonames.length === 0) {
            console.log(`⚠️  No results found for ${originalCityName}`);
            return null;
        }

        // Filter results to prioritize cities (feature codes: P.PPL, P.PPLA, P.PPLA2, etc.)
        const cityResults = data.geonames.filter(place => 
            place.fcode && place.fcode.startsWith('P.PPL')
        );

        // If no city results, use all results
        const results = cityResults.length > 0 ? cityResults : data.geonames;

        // Find best match by name similarity
        const bestMatch = this.findBestMatch(results, originalCityName);
        
        if (bestMatch) {
            console.log(`✅ Found match: ${bestMatch.name}, ${bestMatch.countryName} (${bestMatch.fcode})`);
            return this.formatGeoNamesData(bestMatch);
        }

        console.log(`⚠️  No good match found for ${originalCityName}`);
        return null;
    }

    /**
     * Find the best matching city from GeoNames results
     */
    findBestMatch(results, originalCityName) {
        const normalizedOriginal = originalCityName.toLowerCase().trim();
        
        // Score each result based on name similarity and feature code
        const scoredResults = results.map(result => {
            const normalizedResult = result.name.toLowerCase().trim();
            let score = 0;
            
            // Exact match gets highest score
            if (normalizedResult === normalizedOriginal) {
                score += 100;
            }
            // Partial match gets medium score
            else if (normalizedResult.includes(normalizedOriginal) || normalizedOriginal.includes(normalizedResult)) {
                score += 50;
            }
            // Similarity score
            else {
                score += this.calculateSimilarity(normalizedOriginal, normalizedResult) * 30;
            }
            
            // Boost score for more specific city codes
            if (result.fcode === 'P.PPLA') score += 20; // Admin division seat
            else if (result.fcode === 'P.PPLA2') score += 15; // Second-order admin division seat
            else if (result.fcode === 'P.PPL') score += 10; // Populated place
            
            return { ...result, score };
        });

        // Return highest scoring result
        scoredResults.sort((a, b) => b.score - a.score);
        return scoredResults[0].score > 30 ? scoredResults[0] : null;
    }

    /**
     * Calculate string similarity using Levenshtein distance
     */
    calculateSimilarity(str1, str2) {
        const matrix = [];
        const len1 = str1.length;
        const len2 = str2.length;

        for (let i = 0; i <= len2; i++) {
            matrix[i] = [i];
        }

        for (let j = 0; j <= len1; j++) {
            matrix[0][j] = j;
        }

        for (let i = 1; i <= len2; i++) {
            for (let j = 1; j <= len1; j++) {
                if (str2.charAt(i - 1) === str1.charAt(j - 1)) {
                    matrix[i][j] = matrix[i - 1][j - 1];
                } else {
                    matrix[i][j] = Math.min(
                        matrix[i - 1][j - 1] + 1,
                        matrix[i][j - 1] + 1,
                        matrix[i - 1][j] + 1
                    );
                }
            }
        }

        const maxLen = Math.max(len1, len2);
        return maxLen === 0 ? 1 : (maxLen - matrix[len2][len1]) / maxLen;
    }

    /**
     * Format GeoNames data to match our database schema
     */
    formatGeoNamesData(geoData) {
        // Convert 2-letter country code to 3-letter code
        const iso3Code = this.convertCountryCode(geoData.countryCode);
        
        return {
            city: geoData.name,
            state: geoData.adminName1 || null,
            country: geoData.countryName,
            iso3: iso3Code,
            continent: this.getContinentFromCountryCode(iso3Code),
            latitude: parseFloat(geoData.lat),
            longitude: parseFloat(geoData.lng),
            population_city: geoData.population ? parseInt(geoData.population) : null,
            // Note: Other demographic data (gmp, traffic_mortality, etc.) 
            // would need additional API calls or external data sources
        };
    }

    /**
     * Convert 2-letter country code to 3-letter ISO code
     */
    convertCountryCode(countryCode) {
        const codeMap = {
            'AD': 'AND', 'AE': 'ARE', 'AF': 'AFG', 'AG': 'ATG', 'AI': 'AIA', 'AL': 'ALB', 'AM': 'ARM',
            'AO': 'AGO', 'AQ': 'ATA', 'AR': 'ARG', 'AS': 'ASM', 'AT': 'AUT', 'AU': 'AUS', 'AW': 'ABW',
            'AX': 'ALA', 'AZ': 'AZE', 'BA': 'BIH', 'BB': 'BRB', 'BD': 'BGD', 'BE': 'BEL', 'BF': 'BFA',
            'BG': 'BGR', 'BH': 'BHR', 'BI': 'BDI', 'BJ': 'BEN', 'BL': 'BLM', 'BM': 'BMU', 'BN': 'BRN',
            'BO': 'BOL', 'BQ': 'BES', 'BR': 'BRA', 'BS': 'BHS', 'BT': 'BTN', 'BV': 'BVT', 'BW': 'BWA',
            'BY': 'BLR', 'BZ': 'BLZ', 'CA': 'CAN', 'CC': 'CCK', 'CD': 'COD', 'CF': 'CAF', 'CG': 'COG',
            'CH': 'CHE', 'CI': 'CIV', 'CK': 'COK', 'CL': 'CHL', 'CM': 'CMR', 'CN': 'CHN', 'CO': 'COL',
            'CR': 'CRI', 'CU': 'CUB', 'CV': 'CPV', 'CW': 'CUW', 'CX': 'CXR', 'CY': 'CYP', 'CZ': 'CZE',
            'DE': 'DEU', 'DJ': 'DJI', 'DK': 'DNK', 'DM': 'DMA', 'DO': 'DOM', 'DZ': 'DZA', 'EC': 'ECU',
            'EE': 'EST', 'EG': 'EGY', 'EH': 'ESH', 'ER': 'ERI', 'ES': 'ESP', 'ET': 'ETH', 'FI': 'FIN',
            'FJ': 'FJI', 'FK': 'FLK', 'FM': 'FSM', 'FO': 'FRO', 'FR': 'FRA', 'GA': 'GAB', 'GB': 'GBR',
            'GD': 'GRD', 'GE': 'GEO', 'GF': 'GUF', 'GG': 'GGY', 'GH': 'GHA', 'GI': 'GIB', 'GL': 'GRL',
            'GM': 'GMB', 'GN': 'GIN', 'GP': 'GLP', 'GQ': 'GNQ', 'GR': 'GRC', 'GS': 'SGS', 'GT': 'GTM',
            'GU': 'GUM', 'GW': 'GNB', 'GY': 'GUY', 'HK': 'HKG', 'HM': 'HMD', 'HN': 'HND', 'HR': 'HRV',
            'HT': 'HTI', 'HU': 'HUN', 'ID': 'IDN', 'IE': 'IRL', 'IL': 'ISR', 'IM': 'IMN', 'IN': 'IND',
            'IO': 'IOT', 'IQ': 'IRQ', 'IR': 'IRN', 'IS': 'ISL', 'IT': 'ITA', 'JE': 'JEY', 'JM': 'JAM',
            'JO': 'JOR', 'JP': 'JPN', 'KE': 'KEN', 'KG': 'KGZ', 'KH': 'KHM', 'KI': 'KIR', 'KM': 'COM',
            'KN': 'KNA', 'KP': 'PRK', 'KR': 'KOR', 'KW': 'KWT', 'KY': 'CYM', 'KZ': 'KAZ', 'LA': 'LAO',
            'LB': 'LBN', 'LC': 'LCA', 'LI': 'LIE', 'LK': 'LKA', 'LR': 'LBR', 'LS': 'LSO', 'LT': 'LTU',
            'LU': 'LUX', 'LV': 'LVA', 'LY': 'LBY', 'MA': 'MAR', 'MC': 'MCO', 'MD': 'MDA', 'ME': 'MNE',
            'MF': 'MAF', 'MG': 'MDG', 'MH': 'MHL', 'MK': 'MKD', 'ML': 'MLI', 'MM': 'MMR', 'MN': 'MNG',
            'MO': 'MAC', 'MP': 'MNP', 'MQ': 'MTQ', 'MR': 'MRT', 'MS': 'MSR', 'MT': 'MLT', 'MU': 'MUS',
            'MV': 'MDV', 'MW': 'MWI', 'MX': 'MEX', 'MY': 'MYS', 'MZ': 'MOZ', 'NA': 'NAM', 'NC': 'NCL',
            'NE': 'NER', 'NF': 'NFK', 'NG': 'NGA', 'NI': 'NIC', 'NL': 'NLD', 'NO': 'NOR', 'NP': 'NPL',
            'NR': 'NRU', 'NU': 'NIU', 'NZ': 'NZL', 'OM': 'OMN', 'PA': 'PAN', 'PE': 'PER', 'PF': 'PYF',
            'PG': 'PNG', 'PH': 'PHL', 'PK': 'PAK', 'PL': 'POL', 'PM': 'SPM', 'PN': 'PCN', 'PR': 'PRI',
            'PS': 'PSE', 'PT': 'PRT', 'PW': 'PLW', 'PY': 'PRY', 'QA': 'QAT', 'RE': 'REU', 'RO': 'ROU',
            'RS': 'SRB', 'RU': 'RUS', 'RW': 'RWA', 'SA': 'SAU', 'SB': 'SLB', 'SC': 'SYC', 'SD': 'SDN',
            'SE': 'SWE', 'SG': 'SGP', 'SH': 'SHN', 'SI': 'SVN', 'SJ': 'SJM', 'SK': 'SVK', 'SL': 'SLE',
            'SM': 'SMR', 'SN': 'SEN', 'SO': 'SOM', 'SR': 'SUR', 'SS': 'SSD', 'ST': 'STP', 'SV': 'SLV',
            'SX': 'SXM', 'SY': 'SYR', 'SZ': 'SWZ', 'TC': 'TCA', 'TD': 'TCD', 'TF': 'ATF', 'TG': 'TGO',
            'TH': 'THA', 'TJ': 'TJK', 'TK': 'TKL', 'TL': 'TLS', 'TM': 'TKM', 'TN': 'TUN', 'TO': 'TON',
            'TR': 'TUR', 'TT': 'TTO', 'TV': 'TUV', 'TW': 'TWN', 'TZ': 'TZA', 'UA': 'UKR', 'UG': 'UGA',
            'UM': 'UMI', 'US': 'USA', 'UY': 'URY', 'UZ': 'UZB', 'VA': 'VAT', 'VC': 'VCT', 'VE': 'VEN',
            'VG': 'VGB', 'VI': 'VIR', 'VN': 'VNM', 'VU': 'VUT', 'WF': 'WLF', 'WS': 'WSM', 'YE': 'YEM',
            'YT': 'MYT', 'ZA': 'ZAF', 'ZM': 'ZMB', 'ZW': 'ZWE'
        };
        
        return codeMap[countryCode] || countryCode;
    }

    /**
     * Map country codes to continents
     */
    getContinentFromCountryCode(countryCode) {
        const continentMap = {
            // North America
            'USA': 'North America', 'CAN': 'North America', 'MEX': 'North America',
            // Europe
            'GBR': 'Europe', 'FRA': 'Europe', 'DEU': 'Europe', 'ITA': 'Europe',
            'ESP': 'Europe', 'NLD': 'Europe', 'BEL': 'Europe', 'CHE': 'Europe',
            'AUT': 'Europe', 'DNK': 'Europe', 'SWE': 'Europe', 'NOR': 'Europe',
            'FIN': 'Europe', 'POL': 'Europe', 'CZE': 'Europe', 'HUN': 'Europe',
            'ROU': 'Europe', 'BGR': 'Europe', 'GRC': 'Europe', 'PRT': 'Europe',
            'IRL': 'Europe', 'ISL': 'Europe', 'LUX': 'Europe', 'MCO': 'Europe',
            'LIE': 'Europe', 'SMR': 'Europe', 'VAT': 'Europe', 'AND': 'Europe',
            'MKD': 'Europe', 'ALB': 'Europe', 'BIH': 'Europe', 'SRB': 'Europe',
            'MNE': 'Europe', 'HRV': 'Europe', 'SVN': 'Europe', 'SVK': 'Europe',
            'LTU': 'Europe', 'LVA': 'Europe', 'EST': 'Europe', 'BLR': 'Europe',
            'UKR': 'Europe', 'MDA': 'Europe',
            // Asia
            'CHN': 'Asia', 'JPN': 'Asia', 'KOR': 'Asia', 'IND': 'Asia',
            'IDN': 'Asia', 'THA': 'Asia', 'VNM': 'Asia', 'PHL': 'Asia',
            'MYS': 'Asia', 'SGP': 'Asia', 'MMR': 'Asia', 'KHM': 'Asia',
            'LAO': 'Asia', 'BGD': 'Asia', 'PAK': 'Asia', 'AFG': 'Asia',
            'IRN': 'Asia', 'IRQ': 'Asia', 'SAU': 'Asia', 'ARE': 'Asia',
            'QAT': 'Asia', 'KWT': 'Asia', 'BHR': 'Asia', 'OMN': 'Asia',
            'YEM': 'Asia', 'JOR': 'Asia', 'LBN': 'Asia', 'SYR': 'Asia',
            'ISR': 'Asia', 'PSE': 'Asia', 'TUR': 'Asia', 'GEO': 'Asia',
            'ARM': 'Asia', 'AZE': 'Asia', 'KAZ': 'Asia', 'KGZ': 'Asia',
            'TJK': 'Asia', 'UZB': 'Asia', 'TKM': 'Asia', 'MNG': 'Asia',
            'NPL': 'Asia', 'BTN': 'Asia', 'MDV': 'Asia', 'LKA': 'Asia',
            // Africa
            'EGY': 'Africa', 'LBY': 'Africa', 'TUN': 'Africa', 'DZA': 'Africa',
            'MAR': 'Africa', 'SDN': 'Africa', 'SSD': 'Africa', 'ETH': 'Africa',
            'ERI': 'Africa', 'DJI': 'Africa', 'SOM': 'Africa', 'KEN': 'Africa',
            'UGA': 'Africa', 'TZA': 'Africa', 'RWA': 'Africa', 'BDI': 'Africa',
            'COD': 'Africa', 'CAF': 'Africa', 'TCD': 'Africa', 'CMR': 'Africa',
            'NGA': 'Africa', 'NER': 'Africa', 'BFA': 'Africa', 'MLI': 'Africa',
            'SEN': 'Africa', 'GMB': 'Africa', 'GIN': 'Africa', 'GNB': 'Africa',
            'SLE': 'Africa', 'LBR': 'Africa', 'CIV': 'Africa', 'GHA': 'Africa',
            'TGO': 'Africa', 'BEN': 'Africa', 'NGA': 'Africa', 'GAB': 'Africa',
            'GNQ': 'Africa', 'STP': 'Africa', 'AGO': 'Africa', 'ZMB': 'Africa',
            'ZWE': 'Africa', 'BWA': 'Africa', 'NAM': 'Africa', 'ZAF': 'Africa',
            'LSO': 'Africa', 'SWZ': 'Africa', 'MOZ': 'Africa', 'MDG': 'Africa',
            'MUS': 'Africa', 'SYC': 'Africa', 'COM': 'Africa', 'MYT': 'Africa',
            'REU': 'Africa', 'SHN': 'Africa', 'CPV': 'Africa', 'STP': 'Africa',
            // South America
            'BRA': 'South America', 'ARG': 'South America', 'CHL': 'South America',
            'PER': 'South America', 'COL': 'South America', 'VEN': 'South America',
            'ECU': 'South America', 'BOL': 'South America', 'PRY': 'South America',
            'URY': 'South America', 'GUY': 'South America', 'SUR': 'South America',
            'GUF': 'South America',
            // Oceania
            'AUS': 'Oceania', 'NZL': 'Oceania', 'PNG': 'Oceania', 'FJI': 'Oceania',
            'SLB': 'Oceania', 'VUT': 'Oceania', 'NCL': 'Oceania', 'PYF': 'Oceania',
            'WSM': 'Oceania', 'TON': 'Oceania', 'KIR': 'Oceania', 'TUV': 'Oceania',
            'NRU': 'Oceania', 'PLW': 'Oceania', 'FSM': 'Oceania', 'MHL': 'Oceania',
            'COK': 'Oceania', 'NIU': 'Oceania', 'TKL': 'Oceania', 'ASM': 'Oceania',
            'GUM': 'Oceania', 'MNP': 'Oceania', 'VIR': 'Oceania', 'PRI': 'Oceania'
        };
        
        return continentMap[countryCode] || 'Unknown';
    }

    /**
     * Update city data in the database
     */
    async updateCityData(cityId, geoData) {
        const query = `
            UPDATE cities SET
                state = COALESCE($1, state),
                country = COALESCE($2, country),
                iso3 = COALESCE($3, iso3),
                continent = $4,
                latitude = $5,
                longitude = $6,
                population_city = COALESCE($7, population_city),
                updated_at = CURRENT_TIMESTAMP
            WHERE id = $8
        `;
        
        const values = [
            geoData.state,
            geoData.country,
            geoData.iso3,
            geoData.continent,
            geoData.latitude,
            geoData.longitude,
            geoData.population_city,
            cityId
        ];
        
        if (this.verbose) {
            console.log(`   💾 Updating database with coordinates: lat=${geoData.latitude}, lng=${geoData.longitude}`);
        }
        
        await this.pool.query(query, values);
    }

    /**
     * Process all cities that need updates
     */
    async processCities() {
        console.log('🚀 Starting GeoNames API data update process...\n');
        
        if (this.forceUpdate) {
            console.log('⚠️  Force update mode enabled - processing ALL cities with missing data\n');
        }
        
        const citiesToUpdate = await this.getCitiesNeedingUpdate();
        console.log(`📊 Found ${citiesToUpdate.length} cities needing data updates\n`);
        
        if (citiesToUpdate.length === 0) {
            console.log('✅ No cities need updates. All data is complete!');
            return this.generateReport();
        }

        for (let i = 0; i < citiesToUpdate.length; i++) {
            const city = citiesToUpdate[i];
            console.log(`\n📍 Processing ${i + 1}/${citiesToUpdate.length}: ${city.city}, ${city.country || 'Unknown Country'}`);
            
            try {
                // Check what data is missing
                const missingData = this.getMissingData(city);
                console.log(`   Missing: ${missingData.join(', ')}`);
                
                // Skip if only optional demographic data is missing
                if (this.shouldSkipCity(missingData)) {
                    console.log(`   ⏭️  Skipping - only optional demographic data missing`);
                    this.skippedCities.push({ ...city, reason: 'Optional data only' });
                    continue;
                }
                
                // Search for city data
                const geoData = await this.searchCityData(city.city, city.state, city.country);
                
                if (geoData) {
                    // Update the database
                    await this.updateCityData(city.id, geoData);
                    console.log(`   ✅ Updated successfully`);
                    this.updatedCities.push({ 
                        original: city, 
                        updated: geoData,
                        missingData 
                    });
                } else {
                    console.log(`   ❌ No data found`);
                    this.failedCities.push({ 
                        ...city, 
                        missingData,
                        reason: 'No GeoNames match found' 
                    });
                }
                
                // Rate limiting
                if (i < citiesToUpdate.length - 1) {
                    await this.sleep(this.rateLimitDelay);
                }
                
            } catch (error) {
                console.error(`   ❌ Error processing ${city.city}:`, error.message);
                this.failedCities.push({ 
                    ...city, 
                    reason: `Error: ${error.message}` 
                });
            }
        }
        
        return this.generateReport();
    }

    /**
     * Determine what data is missing for a city
     */
    getMissingData(city) {
        const missing = [];
        
        if (!city.country || city.country.trim() === '') missing.push('country');
        if (!city.state || city.state.trim() === '') missing.push('state');
        if (!city.iso3 || city.iso3.trim() === '') missing.push('iso3');
        if (!city.continent || city.continent.trim() === '' || city.continent === 'Unknown') missing.push('continent');
        if (city.latitude === null || city.latitude === undefined) missing.push('latitude');
        if (city.longitude === null || city.longitude === undefined) missing.push('longitude');
        if (!city.population_city) missing.push('population_city');
        if (!city.traffic_mortality) missing.push('traffic_mortality');
        if (!city.literacy_rate) missing.push('literacy_rate');
        if (!city.avg_height) missing.push('avg_height');
        if (!city.med_age) missing.push('med_age');
        if (!city.gini) missing.push('gini');
        if (!city.gmp) missing.push('gmp');
        if (!city.population_country) missing.push('population_country');
        
        return missing;
    }

    /**
     * Determine if city should be skipped (only optional data missing)
     */
    shouldSkipCity(missingData) {
        if (this.forceUpdate) return false; // Don't skip if force update is enabled
        
        const criticalFields = ['country', 'latitude', 'longitude', 'continent'];
        const hasCriticalMissing = missingData.some(field => criticalFields.includes(field));
        return !hasCriticalMissing;
    }

    /**
     * Generate a comprehensive report
     */
    generateReport() {
        const report = {
            timestamp: new Date().toISOString(),
            summary: {
                totalProcessed: this.updatedCities.length + this.failedCities.length + this.skippedCities.length,
                updated: this.updatedCities.length,
                failed: this.failedCities.length,
                skipped: this.skippedCities.length
            },
            updatedCities: this.updatedCities,
            failedCities: this.failedCities,
            skippedCities: this.skippedCities
        };

        console.log('\n' + '='.repeat(60));
        console.log('📋 GEONAMES API UPDATE REPORT');
        console.log('='.repeat(60));
        console.log(`📅 Timestamp: ${report.timestamp}`);
        console.log(`📊 Total Processed: ${report.summary.totalProcessed}`);
        console.log(`✅ Successfully Updated: ${report.summary.updated}`);
        console.log(`❌ Failed: ${report.summary.failed}`);
        console.log(`⏭️  Skipped: ${report.summary.skipped}`);
        
        if (report.updatedCities.length > 0) {
            console.log('\n✅ UPDATED CITIES:');
            report.updatedCities.forEach((item, index) => {
                console.log(`   ${index + 1}. ${item.original.city} → ${item.updated.city}, ${item.updated.country}`);
                console.log(`      Added: ${item.missingData.join(', ')}`);
            });
        }
        
        if (report.failedCities.length > 0) {
            console.log('\n❌ FAILED CITIES:');
            report.failedCities.forEach((city, index) => {
                console.log(`   ${index + 1}. ${city.city}, ${city.country || 'Unknown'} - ${city.reason}`);
            });
        }
        
        if (report.skippedCities.length > 0) {
            console.log('\n⏭️  SKIPPED CITIES:');
            report.skippedCities.forEach((city, index) => {
                console.log(`   ${index + 1}. ${city.city}, ${city.country || 'Unknown'} - ${city.reason}`);
            });
        }
        
        console.log('\n' + '='.repeat(60));
        
        return report;
    }

    /**
     * Generate missing data report
     */
    async generateMissingDataReport() {
        console.log('📊 Generating missing data report...\n');
        
        const cities = await this.getCitiesNeedingUpdate();
        const report = {
            timestamp: new Date().toISOString(),
            totalCities: cities.length,
            missingDataBreakdown: {},
            citiesByMissingData: {}
        };
        
        // Analyze missing data patterns
        cities.forEach(city => {
            const missing = this.getMissingData(city);
            
            // Count missing data types
            missing.forEach(field => {
                report.missingDataBreakdown[field] = (report.missingDataBreakdown[field] || 0) + 1;
            });
            
            // Group cities by missing data
            const key = missing.sort().join(', ');
            if (!report.citiesByMissingData[key]) {
                report.citiesByMissingData[key] = [];
            }
            report.citiesByMissingData[key].push(city);
        });
        
        console.log('📋 MISSING DATA REPORT');
        console.log('='.repeat(50));
        console.log(`📅 Timestamp: ${report.timestamp}`);
        console.log(`🏙️  Cities with missing data: ${report.totalCities}`);
        
        console.log('\n📊 Missing Data Breakdown:');
        Object.entries(report.missingDataBreakdown)
            .sort(([,a], [,b]) => b - a)
            .forEach(([field, count]) => {
                console.log(`   ${field}: ${count} cities`);
            });
        
        console.log('\n🏙️  Cities by Missing Data Pattern:');
        Object.entries(report.citiesByMissingData)
            .sort(([,a], [,b]) => b.length - a.length)
            .forEach(([pattern, cities]) => {
                console.log(`\n   Missing: ${pattern} (${cities.length} cities)`);
                cities.forEach(city => {
                    console.log(`     - ${city.city}, ${city.country || 'Unknown'}`);
                });
            });
        
        return report;
    }

    /**
     * Sleep utility for rate limiting
     */
    sleep(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    /**
     * Close database connection
     */
    async close() {
        await this.pool.end();
    }
}

// CLI Interface
async function main() {
    const args = process.argv.slice(2);
    const command = args[0] || 'update';
    const forceUpdate = args.includes('--force');
    const verbose = args.includes('--verbose');
    
    const geoNamesAPI = new GeoNamesAPI({ forceUpdate, verbose });
    
    try {
        switch (command) {
            case 'update':
                await geoNamesAPI.processCities();
                break;
            case 'report':
                await geoNamesAPI.generateMissingDataReport();
                break;
            case 'help':
                console.log('GeoNames API Integration Script');
                console.log('Usage: node geonames-api.js [command] [options]');
                console.log('');
                console.log('Commands:');
                console.log('  update  - Update cities with missing data (default)');
                console.log('  report  - Generate missing data report');
                console.log('  help    - Show this help message');
                console.log('');
                console.log('Options:');
                console.log('  --force   - Force update even if only optional data missing');
                console.log('  --verbose - Show detailed logging');
                break;
            default:
                console.log(`Unknown command: ${command}`);
                console.log('Run "node geonames-api.js help" for usage information');
        }
    } catch (error) {
        console.error('❌ Error:', error.message);
        process.exit(1);
    } finally {
        await geoNamesAPI.close();
    }
}

// Run if called directly
if (require.main === module) {
    main();
}

module.exports = GeoNamesAPI;
