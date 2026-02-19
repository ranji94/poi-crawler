const { Client } = require("@googlemaps/google-maps-services-js");
const config = require("../config/config");
const cache = require("../utils/cache");
const { calculateHaversineDistance } = require("../utils/distance");
const { googleMapsThrottler } = require("../utils/throttle");
const { withRetry, getGoogleMapsRetryConfig } = require('../utils/retry');

const client = new Client({});

// Cache TTLs
const PLACES_CACHE_TTL = 24 * 60 * 60 * 1000; // 24 hours

// Cache keys
const PLACE_DETAILS_CACHE_KEY = "place-details";
const DISTANCE_MATRIX_CACHE_KEY = "distance-matrix";

// Constants for error handling
const MAX_ORIGINS_PER_REQUEST = 25;       // Google Maps API limit for distance matrix
const MAX_DESTINATIONS_PER_REQUEST = 25;  // Google Maps API limit for distance matrix
const MAX_ELEMENTS_PER_REQUEST = 100;     // Reduced from Google's 625 to avoid rate limits
const MAX_REQUESTS_PER_MINUTE = 40;       // Conservative limit (Google allows 100/min for Distance Matrix)

/**
 * Safely fetches place details from Google Maps API with caching
 * @param {string} placeId - Google Place ID
 * @returns {Promise<Object>} Place details or null on error
 */
/**
 * Get nearby places from Google Maps (Places API)
 * Uses caching, throttling, and retry logic for resilience.
 * Implementation follows Google Maps Legacy Places API requirements.
 * 
 * @param {Object} params - Search parameters
 * @param {number} params.lat - Latitude
 * @param {number} params.lon - Longitude
 * @param {number} params.radius - Search radius in kilometers
 * @param {string} params.mode - Transport mode (walking, driving, bicycling, transit)
 * @returns {Promise<Array>} - Array of normalized place objects (without distance info)
 */
async function getNearbyPlacesGoogle(params) {
  const lat = params.lat;
  const lon = params.lon;
  const radiusKm = params.radius || config.search.defaultRadiusKm;
  const radiusMeters = radiusKm * 1000;

  const origin = { lat: parseFloat(lat), lng: parseFloat(lon) };

  console.log(`🌍 Google Maps – coordinates: lat: ${origin.lat}, lng: ${origin.lng}`);
  console.log(`🔍 Search radius: ${radiusKm} km`);

  if (!config.googleMaps.apiKey) {
    console.warn('⚠️  GMAPS_API_KEY not set – skipping Google Maps search.');
    return [];
  }

  try {
    console.log('🔍 Searching for nearby places via Google Maps...');

    // Check cache first
    const cacheKey = cache.generateCacheKey('google-places', {
      lat: origin.lat,
      lng: origin.lng,
      radius: radiusMeters
    });
    
    const cachedPlaces = cache.get(cacheKey);
    if (cachedPlaces) {
      console.log(`📍 Google Maps: found ${cachedPlaces.length} places (from cache).`);
      return cachedPlaces;
    }

    // One request per place type (Legacy Places API)
    // Use throttling to avoid rate limits
    const searchPromises = config.placesToSearch.map(type => 
      googleMapsThrottler.throttlePlacesRequest(() => 
        withRetry(
          async () => client.placesNearby({
            params: {
              location: origin,
              radius: radiusMeters,
              type: type,
              key: config.googleMaps.apiKey,
            }
          }),
          getGoogleMapsRetryConfig()
        ).catch(error => {
          // After retries, still failed - log and return empty results
          console.error(`❌ Google Maps error for type ${type}: ${
            error.response?.data?.error_message || error.message}`);
          return { data: { results: [] } };
        })
      )
    );

    // Wait for all requests to complete
    const responses = await Promise.all(searchPromises);

    let places = [];
    responses.forEach((res, index) => {
      if (res.data && res.data.results && res.data.results.length > 0) {
        const found = res.data.results.slice(0, 3).map(place => ({
          id: place.place_id,
          name: place.name,
          type: config.placesToSearch[index],
          location: place.geometry.location,
          vicinity: place.vicinity,
          source: 'google'
        }));

        const filtered = found.filter(place => {
          const educationalTypes = ['school', 'primary_school', 'preschool', 'day_care'];
          if (place.type === 'hospital' || educationalTypes.includes(place.type)) {
            return require('../utils/place').isPublicFacility(place);
          }
          return true;
        });

        places = places.concat(filtered);
      }
    });

    // Cache the results
    cache.set(cacheKey, places, PLACES_CACHE_TTL);

    console.log(`📍 Google Maps: found ${places.length} places.`);
    return places;

  } catch (error) {
    console.error('❌ Google Maps search failed:', error.response ? error.response.data : error.message);
    return [];
  }
}

