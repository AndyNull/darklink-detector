import jsQR from 'jsqr';
import sharp from 'sharp';
import type { QrCodeData } from './types';
import { getNextUserAgent } from './browser-sim';
import { URL_SHORTENERS } from './shared-constants';

// ─── Constants ────────────────────────────────────────────────────────────────

/** Get a rotated User-Agent for image downloads */
const getImageUA = (): string => getNextUserAgent();

/** Max concurrent image downloads */
const BATCH_SIZE = 18;

/** Max width for resizing large images – QR codes don't need high res */
const MAX_IMAGE_WIDTH = 1000;

/** Threshold above which we try quadrant cropping & rotation */
const LARGE_IMAGE_THRESHOLD = 500;

/** Minimum buffer size to even attempt QR detection (skip tiny / non-image data) */
const MIN_BUFFER_SIZE = 50;

// ─── Suspicious TLDs ─────────────────────────────────────────────────────────

const SUSPICIOUS_TLDS = new Set([
  'xyz', 'top', 'club', 'site', 'online', 'click', 'link', 'trade',
  'date', 'party', 'download', 'stream', 'racing', 'win', 'review',
  'science', 'loan', 'men',
]);

// ─── URL Shorteners ───────────────────────────────────────────────────────────
// Imported from shared-constants.ts — single source of truth
const URL_SHORTENER_HOSTS = new Set(URL_SHORTENERS);

// ─── Suspicious Keywords in QR URLs ──────────────────────────────────────────
// Keywords commonly found in phishing/malicious QR code URLs
const QR_SUSPICIOUS_KEYWORDS = [
  'login', 'signin', 'verify', 'secure', 'account', 'update', 'confirm',
  'wallet', 'crypto', 'bitcoin', 'payment', 'banking', 'credential',
  'password', 'token', 'auth', 'reset', 'unlock', 'suspend',
];

// ─── Tracking Parameters ─────────────────────────────────────────────────────

const TRACKING_PARAMS = new Set([
  'utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content',
  'fbclid', 'gclid', 'msclkid', 'dclid', 'mc_eid',
]);

// ─── Image magic bytes ───────────────────────────────────────────────────────

const IMAGE_SIGNATURES: Array<{ bytes: number[]; name: string }> = [
  { bytes: [0x89, 0x50, 0x4e, 0x47], name: 'png' },   // PNG
  { bytes: [0xff, 0xd8, 0xff], name: 'jpeg' },          // JPEG
  { bytes: [0x47, 0x49, 0x46], name: 'gif' },           // GIF
  { bytes: [0x52, 0x49, 0x46, 0x46], name: 'webp' },    // RIFF (WebP)
  { bytes: [0x42, 0x4d], name: 'bmp' },                  // BMP
  { bytes: [0x49, 0x49, 0x2a, 0x00], name: 'tiff' },    // TIFF (little-endian)
  { bytes: [0x4d, 0x4d, 0x00, 0x2a], name: 'tiff' },    // TIFF (big-endian)
  { bytes: [0x3c, 0x3f, 0x78, 0x6d], name: 'svg' },     // <?xml (SVG)
  { bytes: [0x3c, 0x73, 0x76, 0x67], name: 'svg' },     // <svg (SVG)
];

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Check if a buffer starts with known image magic bytes */
function looksLikeImage(buf: Buffer): boolean {
  if (buf.length < 4) return false;
  return IMAGE_SIGNATURES.some(({ bytes }) =>
    bytes.every((b, i) => buf[i] === b)
  );
}

/** Deduplicate QR results by decoded text */
function dedupResults(results: QrCodeData[]): QrCodeData[] {
  const seen = new Set<string>();
  const out: QrCodeData[] = [];
  for (const r of results) {
    // Dedup by sourceUrl + decodedText combo (same QR from different sources is fine)
    const key = `${r.sourceUrl ?? ''}::${r.decodedText}`;
    if (!seen.has(key)) {
      seen.add(key);
      out.push(r);
    }
  }
  return out;
}

// ─── Core: jsQR on raw RGBA ──────────────────────────────────────────────────

function jsqrFromRgba(
  rgba: Uint8ClampedArray,
  width: number,
  height: number,
): string | null {
  const result = jsQR(rgba, width, height, {
    inversionAttempts: 'attemptBoth',
  });
  return result?.data ?? null;
}

