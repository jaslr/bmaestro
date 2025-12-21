/**
 * Tracking parameters to strip from URLs
 */
const TRACKING_PARAMS = [
  // UTM parameters
  'utm_source',
  'utm_medium',
  'utm_campaign',
  'utm_term',
  'utm_content',
  'utm_id',
  'utm_cid',

  // Facebook
  'fbclid',
  'fb_action_ids',
  'fb_action_types',
  'fb_source',
  'fb_ref',

  // Google
  'gclid',
  'gclsrc',
  'dclid',

  // Microsoft/Bing
  'msclkid',

  // Generic tracking
  'ref',
  'ref_src',
  'ref_url',
  'referer',
  'referrer',

  // Email tracking
  'mc_cid',
  'mc_eid',

  // Analytics
  '_ga',
  '_gl',

  // Social
  'twclid',
  'igshid',
];

/**
 * Normalize a URL for comparison and deduplication
 *
 * This function:
 * - Strips tracking parameters (utm_*, fbclid, gclid, etc.)
 * - Upgrades HTTP to HTTPS (except localhost)
 * - Removes trailing slashes from paths
 * - Normalizes the hostname to lowercase
 * - Sorts remaining query parameters
 *
 * @param url - The URL to normalize
 * @returns Normalized URL string, or original if parsing fails
 */
export function normalizeUrl(url: string): string {
  try {
    const parsed = new URL(url);

    // Strip tracking parameters
    for (const param of TRACKING_PARAMS) {
      parsed.searchParams.delete(param);
    }

    // Upgrade HTTP to HTTPS (except localhost)
    if (parsed.protocol === 'http:' && !isLocalhost(parsed.hostname)) {
      parsed.protocol = 'https:';
    }

    // Normalize hostname to lowercase
    parsed.hostname = parsed.hostname.toLowerCase();

    // Sort remaining query parameters for consistent comparison
    parsed.searchParams.sort();

    // Build normalized URL
    let normalized = parsed.toString();

    // Remove trailing slash if it's just the path root
    if (normalized.endsWith('/') && parsed.pathname === '/') {
      normalized = normalized.slice(0, -1);
    }

    return normalized;
  } catch {
    // Return original if URL parsing fails
    return url;
  }
}

/**
 * Check if a hostname is localhost
 */
function isLocalhost(hostname: string): boolean {
  return (
    hostname === 'localhost' ||
    hostname === '127.0.0.1' ||
    hostname === '[::1]' ||
    hostname.endsWith('.localhost')
  );
}

/**
 * Check if two URLs are equivalent after normalization
 */
export function urlsAreEquivalent(url1: string, url2: string): boolean {
  return normalizeUrl(url1) === normalizeUrl(url2);
}

/**
 * Extract the domain from a URL
 */
export function extractDomain(url: string): string | null {
  try {
    const parsed = new URL(url);
    return parsed.hostname;
  } catch {
    return null;
  }
}

/**
 * Check if a URL is valid
 */
export function isValidUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

/**
 * Get a display-friendly version of a URL (shortened)
 */
export function displayUrl(url: string, maxLength = 50): string {
  try {
    const parsed = new URL(url);
    let display = parsed.hostname + parsed.pathname;

    // Remove trailing slash
    if (display.endsWith('/')) {
      display = display.slice(0, -1);
    }

    // Truncate if too long
    if (display.length > maxLength) {
      display = display.slice(0, maxLength - 3) + '...';
    }

    return display;
  } catch {
    return url.slice(0, maxLength);
  }
}
