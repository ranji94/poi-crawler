/**
 * Service for interacting with Google Maps APIs
 */

const { Client } = require("@googlemaps/google-maps-services-js");
const config = require('../config/config');
const distanceUtils = require('../utils/distance');
const placeUtils = require('../utils/place');
const csvUtils = require('../utils/csv');

// Initialize Google Maps client
const client = new Client({});

/**
 * Get transit line numbers for a specific place
 * @param {string} placeId - The Google Place ID
 * @returns {Promise<string>} - Transit line information
 */
async function getTransitLineNumbers(placeId) {
  try {
    const placeDetails = await client.placeDetails({
      params: {
        place_id: placeId,
        fields: 'name,types,opening_hours,permanently_closed,business_status',
        key: config.googleMaps.apiKey
      }
    });
    
    // Google doesn't directly provide line numbers in Places API, we use a workaround
    // Line numbers are often in the stop name
    const name = placeDetails.data.result.name || '';
    
    // Try to extract line numbers from the stop name
    // Format often is: "Przystanek Warszawski (123, 456, 789)"
    const linesMatch = name.match(/\(([0-9, ]+)\)/);
    if (linesMatch && linesMatch[1]) {
      return linesMatch[1].split(',').map(line => line.trim()).join(', ');
    }
    
    // Alternative format: "Przystanek 123, 456, 789"
    const numbersMatch = name.match(/[^\w]([0-9]+(?:,\s*[0-9]+)*)/);
    if (numbersMatch && numbersMatch[1]) {
      return numbersMatch[1];
    }
    
    return "Brak danych o liniach";
  } catch (error) {
    console.error(`Błąd podczas pobierania informacji o liniach: ${error.message}`);
    return "Błąd pobierania danych";
  }
}

/**
 * Get nearby places based on location, radius and mode
 * @param {Object} params - Search parameters
 * @param {number} params.lat - Latitude
 * @param {number} params.lon - Longitude
 * @param {number} params.radius - Search radius in kilometers
 * @param {string} params.mode - Transport mode (walking, driving, bicycling, transit)
 * @returns {Promise<Array>} - Array of places with distance information
 */
