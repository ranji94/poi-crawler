/**
 * Controller for Points of Interest (POI) endpoints
 * Handles API requests for nearby places, with robust error handling
 * to ensure partial results are returned when possible
 */

const googleMapsService = require('../services/googleMaps');
const osmService = require('../services/osm');
const csvUtils = require('../utils/csv');
const cacheUtils = require('../utils/cache');
const config = require('../config/config');
const fs = require('fs');
const path = require('path');

// Threshold in degrees (~111 m per 0.001°) for spatial deduplication
const DEDUP_THRESHOLD_DEG = 0.001; // ≈ 111 m

/**
 * Check whether two places are close enough to be considered duplicates
 * @param {Object} a - Place with .location { lat, lng }
 * @param {Object} b - Place with .location { lat, lng }
 * @returns {boolean}
 */
function areSamePlace(a, b) {
  if (!a.location || !b.location) return false;
  if (a.type !== b.type) return false;

  const dLat = Math.abs(a.location.lat - b.location.lat);
  const dLng = Math.abs(a.location.lng - b.location.lng);
  return dLat < DEDUP_THRESHOLD_DEG && dLng < DEDUP_THRESHOLD_DEG;
}

/**
 * Merge Google Maps and OSM place lists, deduplicating by proximity + type.
 * OSM entries are preferred for transit stops (better line data).
 * Google entries are preferred for non-transit types (richer metadata).
 *
 * @param {Array} googlePlaces - Places from Google Maps
 * @param {Array} osmPlaces    - Places from OpenStreetMap
 * @returns {Array} - Merged, deduplicated list
 */
function mergePlaces(googlePlaces, osmPlaces) {
  const transitTypes = new Set(config.transitTypes);
  const merged = [];

  // Start with all OSM places
  merged.push(...osmPlaces);

  // Add Google places that don't have a nearby OSM counterpart
  for (const gPlace of googlePlaces) {
    const hasDuplicate = merged.some(existing => areSamePlace(existing, gPlace));
    if (!hasDuplicate) {
      merged.push(gPlace);
    } else if (!transitTypes.has(gPlace.type)) {
      // For non-transit types, prefer Google's richer metadata (name, vicinity)
      // Find the OSM duplicate and enrich it with Google data
      const idx = merged.findIndex(existing => areSamePlace(existing, gPlace));
      if (idx !== -1 && merged[idx].source === 'osm') {
        merged[idx] = {
          ...merged[idx],
          // Keep OSM id and lines, but use Google's name/vicinity if OSM has none
          name: merged[idx].name !== 'Unnamed' ? merged[idx].name : gPlace.name,
          vicinity: merged[idx].vicinity || gPlace.vicinity,
          googleId: gPlace.id
        };
      }
    }
  }

  console.log(`🔀 Merged: ${googlePlaces.length} Google + ${osmPlaces.length} OSM → ${merged.length} unique places`);
  return merged;
}

