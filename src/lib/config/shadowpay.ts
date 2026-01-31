/**
 * ShadowPay API Configuration
 * Handles API key and base URL configuration for ShadowPay integration
 */

/**
 * Get ShadowPay API key from environment variables
 * @returns API key string or undefined if not configured
 */
export function getShadowPayApiKey(): string | undefined {
  // Try server-side first (for API routes)
  if (typeof process !== 'undefined' && process.env?.SHADOWPAY_API_KEY) {
    return process.env.SHADOWPAY_API_KEY;
  }
  
  // Try client-side (for browser)
  if (typeof window !== 'undefined') {
    // Client-side should not expose API keys directly
    // API calls should go through server-side API routes
    return undefined;
  }
  
  return undefined;
}

/**
 * Get ShadowPay API base URL
 * @returns Base URL string or default
 */
export function getShadowPayApiUrl(): string {
  const defaultUrl = 'http://shadow.radr.fun/shadowpay';
  
  if (typeof process !== 'undefined' && process.env?.NEXT_PUBLIC_SHADOWPAY_API_URL) {
    return process.env.NEXT_PUBLIC_SHADOWPAY_API_URL;
  }
  
  return defaultUrl;
}

/**
 * Check if ShadowPay is configured
 * @returns true if API key is available
 */
export function isShadowPayConfigured(): boolean {
  return getShadowPayApiKey() !== undefined;
}

/**
 * Get API headers for ShadowPay requests
 * @returns Headers object with API key
 */
export function getShadowPayHeaders(): Record<string, string> {
  const apiKey = getShadowPayApiKey();
  
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'Accept': '*/*',
  };
  
  if (apiKey) {
    headers['X-API-Key'] = apiKey;
  }
  
  return headers;
}