/**
 * Safely fetches place details from Google Maps API with caching
 * @param {string} placeId - Google Place ID
 * @returns {Promise<Object>} Place details or null on error
 */
const getPlaceDetails = async (placeId) => {
  const cacheKey = `${PLACE_DETAILS_CACHE_KEY}-${placeId}`;
  
  // Check cache first
  const cachedData = cache.get(cacheKey);
  if (cachedData) {
    console.log(`🔄 Using cached place details for ${placeId}`);
    return cachedData;
  }

  try {
    // Request throttled to prevent rate limiting
    const response = await throttle(() => 
      client.placeDetails({
        params: {
          place_id: placeId,
          key: process.env.GMAPS_API_KEY,
          fields: ["name", "formatted_address", "geometry", "type"],
        },
        timeout: 5000, // 5 seconds timeout
      })
    );

    if (response.data.status === "OK") {
      const placeData = response.data.result;
      // Cache the result
      cache.set(cacheKey, placeData);
      return placeData;
    } else {
      console.error(`❌ Place Details API failed: ${response.data.status} for place ID ${placeId}`);
      return null;
    }
  } catch (error) {
    // If it's a 4xx or 5xx error, log and return null without retrying
    if (error.response && (error.response.status >= 400)) {
      console.error(`❌ Place Details API error: ${error.message} for place ID ${placeId}`);
      return null;
    }
    // For network errors or timeouts, log the error
    console.error(`❌ Place Details API error: ${error.message} for place ID ${placeId}`);
    return null;
  }
};

/**
 * Enriches places with distance information using either Distance Matrix API or Haversine
 * Helper function wrapper for controllers to use
 * @param {Object} origin - Origin coordinates {lat, lng}
 * @param {Array} places - Array of places with location property
 * @param {string} travelMode - Mode of travel (driving, walking, etc)
 * @returns {Promise<Array>} Places with added distance information
 */
