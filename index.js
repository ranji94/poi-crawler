const { Client } = require("@googlemaps/google-maps-services-js");
const fs = require('fs');
const path = require('path');
require('dotenv').config();

console.log('GMAPS API KEY: ', process.env.GMAPS_API_KEY)

// Configuration
const API_KEY = process.env.GMAPS_API_KEY;
const client = new Client({});
const SEARCH_RADIUS_KM = 20; // Promień wyszukiwania miejsc w kilometrach
const SEARCH_RADIUS_METERS = SEARCH_RADIUS_KM * 1000; // Konwersja km na metry dla API

const coordinates = JSON.parse(fs.readFileSync('./coordinates.json', 'utf8'));
const origin = { lat: parseFloat(coordinates.lat), lng: parseFloat(coordinates.lon) };
console.log(`🌍 Używam współrzędnych: lat: ${origin.lat}, lng: ${origin.lng}`);
console.log(`🔍 Promień wyszukiwania: ${SEARCH_RADIUS_KM} km`);

const typesToSearch = [
  'bus_station',     // Przystanki autobusowe
  'train_station',   // Stacje kolejowe
  'transit_station', // Ogólne przystanki (w tym tramwajowe)
  'subway_station',  // Stacje metra
  'light_rail_station', // Lekka kolej miejska
  'airport',         // Lotniska
  'park',            // Parki
  'natural_feature', // Elementy naturalne (mogą zawierać lasy, rezerwaty)
  'shopping_mall',   // Centra handlowe
  'supermarket',
  'church',
  'school',          // Szkoły (w tym podstawowe)
  'hospital',        // Szpitale
  'primary_school',  // Szkoły podstawowe
  'preschool',       // Przedszkola
  'day_care'         // Żłobki
];

async function getTransitLineNumbers(placeId) {
  try {
    const placeDetails = await client.placeDetails({
      params: {
        place_id: placeId,
        fields: 'name,types,opening_hours,permanently_closed,business_status',
        key: API_KEY
      }
    });
    
    // Google nie udostępnia bezpośrednio numerów linii przez Places API, mozemy użyć workaround
    // Często numery linii są zawarte w nazwie przystanku
    const name = placeDetails.data.result.name || '';
    
    // Próbujemy wyciągnąć numery linii z nazwy przystanku
    // Format często jest taki: "Przystanek Warszawski (123, 456, 789)"
    const linesMatch = name.match(/\(([0-9, ]+)\)/);
    if (linesMatch && linesMatch[1]) {
      return linesMatch[1].split(',').map(line => line.trim()).join(', ');
    }
    
    // Alternatywny format: "Przystanek 123, 456, 789"
    const numbersMatch = name.match(/[^\w]([0-9]+(?:,\s*[0-9]+)*)/);
    if (numbersMatch && numbersMatch[1]) {
      return numbersMatch[1];
    }
    
    return "Brak danych o liniach";
  } catch (error) {
    console.error("Błąd podczas pobierania informacji o liniach:", error.message);
    return "Błąd pobierania danych";
  }
}