// ─── Core: detect QR codes from a single image buffer ────────────────────────

export async function detectQrCodes(
  imageBuffer: Buffer,
  sourceUrl?: string,
): Promise<QrCodeData[]> {
  const results: QrCodeData[] = [];

  if (imageBuffer.length < MIN_BUFFER_SIZE) return results;
  if (!looksLikeImage(imageBuffer)) return results;

  // Generate base64 data URI from the source image for popup verification
  // Try JPEG resize first, then PNG resize, then raw base64 as fallbacks
  let qrImageBase64: string | undefined;
  try {
    if (imageBuffer.length < 2 * 1024 * 1024) {
      // Attempt 1: Resize to JPEG (smallest size)
      try {
        const resizedBuffer = await sharp(imageBuffer)
          .resize({ width: 600, withoutEnlargement: true })
          .jpeg({ quality: 80 })
          .toBuffer();
        qrImageBase64 = `data:image/jpeg;base64,${resizedBuffer.toString('base64')}`;
      } catch {
        // Attempt 2: Resize to PNG
        try {
          const resizedBuffer = await sharp(imageBuffer)
            .resize({ width: 400, withoutEnlargement: true })
            .png({ quality: 60 })
            .toBuffer();
          qrImageBase64 = `data:image/png;base64,${resizedBuffer.toString('base64')}`;
        } catch {
          // Attempt 3: Raw base64 without resize (last resort)
          try {
            const metadata = await sharp(imageBuffer).metadata();
            const format = metadata.format || 'png';
            qrImageBase64 = `data:image/${format};base64,${imageBuffer.toString('base64')}`;
          } catch {
            console.warn(`[QR] Failed to generate base64 for ${sourceUrl}`);
          }
        }
      }
    } else {
      // Large image: try to resize aggressively to fit
      try {
        const resizedBuffer = await sharp(imageBuffer)
          .resize({ width: 300, withoutEnlargement: true })
          .jpeg({ quality: 60 })
          .toBuffer();
        qrImageBase64 = `data:image/jpeg;base64,${resizedBuffer.toString('base64')}`;
      } catch {
        console.warn(`[QR] Failed to generate base64 for large image ${sourceUrl} (${(imageBuffer.length / 1024).toFixed(0)}KB)`);
      }
    }
  } catch {
    console.warn(`[QR] Base64 generation failed entirely for ${sourceUrl}`);
  }

  // ── Pass 1: original (resized if needed) ─────────────────────────────────
  try {
    const { data, info } = await sharp(imageBuffer)
      .resize({ width: MAX_IMAGE_WIDTH, withoutEnlargement: true })
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });

    const text = jsqrFromRgba(new Uint8ClampedArray(data), info.width, info.height);
    if (text) {
      pushResult(results, text, sourceUrl, qrImageBase64);
      return results; // early exit
    }

    // ── Pass 2: enhanced contrast (for large images) ───────────────────────
    if (info.width > LARGE_IMAGE_THRESHOLD || info.height > LARGE_IMAGE_THRESHOLD) {
      const enhanced = await sharp(imageBuffer)
        .resize({ width: MAX_IMAGE_WIDTH, withoutEnlargement: true })
        .ensureAlpha()
        .normalize()       // auto-contrast
        .sharpen()         // sharpen edges
        .raw()
        .toBuffer({ resolveWithObject: true });

      const text2 = jsqrFromRgba(
        new Uint8ClampedArray(enhanced.data),
        enhanced.info.width,
        enhanced.info.height,
      );
      if (text2) {
        pushResult(results, text2, sourceUrl, qrImageBase64);
        return results;
      }

      // ── Pass 3: rotate 90° ───────────────────────────────────────────────
      const rotated = await sharp(imageBuffer)
        .resize({ width: MAX_IMAGE_WIDTH, withoutEnlargement: true })
        .ensureAlpha()
        .normalize()
        .sharpen()
        .rotate(90)
        .raw()
        .toBuffer({ resolveWithObject: true });

      const text3 = jsqrFromRgba(
        new Uint8ClampedArray(rotated.data),
        rotated.info.width,
        rotated.info.height,
      );
      if (text3) {
        pushResult(results, text3, sourceUrl, qrImageBase64);
        return results;
      }

      // ── Pass 4: quadrant crops (QR codes in corners) ─────────────────────
      const fullMeta = await sharp(imageBuffer).metadata();
      const fw = fullMeta.width ?? 0;
      const fh = fullMeta.height ?? 0;
      if (fw > LARGE_IMAGE_THRESHOLD && fh > LARGE_IMAGE_THRESHOLD) {
        const quadrants: Array<{ left: number; top: number; width: number; height: number }> = [
          { left: 0, top: 0, width: Math.floor(fw / 2), height: Math.floor(fh / 2) },
          { left: Math.floor(fw / 2), top: 0, width: Math.floor(fw / 2), height: Math.floor(fh / 2) },
          { left: 0, top: Math.floor(fh / 2), width: Math.floor(fw / 2), height: Math.floor(fh / 2) },
          { left: Math.floor(fw / 2), top: Math.floor(fh / 2), width: Math.floor(fw / 2), height: Math.floor(fh / 2) },
        ];

        for (const q of quadrants) {
          try {
            const crop = await sharp(imageBuffer)
              .extract(q)
              .resize({ width: 600, withoutEnlargement: true })
              .ensureAlpha()
              .normalize()
              .raw()
              .toBuffer({ resolveWithObject: true });

            const textQ = jsqrFromRgba(
              new Uint8ClampedArray(crop.data),
              crop.info.width,
              crop.info.height,
            );
            if (textQ) {
              pushResult(results, textQ, sourceUrl, qrImageBase64);
              // don't return early – multiple quadrants might each have a QR
            }
          } catch {
            // crop failed, skip
          }
        }

        if (results.length > 0) return results;
      }
    } else {
      // Small image – still try rotation
      const rotated = await sharp(imageBuffer)
        .ensureAlpha()
        .rotate(90)
        .raw()
        .toBuffer({ resolveWithObject: true });

      const textR = jsqrFromRgba(
        new Uint8ClampedArray(rotated.data),
        rotated.info.width,
        rotated.info.height,
      );
      if (textR) {
        pushResult(results, textR, sourceUrl, qrImageBase64);
        return results;
      }
    }
  } catch (error) {
    // ── Fallback: try passing raw data directly to jsQR if sharp fails ────
    try {
      // Attempt to get basic image info and try jsQR anyway
      const meta = await sharp(imageBuffer).metadata();
      if (meta.width && meta.height && meta.channels) {
        const raw = await sharp(imageBuffer)
          .ensureAlpha()
          .raw()
          .toBuffer();
        const text = jsqrFromRgba(new Uint8ClampedArray(raw), meta.width, meta.height);
        if (text) {
          pushResult(results, text, sourceUrl, qrImageBase64);
        }
      }
    } catch {
      console.debug(`QR detection failed completely for ${sourceUrl}: ${error}`);
    }
  }

  return results;
}