const enrichWithDistances = async (origin, places, travelMode) => {
  if (places.length === 0) return [];
  
  // Check if we should even attempt the Distance Matrix API
  // If too many places (>100), use Haversine for all to save costs and avoid rate limits
  if (places.length > 100) {
    console.log(`⚠️ Too many places (${places.length} > 100) - using Haversine for all to avoid rate limits`);
    return places.map(place => {
      if (place.location) {
        const distanceText = require('../utils/distance').calculateHaversineDistance(
          origin.lat, origin.lng,
          place.location.lat, place.location.lng
        );
        
        const distanceInKm = require('../utils/distance').getDistanceInKm(distanceText);
        const timeText = require('../utils/distance').calculateTransitTime(distanceInKm, travelMode);
        
        return {
          ...place,
          distance: `${distanceText} (przybliżone)`,
          duration: `${timeText} (przybliżone)`,
          durationValue: distanceInKm * 60 // Very rough estimate: 1 minute per km
        };
      }
      return { ...place, distance: 'N/A', duration: 'N/A', durationValue: 999999 };
    });
  }
  
  try {
    // Format data for the distance matrix calculation
    const origins = [origin];
    const destinations = places.map(p => p.location);
    
    // Get distance matrix data
    const distanceMatrix = await getDistanceMatrix(origins, destinations);
    
    // No need to check if distanceMatrix exists, as getDistanceMatrix always returns a matrix
    // (using Haversine as fallback)
    const matrixRow = distanceMatrix[0]; // We only have one origin
    
    // Map the matrix results back to places
    return places.map((place, idx) => {
      if (matrixRow[idx]) {
        const { distance, duration } = matrixRow[idx];
        
        // Convert meters to km and format for display
        const distanceInKm = distance / 1000;
        const distanceText = distanceInKm < 1 
          ? `${Math.round(distance)} m` 
          : `${distanceInKm.toFixed(1)} km`;
        
        // Convert seconds to minutes/hours for display
        const durationMins = Math.round(duration / 60);
        const durationText = durationMins < 60 
          ? `${durationMins} mins` 
          : `${Math.floor(durationMins / 60)} hr ${durationMins % 60} mins`;
        
        return {
          ...place,
          distance: distanceText,
          duration: durationText,
          durationValue: duration
        };
      }
      
      // Fallback to Haversine if missing or null in matrix
      if (place.location) {
        const distanceText = require('../utils/distance').calculateHaversineDistance(
          origin.lat, origin.lng,
          place.location.lat, place.location.lng
        );
        
        const distanceInKm = require('../utils/distance').getDistanceInKm(distanceText);
        const timeText = require('../utils/distance').calculateTransitTime(distanceInKm, travelMode);
        
        return {
          ...place,
          distance: `${distanceText} (przybliżone)`,
          duration: `${timeText} (przybliżone)`,
          durationValue: distanceInKm * 60 // Very rough estimate: 1 minute per km
        };
      }
      
      return { ...place, distance: 'N/A', duration: 'N/A', durationValue: 999999 };
    });
  } catch (error) {
    console.error(`❌ Error in enrichWithDistances: ${error.message}`);
    
    // If anything fails, fall back to Haversine for all places
    return places.map(place => {
      if (place.location) {
        const distanceText = require('../utils/distance').calculateHaversineDistance(
          origin.lat, origin.lng,
          place.location.lat, place.location.lng
        );
        
        const distanceInKm = require('../utils/distance').getDistanceInKm(distanceText);
        const timeText = require('../utils/distance').calculateTransitTime(distanceInKm, travelMode);
        
        return {
          ...place,
          distance: `${distanceText} (przybliżone)`,
          duration: `${timeText} (przybliżone)`,
          durationValue: distanceInKm * 60
        };
      }
      return { ...place, distance: 'N/A', duration: 'N/A', durationValue: 999999 };
    });
  }
};

/**
 * Efficiently calculates distance matrix with optimal batching, caching and fallbacks
 * Private implementation for enrichWithDistances
 * @param {Array<{lat: number, lng: number}>} origins - Array of origin coordinates
 * @param {Array<{lat: number, lng: number}>} destinations - Array of destination coordinates
 * @returns {Promise<Array<Array<{distance: number, duration: number}>>>} Matrix of distances and durations
 */
