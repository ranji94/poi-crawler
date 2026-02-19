/**
 * Retry utility with exponential backoff
 * Makes API calls more resilient to temporary failures
 */

/**
 * Execute a function with retry and exponential backoff
 * @param {Function} fn - Async function to execute
 * @param {Object} options - Retry options
 * @param {number} options.maxRetries - Maximum number of retries (default: 3)
 * @param {number} options.initialDelayMs - Initial delay in ms before first retry (default: 500)
 * @param {number} options.maxDelayMs - Maximum delay in ms (default: 10000)
 * @param {Function} options.shouldRetry - Function to determine if retry is needed (default: retry on any error)
 * @param {Function} options.onRetry - Function called before each retry attempt
 * @returns {Promise<any>} - Result of the function execution
 */
async function withRetry(fn, options = {}) {
  const {
    maxRetries = 3,
    initialDelayMs = 500,
    maxDelayMs = 10000,
    shouldRetry = () => true,
    onRetry = () => {}
  } = options;

  let attempts = 0;

  while (true) {
    try {
      return await fn();
    } catch (error) {
      attempts += 1;
      
      // Check if we've hit max retries or shouldn't retry this error
      if (attempts > maxRetries || !shouldRetry(error)) {
        throw error;
      }
      
      // Calculate exponential backoff delay with jitter
      const delay = Math.min(
        maxDelayMs,
        initialDelayMs * Math.pow(2, attempts - 1) * (0.5 + Math.random() * 0.5)
      );
      
      // Call onRetry callback with current state
      onRetry({
        error,
        attempts,
        maxRetries,
        delayMs: delay
      });
      
      // Wait before retrying
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }
}

/**
 * Determine if an error is a rate limit error
 * Handles Google Maps rate limit and Overpass rate limit error patterns
 * @param {Error} error - Error object
 * @returns {boolean} - True if it's a rate limit error
 */
function isRateLimitError(error) {
  const message = error.message || '';
  const response = error.response || {};
  const data = response.data || {};
  const status = response.status;
  
  return (
    // Google Maps rate limit patterns
    message.includes('rate-limit') ||
    message.includes('RESOURCE_EXHAUSTED') ||
    message.includes('exceeded your request quota') ||
    message.includes('You have exceeded') ||
    message.includes('OVER_QUERY_LIMIT') ||
    
    // HTTP status codes for rate limiting
    status === 429 ||
    status === 403 ||
    
    // Response data patterns
    (data.status && data.status === 'OVER_QUERY_LIMIT') ||
    (data.error_message && data.error_message.includes('rate'))
  );
}

/**
 * Determine if an error is likely a network/temporary error
 * @param {Error} error - Error object
 * @returns {boolean} - True if it's a network or timeout error
 */
function isNetworkError(error) {
  const message = error.message || '';
  const code = error.code || '';
  const status = error.response ? error.response.status : null;
  
  return (
    // Network errors or timeouts
    message.includes('timeout') ||
    message.includes('network') ||
    message.includes('ECONNREFUSED') ||
    message.includes('ECONNRESET') ||
    message.includes('ETIMEDOUT') ||
    code === 'ECONNRESET' ||
    code === 'ECONNABORTED' ||
    code === 'ETIMEDOUT' ||
    
    // Server errors that might be temporary
    status === 500 ||
    status === 502 ||
    status === 503 ||
    status === 504
  );
}

/**
 * Create a rate-limit aware retry configuration for Google Maps API
 * @returns {Object} - Retry configuration
 */
function getGoogleMapsRetryConfig() {
  return {
    maxRetries: 3,
    initialDelayMs: 1000,
    maxDelayMs: 10000,
    shouldRetry: (error) => isRateLimitError(error) || isNetworkError(error),
    onRetry: ({ error, attempts, delayMs }) => {
      console.warn(`⚠️ Google Maps API retry ${attempts}: ${error.message} - retrying in ${Math.round(delayMs/1000)}s`);
    }
  };
}

/**
 * Create a retry configuration for Overpass API
 * More aggressive with timeouts and server errors
 * @returns {Object} - Retry configuration
 */
function getOverpassRetryConfig() {
  return {
    maxRetries: 2,
    initialDelayMs: 2000,
    maxDelayMs: 20000,
    shouldRetry: (error) => {
      const message = error.message || '';
      return (
        isNetworkError(error) || 
        message.includes('timeout') ||
        message.includes('HTTP 504') ||
        message.includes('HTTP 502')
      );
    },
    onRetry: ({ error, attempts, delayMs }) => {
      console.warn(`⚠️ Overpass API retry ${attempts}: ${error.message} - retrying in ${Math.round(delayMs/1000)}s`);
    }
  };
}

module.exports = {
  withRetry,
  isRateLimitError,
  isNetworkError,
  getGoogleMapsRetryConfig,
  getOverpassRetryConfig
};