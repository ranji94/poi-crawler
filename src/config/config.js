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
  // Types of places to search for
  placesToSearch: [
    'bus_station',     // Bus stops
    'train_station',   // Train stations
    'transit_station', // General transit stops (including trams)
    'subway_station',  // Metro stations
    'light_rail_station', // Light rail stations
    'airport',         // Airports
    'park',            // Parks
    'natural_feature', // Natural features (may include forests, reserves)
    'shopping_mall',   // Shopping malls
    'supermarket',     // Supermarkets
    'church',          // Churches
    'school',          // Schools (including elementary)
    'hospital',        // Hospitals
    'primary_school',  // Elementary schools
    'preschool',       // Preschools
    'day_care'         // Daycare centers
  ]
};

module.exports = config;