// Funkcja do obliczania przybliżonej odległości przy użyciu wzoru haversine
function calculateHaversineDistance(lat1, lon1, lat2, lon2) {
  const R = 6371; // Promień Ziemi w km
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = 
    Math.sin(dLat/2) * Math.sin(dLat/2) +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * 
    Math.sin(dLon/2) * Math.sin(dLon/2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
  const distance = R * c; // Odległość w km
  
  // Formatowanie odpowiedzi
  if (distance < 1) {
    return `${Math.round(distance * 1000)} m`;
  } else {
    return `${distance.toFixed(1)} km`;
  }
}

// Funkcja do obliczania przybliżonego czasu dojścia pieszo (średnie tempo 5km/h)
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

// Sprawdzanie czy miejsce jest hotelem (używane do wykluczenia hoteli z placówek edukacyjnych)
function isHotel(place) {
  const name = place.name ? place.name.toLowerCase() : '';
  const vicinity = place.vicinity ? place.vicinity.toLowerCase() : '';
  
  const hotelKeywords = ['hotel', 'ibis', 'novotel', 'hilton', 'marriott', 'hostel', 
    'inn', 'motel', 'mercure', 'radisson', 'hyatt', 'westin', 'sheraton', 'aparthotel', 
    'resort', 'pensjonat', 'spa & resort', 'spa&resort', 'guesthouse', 'bed&breakfast'];
  
  for (const keyword of hotelKeywords) {
    if (name.includes(keyword)) return true;
  }
  
  // Sprawdzanie adresu (niektóre hotele mogą mieć nazwy bez słów kluczowych)
  for (const keyword of hotelKeywords) {
    if (vicinity.includes(keyword)) return true;
  }
  
  return false;
}

// Sprawdzanie czy miejsce jest zabytkiem/pomnikiem (używane do wykluczenia z placówek edukacyjnych)
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

async function getNearbyPlacesWithDistance() {
  try {
    console.log("🔍 Szukam miejsc w pobliżu...");

    const searchPromises = typesToSearch.map(type => 
      client.placesNearby({
        params: {
          location: origin,
          radius: SEARCH_RADIUS_METERS,
          type: type,
          key: API_KEY,
        }
      }).catch(error => {
        console.error(`❌ Błąd podczas wyszukiwania typu ${type}:`, 
          error.response?.data?.error_message || error.message);
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
          type: typesToSearch[index], 
          location: place.geometry.location, 
          vicinity: place.vicinity
        }));
        
        const filtered = found.filter(place => {
          const educationalTypes = ['school', 'primary_school', 'preschool', 'day_care'];
          if (place.type === 'hospital' || educationalTypes.includes(place.type)) {
            return isPublicFacility(place);
          }
          return true;
        });
        
        places = places.concat(filtered);
      }
    });

    if (places.length === 0) {
      console.log("❌ Nie znaleziono żadnych miejsc lub wystąpił błąd API.");
      return;
    }

    console.log(`📍 Znaleziono ${places.length} miejsc. Obliczam trasę...`);

    try {
      const destinations = places.map(p => p.location);
      
      const matrixRes = await client.distancematrix({
        params: {
          origins: [origin],
          destinations: destinations,
          mode: 'walking', // or 'driving', 'bicycling', 'transit'
          key: API_KEY,
        }
      });
      
      if (!matrixRes.data || !matrixRes.data.rows || matrixRes.data.rows.length === 0) {
        throw new Error("Brak poprawnej odpowiedzi z Distance Matrix API");
      }
      
      const elements = matrixRes.data.rows[0].elements;
      
      if (!elements || elements.length === 0) {
        throw new Error("Brak wyników z Distance Matrix API");
      }
      
      console.log("\n=== WYNIKI (Sortowane wg czasu dojścia) ===");
      
      const finalResults = places.map((place, i) => {
        const info = elements[i] || { distance: null, duration: null };
        return {
          ...place,
          distance: info.distance ? info.distance.text : 'N/A',
          duration: info.duration ? info.duration.text : 'N/A',
          durationValue: info.duration ? info.duration.value : 999999
        };
      }).sort((a, b) => a.durationValue - b.durationValue);
      
    if (!API_KEY || process.env.NO_EXTRA_CALLS === 'true') {
      console.log("⚠️ Ograniczona funkcjonalność - pomijam pobieranie dodatkowych danych o liniach.");
      displayResults(finalResults, []);
      exportToCSV(finalResults, []);
      return;
    }
      
      console.log("🚌 Pobieram informacje o liniach dla przystanków...");
      
      const transitTypes = ['bus_station', 'train_station', 'transit_station', 'subway_station', 'light_rail_station'];
      const transitPlaces = finalResults.filter(p => transitTypes.includes(p.type));
      
      try {
        const linesPromises = transitPlaces.map(place => 
          getTransitLineNumbers(place.id)
            .then(lines => {
              place.lines = lines;
              return place;
            })
            .catch(error => {
              console.error(`Nie udało się pobrać informacji o liniach dla ${place.name}: ${error.message}`);
              place.lines = "Błąd pobierania danych";
              return place;
            })
        );
        
        await Promise.all(linesPromises);
        
      } catch (error) {
        console.error("Błąd podczas pobierania informacji o liniach:", error.message);
      }
      
      displayResults(finalResults, transitTypes);
      exportToCSV(finalResults, transitTypes);
      
    } catch (distanceError) {
      console.error("❌ Błąd podczas pobierania dystansów:", distanceError.message);
      
      console.log("\n=== WYNIKI (Bez informacji o dystansach) ===");
      
      const simpleResults = places.map(place => ({
        ...place,
        distance: 'N/A',
        duration: 'N/A',
        durationValue: 999999
      }));
      
      const resultsWithApproxDistances = simpleResults.map(place => {
        if (place.location && place.location.lat && place.location.lng) {
          const distanceText = calculateHaversineDistance(
            origin.lat, origin.lng, 
            place.location.lat, place.location.lng
          );
          
          let distanceInKm;
          if (distanceText.includes('km')) {
            distanceInKm = parseFloat(distanceText.split(' ')[0]);
          } else {
            distanceInKm = parseFloat(distanceText.split(' ')[0]) / 1000;
          }
          
          const walkTimeText = calculateWalkingTime(distanceInKm);
          
          return {
            ...place,
            distance: `${distanceText} (przybliżone)`,
            duration: `${walkTimeText} (przybliżone)`,
            durationValue: distanceInKm * 12
          };
        }
        return place;
      }).sort((a, b) => (a.durationValue || 999999) - (b.durationValue || 999999));
      
      console.log("ℹ️ Dystanse i czasy dojścia są obliczone przybliżoną metodą (Haversine).");
      displayResults(resultsWithApproxDistances, []);
      exportToCSV(resultsWithApproxDistances, []);
    }

  } catch (error) {
    console.error("Wystąpił błąd:", error.response ? error.response.data : error.message);
  }
}

