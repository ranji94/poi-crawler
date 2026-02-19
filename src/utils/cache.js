/**
 * Simple in-memory cache utility
 * Reduces API calls by storing results temporarily
 */

// In-memory cache object with TTL
const cache = new Map();

/**
 * Generate a cache key from request parameters
 * @param {string} prefix - Cache key prefix (e.g., 'google-places')
 * @param {Object} params - Request parameters
 * @returns {string} - Cache key
 */
function generateCacheKey(prefix, params) {
  // Sort keys to ensure consistent key generation regardless of parameter order
  const sortedParams = Object.keys(params)
    .sort()
    .reduce((acc, key) => {
      acc[key] = params[key];
      return acc;
    }, {});
  
  return `${prefix}:${JSON.stringify(sortedParams)}`;
}

/**
 * Get cached data if available and not expired
 * @param {string} key - Cache key
 * @returns {any} - Cached data or undefined if not found/expired
 */
function get(key) {
  if (!cache.has(key)) {
    return undefined;
  }
  
  const { data, expiry } = cache.get(key);
  
  // Check if expired
  if (expiry && expiry < Date.now()) {
    cache.delete(key);
    return undefined;
  }
  
  return data;
}

/**
 * Set data in cache with optional TTL
 * @param {string} key - Cache key
 * @param {any} data - Data to cache
 * @param {number} ttlMs - Time to live in milliseconds (optional)
 */
function set(key, data, ttlMs = null) {
  const expiry = ttlMs ? Date.now() + ttlMs : null;
  cache.set(key, { data, expiry });
}

/**
 * Remove data from cache
 * @param {string} key - Cache key
 */
function remove(key) {
  cache.delete(key);
}

/**
 * Clear all cache entries
 */
function clear() {
  cache.clear();
}

/**
 * Get cache stats
 * @returns {Object} - Cache statistics
 */
function getStats() {
  return {
    size: cache.size,
    keys: Array.from(cache.keys())
  };
}

module.exports = {
  generateCacheKey,
  get,
  set,
  remove,
  clear,
  getStats
};