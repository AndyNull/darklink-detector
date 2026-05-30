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
export function getBrowserHeaders(customHeaders?: Record<string, string>): Record<string, string> {
  const ua = getNextUserAgent();

  const headers: Record<string, string> = {
    'User-Agent': ua,
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7',
    'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8,en-US;q=0.7',
    'Accept-Encoding': 'gzip, deflate, br',
    'Cache-Control': 'no-cache',
    'Pragma': 'no-cache',
    'Sec-Ch-Ua': '"Google Chrome";v="131", "Chromium";v="131", "Not_A Brand";v="24"',
    'Sec-Ch-Ua-Mobile': '?0',
    'Sec-Ch-Ua-Platform': '"Windows"',
    'Sec-Fetch-Dest': 'document',
    'Sec-Fetch-Mode': 'navigate',
    'Sec-Fetch-Site': 'none',
    'Sec-Fetch-User': '?1',
    'Upgrade-Insecure-Requests': '1',
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
export async function fetchWithRedirectControl(
  url: string,
  options: RequestInit & { headers: Record<string, string> },
  maxRedirects: number = MAX_REDIRECTS
): Promise<{ response: Response; finalUrl: string; redirectCount: number }> {
  let currentUrl = url;
  let redirectCount = 0;

  // Create a new options object without the redirect property
  const fetchOpts = { ...options, redirect: 'manual' as const };

  while (redirectCount < maxRedirects) {
    const response = await fetch(currentUrl, {
      ...fetchOpts,
      headers: {
        ...fetchOpts.headers,
        // Update Referer for redirects
        ...(redirectCount > 0 ? { Referer: currentUrl } : {}),
      },
    });

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
