// Realistic browser simulation headers and behavior

// Rotate between popular browser User-Agent strings
const USER_AGENTS = [
  // Chrome on Windows
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
  // Chrome on macOS
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
  // Firefox on Windows
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:133.0) Gecko/20100101 Firefox/133.0',
  // Firefox on macOS
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:133.0) Gecko/20100101 Firefox/133.0',
  // Edge on Windows
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36 Edg/131.0.0.0',
  // Safari on macOS
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Safari/605.1.15',
];

let uaIndex = 0;

export function getNextUserAgent(): string {
  const ua = USER_AGENTS[uaIndex % USER_AGENTS.length];
  uaIndex++;
  return ua;
}

// Generate realistic browser request headers
// NOTE: Some anti-bot systems (like chinatelecom.com.cn) flag requests with Sec-* headers
// as bot traffic when there's no actual browser behind them. We use a two-step approach:
// 1. Try with full headers first (some sites need them)
// 2. Fall back to simpler headers if blocked
export function getBrowserHeaders(customHeaders?: Record<string, string>): Record<string, string> {
  const ua = getNextUserAgent();

  const headers: Record<string, string> = {
    'User-Agent': ua,
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7',
    'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8,en-US;q=0.7',
    'Accept-Encoding': 'gzip, deflate, br',
    // NOTE: Intentionally NOT including Sec-* headers and Upgrade-Insecure-Requests
    // because many anti-bot systems detect them as non-browser traffic
    // when there's no actual browser behavior behind the request.
  };

  // Custom headers override defaults
  if (customHeaders) {
    for (const [key, value] of Object.entries(customHeaders)) {
      headers[key] = value;
    }
  }

  return headers;
}

// Maximum number of redirects to follow
export const MAX_REDIRECTS = 10;

// Fetch with manual redirect handling to avoid infinite loops
// Now supports cookie persistence across redirects to handle anti-bot challenges
export async function fetchWithRedirectControl(
  url: string,
  options: RequestInit & { headers: Record<string, string> },
  maxRedirects: number = MAX_REDIRECTS
): Promise<{ response: Response; finalUrl: string; redirectCount: number }> {
  let currentUrl = url;
  let redirectCount = 0;
  const accumulatedCookies: string[] = [];

  // Helper to extract and merge cookies from a response
  const collectCookies = (response: Response) => {
    const setCookieHeaders = response.headers.getSetCookie?.() || [];
    for (const sc of setCookieHeaders) {
      const cookiePart = sc.split(';')[0].trim();
      if (cookiePart) {
        const cookieName = cookiePart.split('=')[0];
        const existingIdx = accumulatedCookies.findIndex(c => c.split('=')[0] === cookieName);
        if (existingIdx >= 0) {
          accumulatedCookies[existingIdx] = cookiePart;
        } else {
          accumulatedCookies.push(cookiePart);
        }
      }
    }
  };

  // Create a new options object without the redirect property
  const fetchOpts = { ...options, redirect: 'manual' as const };

  while (redirectCount < maxRedirects) {
    // Build headers with accumulated cookies
    const requestHeaders: Record<string, string> = {
      ...fetchOpts.headers,
      // Update Referer for redirects
      ...(redirectCount > 0 ? { Referer: currentUrl } : {}),
    };

    // Include accumulated cookies
    if (accumulatedCookies.length > 0) {
      requestHeaders['Cookie'] = accumulatedCookies.join('; ');
    }

    const response = await fetch(currentUrl, {
      ...fetchOpts,
      headers: requestHeaders,
    });

    // Collect cookies from this response
    collectCookies(response);

    // Check if this is a redirect
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get('location');
      if (!location) {
        // No location header, return the response as-is
        return { response, finalUrl: currentUrl, redirectCount };
      }

      // Resolve relative redirect URLs
      const redirectUrl = new URL(location, currentUrl).href;
      redirectCount++;

      // Log redirect
      console.debug(`Redirect ${redirectCount}: ${currentUrl} -> ${redirectUrl}`);

      // Check for redirect loops
      if (redirectUrl === currentUrl) {
        console.warn(`Redirect loop detected: ${currentUrl}`);
        return { response, finalUrl: currentUrl, redirectCount };
      }

      // For 301/302/303, change method to GET (browser behavior)
      if ([301, 302, 303].includes(response.status)) {
        fetchOpts.method = 'GET';
        delete fetchOpts.body;
      }

      currentUrl = redirectUrl;
      continue;
    }

    // Not a redirect, return the response
    return { response, finalUrl: currentUrl, redirectCount };
  }

  // Max redirects exceeded - return last response by doing a follow
  console.warn(`Max redirects (${maxRedirects}) exceeded for ${url}`);
  const finalResponse = await fetch(currentUrl, { ...options, redirect: 'follow' });
  return { response: finalResponse, finalUrl: currentUrl, redirectCount };
}
