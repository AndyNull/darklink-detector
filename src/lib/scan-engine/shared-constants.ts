/**
 * Shared constants and utility functions for the scan engine.
 *
 * This module consolidates TRUSTED_DOMAINS, URL_SHORTENERS, and domain-utility
 * functions that were previously duplicated across html-parser.ts and
 * scan-engine.ts into a single source of truth.
 */

// ─── IPv4 / IPv6 regex patterns ───────────────────────────────────────────────

const IPV4_REGEX = /^(\d{1,3}\.){3}\d{1,3}$/;
// IPv6 regex (simplified — matches bracketed and bare forms)
const IPV6_REGEX = /^\[?([0-9a-fA-F]{0,4}:){2,7}[0-9a-fA-F]{0,4}\]?$/;

// ─── Trusted CDN/Service domains ──────────────────────────────────────────────
// Whitelist for suspicious_domain detection — merged from html-parser.ts and
// scan-engine.ts, deduplicated (cdn.jsdelivr.net appeared 3×, etc.).

export const TRUSTED_DOMAINS = new Set([
  // Common CDNs
  'cdn.jsdelivr.net', 'fonts.googleapis.com', 'fonts.gstatic.com',
  'ajax.googleapis.com', 'cdnjs.cloudflare.com', 'cdn.bootcdn.net',
  'cdn.staticfile.org', 'unpkg.com', 'stackpath.bootstrapcdn.com',
  'code.jquery.com', 'maxcdn.bootstrapcdn.com',
  // Chinese CDNs
  'lib.baomitu.com', 'cdn.bytedance.com',
  'lf3-cdn-tos.bytecdntp.com', 'lf6-cdn-tos.bytecdntp.com',
  'lf9-cdn-tos.bytecdntp.com',
  // Analytics & Tag Managers
  'www.googletagmanager.com', 'www.google-analytics.com',
  'connect.facebook.net', 'analytics.tiktok.com',
  'hm.baidu.com', 'zz.bdstatic.com', 's19.cnzz.com', 'cnzz.com',
  'tongji.baidu.com', 'api.mapbox.com', 'cdn.ampproject.org',
  'plausible.io', 'matomo.org',
  'analytics.google.com', 'region1.google-analytics.com',
  'tagmanager.google.com', 'static.hotjar.com',
  'cdn.mxpnl.com', 'sentry.io', 'browser.sentry-cdn.com',
  // Social / Sharing
  'platform.twitter.com', 'apis.google.com',
  'static.addtoany.com', 'assets.pinterest.com',
  'sdn.geetest.com', 'api-share.facebook.com', 'www.facebook.com',
  'graph.facebook.com', 'syndication.twitter.com',
  // Common legit services on cheap TLDs
  'github.io', 'netlify.app', 'vercel.app', 'herokuapp.com',
  'pages.dev', 'surge.sh', 'gitlab.io', 'readthedocs.io',
  'cloudfront.net', 'amazonaws.com', 'azureedge.net',
  // Cloud services
  'azurewebsites.net', 'cloudapp.net', 'compute.amazonaws.com',
  'elasticbeanstalk.com', 'firebaseapp.com', 'firebaseio.com',
  'onrender.com', 'railway.app', 'fly.dev',
  'deno.dev', 'supabase.co', 'hasura.app',
  // Common services
  'cdn.sstatic.net', 'i.stack.imgur.com',
  'payments.stripe.com', 'js.stripe.com',
  'checkout.stripe.com', 'api.stripe.com',
  'js.braintreegateway.com', 'assets.braintreegateway.com',
  'www.paypal.com', 'api.paypal.com',
  'cdn.shopify.com', 'monorail-edge.shopifysvc.com',
]);

// ─── URL Shorteners ───────────────────────────────────────────────────────────
// Merged from html-parser.ts and qr-detector.ts, deduplicated.

