/**
 * Service for interacting with OpenStreetMap via Overpass API
 * No API key required - public endpoint
 */

const https = require('https');
const config = require('../config/config');

/**
 * Execute an Overpass QL query via HTTP POST and return parsed JSON.
 * POST is preferred over GET to avoid URL length limits and to get
 * proper JSON error responses from the Overpass server.
 * @param {string} query - Overpass QL query string
 * @returns {Promise<Object>} - Parsed JSON response
 */
function runOverpassQuery(query) {
  return new Promise((resolve, reject) => {
    const endpointUrl = new URL(config.osm.endpoint);
    const postBody = `data=${encodeURIComponent(query)}`;

    const options = {
      hostname: endpointUrl.hostname,
      port: endpointUrl.port || 443,
      path: endpointUrl.pathname + (endpointUrl.search || ''),
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Content-Length': Buffer.byteLength(postBody),
        'Accept': 'application/json',
        'User-Agent': 'poi-crawler/1.0 (Node.js) (contact: jedrzej.piasecki94@gmail.com)'
      }
    };

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => {
        if (res.statusCode === 429) {
          return reject(new Error(`Overpass API rate limit exceeded (HTTP 429). Try again later.`));
        }
        if (res.statusCode >= 400) {
          return reject(new Error(`Overpass API returned HTTP ${res.statusCode}: ${data.slice(0, 200)}`));
        }
        try {
          resolve(JSON.parse(data));
        } catch (e) {
          // Log first 300 chars of the unexpected response for debugging
          const preview = data.slice(0, 300).replace(/\n/g, ' ');
          reject(new Error(`Failed to parse Overpass response (HTTP ${res.statusCode}): ${preview}`));
        }
      });
    });

    req.on('error', (err) => reject(err));
    req.setTimeout(config.osm.timeoutMs, () => {
      req.destroy();
      reject(new Error('Overpass API request timed out'));
    });

    req.write(postBody);
    req.end();
  });
}

/**
 * Map OSM tags to a Google Places-compatible type string
 * @param {Object} tags - OSM element tags
 * @returns {string} - Mapped type string
 */
function mapOsmTypeToGoogleType(tags) {
  if (!tags) return 'transit_station';

  const railway = tags.railway || '';
  const highway = tags.highway || '';
  const amenity = tags.amenity || '';
  const station = tags.station || '';
  const publicTransport = tags.public_transport || '';

  // Train / rail
  if (railway === 'station' || railway === 'halt') {
    if (station === 'subway' || tags.subway === 'yes') return 'subway_station';
    if (station === 'light_rail' || tags.light_rail === 'yes') return 'light_rail_station';
    return 'train_station';
  }

  // Subway / metro
  if (railway === 'subway_entrance' || station === 'subway') return 'subway_station';

  // Light rail / tram
  if (railway === 'tram_stop' || station === 'light_rail') return 'light_rail_station';

  // Bus
  if (highway === 'bus_stop' || amenity === 'bus_station') return 'bus_station';

  // Generic public transport
  if (publicTransport === 'station') return 'transit_station';
  if (publicTransport === 'stop_position' || publicTransport === 'platform') return 'bus_station';

  // Parks / green areas
  if (tags.leisure === 'park' || tags.leisure === 'nature_reserve') return 'park';
  if (tags.natural) return 'natural_feature';

  // Shopping
  if (tags.shop === 'mall' || amenity === 'marketplace') return 'shopping_mall';
  if (tags.shop === 'supermarket') return 'supermarket';

  // Education
  if (amenity === 'school') return 'school';
  if (amenity === 'kindergarten') return 'preschool';
  if (amenity === 'childcare') return 'day_care';

  // Health
  if (amenity === 'hospital') return 'hospital';

  return 'transit_station';
}

/**
 * Extract transit line references from OSM tags
 * @param {Object} tags - OSM element tags
 * @returns {string} - Comma-separated line numbers or "Brak danych o liniach"
 */
function extractLinesFromTags(tags) {
  if (!tags) return 'Brak danych o liniach';

  const candidates = [
    tags.route_ref,
    tags['route_ref:bus'],
    tags['route_ref:tram'],
    tags['route_ref:train'],
    tags['route_ref:subway'],
    tags.ref,
    tags.lines,
    tags.network_ref
  ].filter(Boolean);

  if (candidates.length === 0) return 'Brak danych o liniach';

  // Flatten all refs (some are semicolon-separated)
  const allLines = candidates
    .flatMap(ref => ref.split(/[;,]/))
    .map(l => l.trim())
    .filter(l => l.length > 0);

  // Deduplicate
  const unique = [...new Set(allLines)];
  return unique.length > 0 ? unique.join(', ') : 'Brak danych o liniach';
}

/**
 * Build Overpass QL query for all configured place types within a radius
 * @param {number} lat - Latitude
 * @param {number} lon - Longitude
 * @param {number} radiusMeters - Search radius in meters
 * @returns {string} - Overpass QL query
 */
function buildOverpassQuery(lat, lon, radiusMeters) {
  const around = `(around:${radiusMeters},${lat},${lon})`;

  return `
[out:json][timeout:${Math.ceil(config.osm.timeoutMs / 1000)}];
(
  node[highway=bus_stop]${around};
  node[amenity=bus_station]${around};
  node[railway=station]${around};
  node[railway=halt]${around};
  node[railway=tram_stop]${around};
  node[railway=subway_entrance]${around};
  node[public_transport=stop_position]${around};
  node[public_transport=platform]${around};
  node[public_transport=station]${around};
  node[leisure=park]${around};
  node[leisure=nature_reserve]${around};
  way[leisure=park]${around};
  way[leisure=nature_reserve]${around};
  node[shop=mall]${around};
  node[shop=supermarket]${around};
  way[shop=mall]${around};
  way[shop=supermarket]${around};
  node[amenity=school]${around};
  node[amenity=kindergarten]${around};
  node[amenity=childcare]${around};
  node[amenity=hospital]${around};
  way[amenity=school]${around};
  way[amenity=hospital]${around};
);
out center;
`.trim();
}

