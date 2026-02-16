/**
 * Controller for Points of Interest (POI) endpoints
 */

const googleMapsService = require('../services/googleMaps');
const csvUtils = require('../utils/csv');
const fs = require('fs');
const path = require('path');

/**
 * Get nearby points of interest
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
async function getNearbyPOI(req, res) {
  try {
    // Extract and validate query parameters
    const { lon, lat, radius, mode } = req.query;
    
    // Check required parameters
    if (!lon || !lat) {
      return res.status(400).json({
        success: false,
        message: 'Both lon (longitude) and lat (latitude) parameters are required'
      });
    }
    
    // Validate longitude and latitude are valid numbers
    const numLon = parseFloat(lon);
    const numLat = parseFloat(lat);
    
    if (isNaN(numLon) || isNaN(numLat)) {
      return res.status(400).json({
        success: false,
        message: 'Longitude and latitude must be valid numbers'
      });
    }
    
    // Validate longitude and latitude ranges
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
    
    // Validate radius if provided
    let numRadius = undefined;
    if (radius) {
      numRadius = parseFloat(radius);
      if (isNaN(numRadius) || numRadius <= 0) {
        return res.status(400).json({
          success: false,
          message: 'Radius must be a positive number'
        });
      }
    }
    
    // Validate mode if provided
    if (mode && !['walking', 'driving', 'bicycling', 'transit'].includes(mode)) {
      return res.status(400).json({
        success: false,
        message: 'Mode must be one of: walking, driving, bicycling, transit'
      });
    }
    
    // Prepare parameters for service call
    const params = {
      lon: numLon,
      lat: numLat,
      radius: numRadius,
      mode: mode
    };
    
    console.log(`Searching for POIs with parameters: ${JSON.stringify(params)}`);
    
    // Call Google Maps service to get places
    const { results, transitTypes } = await googleMapsService.getNearbyPlacesWithDistance(params);
    
    if (results.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'No places found in the specified area'
      });
    }
    
    // Format the places for response
    const formattedPlaces = results.map(place => {
      const educationalTypes = ['school', 'primary_school', 'preschool', 'day_care'];
      
      // Basic place info
      const formattedPlace = {
        type: place.type.toUpperCase(),
        name: place.name,
        vicinity: place.vicinity || 'Brak danych',
        distance: place.distance,
        duration: place.duration,
        location: place.location
      };
      
      // Add transit line info if available
      if (transitTypes.includes(place.type) && place.lines) {
        formattedPlace.lines = place.lines;
      }
      
      // Add facility status info if applicable
      if (place.type === 'hospital' || educationalTypes.includes(place.type)) {
        formattedPlace.status = 'Publiczny';
      }
      
      // Add educational facility type if applicable
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
      
      // Add natural area type if applicable
      if (place.type === 'natural_feature') {
        if ((place.name && place.name.toLowerCase().includes('las')) || 
            (place.vicinity && place.vicinity.toLowerCase().includes('las'))) {
          formattedPlace.naturalType = 'Las';
        } else if ((place.name && place.name.toLowerCase().includes('rezerwat')) || 
                  (place.vicinity && place.vicinity.toLowerCase().includes('rezerwat'))) {
          formattedPlace.naturalType = 'Rezerwat przyrody';
        } else {
          formattedPlace.naturalType = 'Teren naturalny';
        }
      }
      
      return formattedPlace;
    });
    
    // Check if CSV format was explicitly requested
    const format = req.query.format?.toLowerCase();
    const acceptHeader = req.headers.accept || '';
    const wantsCsv = format === 'csv' || acceptHeader.includes('text/csv');
    
    // Generate a unique filename for the CSV
    const timestamp = new Date().getTime();
    const filename = `poi_results_${timestamp}.csv`;
    const csvPath = path.join(process.cwd(), filename);
    
    // Export data to CSV file
    csvUtils.exportToCSV(results, transitTypes, filename);
    
    if (wantsCsv) {
      // Set headers for CSV download
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
      
      // Read the CSV file and send it as the response
      const fileStream = fs.createReadStream(csvPath);
      fileStream.pipe(res);
      
      // Clean up the file after sending (when the response is finished)
      res.on('finish', () => {
        fs.unlink(csvPath, (err) => {
          if (err) console.error(`Error deleting temporary CSV file: ${err.message}`);
        });
      });
    } else {
      // Return JSON response with data and CSV file information
      return res.status(200).json({
        success: true,
        count: formattedPlaces.length,
        csvDownloadUrl: `/api/poi?${new URLSearchParams({...req.query, format: 'csv'})}`,
        data: formattedPlaces
      });
    }
    
  } catch (error) {
    console.error(`Error in getNearbyPOI controller: ${error.message}`);
    
    // Return error response
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