// ─── Data URI handling ────────────────────────────────────────────────────────

/**
 * Detect QR codes from a data URI (base64-encoded image).
 * Decodes directly without an HTTP request – much faster.
 */
export async function detectQrCodesFromDataUri(
  dataUri: string,
  sourceUrl?: string,
): Promise<QrCodeData[]> {
  try {
    // data:image/png;base64,iVBOR...
    const match = dataUri.match(/^data:image\/[^;]+;base64,(.+)$/i);
    if (!match) return [];

    const buffer = Buffer.from(match[1], 'base64');
    if (buffer.length < MIN_BUFFER_SIZE) return [];

    const results = await detectQrCodes(buffer, sourceUrl);

    // If detectQrCodes failed to generate qrImageBase64 (e.g., sharp encoding
    // failed), fall back to the original data URI which already contains the
    // base64 representation of the source image.
    if (results.length > 0 && dataUri.startsWith('data:image/')) {
      for (const r of results) {
        if (!r.qrImageBase64) {
          r.qrImageBase64 = dataUri;
        }
      }
    }

    return results;
  } catch {
    return [];
  }
}

// ─── Fetch a single image URL → Buffer | null ────────────────────────────────

async function fetchImageBuffer(
  url: string,
  timeout: number,
  referer?: string,
): Promise<Buffer | null> {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeout);

    const headers: Record<string, string> = {
      'User-Agent': getImageUA(),
      Accept: 'image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8',
      'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
      'Sec-Fetch-Dest': 'image',
      'Sec-Fetch-Mode': 'no-cors',
      'Sec-Fetch-Site': referer ? 'same-origin' : 'cross-site',
    };

    // CRITICAL: Set Referer to the page URL for same-origin images
    // Many websites (like chinatelecom.com.cn) reject image requests without proper Referer
    if (referer) {
      headers['Referer'] = referer;
    }

    const response = await fetch(url, {
      signal: controller.signal,
      headers,
    });
    clearTimeout(timer);

    if (!response.ok) return null;

    // Don't strictly filter by content-type – some servers return wrong types.
    // Instead, download the buffer and check magic bytes later.
    const buffer = Buffer.from(await response.arrayBuffer());
    if (buffer.length < MIN_BUFFER_SIZE) return null;

    return buffer;
  } catch {
    return null;
  }
}