async function getNearbyPlacesWithDistance(params) {
  // Set up parameters with defaults if not provided
  const lat = params.lat;
  const lon = params.lon;
  const radiusKm = params.radius || config.search.defaultRadiusKm;
  const mode = params.mode || config.search.defaultMode;
  
  // Convert radius from km to meters for API
  const radiusMeters = radiusKm * 1000;
  
  // Define origin coordinates
  const origin = { lat: parseFloat(lat), lng: parseFloat(lon) };
  
  console.log(`🌍 Using coordinates: lat: ${origin.lat}, lng: ${origin.lng}`);
  console.log(`🔍 Search radius: ${radiusKm} km`);
  console.log(`🚗 Transport mode: ${mode}`);

  try {
    console.log("🔍 Searching for nearby places...");
    
    // Place search promises for each type
    const searchPromises = config.placesToSearch.map(type => 
      client.placesNearby({
        params: {
          location: origin,
          radius: radiusMeters,
          type: type,
          key: config.googleMaps.apiKey,
        }
      }).catch(error => {
        console.error(`❌ Error searching for type ${type}: ${
          error.response?.data?.error_message || error.message}`);
        return { data: { results: [] } };
      })
    );

    // Wait for all place search requests to complete
    const responses = await Promise.all(searchPromises);

    // Process the results
    let places = [];
    responses.forEach((res, index) => {
      if (res.data && res.data.results && res.data.results.length > 0) {
        // Take up to 3 results for each type
        const found = res.data.results.slice(0, 3).map(place => ({
          id: place.place_id,
          name: place.name,
          type: config.placesToSearch[index], 
          location: place.geometry.location, 
          vicinity: place.vicinity
        }));
        
        // Filter places based on our criteria
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

    if (places.length === 0) {
      console.log("❌ No places found or API error.");
      return { results: [] };
    }

    console.log(`📍 Found ${places.length} places. Calculating routes...`);

    // Try to use Distance Matrix API for accurate results
    try {
      const destinations = places.map(p => p.location);
      
      // Make a single distance matrix request for all destinations
      const matrixRes = await client.distancematrix({
        params: {
          origins: [origin],
          destinations: destinations,
          mode: mode, // Use the requested mode
          key: config.googleMaps.apiKey,
        }
      });
      
      // Check for valid response
      if (!matrixRes.data || !matrixRes.data.rows || matrixRes.data.rows.length === 0) {
        throw new Error("No valid response from Distance Matrix API");
      }
      
      const elements = matrixRes.data.rows[0].elements;
      
      if (!elements || elements.length === 0) {
        throw new Error("No results from Distance Matrix API");
      }
      
      console.log("\n=== RESULTS (Sorted by arrival time) ===");
      
      // Combine place data with distance info and sort by duration
      const finalResults = places.map((place, i) => {
        const info = elements[i] || { distance: null, duration: null };
        return {
          ...place,
          distance: info.distance ? info.distance.text : 'N/A',
          duration: info.duration ? info.duration.text : 'N/A',
          durationValue: info.duration ? info.duration.value : 999999
        };
      }).sort((a, b) => a.durationValue - b.durationValue);
      
      // Skip getting transit lines if API key is missing or NO_EXTRA_CALLS is set
      if (!config.googleMaps.apiKey || process.env.NO_EXTRA_CALLS === 'true') {
        console.log("⚠️ Limited functionality - skipping additional line data retrieval.");
        return { results: finalResults, transitTypes: [] };
      }
      
      console.log("🚌 Getting line information for transit stops...");
      
      // Define transit stop types
      const transitTypes = ['bus_station', 'train_station', 'transit_station', 'subway_station', 'light_rail_station'];
      const transitPlaces = finalResults.filter(p => transitTypes.includes(p.type));
      
      try {
        // Get line information for all transit stops
        const linesPromises = transitPlaces.map(place => 
          getTransitLineNumbers(place.id)
            .then(lines => {
              place.lines = lines;
              return place;
            })
            .catch(error => {
              console.error(`Failed to get line info for ${place.name}: ${error.message}`);
              place.lines = "Error retrieving data";
              return place;
            })
        );
        
        await Promise.all(linesPromises);
        
      } catch (error) {
        console.error(`Error getting line information: ${error.message}`);
      }
      
      return { results: finalResults, transitTypes };
      
    } catch (distanceError) {
      // Distance Matrix API failed - fall back to Haversine calculation
      console.error(`❌ Error getting distances: ${distanceError.message}`);
      
      console.log("\n=== RESULTS (Without API distance information) ===");
      
      // Create simple results without API distance info
      const simpleResults = places.map(place => ({
        ...place,
        distance: 'N/A',
        duration: 'N/A',
        durationValue: 999999
      }));
      
      // Calculate approximate distances and durations
      const resultsWithApproxDistances = simpleResults.map(place => {
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
          
          // Calculate estimated travel time based on mode
          const timeText = distanceUtils.calculateTransitTime(distanceInKm, mode);
          
          return {
            ...place,
            distance: `${distanceText} (approximate)`,
            duration: `${timeText} (approximate)`,
            durationValue: distanceInKm * 12 // Rough priority value for sorting
          };
        }
        return place;
      }).sort((a, b) => (a.durationValue || 999999) - (b.durationValue || 999999));
      
      console.log("ℹ️ Distances and travel times are calculated using approximate method (Haversine).");
      
      return { results: resultsWithApproxDistances, transitTypes: [] };
    }

  } catch (error) {
    console.error("An error occurred:", error.response ? error.response.data : error.message);
    return { results: [], transitTypes: [] };
  }
}

module.exports = {
  getNearbyPlacesWithDistance,
  getTransitLineNumbers
};