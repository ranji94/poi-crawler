/**
 * Utilities for working with place data
 */

/**
 * Check if a place is a hotel (used to exclude hotels from educational facilities)
 * @param {Object} place - Place object with name and vicinity
 * @returns {boolean} - True if the place is a hotel
 */
function isHotel(place) {
  const name = place.name ? place.name.toLowerCase() : '';
  const vicinity = place.vicinity ? place.vicinity.toLowerCase() : '';
  
  const hotelKeywords = ['hotel', 'ibis', 'novotel', 'hilton', 'marriott', 'hostel', 
    'inn', 'motel', 'mercure', 'radisson', 'hyatt', 'westin', 'sheraton', 'aparthotel', 
    'resort', 'pensjonat', 'spa & resort', 'spa&resort', 'guesthouse', 'bed&breakfast'];
  
  for (const keyword of hotelKeywords) {
    if (name.includes(keyword)) return true;
  }
  
  // Check address (some hotels might have names without keywords)
  for (const keyword of hotelKeywords) {
    if (vicinity.includes(keyword)) return true;
  }
  
  return false;
}

/**
 * Check if a place is a monument/memorial (used to exclude from educational facilities)
 * @param {Object} place - Place object with name and vicinity
 * @returns {boolean} - True if the place is a monument
 */
function isMonument(place) {
  const name = place.name ? place.name.toLowerCase() : '';
  const vicinity = place.vicinity ? place.vicinity.toLowerCase() : '';
  
  const monumentKeywords = ['monument', 'memorial', 'pomnik', 'zabytek', 'umschlagplatz', 
    'muzeum', 'museum', 'shrine', 'grób', 'tomb', 'obelisk', 'statue', 'posąg', 'rzeźba'];
  
  for (const keyword of monumentKeywords) {
    if (name.includes(keyword)) return true;
  }
  
  return false;
}

/**
 * Determine if a place is a public facility
 * @param {Object} place - Place object with name, vicinity, and type
 * @returns {boolean} - True if the place is a public facility
 */
function isPublicFacility(place) {
  const name = place.name ? place.name.toLowerCase() : '';
  const vicinity = place.vicinity ? place.vicinity.toLowerCase() : '';

  if (isHotel(place) || isMonument(place)) {
    return false;
  }

  const educationalTypes = ['school', 'primary_school', 'preschool', 'day_care'];
  const isEducational = educationalTypes.includes(place.type);
  
  if (place.type === 'hospital') {
    const publicHospitalKeywords = [
      'wojewódzki', 'miejski', 'powiatowy', 'państwowy', 'publiczny',
      'uniwersytecki', 'kliniczny', 'specjalistyczny szpital', 'centrum medyczne',
      'instytut', 'samodzielny publiczny'
    ];
    
    const privateHospitalKeywords = [
      'prywatny', 'niepubliczny', 'luxmed', 'medicover', 'enel-med', 'enelmed', 
      'centrum medycyny', 'prywatna klinika', 'prywatne centrum'
    ];
    
    for (const keyword of publicHospitalKeywords) {
      if (name.includes(keyword) || vicinity.includes(keyword)) {
        return true;
      }
    }
    
    for (const keyword of privateHospitalKeywords) {
      if (name.includes(keyword) || vicinity.includes(keyword)) {
        return false;
      }
    }
    
    return true;
  } else if (isEducational) {
    const publicEducationalKeywords = [
      'przedszkole nr', 'żłobek nr', 'publiczne', 'miejskie', 'gminne',
      'szkoła podstawowa nr', 'liceum ogólnokształcące nr', 'zespół szkół nr',
      'publiczna', 'państwowa', 'miejska', 'gminny', 'zespół szkół',
      'ogólnokształc', 'technikum nr'
    ];
    
    const privateEducationalKeywords = [
      'prywatna', 'prywatne', 'niepubliczne', 'społeczne', 'fundacja', 'montessori',
      'niepubliczna', 'społeczna', 'domowe', 'kreatywne', 'artystyczne',
      'international', 'british', 'american', 'językowa', 'językowe',
      'akademia', 'edukacja'
    ];
    
    for (const keyword of publicEducationalKeywords) {
      if (name.includes(keyword) || vicinity.includes(keyword)) {
        return true;
      }
    }
    
    for (const keyword of privateEducationalKeywords) {
      if (name.includes(keyword) || vicinity.includes(keyword)) {
        return false;
      }
    }
    
    return true;
  }

  return true;
}

/**
 * Get facility type based on place data
 * @param {Object} place - Place object with name, type, etc.
 * @returns {string} - The facility type
 */
function getFacilityType(place) {
  if (place.type === 'primary_school' || 
      (place.type === 'school' && place.name && place.name.toLowerCase().includes('podstawow'))) {
    return 'Szkoła podstawowa';
  } else if (place.type === 'preschool' || 
            (place.type === 'school' && place.name && place.name.toLowerCase().includes('przedszkol'))) {
    return 'Przedszkole';
  } else if (place.type === 'day_care' || 
            (place.type === 'school' && place.name && place.name.toLowerCase().includes('żłobek'))) {
    return 'Żłobek';
  }
  
  return '';
}

/**
 * Get natural area type based on place data
 * @param {Object} place - Place object with name, vicinity, etc.
 * @returns {string} - The natural area type
 */
function getNaturalAreaType(place) {
  if (place.type !== 'natural_feature') {
    return '';
  }
  
  const name = place.name ? place.name.toLowerCase() : '';
  const vicinity = place.vicinity ? place.vicinity.toLowerCase() : '';
  
  if (name.includes('las') || vicinity.includes('las')) {
    return 'Las';
  } else if (name.includes('rezerwat') || vicinity.includes('rezerwat')) {
    return 'Rezerwat przyrody';
  } else {
    return 'Teren naturalny';
  }
}

module.exports = {
  isHotel,
  isMonument,
  isPublicFacility,
  getFacilityType,
  getNaturalAreaType
};