// ─── Main entry: detect QR codes from multiple URLs / data URIs ───────────────

export async function detectQrCodesFromUrls(
  imageUrls: string[],
  timeout: number = 15000,
  referer?: string,
): Promise<QrCodeData[]> {
  if (imageUrls.length === 0) return [];

  const allResults: QrCodeData[] = [];

  // Separate data URIs from HTTP URLs
  const dataUris: string[] = [];
  const httpUrls: string[] = [];

  for (const url of imageUrls) {
    if (url.startsWith('data:image/')) {
      dataUris.push(url);
    } else if (url.startsWith('http://') || url.startsWith('https://')) {
      httpUrls.push(url);
    }
    // skip everything else (javascript:, mailto:, etc.)
  }

  // ── Process data URIs synchronously (very fast, no network) ──────────────
  for (const uri of dataUris) {
    try {
      const res = await detectQrCodesFromDataUri(uri, uri.slice(0, 80) + '...');
      allResults.push(...res);
    } catch {
      // skip
    }
  }

  // ── Process HTTP URLs in parallel batches ────────────────────────────────
  for (let i = 0; i < httpUrls.length; i += BATCH_SIZE) {
    const batch = httpUrls.slice(i, i + BATCH_SIZE);

    const promises = batch.map(async (url) => {
      const buffer = await fetchImageBuffer(url, timeout, referer);
      if (!buffer) return [];

      // Check magic bytes before heavy processing
      if (!looksLikeImage(buffer)) return [];

      return detectQrCodes(buffer, url);
    });

    const batchResults = await Promise.all(promises);
    allResults.push(...batchResults.flat());
  }

  return dedupResults(allResults);
}

// ─── Result builder ───────────────────────────────────────────────────────────

function pushResult(
  results: QrCodeData[],
  decodedText: string,
  sourceUrl?: string,
  qrImageBase64?: string,
): void {
  const isSuspicious = isQrContentSuspicious(decodedText);
  results.push({
    sourceUrl,
    decodedText,
    isSuspicious,
    reason: isSuspicious ? getQrSuspicionReason(decodedText) : undefined,
    qrImageBase64,
  });
}

// ─── Suspicion detection ─────────────────────────────────────────────────────

