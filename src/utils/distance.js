/**
 * Utility functions for distance calculations
 */

/**
 * Calculate approximate distance using the Haversine formula
 * @param {number} lat1 - Origin latitude
 * @param {number} lon1 - Origin longitude
 * @param {number} lat2 - Destination latitude
 * @param {number} lon2 - Destination longitude
 * @returns {string} - Formatted distance in km or m
 */
function calculateHaversineDistance(lat1, lon1, lat2, lon2) {
  const R = 6371; // Earth radius in km
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  
  const a = 
    Math.sin(dLat/2) * Math.sin(dLat/2) +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * 
    Math.sin(dLon/2) * Math.sin(dLon/2);
  
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
  const distance = R * c; // Distance in km
  
  // Format the response
  if (distance < 1) {
    return `${Math.round(distance * 1000)} m`;
  } else {
    return `${distance.toFixed(1)} km`;
  }
}

/**
 * Calculate approximate walking time based on distance
 * @param {number} distanceInKm - Distance in kilometers
 * @returns {string} - Formatted walking time
 */
function calculateWalkingTime(distanceInKm) {
  const walkingSpeedKmPerHour = 5;
  const timeInHours = distanceInKm / walkingSpeedKmPerHour;
  const timeInMinutes = Math.round(timeInHours * 60);
  
  if (timeInMinutes < 60) {
    return `${timeInMinutes} mins`;
  } else {
    const hours = Math.floor(timeInMinutes / 60);
    const minutes = timeInMinutes % 60;
    return `${hours} ${hours === 1 ? 'hour' : 'hours'}${minutes > 0 ? ` ${minutes} mins` : ''}`;
  }
}

/**
 * Calculate approximate transit time based on mode and distance
 * @param {number} distanceInKm - Distance in kilometers
 * @param {string} mode - Transit mode (walking, driving, bicycling, transit)
 * @returns {string} - Formatted transit time
 */
function calculateTransitTime(distanceInKm, mode = 'walking') {
  // Average speeds in km/h for different modes
  const speeds = {
    walking: 5,
    bicycling: 16,
    driving: 35,
    transit: 20
  };
  
  const speed = speeds[mode] || speeds.walking;
  const timeInHours = distanceInKm / speed;
  const timeInMinutes = Math.round(timeInHours * 60);
  
  if (timeInMinutes < 60) {
    return `${timeInMinutes} mins`;
  } else {
    const hours = Math.floor(timeInMinutes / 60);
    const minutes = timeInMinutes % 60;
    return `${hours} ${hours === 1 ? 'hour' : 'hours'}${minutes > 0 ? ` ${minutes} mins` : ''}`;
  }
}

/**
 * Get numeric value of distance in kilometers
 * @param {string} distanceText - Formatted distance (e.g., "5.2 km" or "800 m")
 * @returns {number} - Distance in kilometers
 */
function getDistanceInKm(distanceText) {
  if (distanceText.includes('km')) {
    return parseFloat(distanceText.split(' ')[0]);
  } else {
    return parseFloat(distanceText.split(' ')[0]) / 1000;
  }
}

module.exports = {
  calculateHaversineDistance,
  calculateWalkingTime,
  calculateTransitTime,
  getDistanceInKm
};