function exportToCSV(results, transitTypes) {
  try {
    let csv = "TYP,NAZWA,ADRES,DYSTANS,CZAS_DOJŚCIA,LINIE,STATUS,TYP_PLACÓWKI,RODZAJ_TERENU\n";
    
    results.forEach(p => {
      const educationalTypes = ['school', 'primary_school', 'preschool', 'day_care'];
      
      const typPlace = p.type.toUpperCase();
      const name = `"${(p.name || '').replace(/"/g, '""')}"`;
      const vicinity = `"${(p.vicinity || 'Brak danych').replace(/"/g, '""')}"`;
      const distance = p.distance || 'N/A';
      const duration = p.duration || 'N/A';
      
      let lines = '';
      if (transitTypes.includes(p.type) && p.lines) {
        lines = `"${p.lines.replace(/"/g, '""')}"`;
      }
      
      let status = '';
      if (p.type === 'hospital' || educationalTypes.includes(p.type)) {
        status = 'Publiczny';
      }
      
      let facilityType = '';
      if (p.type === 'primary_school' || 
          (p.type === 'school' && p.name && p.name.toLowerCase().includes('podstawow'))) {
        facilityType = 'Szkoła podstawowa';
      } else if (p.type === 'preschool' || 
                (p.type === 'school' && p.name && p.name.toLowerCase().includes('przedszkol'))) {
        facilityType = 'Przedszkole';
      } else if (p.type === 'day_care' || 
                (p.type === 'school' && p.name && p.name.toLowerCase().includes('żłobek'))) {
        facilityType = 'Żłobek';
      }
      
      let naturalType = '';
      if (p.type === 'natural_feature') {
        if ((p.name && p.name.toLowerCase().includes('las')) || 
            (p.vicinity && p.vicinity.toLowerCase().includes('las'))) {
          naturalType = 'Las';
        } else if ((p.name && p.name.toLowerCase().includes('rezerwat')) || 
                  (p.vicinity && p.vicinity.toLowerCase().includes('rezerwat'))) {
          naturalType = 'Rezerwat przyrody';
        } else {
          naturalType = 'Teren naturalny';
        }
      }
      
      csv += `${typPlace},${name},${vicinity},${distance},${duration},${lines},${status},${facilityType},${naturalType}\n`;
    });
    
    const fileName = 'results.csv';
    fs.writeFileSync(path.join(__dirname, fileName), csv);
    console.log(`📊 Zapisano wyniki do pliku ${fileName}`);
  } catch (error) {
    console.error("❌ Błąd podczas zapisywania do CSV:", error.message);
  }
}