/**
 * Fetch transit line information for a specific OSM node/way by its ID
 * Uses Overpass to find all routes passing through the stop
 * @param {string} osmType - 'node' or 'way'
 * @param {number} osmId - OSM element ID
 * @returns {Promise<string>} - Comma-separated line numbers
 */
async function getTransitLinesForStop(osmType, osmId) {
  const query = `
[out:json][timeout:15];
relation[type=route](bn:${osmType}/${osmId});
out tags;
`.trim();

  try {
    const data = await runOverpassQuery(query);
    if (!data.elements || data.elements.length === 0) {
      return 'Brak danych o liniach';
    }

    const lines = data.elements
      .map(rel => rel.tags && (rel.tags.ref || rel.tags.name))
      .filter(Boolean)
      .map(l => l.trim());

    const unique = [...new Set(lines)];
    return unique.length > 0 ? unique.join(', ') : 'Brak danych o liniach';
  } catch (err) {
    console.error(`⚠️  OSM route query failed for ${osmType}/${osmId}: ${err.message}`);
    return 'Brak danych o liniach';
  }
}

/**
 * Get nearby places from OpenStreetMap
 * @param {Object} params - Search parameters
 * @param {number} params.lat - Latitude
 * @param {number} params.lon - Longitude
 * @param {number} params.radiusKm - Search radius in kilometers
 * @returns {Promise<Array>} - Array of normalized place objects
 */
async function getNearbyPlacesOSM(params) {
  const { lat, lon, radiusKm } = params;
  const radiusMeters = radiusKm * 1000;

  console.log('🗺️  Querying OpenStreetMap (Overpass API)...');

  const query = buildOverpassQuery(lat, lon, radiusMeters);

  let data;
  try {
    data = await runOverpassQuery(query);
  } catch (err) {
    console.error(`❌ Overpass API error: ${err.message}`);
    return [];
  }

  if (!data.elements || data.elements.length === 0) {
    
    console.log('ℹ️  No OSM elements found in the area.');
    return [];
  }

  const transitTypes = new Set(config.transitTypes);
  const places = [];

  for (const element of data.elements) {
    const tags = element.tags || {};

    // Skip unnamed elements without meaningful tags
    if (!tags.name && !tags.highway && !tags.railway && !tags.public_transport &&
        !tags.leisure && !tags.shop && !tags.amenity) {
      continue;
    }

    // Determine coordinates (nodes have lat/lon directly; ways have center)
    const elLat = element.lat ?? element.center?.lat;
    const elLon = element.lon ?? element.center?.lon;

    if (!elLat || !elLon) continue;

    const type = mapOsmTypeToGoogleType(tags);
    const name = tags.name || tags['name:pl'] || tags['name:en'] || 'Unnamed';
    const vicinity = [tags['addr:street'], tags['addr:city']]
      .filter(Boolean).join(', ') || tags.description || '';

    const place = {
      id: `osm-${element.type}/${element.id}`,
      osmType: element.type,
      osmId: element.id,
      name,
      type,
      location: { lat: elLat, lng: elLon },
      vicinity,
      source: 'osm',
      // Pre-extract lines from tags (fast path)
      lines: transitTypes.has(type) ? extractLinesFromTags(tags) : undefined
    };

    places.push(place);
  }

  console.log(`📍 OSM: found ${places.length} places.`);

  // Enrich transit stops with route relation data (slower path)
  // Only do this when the fast-path returned no line data
  const transitStopsNeedingLines = places.filter(
    p => transitTypes.has(p.type) && p.lines === 'Brak danych o liniach'
  );

  if (transitStopsNeedingLines.length > 0) {
    console.log(`🚌 Fetching route relations for ${transitStopsNeedingLines.length} transit stops...`);

    // Batch: build a single Overpass query for all stops at once
    const nodeIds = transitStopsNeedingLines
      .filter(p => p.osmType === 'node')
      .map(p => p.osmId);

    if (nodeIds.length > 0) {
      try {
        const batchQuery = `
[out:json][timeout:${Math.ceil(config.osm.timeoutMs / 1000)}];
node(id:${nodeIds.join(',')});
rel[type=route](bn);
out tags;
`.trim();

        const routeData = await runOverpassQuery(batchQuery);

        if (routeData.elements && routeData.elements.length > 0) {
          // Build a map: nodeId -> [line refs]
          // Overpass returns relations; we need to cross-reference via members
          // Since we queried by node IDs, all returned relations pass through at least one of our stops.
          // We'll do a second targeted query per stop only if needed.
          // For now, collect all refs from returned relations as a shared pool.
          const allRefs = routeData.elements
            .map(rel => rel.tags && (rel.tags.ref || rel.tags.name))
            .filter(Boolean)
            .map(r => r.trim());

          if (allRefs.length > 0) {
            // Assign to all stops that still lack data (best-effort for batch)
            transitStopsNeedingLines.forEach(stop => {
              if (stop.lines === 'Brak danych o liniach') {
                stop.lines = [...new Set(allRefs)].join(', ');
              }
            });
          }
        }
      } catch (err) {
        console.error(`⚠️  Batch route query failed: ${err.message}`);
      }
    }
  }

  return places;
}

module.exports = {
  getNearbyPlacesOSM,
  extractLinesFromTags,
  mapOsmTypeToGoogleType
};