/**
 * Get nearby points of interest
 * Improved to handle partial results and API failures
 * 
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
async function getNearbyPOI(req, res) {
  try {
    // ── Parameter validation ──────────────────────────────────────────────────
    const { lon, lat, radius, mode } = req.query;

    if (!lon || !lat) {
      return res.status(400).json({
        success: false,
        message: 'Both lon (longitude) and lat (latitude) parameters are required'
      });
    }

    const numLon = parseFloat(lon);
    const numLat = parseFloat(lat);

    if (isNaN(numLon) || isNaN(numLat)) {
      return res.status(400).json({
        success: false,
        message: 'Longitude and latitude must be valid numbers'
      });
    }

    if (numLon < -180 || numLon > 180) {
      return res.status(400).json({
        success: false,
        message: 'Longitude must be between -180 and 180'
      });
    }

    if (numLat < -90 || numLat > 90) {
      return res.status(400).json({
        success: false,
        message: 'Latitude must be between -90 and 90'
      });
    }

    let numRadius;
    if (radius) {
      numRadius = parseFloat(radius);
      if (isNaN(numRadius) || numRadius <= 0) {
        return res.status(400).json({
          success: false,
          message: 'Radius must be a positive number'
        });
      }
    }

    if (mode && !['walking', 'driving', 'bicycling', 'transit'].includes(mode)) {
      return res.status(400).json({
        success: false,
        message: 'Mode must be one of: walking, driving, bicycling, transit'
      });
    }

    const params = {
      lon: numLon,
      lat: numLat,
      radius: numRadius || config.search.defaultRadiusKm,
      mode: mode || config.search.defaultMode
    };

    console.log(`\n🔎 Searching for POIs – params: ${JSON.stringify(params)}`);
    console.log(`🚗 Transport mode: ${params.mode}`);

    const origin = { lat: numLat, lng: numLon };

    // Generate a cache key for this request
    const requestCacheKey = cacheUtils.generateCacheKey('poi-request', {
      lat: numLat,
      lng: numLon,
      radius: params.radius,
      mode: params.mode
    });

    // Check if we have a cached response for this exact request
    const cachedResponse = cacheUtils.get(requestCacheKey);
    if (cachedResponse) {
      console.log('📍 Using cached POI response');
      
      // For CSV requests, still need to generate a fresh file
      const format = req.query.format?.toLowerCase();
      const acceptHeader = req.headers.accept || '';
      const wantsCsv = format === 'csv' || acceptHeader.includes('text/csv');
      
      if (wantsCsv) {
        const timestamp = new Date().getTime();
        const filename = `poi_results_${timestamp}.csv`;
        const csvPath = path.join(process.cwd(), filename);
        
        // Regenerate CSV from cached data
        const transitTypes = new Set(config.transitTypes);
        csvUtils.exportToCSV(cachedResponse.sortedPlaces, [...transitTypes], filename);
        
        res.setHeader('Content-Type', 'text/csv; charset=utf-8');
        res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
        
        const fileStream = fs.createReadStream(csvPath);
        fileStream.pipe(res);
        
        res.on('finish', () => {
          fs.unlink(csvPath, err => {
            if (err) console.error(`Error deleting temporary CSV file: ${err.message}`);
          });
        });
        
        return;
      }
      
      return res.status(200).json(cachedResponse.jsonResponse);
    }

    // ── Fetch from both sources concurrently ──────────────────────────────────
    // Use Promise.allSettled to ensure we get partial results even if one API fails
    const apiResults = await Promise.allSettled([
      googleMapsService.getNearbyPlacesGoogle(params),
      osmService.getNearbyPlacesOSM({ lat: numLat, lon: numLon, radiusKm: params.radius })
    ]);

    // Extract results and handle errors
    const googlePlaces = apiResults[0].status === 'fulfilled' ? apiResults[0].value : [];
    const osmPlaces = apiResults[1].status === 'fulfilled' ? apiResults[1].value : [];
    
    // Log API errors for monitoring/debugging
    if (apiResults[0].status === 'rejected') {
      console.error('⚠️ Google Maps API failed:', apiResults[0].reason.message);
    }
    if (apiResults[1].status === 'rejected') {
      console.error('⚠️ OSM API failed:', apiResults[1].reason.message);
    }

    // ── Merge & deduplicate ───────────────────────────────────────────────────
    const mergedPlaces = mergePlaces(googlePlaces, osmPlaces);

    if (mergedPlaces.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'No places found in the specified area',
        // Include API errors in response for better debugging
        details: {
          googleStatus: apiResults[0].status,
          googleError: apiResults[0].reason?.message,
          osmStatus: apiResults[1].status,
          osmError: apiResults[1].reason?.message
        }
      });
    }

    // ── Enrich with distances (with proper error handling) ────────────────────
    console.log(`� Calculating distances for ${mergedPlaces.length} places...`);
    let placesWithDistances;
    try {
      placesWithDistances = await googleMapsService.enrichWithDistances(
        origin,
        mergedPlaces,
        params.mode
      );
    } catch (distanceError) {
      console.error(`❌ Distance calculation failed completely: ${distanceError.message}`);
      // If distance enrichment fails completely, apply fallback Haversine calculation
      // to all places to ensure we still return results
      placesWithDistances = mergedPlaces.map(place => {
        if (place.location && place.location.lat && place.location.lng) {
          const distanceText = require('../utils/distance').calculateHaversineDistance(
            origin.lat, origin.lng,
            place.location.lat, place.location.lng
          );
          
          let distanceInKm;
          if (distanceText.includes('km')) {
            distanceInKm = parseFloat(distanceText.split(' ')[0]);
          } else {
            distanceInKm = parseFloat(distanceText.split(' ')[0]) / 1000;
          }
          
          const timeText = require('../utils/distance').calculateTransitTime(distanceInKm, params.mode);
          
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

    // Sort by travel duration ascending
    const sortedPlaces = placesWithDistances.sort(
      (a, b) => (a.durationValue || 999999) - (b.durationValue || 999999)
    );

    // ── Format response ───────────────────────────────────────────────────────
    const transitTypes = new Set(config.transitTypes);
    const educationalTypes = ['school', 'primary_school', 'preschool', 'day_care'];

    const formattedPlaces = sortedPlaces.map(place => {
      const formattedPlace = {
        type: place.type.toUpperCase(),
        name: place.name,
        vicinity: place.vicinity || 'Brak danych',
        distance: place.distance,
        duration: place.duration,
        location: place.location,
        source: place.source || 'unknown'
      };

      // Transit line info (from OSM or fallback)
      if (transitTypes.has(place.type) && place.lines) {
        formattedPlace.lines = place.lines;
      }

      // Public facility status
      if (place.type === 'hospital' || educationalTypes.includes(place.type)) {
        formattedPlace.status = 'Publiczny';
      }

      // Educational facility sub-type
      if (educationalTypes.includes(place.type)) {
        if (place.type === 'primary_school' ||
            (place.type === 'school' && place.name && place.name.toLowerCase().includes('podstawow'))) {
          formattedPlace.facilityType = 'Szkoła podstawowa';
        } else if (place.type === 'preschool' ||
                   (place.type === 'school' && place.name && place.name.toLowerCase().includes('przedszkol'))) {
          formattedPlace.facilityType = 'Przedszkole';
        } else if (place.type === 'day_care' ||
                   (place.type === 'school' && place.name && place.name.toLowerCase().includes('żłobek'))) {
          formattedPlace.facilityType = 'Żłobek';
        }
      }

      // Natural area sub-type
      if (place.type === 'natural_feature') {
        const n = (place.name || '').toLowerCase();
        const v = (place.vicinity || '').toLowerCase();
        if (n.includes('las') || v.includes('las')) {
          formattedPlace.naturalType = 'Las';
        } else if (n.includes('rezerwat') || v.includes('rezerwat')) {
          formattedPlace.naturalType = 'Rezerwat przyrody';
        } else {
          formattedPlace.naturalType = 'Teren naturalny';
        }
      }

      return formattedPlace;
    });

    // Create JSON response object
    const jsonResponse = {
      success: true,
      count: formattedPlaces.length,
      sources: {
        google: googlePlaces.length,
        osm: osmPlaces.length,
        merged: mergedPlaces.length
      },
      apiStatus: {
        google: apiResults[0].status === 'fulfilled' ? 'success' : 'error',
        osm: apiResults[1].status === 'fulfilled' ? 'success' : 'error',
      },
      csvDownloadUrl: `/api/poi?${new URLSearchParams({ ...req.query, format: 'csv' })}`,
      data: formattedPlaces
    };

    // Cache the response data for future use
    cacheUtils.set(requestCacheKey, {
      jsonResponse,
      sortedPlaces
    }, config.cache.ttl.places);

    // ── CSV export ────────────────────────────────────────────────────────────
    const format = req.query.format?.toLowerCase();
    const acceptHeader = req.headers.accept || '';
    const wantsCsv = format === 'csv' || acceptHeader.includes('text/csv');

    if (wantsCsv) {
      const timestamp = new Date().getTime();
      const filename = `poi_results_${timestamp}.csv`;
      const csvPath = path.join(process.cwd(), filename);

      csvUtils.exportToCSV(sortedPlaces, [...transitTypes], filename);

      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);

      const fileStream = fs.createReadStream(csvPath);
      fileStream.pipe(res);

      res.on('finish', () => {
        fs.unlink(csvPath, err => {
          if (err) console.error(`Error deleting temporary CSV file: ${err.message}`);
        });
      });
    } else {
      return res.status(200).json(jsonResponse);
    }

  } catch (error) {
    console.error(`Error in getNearbyPOI controller: ${error.message}`);
    
    // Provide informative error response
    return res.status(500).json({
      success: false,
      message: 'Server error while fetching POIs',
      error: error.message,
      stackTrace: process.env.NODE_ENV !== 'production' ? error.stack : undefined
    });
  }
}

module.exports = {
  getNearbyPOI
};
