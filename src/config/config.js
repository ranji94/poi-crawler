/**
 * Configuration settings for the application
 * Includes settings for caching, retry, and API rate limits
 */

// Load environment variables
require('dotenv').config();

// Parse boolean environment variables
const parseBool = (value, defaultValue = false) => {
  if (value === undefined || value === null) return defaultValue;
  return ['true', '1', 'yes'].includes(value.toLowerCase());
};

// Configuration object
const config = {
  // Google Maps API configuration
  googleMaps: {
    apiKey: process.env.GMAPS_API_KEY,
    // Requests-per-minute limits to avoid hitting rate limits
    rateLimit: {
      placesApi: parseInt(process.env.GMAPS_PLACES_RATE_LIMIT, 10) || 150,  // Legacy Places API limit
      distanceApi: parseInt(process.env.GMAPS_DISTANCE_RATE_LIMIT, 10) || 500 // Distance Matrix API limit
    }
  },
  
  // Server configuration
  server: {
    port: process.env.PORT || 15010
  },
  
  // Default search parameters
  search: {
    defaultRadiusKm: 5,  // Changed from 20km to 5km as default
    minRadiusKm: 1,      // Minimum allowed radius
    maxRadiusKm: 10,     // Maximum allowed radius
    defaultMode: 'walking',
    // Skip extra API calls to reduce costs
    skipExtraCalls: parseBool(process.env.NO_EXTRA_CALLS, false)
  },
  
  // OpenStreetMap / Overpass API configuration
  osm: {
    endpoint: process.env.OSM_OVERPASS_ENDPOINT || 'https://overpass-api.de/api/interpreter',
    timeoutMs: parseInt(process.env.OSM_TIMEOUT_MS, 10) || 30000,
    // Alternative endpoints for fallback
    fallbackEndpoints: [
      'https://overpass.kumi.systems/api/interpreter',
      'https://maps.mail.ru/osm/tools/overpass/api/interpreter'
    ]
  },
  
  // Caching configuration
  cache: {
    enabled: parseBool(process.env.ENABLE_CACHE, true),
    // TTL values in milliseconds
    ttl: {
      places: parseInt(process.env.CACHE_PLACES_TTL_MINS, 10) * 60 * 1000 || 24 * 60 * 60 * 1000, // Default: 24h
      distance: parseInt(process.env.CACHE_DISTANCE_TTL_MINS, 10) * 60 * 1000 || 6 * 60 * 60 * 1000, // Default: 6h
      osm: parseInt(process.env.CACHE_OSM_TTL_MINS, 10) * 60 * 1000 || 24 * 60 * 60 * 1000 // Default: 24h
    }
  },
  
  // Retry configuration
  retry: {
    maxAttempts: parseInt(process.env.MAX_RETRY_ATTEMPTS, 10) || 3,
    backoffMs: parseInt(process.env.RETRY_BACKOFF_MS, 10) || 1000
  },
  
  // Transit stop types (used by both Google Maps and OSM services)
  transitTypes: [
    'bus_station',
    'train_station',
    'transit_station',
    'subway_station',
    'light_rail_station'
  ],
  
  // Types of places to search for (Google Maps)
  placesToSearch: [
    'bus_station',        // Bus stops
    'train_station',      // Train stations
    'transit_station',    // General transit stops (including trams)
    'subway_station',     // Metro stations
    'light_rail_station', // Light rail stations
    'park',               // Parks
    'natural_feature',    // Natural features (may include forests, reserves)
    'shopping_mall',      // Shopping malls
    'supermarket',        // Supermarkets
    'school',             // Schools (including elementary)
    'hospital',           // Hospitals
    'primary_school',     // Elementary schools
    'preschool',          // Preschools
    'day_care'            // Daycare centers
  ]
};

module.exports = config;
