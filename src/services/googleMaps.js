/**
 * Service for interacting with Google Maps APIs
 */

const { Client } = require("@googlemaps/google-maps-services-js");
const config = require('../config/config');
const distanceUtils = require('../utils/distance');
const placeUtils = require('../utils/place');

// Initialize Google Maps client
const client = new Client({});

/**
 * Get nearby places from Google Maps (Places + Distance Matrix APIs)
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

    // One request per place type (Legacy Places API)
    const searchPromises = config.placesToSearch.map(type =>
      client.placesNearby({
        params: {
          location: origin,
          radius: radiusMeters,
          type: type,
          key: config.googleMaps.apiKey,
        }
      }).catch(error => {
        console.error(`❌ Google Maps error for type ${type}: ${
          error.response?.data?.error_message || error.message}`);
        return { data: { results: [] } };
      })
    );

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

    console.log(`📍 Google Maps: found ${places.length} places.`);
    return places;

  } catch (error) {
    console.error('❌ Google Maps search failed:', error.response ? error.response.data : error.message);
    return [];
  }
}

/**
 * Calculate distances for a list of places using Distance Matrix API,
 * falling back to Haversine approximation on failure.
 * @param {Object} origin - { lat, lng }
 * @param {Array}  places - Array of place objects with .location
 * @param {string} mode   - Transport mode
 * @returns {Promise<Array>} - Places enriched with distance/duration fields
 */
async function enrichWithDistances(origin, places, mode) {
  if (places.length === 0) return [];

  const travelMode = mode || config.search.defaultMode;

  try {
    const destinations = places.map(p => p.location);

    // Single batched Distance Matrix request – never call inside a loop
    const matrixRes = await client.distancematrix({
      params: {
        origins: [origin],
        destinations,
        mode: travelMode,
        key: config.googleMaps.apiKey,
      }
    });

    if (!matrixRes.data || !matrixRes.data.rows || matrixRes.data.rows.length === 0) {
      throw new Error('No valid response from Distance Matrix API');
    }

    const elements = matrixRes.data.rows[0].elements;

    return places.map((place, i) => {
      const info = elements[i] || {};
      return {
        ...place,
        distance: info.distance ? info.distance.text : 'N/A',
        duration: info.duration ? info.duration.text : 'N/A',
        durationValue: info.duration ? info.duration.value : 999999
      };
    });

  } catch (err) {
    console.error(`❌ Distance Matrix API failed: ${err.message} – falling back to Haversine.`);

    return places.map(place => {
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
  }
}

module.exports = {
  getNearbyPlacesGoogle,
  enrichWithDistances
};
