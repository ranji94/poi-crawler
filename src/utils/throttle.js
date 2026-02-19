/**
 * Request throttling utility
 * Prevents API rate limits by controlling request concurrency and frequency
 */

/**
 * Create a throttler that ensures only N requests run concurrently
 * @param {number} maxConcurrent - Maximum number of concurrent requests
 * @returns {Function} - Throttled function wrapper
 */
function createConcurrencyThrottler(maxConcurrent = 5) {
  let running = 0;
  const queue = [];
  
  function runNext() {
    if (running < maxConcurrent && queue.length > 0) {
      running++;
      const { fn, resolve, reject } = queue.shift();
      
      Promise.resolve()
        .then(() => fn())
        .then(
          result => {
            running--;
            resolve(result);
            runNext();
          },
          error => {
            running--;
            reject(error);
            runNext();
          }
        );
    }
  }

  // Return a function that throttles the provided function
  return function throttle(fn) {
    return new Promise((resolve, reject) => {
      queue.push({ fn, resolve, reject });
      runNext();
    });
  };
}

/**
 * Create a rate limiter for API calls
 * Ensures requests are spaced by minimum time intervals
 * @param {number} requestsPerSecond - Max requests per second
 * @returns {Function} - Rate limited function wrapper
 */
function createRateLimiter(requestsPerSecond = 5) {
  const minInterval = 1000 / requestsPerSecond;
  let lastRun = 0;
  const queue = [];
  
  function runNext() {
    if (queue.length === 0) return;
    
    const now = Date.now();
    const timeToWait = Math.max(0, lastRun + minInterval - now);
    
    setTimeout(() => {
      if (queue.length === 0) return;
      
      const { fn, resolve, reject } = queue.shift();
      lastRun = Date.now();
      
      Promise.resolve()
        .then(() => fn())
        .then(
          result => {
            resolve(result);
            runNext();
          },
          error => {
            reject(error);
            runNext();
          }
        );
    }, timeToWait);
  }
  
  // Return a function that rate limits the provided function
  return function rateLimit(fn) {
    return new Promise((resolve, reject) => {
      queue.push({ fn, resolve, reject });
      if (queue.length === 1) {
        runNext();
      }
    });
  };
}

/**
 * Create a Google Maps API throttler
 * Combines both concurrency and rate limiting
 * @returns {Object} - Throttling functions for different API endpoints
 */
function createGoogleMapsThrottler() {
  // Different limits for different APIs
  const placesThrottler = createConcurrencyThrottler(3);
  const placesRateLimiter = createRateLimiter(5);
  
  const distanceThrottler = createConcurrencyThrottler(1);
  const distanceRateLimiter = createRateLimiter(10);
  
  return {
    /**
     * Throttle Places API requests
     * @param {Function} fn - Function to throttle
     * @returns {Promise<any>} - Result of the function
     */
    throttlePlacesRequest(fn) {
      return placesThrottler(() => placesRateLimiter(fn));
    },
    
    /**
     * Throttle Distance Matrix API requests
     * @param {Function} fn - Function to throttle
     * @returns {Promise<any>} - Result of the function
     */
    throttleDistanceRequest(fn) {
      return distanceThrottler(() => distanceRateLimiter(fn));
    }
  };
}

/**
 * Create an Overpass API throttler
 * @returns {Function} - Throttled function for Overpass API calls
 */
function createOverpassThrottler() {
  // Only 1 concurrent request, 1 request per 5 seconds
  const concurrencyThrottler = createConcurrencyThrottler(1);
  const rateLimiter = createRateLimiter(0.2); // 1 request per 5 seconds
  
  return function throttleOverpassRequest(fn) {
    return concurrencyThrottler(() => rateLimiter(fn));
  };
}

// Create singleton instances
const googleMapsThrottler = createGoogleMapsThrottler();
const throttleOverpassRequest = createOverpassThrottler();

module.exports = {
  createConcurrencyThrottler,
  createRateLimiter,
  googleMapsThrottler,
  throttleOverpassRequest
};