function extractLinesFromName(name) {
  if (!name) return null;
  
  const extractNumbers = (text) => {
    // Pattern for transit lines: "113, 138, 175, 189, N44, N13"
    const matches = text.match(/\b([0-9]{1,3}|[A-Z][0-9]{1,3})\b/g);
    if (matches && matches.length > 0) {
      return matches.join(', ');
    }
    return null;
  };
  
  const parenthesesMatch = name.match(/\(([^)]+)\)/);
  if (parenthesesMatch) {
    const possibleLines = extractNumbers(parenthesesMatch[1]);
    if (possibleLines) return possibleLines;
  }
  
  const nameNumbers = extractNumbers(name);
  if (nameNumbers) return nameNumbers;
  
  const directionMatch = name.match(/(metro|m1|m2|[sS][1-9]|[rR][1-9]|[kK][mM]L|\d+[a-zA-Z]{1,2}|\d{2})/g);
  if (directionMatch) return directionMatch.join(', ');
  
  return null;
}

function displayResults(results, transitTypes) {
  results.forEach(p => {
    console.log(`[${p.type.toUpperCase()}] ${p.name}`);
    console.log(`   Adres: ${p.vicinity || 'Brak danych'}`);
    console.log(`   Dystans: ${p.distance} | Czas (pieszo): ${p.duration}`);
    
    if (transitTypes.includes(p.type)) {
      if (p.lines && p.lines !== "Brak danych o liniach" && p.lines !== "Błąd pobierania danych") {
        console.log(`   Linie: ${p.lines}`);
      } else {
        const extractedLines = extractLinesFromName(p.name);
        if (extractedLines) {
          console.log(`   Linie: ${extractedLines} (z nazwy przystanku)`);
          p.lines = extractedLines + " (z nazwy przystanku)";
        } else {
          console.log(`   Linie: Nieznane`);
        }
      }
    }
    
    if (p.type === 'natural_feature') {
      if ((p.name && p.name.toLowerCase().includes('las')) || 
          (p.vicinity && p.vicinity.toLowerCase().includes('las'))) {
        console.log(`   Rodzaj: Las`);
      } else if ((p.name && p.name.toLowerCase().includes('rezerwat')) || 
                (p.vicinity && p.vicinity.toLowerCase().includes('rezerwat'))) {
        console.log(`   Rodzaj: Rezerwat przyrody`);
      } else {
        console.log(`   Rodzaj: Teren naturalny`);
      }
    }
    
    const educationalTypes = ['school', 'primary_school', 'preschool', 'day_care'];
    if (p.type === 'hospital' || educationalTypes.includes(p.type)) {
      console.log(`   Status: Publiczny`);

      if (p.type === 'primary_school' || 
          (p.type === 'school' && p.name && p.name.toLowerCase().includes('podstawow'))) {
        console.log(`   Typ placówki: Szkoła podstawowa`);
      } else if (p.type === 'preschool' || 
                (p.type === 'school' && p.name && p.name.toLowerCase().includes('przedszkol'))) {
        console.log(`   Typ placówki: Przedszkole`);
      } else if (p.type === 'day_care' || 
                (p.type === 'school' && p.name && p.name.toLowerCase().includes('żłobek'))) {
        console.log(`   Typ placówki: Żłobek`);
      }
    }
    
    console.log('------------------------------------------------');
  });
}

getNearbyPlacesWithDistance();