export const URL_SHORTENERS = [
  // Major international
  'bit.ly', 't.cn', 'dwz.cn', 'suo.im', 'tinyurl.com',
  'goo.gl', 'ow.ly', 'is.gd', 'buff.ly', 'rebrand.ly',
  'cutt.ly', 'short.io', 'soo.gd', 'tny.im', 'v.gd',
  'ht.ly', 'bl.ink', 'shorturl.at', 'tiny.cc',
  'bit.do', 'mcaf.ee', 'su.pr', 'tr.im', 'cli.gs',
  'scrnch.me', 'qr.ae', 'po.st', 'sp2.ro',
  // Monetized / suspicious
  'shrinke.me', 'clk.ink', 'adf.ly', 'bc.vc',
  'sh.st', 'ouo.io', 'linkshrink.net',
  // Chinese shorteners
  'url.cn', 'amzn.to', 'rrd.me',
  'dwz1.com', 't.hk0.cn', 'b23.tv', 'kuaibao.cn',
  // Additional common shorteners
  'trib.al', 'db.tt', 'disq.us',
  'j.mp', 'lnkd.in', 'fxn.ws', 'on.wsj.com',
  'flip.it', 'spoti.fi', 'apple.co',
  'geni.us', 'shr.name', 'shorte.st', 'zi.ma',
  '1w.al', '2no.co', '4fun.tw', '7.ly',
  'a.co', 'adcrun.ch', 'adv.li',
  'budurl.com', 'chilp.it', 'clck.ru', 'clicky.me',
  'dsh.re', 'fat.ly', 'fla.sh', 'gdurl.com',
  'git.io', 'go2l.ink', 'go.shr.lc', 'hyper.co',
  'idek.net', 'ker.fr', 'lc.chat',
  'liinks.co', 'mercuri.co', 'migre.me', 'moourl.com',
  'n9.cl', 'nn.nf', 'nowlinks.net', 'oec.io',
  'ph.dog', 'picsee.co', 'polr.co', 'qslee.com',
  'redirecting.at', 's2r.co', 'sc.link', 'sg.id',
  'shor.by', 'shortcm.li', 'shortlink.in', 'shrtco.de',
  'smms.in', 'snip.ly', 'sprmn.lol',
  'surl.li', 't2m.io', 't.co', 'tiny.pl',
  'tr.ee', 'ubb.sh', 'urle.co',
  'vzturl.com', 'yep.it',
  'zip.net', 'zippi.tk',
  // Additional from qr-detector.ts
  'suolink.cn', 'rb.gy', 'cli.re',
];

// ─── Shared utility functions ─────────────────────────────────────────────────

/**
 * Extract the domain (hostname) from a URL string.
 * Returns null if the hostname is not a valid domain or IP address.
 */
export function extractDomain(url: string): string | null {
  try {
    const hostname = new URL(url).hostname;
    if (!isValidDomain(hostname)) return null;
    return hostname;
  } catch {
    return null;
  }
}

/**
 * Validate that a hostname is a meaningful domain (not single chars,
 * punycode fragments, etc.).
 *
 * Accepts IPv4 addresses, IPv6 addresses (bracketed or bare), and
 * hostnames with valid TLD structure (at least 2-char TLD).
 */
export function isValidDomain(hostname: string): boolean {
  if (!hostname || hostname.length === 0) return false;

  // Allow IPv4 addresses
  if (IPV4_REGEX.test(hostname)) return true;

  // Allow IPv6 addresses (bracketed or bare)
  if (IPV6_REGEX.test(hostname)) return true;

  // Reject single-character hostnames (a, b, x, etc.)
  if (hostname.length < 3) return false;

  // Reject hostnames without a dot (no TLD)
  if (!hostname.includes('.')) {
    return hostname === 'localhost';
  }

  // Reject punycode-only hostnames without a valid TLD structure
  const parts = hostname.split('.');
  if (parts.length < 2) return false;

  // TLD must be at least 2 characters
  const tld = parts[parts.length - 1];
  if (tld.length < 2) return false;

  for (const part of parts) {
    if (part.length === 0) return false;
  }

  return true;
}

/**
 * Compute Levenshtein distance between two strings.
 * Used to detect typosquatting domains that differ by 1-2 characters.
 */
function levenshteinDistance(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  // Use a single array for DP to keep memory O(n)
  let prev = new Array(n + 1);
  for (let j = 0; j <= n; j++) prev[j] = j;
  for (let i = 1; i <= m; i++) {
    const curr = new Array(n + 1);
    curr[0] = i;
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(
        curr[j - 1] + 1,      // insertion
        prev[j] + 1,          // deletion
        prev[j - 1] + cost,   // substitution
      );
    }
    prev = curr;
  }
  return prev[n];
}

/**
 * Known homoglyph mappings: characters that look alike but are different.
 * Used to detect homoglyph attacks where attackers replace characters
 * with visually similar ones (e.g., '0' ↔ 'o', '1' ↔ 'l').
 */
