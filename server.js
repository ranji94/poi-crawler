/**
 * Main server entry point for POI Crawler API
 */

const express = require('express');
const cors = require('cors');
const config = require('./src/config/config');
const poiController = require('./src/controllers/poiController');

// Initialize Express app
const app = express();

// CORS
app.use(cors({
  origin: 'http://192.168.0.254:15011', // Zezwalaj tylko na ten konkretny adres frontendu
  methods: ['GET', 'POST'],            // Dozwolone metody
  allowedHeaders: ['Content-Type', 'Accept']
}));

// Middleware
app.use(express.json());

// Log all requests
app.use((req, res, next) => {
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.url}`);
  next();
});

// Routes
app.get('/api/poi', poiController.getNearbyPOI);

// Health check endpoint
app.get('/health', (req, res) => {
  res.status(200).json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Root endpoint with API information
app.get('/', (req, res) => {
  res.status(200).json({
    name: 'POI Crawler API',
    version: '1.0.0',
    description: 'API for finding Points of Interest around a location',
    endpoints: [
      {
        path: '/api/poi',
        method: 'GET',
        description: 'Get nearby points of interest (returns JSON or downloadable CSV)',
        params: {
          lon: 'Longitude (required)',
          lat: 'Latitude (required)',
          radius: 'Search radius in kilometers (optional)',
          mode: 'Transport mode: walking, driving, bicycling, transit (optional)',
          format: 'Response format: csv for direct download (optional)'
        }
      },
      {
        path: '/health',
        method: 'GET',
        description: 'Health check endpoint'
      }
    ]
  });
});

// 404 handler
app.use((req, res, next) => {
  res.status(404).json({
    success: false,
    message: `Route ${req.originalUrl} not found`
  });
});

// Error handler
app.use((err, req, res, next) => {
  console.error(`Error: ${err.message}`);
  res.status(500).json({
    success: false,
    message: 'Server error',
    error: process.env.NODE_ENV === 'production' ? 'Internal server error' : err.message
  });
});

// Start server
const PORT = config.server.port;
app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
  console.log(`📍 API available at http://localhost:${PORT}/api/poi`);
  console.log(`ℹ️ Google Maps API Key: ${config.googleMaps.apiKey ? 'CONFIGURED' : 'MISSING'}`);
});

module.exports = app; // Export for testing