export function isQrContentSuspicious(content: string): boolean {
  // Blank / empty
  if (!content || content.trim().length === 0) return false;

  // Dangerous protocols
  if (content.startsWith('javascript:')) return true;
  if (content.startsWith('data:')) return true;
  if (content.startsWith('vbscript:')) return true;

  try {
    const url = new URL(content);

    // JavaScript/data protocol via URL parser
    if (url.protocol === 'javascript:') return true;
    if (url.protocol === 'data:') return true;
    if (url.protocol === 'vbscript:') return true;

    // IP address instead of domain
    if (/^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(url.hostname)) return true;

    // Suspicious TLD
    const tld = url.hostname.split('.').pop()?.toLowerCase();
    if (tld && SUSPICIOUS_TLDS.has(tld)) return true;

    // URL shortener
    const hostnameLower = url.hostname.toLowerCase();
    if (URL_SHORTENER_HOSTS.has(hostnameLower)) return true;
    // Also check parent domain (e.g. tinyurl.com → match)
    const parentDomain = hostnameLower.split('.').slice(-2).join('.');
    if (URL_SHORTENER_HOSTS.has(parentDomain)) return true;

    // Very long URL — only suspicious if combined with another indicator
    // (e.g. IP address URL, URL shortener, or suspicious keyword in the URL)
    // Legitimate long URLs like Google Maps links should not be flagged
    if (content.length > 500) {
      const hasOtherIndicator =
        /^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(url.hostname) || // IP address
        URL_SHORTENER_HOSTS.has(hostnameLower) ||                        // URL shortener
        URL_SHORTENER_HOSTS.has(parentDomain) ||                         // URL shortener (parent)
        (tld && SUSPICIOUS_TLDS.has(tld)) ||                             // Suspicious TLD
        QR_SUSPICIOUS_KEYWORDS.some(kw => content.toLowerCase().includes(kw)); // Suspicious keyword
      if (hasOtherIndicator) return true;
    }

    // Tracking parameters
    const params = url.searchParams;
    for (const key of TRACKING_PARAMS) {
      if (params.has(key)) return true;
    }

    return false;
  } catch {
    // Not a URL – check for dangerous prefixes
    if (content.startsWith('javascript:')) return true;
    if (content.startsWith('data:')) return true;
    if (content.startsWith('vbscript:')) return true;
    return false;
  }
}

export function getQrSuspicionReason(content: string): string {
  // Dangerous protocols
  if (content.startsWith('javascript:')) return 'QR码包含JavaScript代码，可能执行恶意脚本';
  if (content.startsWith('data:')) return 'QR码包含Data URI，可能嵌入恶意内容';
  if (content.startsWith('vbscript:')) return 'QR码包含VBScript代码，可能执行恶意脚本';

  try {
    const url = new URL(content);

    if (url.protocol === 'javascript:') return 'QR码包含JavaScript代码，可能执行恶意脚本';
    if (url.protocol === 'data:') return 'QR码包含Data URI，可能嵌入恶意内容';
    if (url.protocol === 'vbscript:') return 'QR码包含VBScript代码，可能执行恶意脚本';

    // IP address
    if (/^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(url.hostname)) {
      return 'QR码指向IP地址而非域名，可疑行为';
    }

    // Suspicious TLD
    const tld = url.hostname.split('.').pop()?.toLowerCase();
    if (tld && SUSPICIOUS_TLDS.has(tld)) {
      return `QR码指向可疑顶级域名 .${tld}`;
    }

    // URL shortener
    const hostnameLower = url.hostname.toLowerCase();
    const parentDomain = hostnameLower.split('.').slice(-2).join('.');
    if (URL_SHORTENER_HOSTS.has(hostnameLower) || URL_SHORTENER_HOSTS.has(parentDomain)) {
      return 'QR码包含短链接，可能隐藏真实目标地址';
    }

    // Very long URL (only flagged when combined with another suspicious indicator)
    if (content.length > 500) {
      const hasOtherIndicator =
        /^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(url.hostname) ||
        URL_SHORTENER_HOSTS.has(hostnameLower) ||
        URL_SHORTENER_HOSTS.has(parentDomain) ||
        (tld && SUSPICIOUS_TLDS.has(tld)) ||
        QR_SUSPICIOUS_KEYWORDS.some(kw => content.toLowerCase().includes(kw));
      if (hasOtherIndicator) {
        return 'QR码URL异常长且包含可疑特征，可能包含隐藏参数';
      }
    }

    // Tracking parameters
    const params = url.searchParams;
    const foundTracking: string[] = [];
    for (const key of TRACKING_PARAMS) {
      if (params.has(key)) foundTracking.push(key);
    }
    if (foundTracking.length > 0) {
      return `QR码URL包含跟踪参数: ${foundTracking.join(', ')}`;
    }

    return 'QR码URL存在可疑特征';
  } catch {
    if (content.startsWith('javascript:')) return 'QR码包含JavaScript代码';
    if (content.startsWith('data:')) return 'QR码包含Data URI';
    if (content.startsWith('vbscript:')) return 'QR码包含VBScript代码';
    return 'QR码内容可疑';
  }
}