const getDistanceMatrix = async (origins, destinations) => {
  if (!origins.length || !destinations.length) {
    return [];
  }

  // Initialize result matrix with null values
  const resultMatrix = Array(origins.length).fill().map(() => Array(destinations.length).fill(null));
  
  // Convert coordinates to Google Maps API format
  const originsFormatted = origins.map(({ lat, lng }) => ({ lat, lng }));
  const destinationsFormatted = destinations.map(({ lat, lng }) => ({ lat, lng }));
  
  // Create optimal batches to maximize efficiency while staying within API limits
  const batches = createOptimalBatches(originsFormatted, destinationsFormatted);
  console.log(`📊 Created ${batches.length} optimized batches for distance matrix calculation`);

  for (let i = 0; i < batches.length; i++) {
    const batch = batches[i];
    const { batchOrigins, batchDestinations, originIndices, destinationIndices } = batch;

    // Generate cache key for this specific combination
    const cacheKey = generateDistanceMatrixCacheKey(batchOrigins, batchDestinations);
    const cachedResult = cache.get(cacheKey);
    
    if (cachedResult) {
      console.log(`🔄 Using cached distance matrix for batch ${i+1}/${batches.length}`);
      // Apply cached results to the result matrix
      applyBatchResultToMatrix(cachedResult, resultMatrix, originIndices, destinationIndices);
      continue; // Skip API call for this batch
    }

    try {
      console.log(`📡 Requesting Distance Matrix API for batch ${i+1}/${batches.length}`);
      
      // Make the API request
      const response = await client.distancematrix({
        params: {
          origins: batchOrigins,
          destinations: batchDestinations,
          key: process.env.GMAPS_API_KEY,
          mode: "driving",
        },
        timeout: 10000, // 10 seconds timeout
      });

      // Process successful response
      if (response.data.status === "OK") {
        const batchResult = parseBatchResponse(response.data);
        cache.set(cacheKey, batchResult);
        applyBatchResultToMatrix(batchResult, resultMatrix, originIndices, destinationIndices);
      } else {
        // If API returns an error status, fallback to Haversine for this batch
        console.error(`❌ Distance Matrix API batch ${i+1} failed: ${response.data.status} – falling back to Haversine for this batch.`);
        applyHaversineToMatrix(batchOrigins, batchDestinations, resultMatrix, originIndices, destinationIndices);
      }
    } catch (error) {
      // For 4xx/5xx errors, log error and fallback to Haversine without retries
      if (error.response && (error.response.status >= 400)) {
        console.error(`❌ Distance Matrix API batch ${i+1} failed: ${error.message} – falling back to Haversine for this batch.`);
        applyHaversineToMatrix(batchOrigins, batchDestinations, resultMatrix, originIndices, destinationIndices);
        continue;
      }
      
      // For network errors, also fallback to Haversine
      console.error(`❌ Distance Matrix API batch ${i+1} failed: ${error.message || 'Unknown error'} – falling back to Haversine for this batch.`);
      applyHaversineToMatrix(batchOrigins, batchDestinations, resultMatrix, originIndices, destinationIndices);
    }
    
    // Add a delay between batches to avoid rate limiting
    if (i < batches.length - 1) {
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
  }

  return resultMatrix;
};

/**
 * Creates optimal batches for distance matrix API to minimize API calls
 * @param {Array<{lat: number, lng: number}>} origins - Origin coordinates
 * @param {Array<{lat: number, lng: number}>} destinations - Destination coordinates
 * @returns {Array<Object>} Array of batch objects
 */
const createOptimalBatches = (origins, destinations) => {
  const batches = [];
  const totalElements = origins.length * destinations.length;
  
  // If total is small enough, we can do it all in one request
  if (origins.length <= MAX_ORIGINS_PER_REQUEST && 
      destinations.length <= MAX_DESTINATIONS_PER_REQUEST && 
      totalElements <= MAX_ELEMENTS_PER_REQUEST) {
    return [{
      batchOrigins: origins,
      batchDestinations: destinations,
      originIndices: origins.map((_, index) => index),
      destinationIndices: destinations.map((_, index) => index)
    }];
  }
  
  // For larger sets, we need to batch optimally
  // Strategy: Fill each batch with as many elements as possible while respecting all limits
  let originBatchSize = Math.min(origins.length, MAX_ORIGINS_PER_REQUEST);
  let destBatchSize = Math.min(
    destinations.length, 
    MAX_DESTINATIONS_PER_REQUEST,
    Math.floor(MAX_ELEMENTS_PER_REQUEST / originBatchSize)
  );
  
  // Adjust batch sizes to get closest to MAX_ELEMENTS_PER_REQUEST without exceeding it
  while (originBatchSize * destBatchSize > MAX_ELEMENTS_PER_REQUEST) {
    if (originBatchSize > destBatchSize) {
      originBatchSize--;
    } else {
      destBatchSize--;
    }
  }
  
  // Create batches using the optimal sizes
  for (let i = 0; i < origins.length; i += originBatchSize) {
    const batchOrigins = origins.slice(i, i + originBatchSize);
    const originIndices = Array.from({length: batchOrigins.length}, (_, idx) => i + idx);
    
    for (let j = 0; j < destinations.length; j += destBatchSize) {
      const batchDestinations = destinations.slice(j, j + destBatchSize);
      const destinationIndices = Array.from({length: batchDestinations.length}, (_, idx) => j + idx);
      
      batches.push({
        batchOrigins,
        batchDestinations,
        originIndices,
        destinationIndices
      });
    }
  }
  
  return batches;
};

/**
 * Parses the Google Maps API distance matrix response
 * @param {Object} data - Response data from Google API
 * @returns {Array<Array<{distance: number, duration: number}>>} Parsed distance matrix
 */
const parseBatchResponse = (data) => {
  return data.rows.map(row => {
    return row.elements.map(element => {
      if (element.status === "OK") {
        return {
          distance: element.distance.value,
          duration: element.duration.value
        };
      }
      return null;
    });
  });
};

/**
 * Applies batch results to the overall result matrix
 * @param {Array<Array<{distance: number, duration: number}>>} batchResult - Results from one batch
 * @param {Array<Array<{distance: number, duration: number}>>} resultMatrix - Overall result matrix
 * @param {Array<number>} originIndices - Indices mapping batch origins to overall origins
 * @param {Array<number>} destinationIndices - Indices mapping batch destinations to overall destinations
 */
const applyBatchResultToMatrix = (batchResult, resultMatrix, originIndices, destinationIndices) => {
  for (let i = 0; i < batchResult.length; i++) {
    const overallOriginIndex = originIndices[i];
    
    for (let j = 0; j < batchResult[i].length; j++) {
      const overallDestIndex = destinationIndices[j];
      resultMatrix[overallOriginIndex][overallDestIndex] = batchResult[i][j];
    }
  }
};

/**
 * Applies Haversine distance calculation as fallback
 * @param {Array<{lat: number, lng: number}>} origins - Batch origin coordinates
 * @param {Array<{lat: number, lng: number}>} destinations - Batch destination coordinates
 * @param {Array<Array<{distance: number, duration: number}>>} resultMatrix - Overall result matrix
 * @param {Array<number>} originIndices - Indices mapping batch origins to overall origins
 * @param {Array<number>} destinationIndices - Indices mapping batch destinations to overall destinations
 */
const applyHaversineToMatrix = (origins, destinations, resultMatrix, originIndices, destinationIndices) => {
  // Assume average driving speed of 50 km/h for duration estimation (in seconds)
  const AVG_SPEED_KMH = 50;
  const METERS_PER_KM = 1000;
  const SECONDS_PER_HOUR = 3600;
  
  for (let i = 0; i < origins.length; i++) {
    const origin = origins[i];
    const overallOriginIndex = originIndices[i];
    
    for (let j = 0; j < destinations.length; j++) {
      const destination = destinations[j];
      const overallDestIndex = destinationIndices[j];
      
      const distanceKm = calculateHaversineDistance(
        origin.lat, origin.lng,
        destination.lat, destination.lng
      );
      
      // Convert km to meters for consistency with Google API
      const distanceMeters = distanceKm * METERS_PER_KM;
      
      // Estimate duration based on average speed
      const durationSeconds = (distanceKm / AVG_SPEED_KMH) * SECONDS_PER_HOUR;
      
      resultMatrix[overallOriginIndex][overallDestIndex] = {
        distance: distanceMeters,
        duration: durationSeconds
      };
    }
  }
};

/**
 * Generates a cache key for a specific distance matrix request
 * @param {Array<{lat: number, lng: number}>} origins - Origin coordinates
 * @param {Array<{lat: number, lng: number}>} destinations - Destination coordinates
 * @returns {string} Cache key
 */
const generateDistanceMatrixCacheKey = (origins, destinations) => {
  const originsKey = origins.map(o => `${o.lat.toFixed(6)},${o.lng.toFixed(6)}`).sort().join('|');
  const destinationsKey = destinations.map(d => `${d.lat.toFixed(6)},${d.lng.toFixed(6)}`).sort().join('|');
  return `${DISTANCE_MATRIX_CACHE_KEY}-${originsKey}-${destinationsKey}`;
};

module.exports = {
  getNearbyPlacesGoogle,
  enrichWithDistances
};
