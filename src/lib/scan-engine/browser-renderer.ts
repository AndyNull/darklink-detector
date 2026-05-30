/**
 * Browser Renderer Module
 * 
 * Uses Playwright headless browser to fully render a page and extract
 * all loaded resources — including images dynamically created by JavaScript.
 * 
 * This is the key to detecting QR codes that are only visible after JS execution.
 */

import { chromium, type Browser, type Page, type BrowserContext } from 'playwright';
import type { BrowserFingerprint } from './browser-sim';

// Singleton browser instance — reused across scans
let _browser: Browser | null = null;
let _browserLaunchPromise: Promise<Browser> | null = null;

// Maximum concurrent browser pages
const MAX_CONCURRENT_PAGES = 3;

// Semaphore for proper concurrency control (replaces simple counter)
class Semaphore {
  private queue: (() => void)[] = [];
  private _count: number;
  constructor(private max: number) { this._count = max; }
  get count() { return this._count; }
  async acquire(): Promise<void> {
    if (this._count > 0) {
      this._count--;
      return;
    }
    return new Promise<void>((resolve) => {
      this.queue.push(resolve);
    });
  }
  release(): void {
    const next = this.queue.shift();
    if (next) {
      next();
    } else {
      this._count++;
    }
  }
}

const pageSemaphore = new Semaphore(MAX_CONCURRENT_PAGES);

async function getBrowser(): Promise<Browser> {
  if (_browser && _browser.isConnected()) {
    return _browser;
  }
  if (_browserLaunchPromise) {
    return _browserLaunchPromise;
  }
  _browserLaunchPromise = (async () => {
    console.log('[BrowserRenderer] Launching Chromium headless browser...');
    const browser = await chromium.launch({
      headless: true,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-gpu',
        '--disable-extensions',
        '--disable-web-security',
        '--disable-features=IsolateOrigins,site-per-process',
        '--no-first-run',
        '--no-default-browser-check',
        '--disable-background-timer-throttling',
        '--disable-backgrounding-occluded-windows',
        '--disable-renderer-backgrounding',
        '--disable-component-update',
        '--disable-client-side-phishing-detection',
        '--disable-default-apps',
        '--disable-hang-monitor',
        '--disable-prompt-on-repost',
        '--disable-sync',
        '--metrics-recording-only',
        '--safebrowsing-disable-auto-update',
      ],
    });
    console.log('[BrowserRenderer] Browser launched successfully');
    _browser = browser;
    _browserLaunchPromise = null;
    return browser;
  })();
  return _browserLaunchPromise;
}

// Track network requests to find image URLs loaded by JavaScript
interface NetworkImageEntry {
  url: string;
  method: string;
  resourceType: string;
  status: number;
  headers: Record<string, string>;
}

// Result of browser rendering
export interface BrowserRenderResult {
  /** All image URLs found in the rendered page (from DOM + network) */
  imageUrls: string[];
  /** All image data: URIs found in the rendered page */
  dataUriImages: string[];
  /** Network requests that were image resources */
  networkImages: NetworkImageEntry[];
  /** Final page URL after any redirects */
  finalUrl: string;
  /** Page title */
  title: string;
  /** Fully rendered HTML */
  html: string;
  /** Whether the browser rendering succeeded */
  success: boolean;
  /** Error message if failed */
  error?: string;
}

/**
 * Render a URL in a headless browser and extract all image resources.
 * This catches images that are only loaded after JavaScript execution.
 */
