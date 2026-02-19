/**
 * Controller for Points of Interest (POI) endpoints
 */

const googleMapsService = require('../services/googleMaps');
const osmService = require('../services/osm');
const csvUtils = require('../utils/csv');
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

    // ── Fetch from both sources concurrently ──────────────────────────────────
    const [googlePlaces, osmPlaces] = await Promise.all([
      googleMapsService.getNearbyPlacesGoogle(params),
      osmService.getNearbyPlacesOSM({ lat: numLat, lon: numLon, radiusKm: params.radius })
    ]);

    // ── Merge & deduplicate ───────────────────────────────────────────────────
    const mergedPlaces = mergePlaces(googlePlaces, osmPlaces);

    if (mergedPlaces.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'No places found in the specified area'
      });
    }

    // ── Enrich with distances (single Distance Matrix call) ───────────────────
    console.log(`📏 Calculating distances for ${mergedPlaces.length} places...`);
    const placesWithDistances = await googleMapsService.enrichWithDistances(
      origin,
      mergedPlaces,
      params.mode
    );

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

    // ── CSV export ────────────────────────────────────────────────────────────
    const format = req.query.format?.toLowerCase();
    const acceptHeader = req.headers.accept || '';
    const wantsCsv = format === 'csv' || acceptHeader.includes('text/csv');

    const timestamp = new Date().getTime();
    const filename = `poi_results_${timestamp}.csv`;
    const csvPath = path.join(process.cwd(), filename);

    csvUtils.exportToCSV(sortedPlaces, [...transitTypes], filename);

    if (wantsCsv) {
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
      return res.status(200).json({
        success: true,
        count: formattedPlaces.length,
        sources: {
          google: googlePlaces.length,
          osm: osmPlaces.length,
          merged: mergedPlaces.length
        },
        csvDownloadUrl: `/api/poi?${new URLSearchParams({ ...req.query, format: 'csv' })}`,
        data: formattedPlaces
      });
    }

  } catch (error) {
    console.error(`Error in getNearbyPOI controller: ${error.message}`);
    return res.status(500).json({
      success: false,
      message: 'Server error while fetching POIs',
      error: error.message
    });
  }
}

module.exports = {
  getNearbyPOI
};
