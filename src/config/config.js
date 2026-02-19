/**
 * Configuration settings for the application
 */

// Load environment variables
require('dotenv').config();

// Configuration object
const config = {
  // Google Maps API configuration
  googleMaps: {
    apiKey: process.env.GMAPS_API_KEY
  },
  // Server configuration
  server: {
    port: process.env.PORT || 15010
  },
  // Default search parameters
  search: {
    defaultRadiusKm: 20,
    defaultMode: 'walking'
  },
  // OpenStreetMap / Overpass API configuration
  osm: {
    endpoint: process.env.OSM_OVERPASS_ENDPOINT || 'https://overpass-api.de/api/interpreter',
    timeoutMs: parseInt(process.env.OSM_TIMEOUT_MS, 10) || 30000
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