export async function renderPageForImages(
  url: string,
  timeout: number = 20000,
  abortSignal?: AbortSignal,
  fingerprint?: BrowserFingerprint
): Promise<BrowserRenderResult> {
  const result: BrowserRenderResult = {
    imageUrls: [],
    dataUriImages: [],
    networkImages: [],
    finalUrl: url,
    title: '',
    html: '',
    success: false,
  };

  // Check if aborted before starting
  if (abortSignal?.aborted) {
    result.error = 'Task aborted';
    return result;
  }

  let context: BrowserContext | null = null;
  let page: Page | null = null;

  try {
    // Acquire semaphore slot (waits if at capacity)
    await pageSemaphore.acquire();
    const browser = await getBrowser();

    // Create a new context with realistic browser settings (use fingerprint if provided)
    context = await browser.newContext({
      userAgent: fingerprint?.userAgent || 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
      viewport: fingerprint?.viewport || { width: 1920, height: 1080 },
      locale: 'zh-CN',
      timezoneId: 'Asia/Shanghai',
      ignoreHTTPSErrors: true,
      extraHTTPHeaders: {
        'Accept-Language': fingerprint?.acceptLanguage || 'zh-CN,zh;q=0.9,en;q=0.8',
      },
    });

    page = await context.newPage();

    // Track network requests for image resources
    const networkImages: NetworkImageEntry[] = [];
    
    page.on('response', (response) => {
      const url = response.url();
      const contentType = response.headers()['content-type'] || '';
      const request = response.request();
      const resourceType = request.resourceType();
      
      // Capture image responses (both by content-type and resource type)
      if (
        resourceType === 'image' ||
        contentType.startsWith('image/') ||
        url.match(/\.(jpg|jpeg|png|gif|webp|bmp|svg|ico|avif)(\?|$)/i) ||
        url.match(/\/(qr|qrcode|weixin|wechat|code|ewm|barcode|scan)/i)
      ) {
        networkImages.push({
          url,
          method: request.method(),
          resourceType,
          status: response.status(),
          headers: response.headers(),
        });
      }
    });

    // Also track request failures silently
    page.on('requestfailed', () => {
      // Silently ignore — some resources intentionally fail
    });

    // Set reasonable timeout
    page.setDefaultTimeout(timeout);
    page.setDefaultNavigationTimeout(timeout);

    // Navigate to the page and wait for network to be idle
    // This ensures all dynamically loaded resources are captured
    console.log(`[BrowserRenderer] Navigating to: ${url}`);
    
    const response = await page.goto(url, {
      waitUntil: 'networkidle', // Wait until no new network requests for 500ms
      timeout,
    });

    if (!response) {
      result.error = 'No response from page';
      return result;
    }

    // Additional wait for any lazy-loaded content
    await page.waitForTimeout(1500);

    // Get the final URL and title
    result.finalUrl = page.url();
    result.title = await page.title();

    // Extract ALL image URLs from the rendered DOM
    // This includes images that were dynamically created by JavaScript
    const domImageResult = await page.evaluate(() => {
      const dataSrc: string[] = [];

      // 1. All <img> elements (including dynamically created ones)
      const imgElements = Array.from(document.querySelectorAll('img'));
      for (const img of imgElements) {
        // Check all possible image attributes
        const attrs = ['src', 'data-src', 'data-lazy-src', 'data-original', 'data-lazy', 'data-image', 'data-url'];
        for (const attr of attrs) {
          const val = img.getAttribute(attr);
          if (val && val.trim() && !val.startsWith('javascript:')) {
            dataSrc.push(val.trim());
          }
        }
        // Check srcset
        const srcset = img.getAttribute('srcset');
        if (srcset) {
          const urls = srcset.split(',').map(s => s.trim().split(/\s+/)[0]);
          for (const u of urls) {
            if (u && u.trim()) dataSrc.push(u.trim());
          }
        }
      }

      // 2. All elements with background-image
      const allElements = Array.from(document.querySelectorAll('*'));
      for (const el of allElements) {
        const style = (el as HTMLElement).style;
        if (style && style.backgroundImage) {
          const bgUrl = style.backgroundImage;
          const urlMatches = Array.from(bgUrl.matchAll(/url\s*\(\s*['"]?([^'")]+?)['"]?\s*\)/gi));
          for (const m of urlMatches) {
            if (m[1] && m[1].trim()) dataSrc.push(m[1].trim());
          }
        }
      }

      // 3. SVG images
      const svgImages = Array.from(document.querySelectorAll('svg image, svg use'));
      for (const svgImg of svgImages) {
        const svgAttrs = ['href', 'xlink:href'];
        for (const attr of svgAttrs) {
          const val = svgImg.getAttribute(attr);
          if (val && val.trim()) dataSrc.push(val.trim());
        }
      }

      // 4. Canvas elements that might contain QR codes
      const canvases = Array.from(document.querySelectorAll('canvas'));
      for (const canvas of canvases) {
        try {
          const dataUrl = (canvas as HTMLCanvasElement).toDataURL('image/png');
          if (dataUrl && dataUrl.length > 100) {
            dataSrc.push(dataUrl);
          }
        } catch {}
      }

      // 5. <source> elements in <picture>
      const sources = Array.from(document.querySelectorAll('picture source, video source'));
      for (const source of sources) {
        const src = source.getAttribute('src');
        if (src && src.trim()) dataSrc.push(src.trim());
        const srcset = source.getAttribute('srcset');
        if (srcset) {
          const urls = srcset.split(',').map(s => s.trim().split(/\s+/)[0]);
          for (const u of urls) {
            if (u && u.trim()) dataSrc.push(u.trim());
          }
        }
      }

      // 6. Meta og:image
      const metaImages = Array.from(document.querySelectorAll('meta[property="og:image"], meta[name="twitter:image"]'));
      for (const meta of metaImages) {
        const content = meta.getAttribute('content');
        if (content && content.trim()) dataSrc.push(content.trim());
      }

      return { dataSrc };
    });

    // Get the full rendered HTML
    result.html = await page.content();

    // Process extracted images: resolve relative URLs and separate data URIs
    const allRawUrls = domImageResult.dataSrc;
    const resolvedUrls: string[] = [];
    const dataUris: string[] = [];

    for (const rawUrl of allRawUrls) {
      if (rawUrl.startsWith('data:image/')) {
        dataUris.push(rawUrl);
      } else if (rawUrl.startsWith('http://') || rawUrl.startsWith('https://') || rawUrl.startsWith('//')) {
        const resolved = rawUrl.startsWith('//') ? `https:${rawUrl}` : rawUrl;
        resolvedUrls.push(resolved);
      } else if (rawUrl.startsWith('/')) {
        // Relative URL — resolve using page URL
        try {
          const pageUrl = new URL(result.finalUrl);
          resolvedUrls.push(`${pageUrl.origin}${rawUrl}`);
        } catch {}
      } else if (rawUrl.startsWith('./') || !rawUrl.startsWith('/')) {
        // Relative URL
        try {
          const resolved = new URL(rawUrl, result.finalUrl).href;
          resolvedUrls.push(resolved);
        } catch {}
      }
    }

    // Add network-captured image URLs (these are URLs the browser actually requested)
    for (const netImg of networkImages) {
      if (netImg.url.startsWith('data:')) {
        if (netImg.url.startsWith('data:image/')) {
          dataUris.push(netImg.url);
        }
      } else if (netImg.url.startsWith('http://') || netImg.url.startsWith('https://')) {
        if (!resolvedUrls.includes(netImg.url)) {
          resolvedUrls.push(netImg.url);
        }
      }
    }

    // Deduplicate
    result.imageUrls = Array.from(new Set(resolvedUrls));
    result.dataUriImages = Array.from(new Set(dataUris));
    result.networkImages = networkImages;
    result.success = true;

    console.log(`[BrowserRenderer] Page rendered: ${url}`, 
      `DOM images: ${domImageResult.dataSrc.length}, ` +
      `Network images: ${networkImages.length}, ` +
      `Total resolved: ${result.imageUrls.length}, ` +
      `Data URIs: ${result.dataUriImages.length}`);

  } catch (err: any) {
    const errMsg = err?.message || String(err);
    console.warn(`[BrowserRenderer] Failed to render page: ${url}`, errMsg);
    result.error = errMsg;
  } finally {
    // Clean up
    try {
      if (page && !page.isClosed()) await page.close();
    } catch {}
    try {
      if (context) await context.close();
    } catch {}
    pageSemaphore.release();
  }

  return result;
}

/**
 * Clean up the browser instance
 */
export async function closeBrowser(): Promise<void> {
  if (_browser) {
    try {
      await _browser.close();
    } catch {}
    _browser = null;
  }
}
