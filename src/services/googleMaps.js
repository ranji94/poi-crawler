/**
 * Service for interacting with Google Maps APIs
 * Includes caching, retry logic, and request throttling
 */

const { Client } = require("@googlemaps/google-maps-services-js");
const config = require('../config/config');
const distanceUtils = require('../utils/distance');
const placeUtils = require('../utils/place');
const cacheUtils = require('../utils/cache');
const { withRetry, getGoogleMapsRetryConfig } = require('../utils/retry');
const { googleMapsThrottler } = require('../utils/throttle');

// Initialize Google Maps client
const client = new Client({});

// Cache TTLs
const PLACES_CACHE_TTL = 24 * 60 * 60 * 1000; // 24 hours
const DISTANCE_CACHE_TTL = 12 * 60 * 60 * 1000; // 12 hours

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
    const cacheKey = cacheUtils.generateCacheKey('google-places', {
      lat: origin.lat,
      lng: origin.lng,
      radius: radiusMeters
    });
    
    const cachedPlaces = cacheUtils.get(cacheKey);
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
            return placeUtils.isPublicFacility(place);
          }
          return true;
        });

        places = places.concat(filtered);
      }
    });

    // Cache the results
    cacheUtils.set(cacheKey, places, PLACES_CACHE_TTL);

    console.log(`📍 Google Maps: found ${places.length} places.`);
    return places;

  } catch (error) {
    console.error('❌ Google Maps search failed:', error.response ? error.response.data : error.message);
    return [];
  }
}

/**
 * Calculate distances for a list of places using Distance Matrix API,
 * with retries, throttling, caching, and fallback to Haversine approximation on failure.
 * 
 * @param {Object} origin - { lat, lng }
 * @param {Array}  places - Array of place objects with .location
 * @param {string} mode   - Transport mode
 * @returns {Promise<Array>} - Places enriched with distance/duration fields
 */
async function enrichWithDistances(origin, places, mode) {
  if (places.length === 0) return [];

  const travelMode = mode || config.search.defaultMode;

  // Check cache first
  const cacheKey = cacheUtils.generateCacheKey('distance-matrix', {
    origin: `${origin.lat},${origin.lng}`,
    mode: travelMode,
    // Use place IDs for the cache key to handle the same set of places
    places: places.map(p => p.id || `${p.location.lat},${p.location.lng}`)
  });
  
  const cachedResult = cacheUtils.get(cacheKey);
  if (cachedResult) {
    console.log(`📏 Using cached distance calculations for ${places.length} places.`);
    return cachedResult;
  }

  // Split into batches - Distance Matrix API has limits on number of destinations per request
  // The API can handle up to 25 destinations per request, but we'll use 20 to be safe
  const BATCH_SIZE = 20;
  const batches = [];
  
  for (let i = 0; i < places.length; i += BATCH_SIZE) {
    batches.push(places.slice(i, i + BATCH_SIZE));
  }

  console.log(`📏 Calculating distances for ${places.length} places (in ${batches.length} batches)...`);

  try {
    // Process each batch
    const batchResults = [];
    
    for (let i = 0; i < batches.length; i++) {
      const batch = batches[i];
      const destinations = batch.map(p => p.location);
      
      try {
        // Use throttling and retry logic
        const matrixRes = await googleMapsThrottler.throttleDistanceRequest(() => 
          withRetry(
            async () => client.distancematrix({
              params: {
                origins: [origin],
                destinations,
                mode: travelMode,
                key: config.googleMaps.apiKey,
              }
            }),
            getGoogleMapsRetryConfig()
          )
        );

        if (!matrixRes.data || !matrixRes.data.rows || matrixRes.data.rows.length === 0) {
          throw new Error('No valid response from Distance Matrix API');
        }

        const elements = matrixRes.data.rows[0].elements;

        const batchWithDistances = batch.map((place, j) => {
          const info = elements[j] || {};
          return {
            ...place,
            distance: info.distance ? info.distance.text : 'N/A',
            duration: info.duration ? info.duration.text : 'N/A',
            durationValue: info.duration ? info.duration.value : 999999
          };
        });

        batchResults.push(batchWithDistances);
        console.log(`📏 Batch ${i+1}/${batches.length} processed successfully.`);
      } catch (err) {
        // If a batch fails, fall back to Haversine for that batch
        console.error(`❌ Distance Matrix API batch ${i+1} failed: ${err.message} – falling back to Haversine for this batch.`);
        
        const batchWithHaversine = batch.map(place => {
          if (place.location && place.location.lat && place.location.lng) {
            const distanceText = distanceUtils.calculateHaversineDistance(
              origin.lat, origin.lng,
              place.location.lat, place.location.lng
            );

            let distanceInKm;
            if (distanceText.includes('km')) {
              distanceInKm = parseFloat(distanceText.split(' ')[0]);
            } else {
              distanceInKm = parseFloat(distanceText.split(' ')[0]) / 1000;
            }

            const timeText = distanceUtils.calculateTransitTime(distanceInKm, travelMode);

            return {
              ...place,
              distance: `${distanceText} (przybliżone)`,
              duration: `${timeText} (przybliżone)`,
              durationValue: distanceInKm * 12
            };
          }
          return { ...place, distance: 'N/A', duration: 'N/A', durationValue: 999999 };
        });

        batchResults.push(batchWithHaversine);
      }
    }

    // Combine all batch results
    const result = batchResults.flat();

    // Cache successful result
    cacheUtils.set(cacheKey, result, DISTANCE_CACHE_TTL);
    
    return result;

  } catch (err) {
    console.error(`❌ Distance Matrix API failed completely: ${err.message} – falling back to Haversine for all places.`);

    // Complete fallback to Haversine
    const result = places.map(place => {
      if (place.location && place.location.lat && place.location.lng) {
        const distanceText = distanceUtils.calculateHaversineDistance(
          origin.lat, origin.lng,
          place.location.lat, place.location.lng
        );

        let distanceInKm;
        if (distanceText.includes('km')) {
          distanceInKm = parseFloat(distanceText.split(' ')[0]);
        } else {
          distanceInKm = parseFloat(distanceText.split(' ')[0]) / 1000;
        }

        const timeText = distanceUtils.calculateTransitTime(distanceInKm, travelMode);

        return {
          ...place,
          distance: `${distanceText} (przybliżone)`,
          duration: `${timeText} (przybliżone)`,
          durationValue: distanceInKm * 12
        };
      }
      return { ...place, distance: 'N/A', duration: 'N/A', durationValue: 999999 };
    });

    return result;
  }
}

module.exports = {
  getNearbyPlacesGoogle,
  enrichWithDistances
};
