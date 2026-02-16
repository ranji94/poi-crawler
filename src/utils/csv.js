/**
 * Utilities for CSV file operations
 */

const fs = require('fs');
const path = require('path');

/**
 * Export results to a CSV file
 * @param {Array} results - Array of POI results
 * @param {Array} transitTypes - Array of transit type identifiers
 * @param {string} filePath - Path to save the file (default: 'results.csv')
 */
function exportToCSV(results, transitTypes, filePath = 'results.csv') {
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
    
    fs.writeFileSync(path.join(process.cwd(), filePath), csv);
    console.log(`📊 Zapisano wyniki do pliku ${filePath}`);
    return filePath;
  } catch (error) {
    console.error(`❌ Błąd podczas zapisywania do CSV: ${error.message}`);
    throw error;
  }
}

/**
 * Extract transit line numbers from place name
 * @param {string} name - Place name
 * @returns {string|null} - Extracted line numbers or null if none found
 */
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

module.exports = {
  exportToCSV,
  extractLinesFromName
};