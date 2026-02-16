---
name: google-maps-integration
description: Implements Google Maps Places and Distance Matrix APIs in Node.js with cost optimization and legacy compatibility strategies.
---

# Google Maps Integration Strategy

Instructions for the AI agent to implement location-based features using the official Node.js client, ensuring low costs and correct API versioning.

## Usage

Use this skill when the user requests features involving:
- Searching for nearby places (shops, bus stations, etc.).
- Calculating travel times or distances (walking, driving).
- Integrating `@googlemaps/google-maps-services-js`.

## Steps

1.  **Environment Setup & Security**
    -   Install `dotenv` and `@googlemaps/google-maps-services-js`.
    -   Create `.env` file structure (do not fill real keys).
    -   Verify `.gitignore` contains `.env`.

2.  **Mock Data Implementation (Cost Saver)**
    -   Create a `mock_data.js` file containing a sample array of places with location data.
    -   Implement the main logic using this mock data first to verify data parsing and sorting without incurring API costs.

3.  **Places API Implementation (Legacy Mode)**
    -   Use `client.placesNearby` (which targets the Legacy API).
    -   **Warning:** Do not use `searchNearby` (New API) unless the client library is updated to support v1 specifically.
    -   Parameters: ensure `location` (lat/lng), `radius`, and `type` are set.

4.  **Distance Matrix Implementation (Batch Mode)**
    -   Extract all `location` objects from the Places result.
    -   Construct a **single** `client.distancematrix` request:
        -   `origins`: [start_point]
        -   `destinations`: [place1, place2, place3, ...]
    -   **Crucial:** This avoids the "N+1 query problem" and significantly reduces billing units.

5.  **Data Merging & Error Handling**
    -   Map the Distance Matrix results (rows/elements) back to the original Places array based on index.
    -   Handle `REQUEST_DENIED` by prompting the user to check "Places API" (Legacy) status in Google Cloud Console.
    -   Handle `OVER_QUERY_LIMIT` gracefully.