const HOMOGLYPH_GROUPS: string[][] = [
  ['0', 'o', 'ο'],        // digit zero, Latin o, Greek omicron
  ['1', 'l', 'i', '|'],   // digit one, lowercase L, lowercase i
  ['rn', 'm'],             // 'rn' looks like 'm'
  ['vv', 'w'],             // 'vv' looks like 'w'
  ['5', 's'],              // digit five, lowercase s
  ['9', 'g'],              // digit nine, lowercase g
  ['cl', 'd'],             // 'cl' looks like 'd'
  ['nn', 'm'],             // 'nn' looks like 'm'
];

/**
 * Normalize a string by replacing homoglyph characters with their
 * canonical form. This allows comparing domains that use lookalike
 * characters to impersonate another domain.
 */
function normalizeHomoglyphs(s: string): string {
  let result = s;
  for (const group of HOMOGLYPH_GROUPS) {
    // Use the first character in the group as the canonical form
    const canonical = group[0];
    for (let i = 1; i < group.length; i++) {
      result = result.split(group[i]).join(canonical);
    }
  }
  return result;
}

/**
 * Check if a domain is suspicious relative to the base domain.
 *
 * Previous implementation was too aggressive — it flagged ALL domains with a
 * different TLD or SLD, which produced massive false positives since most
 * external links are to legitimate, unrelated domains.
 *
 * The new approach only flags truly suspicious patterns:
 *  1. Typosquatting: domain SLD has Levenshtein distance 1-2 from base SLD
 *     AND uses a different TLD (e.g., "g00gle.com" vs "google.com")
 *  2. Homoglyph attacks: after normalizing lookalike characters, the SLD
 *     matches the base SLD but the original doesn't (e.g., "g00gle.com")
 *  3. Deceptive subdomain/hyphen patterns: domains that embed the base domain
 *     name as a subdomain or prefix with a hyphen to appear legitimate
 *     (e.g., "google.evil.com" or "google-evil.com")
 *  4. Trusted domains whitelist is still respected
 */
export function isSuspiciousDomain(domain: string, baseDomain: string): boolean {
  // Skip trusted domains entirely
  if (TRUSTED_DOMAINS.has(domain)) return false;

  // Don't flag IP addresses
  if (IPV4_REGEX.test(domain) || IPV6_REGEX.test(domain)) return false;

  const baseParts = baseDomain.split('.');
  const domainParts = domain.split('.');

  if (baseParts.length < 2 || domainParts.length < 2) return false;

  const baseSld = baseParts.slice(-2)[0].toLowerCase();
  const domainSld = domainParts.slice(-2)[0].toLowerCase();
  const baseTld = baseParts.slice(-1)[0].toLowerCase();
  const domainTld = domainParts.slice(-1)[0].toLowerCase();

  // If the SLD is identical and TLD is the same, it's not suspicious
  if (baseSld === domainSld && baseTld === domainTld) return false;

  // ─── Check 1: Typosquatting (Levenshtein distance 1-2 + different TLD) ───
  // Only flag if the SLD is very similar to the base SLD (off by 1-2 chars)
  // AND the TLD is different — this catches g00gle.com, gooogle.com, etc.
  if (baseTld !== domainTld) {
    const dist = levenshteinDistance(baseSld, domainSld);
    if (dist >= 1 && dist <= 2) return true;
  }

  // ─── Check 2: Homoglyph attacks ─────────────────────────────────────────
  // After normalizing lookalike characters, if the SLDs match but the
  // originals don't, a homoglyph substitution was used
  const normalizedBaseSld = normalizeHomoglyphs(baseSld);
  const normalizedDomainSld = normalizeHomoglyphs(domainSld);
  if (normalizedBaseSld === normalizedDomainSld && baseSld !== domainSld) {
    return true;
  }

  // ─── Check 3: Deceptive patterns ────────────────────────────────────────
  // Patterns like "basedomain-evil.com" or "basedomain.evil.com"
  // where the base SLD appears as a prefix with a hyphen or as a subdomain
  const domainLower = domain.toLowerCase();
  const baseSldLower = baseSld.toLowerCase();

  // Hyphen deception: baseDomain-anything.tld (e.g., google-evil.com)
  if (domainSld.startsWith(baseSldLower + '-') || domainSld.startsWith(baseSldLower + '_')) {
    return true;
  }

  // Subdomain deception: baseDomain.evil.tld (e.g., google.evil.com)
  // Check if any domain part (except the last two, which are SLD+TLD) matches the base SLD
  if (domainParts.length > 2) {
    const subdomainParts = domainParts.slice(0, -2);
    for (const part of subdomainParts) {
      if (part.toLowerCase() === baseSldLower) return true;
    }
  }

  return false;
}
