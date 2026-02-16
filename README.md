# POI Crawler API

An Express.js API server that searches for Points of Interest around a specified location using the Google Maps Places API.

## Features

- Find nearby points of interest based on latitude, longitude
- Customize search radius and transportation mode
- Export results to CSV for offline analysis
- Docker support for easy deployment
- REST API with JSON responses

## Requirements

- Node.js 16+
- Google Maps API Key with Places API (Legacy) and Distance Matrix API enabled

## Configuration

1. Copy `.env.example` to `.env`
2. Add your Google Maps API Key to the `.env` file

```
GMAPS_API_KEY=your_api_key_here
```

> **IMPORTANT**: This application uses the **Legacy Places API**, not the Places API (New). Make sure you have enabled the correct API in your Google Cloud Platform project.

## Installation

```bash
# Install dependencies
npm install

# Start the server in development mode
npm run dev

# Start the server in production mode
npm start
```

## Docker Support

Build and run with Docker:

```bash
# Build Docker image
npm run docker:build

# Run Docker container
npm run docker:run
```

Or manually:

```bash
docker build -t poi-crawler:latest .
docker run -p 15010:15010 --env-file .env poi-crawler:latest
```

## API Endpoints

### GET /api/poi

Get nearby points of interest.

**Query Parameters:**

- `lat` (required): Latitude of the center point
- `lon` (required): Longitude of the center point
- `radius` (optional): Search radius in kilometers (default: 20)
- `mode` (optional): Transport mode - one of: walking, driving, bicycling, transit (default: walking)

**Example Request:**

```
GET /api/poi?lat=52.229676&lon=21.012229&radius=10&mode=walking
```

**Example Response:**

```json
{
  "success": true,
  "count": 24,
  "csvFile": "results_1708097458.csv",
  "data": [
    {
      "type": "BUS_STATION",
      "name": "Centrum 01",
      "vicinity": "Warszawa",
      "distance": "120 m",
      "duration": "2 mins",
      "location": {
        "lat": 52.2298,
        "lng": 21.0125
      },
      "lines": "107, 128, 175"
    },
    // ... more results
  ]
}
```

### GET /health

Health check endpoint to verify the API is running.

**Example Response:**

```json
{
  "status": "ok",
  "timestamp": "2023-04-22T12:00:00.000Z"
}
```

### GET /

API documentation and information.

## Project Structure

```
poi-crawler/
├── src/
│   ├── config/       # Configuration files
│   ├── controllers/  # Route handlers
│   ├── services/     # Business logic
│   └── utils/        # Helper functions
├── .env              # Environment variables (create from .env.example)
├── .env.example      # Example environment variables
├── Dockerfile        # Docker configuration
├── server.js         # Main entry point
└── package.json      # Project metadata and dependencies
```

## License

MIT