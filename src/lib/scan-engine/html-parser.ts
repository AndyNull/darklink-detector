import * as cheerio from 'cheerio';
import type { UrlDetailData, DarkLinkData, DarkLinkType, Severity } from './types';
import { TRUSTED_DOMAINS, URL_SHORTENERS, extractDomain, isValidDomain, isSuspiciousDomain } from './shared-constants';

// ─── Public types ────────────────────────────────────────────────────────────

export interface ParsedResult {
  title: string;
  urlDetails: UrlDetailData[];
  darkLinkDetails: DarkLinkData[];
}

// Internal tracking for source classification
interface RawUrlEntry {
  url: string;
  tag?: string;
  attribute?: string;
  text?: string;
  source: string; // e.g. "tag", "inline-script", "css-url", "data-attr", "comment", "meta-tag", "json-ld", "regex-scan"
  // Visibility info (populated during tag extraction for elements we have direct references to)
  isVisible?: boolean;
  hideReason?: string;
  visibilityReasons?: Array<{ type: DarkLinkType; severity: Severity; description: string; evidence: string }>;
}

// ─── TLD list for domain regex ───────────────────────────────────────────────

const TLD_LIST = [
  'com', 'cn', 'net', 'org', 'gov', 'edu', 'io', 'xyz', 'top', 'cc',
  'vip', 'club', 'site', 'online', 'info', 'me', 'tv', 'co', 'biz', 'name',
  'pro', 'wang', 'shop', 'ltd', 'ink', 'mobi', 'kim', 'group', 'work', 'law',
  'beer', 'fit', 'yoga', 'run', 'pub', 'wiki', 'design', 'live', 'studio', 'red',
  'loan', 'men', 'click', 'link', 'trade', 'date', 'party', 'download', 'stream',
  'racing', 'win', 'review', 'science', 'accountant', 'faith', 'cricket', 'space',
  'dev', 'app', 'ai', 'tech', 'store', 'fun', 'host', 'press', 'website', 'pw',
].join('|');

// ─── Malicious keywords (Chinese + English) ──────────────────────────────────

const MALICIOUS_KEYWORDS = [
  // ─── Chinese malicious keywords - 暗链常见中文关键词 ───
  // 赌博/博彩
  '赌博', '彩票', '赌场', '博彩', '六合彩', '时时彩', '网络赌博', '在线赌场',
  '时时彩平台', '极速赛车', '飞艇', '快3', '快三', '黑彩', '私彩', '福利彩',
  '澳门', '葡京', '皇冠', '威尼斯人', '金沙', '太阳城', '博狗', '新葡京', '永利', '美高梅',
  '188bet', 'bet365', 'betway', '1xbet',
  'AG百家乐', 'BBIN', 'PT电子',
  '皇冠体育', '乐鱼体育', '九游会', '尊龙凯时', '开元棋牌',
  '棋牌游戏', '斗地主赢钱', '抢庄牛牛', '龙虎斗', '真人荷官',
  '注册领红包', '充值赠送', '首存优惠', '存送优惠', '反水优惠',
  '百家乐', '21点', '老虎机', '转盘', '摇钱树',
  '幸运彩票', '彩票预测', '开奖结果', '彩票助手',
  '老虎机攻略', '百家乐公式', '必赢策略', '包赢',
  // 色情/成人
  '色情', '成人网站', '色网', '招嫖', '成人直播', '色播', '裸聊',
  '同城约', '一夜情', '约炮', '裸聊', '色诱',
  // 贷款/金融
  '贷款', '借款', '小贷', '网贷', '现金贷',
  // 非法服务
  '代孕', '办证', '刷单', '仿牌', '假证', '私服', '外挂',
  '微信加粉', '涨粉', '买粉', '代开', '代发', '代刷',
  '黑客', '钓鱼', '木马', '挂马', '暗网', '洗钱', '传销', '诈骗',
  '黑产', '网赚', '刷信誉',
  // 加密货币诈骗
  '量化交易', '合约交易', '币圈', '炒币', '虚拟货币投资', '数字货币投资',
  '申购分红', '认购返利', '理财收益保障', '高频套利', '保本理财',
  '数字货币平台', '虚拟币交易', '加密资产', '币圈韭菜', '空气币',
  // 钓鱼/身份盗窃
  '身份验证过期', '账号异常', '安全认证', '实名补录', '密码过期', '限制登录', '账号解冻',
  '紧急通知', '系统升级验证', '安全风险', '账户被锁', '实名认证过期',
  '银行卡冻结', '微信支付异常', '支付宝异常', '验证身份',
  // 诈骗相关
  '兼职刷单', '淘宝刷单', '刷信誉兼职', '日赚千元', '轻松赚钱',
  '网络兼职', '在家赚钱', '手机赚钱', '免费赚钱',
  '高息理财', '稳赚不赔', '投资返利', '天天分红',
  '仿品', '高仿', '精仿', '原单', '尾单',
  // 赌博平台
  'AG平台', 'MG平台', 'PT平台', 'BG平台', 'GG平台',
  '开元平台', '乐游平台', '皇冠平台',
  '百家乐打法', '龙虎和路', '捕鱼达人', '牛牛规则',
  // SEO作弊
  '外链代发', '黑帽SEO', '快排', '刷排名', '刷流量', '刷点击',
  '站群', '蜘蛛池', '权重出售', '友链出售',
  // 钓鱼关键词
  '官方客服', '在线客服', '客服QQ', '客服微信',
  '限时优惠', '仅限今日', '最后机会',
  // 违法医疗
  '代孕妈妈', '试管代孕', '精子库', '卵子出售',
  '壮阳药', '延时药', '增大药', '性药',
  // 仿冒/走私
  '高仿手表', '高仿包包', '精仿鞋子', 'A货',
  '走私车', '抵押车', '二手车低价',
  '仿真枪', '电击器', '防身器材',
  // ─── Japanese malicious keywords (暗链常见日语关键词) ───
  'ギャンブル', 'カジノ', '賭博', 'ポーカー', 'スロット',
  '出会い系', '風俗', 'アダルト', 'エロ', '裸',
  '闇金', '借入', '融資', '即日融資',
  'パチンコ', 'パチスロ', '競馬', '競艇', 'オートレース',
  '偽造', 'マルウェア', 'フィッシング',
  'ベラジョン', 'ビットカジノ', 'カジノシークレット', 'ジパングカジノ',
  '出会い', '割り切り', 'デリヘル', 'ソープ',
  '闇バイト', '軽作業', '高収入',
  // ─── Korean malicious keywords (暗链常见韩語关键词) ───
  '도박', '카지노', '베팅', '포커', '슬롯',
  '성인', '음란', '유흥', '출장마사지',
  '대출', '급전', '일수', '대부',
  '바카라', '룰렛', '블랙잭', '스포츠토토', '사설바카라',
  '위조', '피싱', '악성코드',
  '우리카지노', '코인카지노', '온카지노',
  '먹튀', '토토사이트', '안전놀이터',
  // ─── Russian malicious keywords (暗链常见俄语关键词) ───
  'казино', 'рулетка', 'слот', 'букмекер', 'ставка',
  'вулкан', 'азино', 'эльдорадо', 'джойказино',
  'подделка', 'взлом', 'фишинг', 'мошенничество',
  // ─── English malicious keywords ───
  'gambling', 'casino', 'betting', 'poker', 'slot',
  'pharma', 'viagra', 'cialis', 'levitra', 'oxycodone',
  'porn', 'adult-content', 'adult-chat', 'xxx', 'naked', 'escort',
  'payday-loan', 'quick-loan', 'cash-advance',
  'hack', 'crack', 'keygen', 'warez', 'pirate',
  'phishing', 'malware', 'ransomware', 'trojan',
  'counterfeit', 'replica', 'fake-id',
  'crypto-scam', 'ponzi', 'hyip', 'ico-scam',
  'blackhat', 'exploit-kit', 'c2-server', 'botnet',
  'steroids', 'anabolic', 'xanax', 'adderall',
  'forex-scam', 'binary-options', 'investment-scam',
  'email-harvest', 'credential-stuffing', 'brute-force',
  // ─── Suspicious path patterns commonly used for dark links ───
  '/go.php', '/link.php', '/redirect.php', '/jump.php', '/out.php',
  '/go.html', '/link.html', '/url.php', '/click.php',
  '/tj.php', '/st.php', '/count.php', '/track.php', '/aff.php', '/ref.php',
  '/t.php', '/s.php', '/tu.php', '/ad.php', '/ads.php',
  '/jump/', '/go/', '/out/', '/redirect/', '/click/', '/aff/', '/ref/',
  '/goto/', '/forward/', '/redir/', '/traffic/', '/promo/',
  '/partner/', '/sponsor/', '/campaign/', '/landing/',
];

// ─── Suspicious URL shorteners ───────────────────────────────────────────────
// (imported from shared-constants.ts)

// ─── Cheap / abusable TLDs ───────────────────────────────────────────────────

const CHEAP_TLDS = [
  'xyz', 'top', 'cc', 'vip', 'club', 'site', 'online', 'info',
  'biz', 'name', 'wang', 'shop', 'ltd', 'ink', 'mobi', 'kim',
  'loan', 'men', 'click', 'link', 'trade', 'date', 'party',
  'download', 'stream', 'racing', 'win', 'review', 'science',
  'accountant', 'faith', 'cricket', 'pw', 'gq', 'cf', 'ml', 'ga', 'tk',
  'buzz', 'icu', 'monster', 'cam', 'cyou', 'rest', 'bar', 'bond', 'cfd', 'sbs',
  // Additional cheap/abusable TLDs
  'fun', 'host', 'press', 'website', 'space', 'tech', 'store',
  'work', 'law', 'beer', 'fit', 'yoga', 'run', 'pub', 'wiki', 'design',
  'live', 'studio', 'red', 'pro', 'app', 'dev', 'ai',
  'surf', 'skin', 'hair', 'beauty', 'mom', 'dad', 'lol', 'gay',
  'quest', 'place', 'world', 'zone', 'cool', 'ninja', 'rocks',
  'help', 'how', 'guide', 'directory', 'services', 'solutions',
  'agency', 'builders', 'catering', 'cleaning', 'contractors',
  'dentist', 'engineer', 'florist', 'guru', 'immobilien',
  'international', 'lighting', 'plumbing', 'repairs', 'shoes',
  'cheap', 'discount', 'free', 'promo', 'deals', 'bargain',
  'bid', 'auction', 'market', 'marketplace',
];

// ─── Performance: Pre-compile Sets for O(1) lookup ─────────────────────────────

const URL_SHORTENERS_SET = new Set(URL_SHORTENERS);
const CHEAP_TLDS_SET = new Set(CHEAP_TLDS);

// ─── Trusted CDN/Service domains (whitelist for suspicious_domain detection) ───
// (imported from shared-constants.ts)

// ─── Legit services on cheap TLDs (skip cheap_tld detection for these) ────────

const LEGIT_CHEAP_TLD_DOMAINS = new Set([
  'github.io', 'netlify.app', 'vercel.app', 'herokuapp.com',
  'pages.dev', 'surge.sh', 'gitlab.io', 'readthedocs.io',
  'cloudfront.net', 'amazonaws.com', 'azureedge.net',
  'slack-edge.com', 'atlassian.net', 'shopify.com',
  'onrender.com', 'railway.app', 'fly.dev', 'deno.dev',
  'supabase.co', 'hasura.app', 'firebaseapp.com',
  'elasticbeanstalk.com', 'azurewebsites.net',
]);

// ─── Pre-compiled malicious keyword regex for fast matching ────────────────────

const MALICIOUS_KEYWORD_REGEX = new RegExp(
  MALICIOUS_KEYWORDS
    .map(kw => kw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')) // escape regex special chars
    .sort((a, b) => b.length - a.length) // longer keywords first for greedy match
    .join('|'),
  'i'
);

// ─── Main entry: parseHtml ───────────────────────────────────────────────────

export function parseHtml(html: string, baseUrl: string, disabledRules: string[] = []): ParsedResult {
  const $ = cheerio.load(html);
  const title = $('title').text().trim() || '';
  const baseDomain = extractDomain(baseUrl);
  const seenUrls = new Map<string, RawUrlEntry>(); // dedup by url+tag+attribute+source
  const urlDetails: UrlDetailData[] = [];
  const darkLinkDetails: DarkLinkData[] = [];

  // Helper: check if a detection rule is enabled (not in disabledRules)
  const ruleEnabled = (id: string) => !disabledRules.includes(id);

  // Resolve any <base href="..."> tag
  const baseHref = $('base').attr('href');
  const effectiveBase = baseHref ? resolveUrl(baseHref, baseUrl) || baseUrl : baseUrl;

  // Collect all raw URL entries from every extraction method
  const rawEntries: RawUrlEntry[] = [];

  // 1. Enhanced basic tag extraction
  rawEntries.push(...extractBasicTags($, effectiveBase));

  // 2. Inline script extraction
  rawEntries.push(...extractInlineScripts($, effectiveBase));

  // 3. Inline style / CSS extraction
  rawEntries.push(...extractCssUrls($, effectiveBase, html));

  // 4. Data attribute extraction
  rawEntries.push(...extractDataAttributes($, effectiveBase));

  // 5. HTML comment extraction
  rawEntries.push(...extractCommentUrls(html, effectiveBase));

  // 6. Meta tag extraction
  rawEntries.push(...extractMetaTags($, effectiveBase));

  // 7. JSON-LD extraction
  rawEntries.push(...extractJsonLd($, effectiveBase));

  // 8. Raw HTML regex scan (catch-all)
  rawEntries.push(...extractRegexScan(html, effectiveBase));

  // 9. Noscript content extraction (hidden dark links visible only when JS disabled)
  rawEntries.push(...extractNoscriptUrls($, effectiveBase));

  // 10. Data-URI link detection
  rawEntries.push(...extractDataUriLinks($, effectiveBase));

  // 11. Object/embed deep inspection
  rawEntries.push(...extractObjectEmbedUrls($, effectiveBase));

  // ─── Domain-level deduplication ─────────────────────────────────────────────
  // Same domain with different paths/parameters is not meaningful — we only keep
  // one representative URL per domain, plus a count of how many URLs were found.
  // Dark-link checks still run on ALL URLs before dedup, so nothing is missed.

  // Track per-domain aggregate info
  const domainMap = new Map<string, {
    representativeUrl: string;
    domain: string;
    isExternal: boolean;
    isVisible: boolean;    // true if ANY URL under this domain is visible
    hasHidden: boolean;    // true if ANY URL under this domain is hidden
    hideReasons: string[];
    urlCount: number;
    sources: Set<string>;
    tags: Set<string>;
    text?: string;         // anchor text from first visible link
  }>();

  // Also collect all dark link detections before dedup
  const allDarkLinkEntries: DarkLinkData[] = [];

  for (const entry of rawEntries) {
    const entryKey = `${entry.url}|${entry.tag || ''}|${entry.attribute || ''}|${entry.source}`;
    if (seenUrls.has(entryKey)) continue;
    seenUrls.set(entryKey, entry);

    const domain = extractDomain(entry.url);
    if (!domain) continue;
    const isExternal = domain !== baseDomain;

    // Run dark-link checks on EVERY URL (before dedup)
    const isVisible = entry.isVisible !== undefined ? entry.isVisible : true;
    const hideReason = entry.hideReason;

    // Generate dark link entries for hidden tag-based elements
    // Only flag if the corresponding rule is enabled
    if (!isVisible && entry.visibilityReasons && entry.visibilityReasons.length > 0) {
      for (const reason of entry.visibilityReasons) {
        // Map DarkLinkType to rule ID (data_uri_link → data_uri, noscript_hidden → noscript_hidden, etc.)
        const ruleId = reason.type === 'data_uri_link' ? 'data_uri' : reason.type;
        if (!ruleEnabled(ruleId)) continue;
        allDarkLinkEntries.push({
          url: entry.url,
          tag: entry.tag,
          text: entry.text || undefined,
          type: reason.type,
          severity: reason.severity,
          description: reason.description,
          evidence: reason.evidence,
        });
      }
    }

    // Non-visibility-based dark link sources
    if (entry.source === 'inline-script') {
      if (ruleEnabled('js_injected')) {
        const isExternalUrl = baseDomain && entry.url && !entry.url.includes(baseDomain);
        const srcAttr = entry.tag === 'script' ? 'inline <script>' : `<${entry.tag}>`;
        allDarkLinkEntries.push({
          url: entry.url,
          tag: entry.tag || 'script',
          text: entry.text || undefined,
          type: 'js_injected',
          severity: isExternalUrl ? 'high' : 'medium',
          description: isExternalUrl
            ? '内联JavaScript注入外部URL — 高风险动态注入'
            : '内联JavaScript中的URL — 可能被动态注入',
          evidence: `来源: ${srcAttr}内联脚本, URL上下文: ${entry.text || 'N/A'}`,
        });
      }
    }

    // Aggregate per-domain info
    const existing = domainMap.get(domain);
    if (existing) {
      existing.urlCount++;
      if (isVisible) existing.isVisible = true;
      if (!isVisible) existing.hasHidden = true;
      if (hideReason && !existing.hideReasons.includes(hideReason)) {
        existing.hideReasons.push(hideReason);
      }
      existing.sources.add(entry.source);
      if (entry.tag) existing.tags.add(entry.tag);
      // Keep text from a visible entry if we don't have one yet
      if (!existing.text && entry.text && isVisible) {
        existing.text = entry.text;
      }
    } else {
      domainMap.set(domain, {
        representativeUrl: entry.url,
        domain,
        isExternal,
        isVisible,
        hasHidden: !isVisible,
        hideReasons: hideReason ? [hideReason] : [],
        urlCount: 1,
        sources: new Set([entry.source]),
        tags: new Set(entry.tag ? [entry.tag] : []),
        text: isVisible ? entry.text : undefined,
      });
    }
  }

  // Build urlDetails from domain-level aggregation
  for (const [, info] of domainMap) {
    // A domain is "not visible" only if ALL its URLs are hidden
    const domainIsVisible = info.isVisible;
    const domainHideReason = info.hasHidden && !info.isVisible
      ? info.hideReasons.join('; ')
      : (info.hasHidden ? '部分URL隐藏' : undefined);

    urlDetails.push({
      url: info.representativeUrl,
      tag: [...info.tags].slice(0, 3).join(','),
      text: info.text || undefined,
      isExternal: info.isExternal,
      domain: info.domain,
      isVisible: domainIsVisible,
      hideReason: domainHideReason,
      urlCount: info.urlCount,
      sources: [...info.sources],
      tags: [...info.tags],
    });
  }

  // Deduplicate dark links by domain+type (avoid 50 identical entries for same domain)
  const darkLinkSeen = new Set<string>();
  for (const dl of allDarkLinkEntries) {
    const dlDomain = extractDomain(dl.url);
    const dedupKey = `${dlDomain}|${dl.type}`;
    if (darkLinkSeen.has(dedupKey)) continue;
    darkLinkSeen.add(dedupKey);
    darkLinkDetails.push(dl);
  }

  // Detect hidden iframes (special case, always critical)
  if (ruleEnabled('iframe_hidden')) {
  $('iframe').each((_, el) => {
    const src = $(el).attr('src');
    if (!src) return;
    const resolvedUrl = resolveUrl(src, effectiveBase);
    if (!resolvedUrl) return;

    const width = $(el).attr('width') || getCssValue($, el, 'width');
    const height = $(el).attr('height') || getCssValue($, el, 'height');
    const style = ($(el).attr('style') || '').replace(/\s+/g, '').toLowerCase();

    if (isZeroSize(width) || isZeroSize(height) || isOnePixelSize(width) || isOnePixelSize(height) || style.includes('display:none') || style.includes('visibility:hidden')) {
      const dlDomain = extractDomain(resolvedUrl);
      const dedupKey = `${dlDomain}|iframe_hidden`;
      if (!darkLinkSeen.has(dedupKey)) {
        darkLinkSeen.add(dedupKey);
        darkLinkDetails.push({
          url: resolvedUrl,
          tag: 'iframe',
          type: 'iframe_hidden',
          severity: 'high',
          description: '检测到隐藏iframe — 可能用于暗链',
          evidence: `发现于<iframe>标签, CSS/style隐藏, src="${src}" width="${width || 'auto'}" height="${height || 'auto'}"`,
        });
      }
    }
  });
  }

  // Detect suspicious external links (domain mismatch)
  // Skip domains in the trusted CDN/service whitelist
  if (ruleEnabled('suspicious_domain')) {
  $('a[href]').each((_, el) => {
    const href = $(el).attr('href');
    if (!href) return;
    const resolvedUrl = resolveUrl(href, effectiveBase);
    if (!resolvedUrl) return;
    const domain = extractDomain(resolvedUrl);
    if (domain && baseDomain && domain !== baseDomain) {
      // Skip trusted CDN/analytic domains
      if (TRUSTED_DOMAINS.has(domain)) return;
      const text = $(el).text().trim();
      const visibility = analyzeVisibility($, el, 'a');
      if (!visibility.isVisible || isSuspiciousDomain(domain, baseDomain)) {
        const dedupKey = `${domain}|suspicious_domain`;
        if (!darkLinkSeen.has(dedupKey)) {
          darkLinkSeen.add(dedupKey);
          darkLinkDetails.push({
            url: resolvedUrl,
            tag: 'a',
            text: text || undefined,
            type: 'suspicious_domain',
            severity: 'medium',
            description: `外部链接指向可疑域名: ${domain}`,
            evidence: `发现于<a>标签, href属性, text="${text || ''}"`,
          });
        }
      }
    }
  });
  }

  // ─── 10. Enhanced dark link detection rules ──────────────────────────────────

  // 10a. Malicious keyword detection in URL paths (already domain-deduped via urlDetails)
  // Uses pre-compiled regex for O(1) performance instead of array iteration
  if (ruleEnabled('malicious_keyword')) {
  for (const detail of urlDetails) {
    const urlLower = detail.url.toLowerCase();
    const match = urlLower.match(MALICIOUS_KEYWORD_REGEX);
    if (match) {
      const matchedKeyword = match[0];
      const dedupKey = `${detail.domain}|malicious_keyword`;
      if (!darkLinkSeen.has(dedupKey)) {
        darkLinkSeen.add(dedupKey);
        darkLinkDetails.push({
          url: detail.url,
          tag: detail.tag,
          text: detail.text || undefined,
          type: 'malicious_keyword',
          severity: 'critical',
          description: `URL包含恶意关键词: "${matchedKeyword}"`,
          evidence: `keyword="${matchedKeyword}" in url="${detail.url}" (domain: ${detail.domain}, ${detail.urlCount || 1} URLs)`,
        });
      }
    }
  }
  }

  // 10b. Suspicious URL shortener detection (already domain-deduped)
  // Uses Set for O(1) lookup instead of Array.includes()
  if (ruleEnabled('suspicious_shortener')) {
  for (const detail of urlDetails) {
    const domain = detail.domain;
    if (domain && URL_SHORTENERS_SET.has(domain)) {
      const dedupKey = `${domain}|suspicious_shortener`;
      if (!darkLinkSeen.has(dedupKey)) {
        darkLinkSeen.add(dedupKey);
        darkLinkDetails.push({
          url: detail.url,
          tag: detail.tag,
          text: detail.text || undefined,
          type: 'suspicious_shortener',
          severity: 'medium',
          description: `URL使用可疑短链服务: ${domain}`,
          evidence: `shortener_domain="${domain}" (${detail.urlCount || 1} URLs)`,
        });
      }
    }
  }
  }

  // 10c. Cheap/suspicious TLD detection (already domain-deduped)
  // Uses Set for O(1) lookup; skips legit services on cheap TLDs
  if (ruleEnabled('cheap_tld')) {
  for (const detail of urlDetails) {
    if (!detail.isExternal) continue;
    const domain = detail.domain;
    if (domain) {
      // Skip well-known legitimate services on cheap TLDs
      if (LEGIT_CHEAP_TLD_DOMAINS.has(domain)) continue;
      const tld = domain.split('.').pop()?.toLowerCase() || '';
      if (CHEAP_TLDS_SET.has(tld)) {
        const dedupKey = `${domain}|cheap_tld`;
        if (!darkLinkSeen.has(dedupKey)) {
          darkLinkSeen.add(dedupKey);
          darkLinkDetails.push({
            url: detail.url,
            tag: detail.tag,
            text: detail.text || undefined,
            type: 'cheap_tld',
            severity: 'low',
            description: `外部链接使用廉价/易滥用顶级域名: .${tld}`,
            evidence: `tld=".${tld}" domain="${domain}" (${detail.urlCount || 1} URLs)`,
          });
        }
      }
    }
  }
  }

  // 10d. Hidden text detection (same color as background, zero font-size)
  if (ruleEnabled('hidden_text')) {
  $('*').each((_, el) => {
    const $el = $(el);
    const style = ($el.attr('style') || '').replace(/\s+/g, ' ').trim();

    // Check for zero font-size text
    const fontSizeMatch = style.match(/font-size\s*:\s*([\d.]+)\s*(px|em|rem|pt)?/i);
    if (fontSizeMatch) {
      const size = parseFloat(fontSizeMatch[1]);
      if (size === 0) {
        const text = $el.text().trim();
        if (text) {
          const links = $el.find('a[href]');
          links.each((__, linkEl) => {
            const href = $(linkEl).attr('href');
            if (!href) return;
            const resolvedUrl = resolveUrl(href, effectiveBase);
            if (resolvedUrl) {
              const dlDomain = extractDomain(resolvedUrl);
              const dedupKey = `${dlDomain}|hidden_text`;
              if (!darkLinkSeen.has(dedupKey)) {
                darkLinkSeen.add(dedupKey);
                darkLinkDetails.push({
                  url: resolvedUrl,
                  tag: 'a',
                  text: text.substring(0, 100),
                  type: 'hidden_text',
                  severity: 'critical',
                  description: '零字号文本中的链接 — 隐藏内容',
                  evidence: `CSS属性: font-size:0, 标签文本: "${text.substring(0, 80)}"`,
                });
              }
            }
          });
        }
      }
    }

    // Check for text same color as background (enhanced)
    const colorMatch = style.match(/(?:^|;)\s*color\s*:\s*([#\w]+)/i);
    const bgColorMatch = style.match(/background(?:-color)?\s*:\s*([#\w]+)/i);
    if (colorMatch && bgColorMatch) {
      const textColor = colorMatch[1].toLowerCase();
      const bgColor = bgColorMatch[1].toLowerCase();
      if (textColor === bgColor || normalizeColor(textColor) === normalizeColor(bgColor)) {
        const links = $el.find('a[href]');
        links.each((__, linkEl) => {
          const href = $(linkEl).attr('href');
          if (!href) return;
          const resolvedUrl = resolveUrl(href, effectiveBase);
          if (resolvedUrl) {
            const dlDomain = extractDomain(resolvedUrl);
            const dedupKey = `${dlDomain}|hidden_text`;
            if (!darkLinkSeen.has(dedupKey)) {
              darkLinkSeen.add(dedupKey);
              darkLinkDetails.push({
                url: resolvedUrl,
                tag: 'a',
                text: $el.text().trim().substring(0, 100) || undefined,
                type: 'hidden_text',
                severity: 'critical',
                description: '链接文字颜色与背景色相同 — 隐藏文字',
                evidence: `CSS属性: color=${textColor}, background-color=${bgColor}, 文字与背景同色`,
              });
            }
          }
        });
      }
    }
  });
  }

  // 10e. Keyword stuffing detection in meta tags
  if (ruleEnabled('keyword_stuffing')) {
  const metaContent = $('meta[name="keywords"], meta[name="description"]').map((_, el) => $(el).attr('content') || '').get().join(' ');
  if (metaContent) {
    const metaLower = metaContent.toLowerCase();
    const stuffedKeywords = MALICIOUS_KEYWORDS.filter(kw => metaLower.includes(kw));
    if (stuffedKeywords.length >= 2) {
      darkLinkDetails.push({
        url: baseUrl,
        tag: 'meta',
        type: 'keyword_stuffing',
        severity: 'high',
        description: `Meta标签包含${stuffedKeywords.length}个可疑关键词: ${stuffedKeywords.slice(0, 5).join(', ')}`,
        evidence: `keywords_found="${stuffedKeywords.slice(0, 5).join(', ')}" meta_content="${metaContent.substring(0, 200)}"`,
      });
    }
  }
  }

  // 10f. Hidden divs with links (0x0 divs containing links)
  if (ruleEnabled('hidden_div_link')) {
  $('div, span, p').each((_, el) => {
    const $el = $(el);
    const style = ($el.attr('style') || '').replace(/\s+/g, ' ').trim().toLowerCase();

    // Check for zero-size containers with links
    const isZeroDiv = /\b(width|height)\s*:\s*0(px)?\b/.test(style) ||
      /\bdisplay\s*:\s*none\b/.test(style) ||
      /\boverflow\s*:\s*hidden\b/.test(style) && /\b(width|height)\s*:\s*[01](px)?\b/.test(style);

    if (isZeroDiv) {
      const links = $el.find('a[href]');
      links.each((__, linkEl) => {
        const href = $(linkEl).attr('href');
        if (!href || href.startsWith('#') || href.toLowerCase().startsWith('javascript:')) return;
        const resolvedUrl = resolveUrl(href, effectiveBase);
        if (!resolvedUrl) return;
        const dlDomain = extractDomain(resolvedUrl);
        const dedupKey = `${dlDomain}|hidden_div_link`;
        if (!darkLinkSeen.has(dedupKey)) {
          darkLinkSeen.add(dedupKey);
          darkLinkDetails.push({
            url: resolvedUrl,
            tag: 'a',
            text: $(linkEl).text().trim().substring(0, 100) || undefined,
            type: 'hidden_div_link',
            severity: 'critical',
            description: '隐藏容器(div/span/p)中的链接 — 疑似暗链',
            evidence: `CSS属性: ${style.substring(0, 100)}, 隐藏原因: ${/\bdisplay\s*:\s*none\b/.test(style) ? 'display:none' : /\b(width|height)\s*:\s*0/.test(style) ? '尺寸为0' : 'overflow:hidden+小尺寸'}, link_href="${href}"`,
          });
        }
      });
    }
  });
  }

  // 10g. 0x0 iframes (additional check beyond existing hidden iframe detection)
  if (ruleEnabled('iframe_hidden')) {
  $('iframe').each((_, el) => {
    const src = $(el).attr('src');
    if (!src) return;
    const resolvedUrl = resolveUrl(src, effectiveBase);
    if (!resolvedUrl) return;

    const width = $(el).attr('width') || '';
    const height = $(el).attr('height') || '';
    const style = ($(el).attr('style') || '').replace(/\s+/g, '').toLowerCase();

    // Check for 0x0 or 1x1 iframes (even without explicit display:none)
    if ((width === '0' || width === '1' || height === '0' || height === '1') ||
        (style.includes('width:0') || style.includes('width:1') || style.includes('height:0') || style.includes('height:1'))) {
      const dlDomain = extractDomain(resolvedUrl);
      const dedupKey = `${dlDomain}|iframe_hidden`;
      if (!darkLinkSeen.has(dedupKey)) {
        darkLinkSeen.add(dedupKey);
        darkLinkDetails.push({
          url: resolvedUrl,
          tag: 'iframe',
          type: 'iframe_hidden',
          severity: 'critical',
          description: '检测到0x0或1x1的iframe — 典型暗链手法',
          evidence: `发现于<iframe>标签, 尺寸: ${width}x${height}, src="${src}"`,
        });
      }
    }
  });
  }

  // 10h. Base tag abuse detection — <base href> pointing to external domain
  if (ruleEnabled('base_redirect') && baseHref && baseDomain) {
    const baseHrefDomain = extractDomain(effectiveBase);
    if (baseHrefDomain && baseHrefDomain !== baseDomain) {
      const dedupKey = `${baseHrefDomain}|base_redirect`;
      if (!darkLinkSeen.has(dedupKey)) {
        darkLinkSeen.add(dedupKey);
        darkLinkDetails.push({
          url: effectiveBase,
          tag: 'base',
          type: 'base_redirect',
          severity: 'critical',
          description: 'Base标签指向外部域名，可能导致所有相对链接被重定向',
          evidence: `base href="${baseHref}" resolved="${effectiveBase}" page_domain="${baseDomain}"`,
        });
      }
    }
  }

  // 10i. Suspicious meta refresh — fast redirect to external domain
  if (ruleEnabled('meta_refresh')) {
  $('meta[http-equiv="refresh"]').each((_, el) => {
    const content = $(el).attr('content') || '';
    // Extract delay (seconds before redirect)
    const delayMatch = content.match(/^(\d+)/);
    if (!delayMatch) return;
    const delay = parseInt(delayMatch[1]);
    // Extract URL
    const urlMatch = content.match(/url\s*=\s*(.+)/i);
    if (!urlMatch) return;
    const rawUrl = urlMatch[1].trim().replace(/^["']|["']$/g, '');
    const resolvedUrl = resolveUrl(rawUrl, effectiveBase);
    if (!resolvedUrl) return;
    const targetDomain = extractDomain(resolvedUrl);
    // Only flag if: short delay (0-2s) AND redirects to external domain
    if (delay <= 2 && targetDomain && baseDomain && targetDomain !== baseDomain) {
      const dedupKey = `${targetDomain}|meta_refresh`;
      if (!darkLinkSeen.has(dedupKey)) {
        darkLinkSeen.add(dedupKey);
        darkLinkDetails.push({
          url: resolvedUrl,
          tag: 'meta',
          type: 'meta_refresh',
          severity: 'high',
          description: '快速Meta刷新重定向到外部域名',
          evidence: `content="${content}" delay=${delay}s target="${targetDomain}"`,
        });
      }
    }
  });
  }

  // 10j. Form action hijacking — <form action> pointing to external domain
  if (ruleEnabled('form_hijack')) {
  $('form').each((_, el) => {
    const action = $(el).attr('action');
    if (!action) return;
    const resolvedUrl = resolveUrl(action, effectiveBase);
    if (!resolvedUrl) return;
    const targetDomain = extractDomain(resolvedUrl);
    if (targetDomain && baseDomain && targetDomain !== baseDomain) {
      // Check for hidden inputs (data exfiltration risk)
      const hiddenInputs = $(el).find('input[type="hidden"]');
      const hasHiddenInputs = hiddenInputs.length > 0;
      const dedupKey = `${targetDomain}|form_hijack`;
      if (!darkLinkSeen.has(dedupKey)) {
        darkLinkSeen.add(dedupKey);
        darkLinkDetails.push({
          url: resolvedUrl,
          tag: 'form',
          type: 'form_hijack',
          severity: 'high',
          description: '表单提交至外部域名，可能窃取用户数据',
          evidence: `form action="${action}" target="${targetDomain}" hidden_inputs=${hiddenInputs.length}${hasHiddenInputs ? ' ⚠ 含隐藏字段' : ''}`,
        });
      }
    }
  });
  }

  // 10k. SVG-based hiding — <svg> contains hidden <a> links
  if (ruleEnabled('svg_hidden')) {
  $('svg').each((_, svgEl) => {
    const $svg = $(svgEl);
    const svgStyle = ($svg.attr('style') || '').replace(/\s+/g, ' ').trim().toLowerCase();
    const isSvgHidden = /\bdisplay\s*:\s*none\b/i.test(svgStyle) ||
                        /\bvisibility\s*:\s*hidden\b/i.test(svgStyle) ||
                        /\bopacity\s*:\s*0(\.0*)?\b/i.test(svgStyle);

    if (isSvgHidden) {
      // Find <a> elements inside the hidden SVG
      $svg.find('a').each((__, aEl) => {
        const href = $(aEl).attr('href') || $(aEl).attr('xlink:href');
        if (!href || href.startsWith('#') || href.toLowerCase().startsWith('javascript:')) return;
        const resolvedUrl = resolveUrl(href, effectiveBase);
        if (!resolvedUrl) return;
        const dlDomain = extractDomain(resolvedUrl);
        const dedupKey = `${dlDomain}|svg_hidden`;
        if (!darkLinkSeen.has(dedupKey)) {
          darkLinkSeen.add(dedupKey);
          darkLinkDetails.push({
            url: resolvedUrl,
            tag: 'svg',
            type: 'svg_hidden',
            severity: 'high',
            description: 'SVG中包含隐藏链接',
            evidence: `svg_style="${svgStyle.substring(0, 100)}" link_href="${href}"`,
          });
        }
      });
    }
  });
  }

  // ─── 10l. rel="nofollow" suspicious link detection ──────────────────────────
  // Links with rel="nofollow" pointing to external domains are suspicious:
  // the site owner doesn't want search engines to follow these links
  // Only flag if domain is NOT in trusted whitelist
  if (ruleEnabled('nofollow_suspicious')) {
  $('a[rel~="nofollow"]').each((_, el) => {
    const href = $(el).attr('href');
    if (!href || href.startsWith('#') || href.toLowerCase().startsWith('javascript:')) return;
    const resolvedUrl = resolveUrl(href, effectiveBase);
    if (!resolvedUrl) return;
    const domain = extractDomain(resolvedUrl);
    if (domain && baseDomain && domain !== baseDomain) {
      // Skip trusted domains
      if (TRUSTED_DOMAINS.has(domain)) return;
      const text = $(el).text().trim();
      const dedupKey = `${domain}|nofollow_suspicious`;
      if (!darkLinkSeen.has(dedupKey)) {
        darkLinkSeen.add(dedupKey);
        darkLinkDetails.push({
          url: resolvedUrl,
          tag: 'a',
          text: text || undefined,
          type: 'nofollow_suspicious',
          severity: 'medium',
          description: `外部链接带rel="nofollow"指向: ${domain} — 站长不希望搜索引擎追踪`,
          evidence: `href="${href}" rel="nofollow" text="${text}"`,
        });
      }
    }
  });
  }

  // ─── 10m. Link farm detection ──────────────────────────────────────────────
  // Pages with unusually high number of external links to different domains
  // using cheap TLDs or shorteners are likely link farms
  if (ruleEnabled('keyword_stuffing')) {
  {
    const externalDomainCount = urlDetails.filter(d => d.isExternal).length;
    if (externalDomainCount > 30) {
      const cheapOrShortener = urlDetails.filter(d => {
        if (!d.domain || !d.isExternal) return false;
        const tld = d.domain.split('.').pop()?.toLowerCase() || '';
        return CHEAP_TLDS_SET.has(tld) || URL_SHORTENERS_SET.has(d.domain);
      }).length;
      const ratio = cheapOrShortener / externalDomainCount;
      if (ratio > 0.5) {
        const dedupKey = `${baseDomain}|link_farm`;
        if (!darkLinkSeen.has(dedupKey)) {
          darkLinkSeen.add(dedupKey);
          darkLinkDetails.push({
            url: baseUrl,
            tag: 'body',
            type: 'keyword_stuffing',
            severity: 'high',
            description: `疑似链接农场: 页面含${externalDomainCount}个外链域名，其中${cheapOrShortener}个(${Math.round(ratio * 100)}%)使用廉价域名或短链`,
            evidence: `external_domains=${externalDomainCount} cheap_or_shortener=${cheapOrShortener} ratio=${ratio.toFixed(2)}`,
          });
        }
      }
    }
  }
  }

  // ─── 10n. Mixed content hijacking ────────────────────────────────────────────
  // HTTPS pages loading HTTP resources (security downgrade risk)
  if (ruleEnabled('meta_refresh') && baseUrl.startsWith('https://')) {
    const httpResources: string[] = [];
    for (const detail of urlDetails) {
      if (detail.url && detail.url.startsWith('http://')) {
        // Only flag scripts and iframes as high risk
        if (detail.tag && ['script', 'iframe', 'embed', 'object'].some(t => detail.tag!.includes(t))) {
          httpResources.push(detail.url);
        }
      }
    }
    if (httpResources.length > 0) {
      const dedupKey = `${baseDomain}|mixed_content`;
      if (!darkLinkSeen.has(dedupKey)) {
        darkLinkSeen.add(dedupKey);
        darkLinkDetails.push({
          url: baseUrl,
          tag: 'mixed-content',
          type: 'meta_refresh',
          severity: 'high',
          description: `HTTPS页面加载${httpResources.length}个HTTP资源 — 可能被中间人攻击劫持`,
          evidence: `http_resources=${httpResources.length} examples=${httpResources.slice(0, 3).join(', ')}`,
        });
      }
    }
  }

  // ─── 10o. Obfuscated JavaScript detection ────────────────────────────────────
  // Detect eval(), atob(), String.fromCharCode() patterns that may hide malicious URLs
  if (ruleEnabled('js_obfuscated')) {
  {
    const obfuscationPatterns = [
      { pattern: /\beval\s*\(/, name: 'eval()', desc: '使用eval()动态执行代码' },
      { pattern: /\batob\s*\(/, name: 'atob()', desc: '使用Base64解码隐藏内容' },
      { pattern: /String\.fromCharCode\s*\(/, name: 'String.fromCharCode()', desc: '使用字符编码构造URL' },
      { pattern: /unescape\s*\(/, name: 'unescape()', desc: '使用URL解码隐藏内容' },
      { pattern: /decodeURIComponent\s*\(/, name: 'decodeURIComponent()', desc: '使用URI解码构造URL' },
    ];

    $('script').each((_, el) => {
      const content = ($(el).html() || '').trim();
      if (!content) return;
      const type = ($(el).attr('type') || '').toLowerCase();
      if (type === 'application/ld+json') return;

      // Check for URL construction combined with obfuscation
      const hasUrlConstruction = /\.(src|href|location|action)\s*=/.test(content);
      const matchedObfuscation = obfuscationPatterns.find(p => p.pattern.test(content));

      if (matchedObfuscation && hasUrlConstruction) {
        const dedupKey = `${baseDomain}|obfuscated_js`;
        if (!darkLinkSeen.has(dedupKey)) {
          darkLinkSeen.add(dedupKey);
          darkLinkDetails.push({
            url: baseUrl,
            tag: 'script',
            type: 'js_injected',
            severity: 'high',
            description: `检测到混淆JavaScript: ${matchedObfuscation.desc} — 可能隐藏恶意URL`,
            evidence: `obfuscation="${matchedObfuscation.name}" has_url_construction=true`,
          });
        }
      }
    });
  }
  }

  return { title, urlDetails, darkLinkDetails };
}

// ─── 1. Enhanced basic tag extraction ────────────────────────────────────────

function extractBasicTags($: cheerio.CheerioAPI, baseUrl: string): RawUrlEntry[] {
  const entries: RawUrlEntry[] = [];

  // Core link-bearing tags
  const tagAttrPairs: Array<{ tag: string; attr: string }> = [
    { tag: 'a', attr: 'href' },
    { tag: 'img', attr: 'src' },
    { tag: 'script', attr: 'src' },
    { tag: 'link', attr: 'href' },
    { tag: 'iframe', attr: 'src' },
    { tag: 'area', attr: 'href' },
    { tag: 'source', attr: 'src' },
    { tag: 'embed', attr: 'src' },
    { tag: 'object', attr: 'data' },
    { tag: 'form', attr: 'action' },
    // Video / audio
    { tag: 'video', attr: 'src' },
    { tag: 'video', attr: 'poster' },
    { tag: 'audio', attr: 'src' },
    { tag: 'track', attr: 'src' },
    // Portal
    { tag: 'portal', attr: 'src' },
    // Input type=image
    { tag: 'input', attr: 'src' },
    // SVG
    { tag: 'svg', attr: 'href' },
    { tag: 'svg', attr: 'xlink:href' },
    { tag: 'use', attr: 'href' },
    { tag: 'use', attr: 'xlink:href' },
    { tag: 'image', attr: 'href' },
    { tag: 'image', attr: 'xlink:href' },
    // Body background
    { tag: 'body', attr: 'background' },
    // Table backgrounds
    { tag: 'table', attr: 'background' },
    { tag: 'td', attr: 'background' },
    { tag: 'th', attr: 'background' },
    // Base
    { tag: 'base', attr: 'href' },
  ];

  for (const { tag, attr } of tagAttrPairs) {
    $(tag).each((_, el) => {
      // For input, only process type="image"
      if (tag === 'input') {
        const type = ($(el).attr('type') || '').toLowerCase();
        if (type !== 'image') return;
      }

      const rawUrl = $(el).attr(attr);
      if (!rawUrl || rawUrl.startsWith('#') || rawUrl.toLowerCase().startsWith('javascript:') || rawUrl === '') return;

      const resolvedUrl = resolveUrl(rawUrl, baseUrl);
      if (!resolvedUrl) return;

      const text = $(el).text().trim();

      // Run visibility analysis while we have the element reference
      const visibility = analyzeVisibility($, el, tag);

      entries.push({
        url: resolvedUrl,
        tag,
        attribute: attr,
        text: text || undefined,
        source: 'tag',
        isVisible: visibility.isVisible,
        hideReason: visibility.hideReason,
        visibilityReasons: visibility.reasons,
      });

      // Also check srcset on img, source, picture
      if (['img', 'source'].includes(tag) && attr === 'src') {
        const srcset = $(el).attr('srcset');
        if (srcset) {
          const urls = srcset.split(',').map(s => s.trim().split(/\s+/)[0]);
          for (const u of urls) {
            const resolved = resolveUrl(u, baseUrl);
            if (resolved) {
              entries.push({
                url: resolved,
                tag,
                attribute: 'srcset',
                text: undefined,
                source: 'tag',
                isVisible: visibility.isVisible,
                hideReason: visibility.hideReason,
                visibilityReasons: visibility.reasons,
              });
            }
          }
        }
      }
    });
  }

  // Applet tags (legacy but can be abused)
  $('applet').each((_, el) => {
    for (const attr of ['codebase', 'code', 'archive']) {
      const rawUrl = $(el).attr(attr);
      if (!rawUrl) continue;
      const resolvedUrl = resolveUrl(rawUrl, baseUrl);
      if (resolvedUrl) {
        entries.push({
          url: resolvedUrl,
          tag: 'applet',
          attribute: attr,
          text: undefined,
          source: 'tag',
        });
      }
    }
  });

  // <picture> element — extract srcset from <source> children
  $('picture source').each((_, el) => {
    const srcset = $(el).attr('srcset');
    if (srcset) {
      const urls = srcset.split(',').map(s => s.trim().split(/\s+/)[0]);
      for (const u of urls) {
        const resolved = resolveUrl(u, baseUrl);
        if (resolved) {
          entries.push({
            url: resolved,
            tag: 'picture-source',
            attribute: 'srcset',
            text: undefined,
            source: 'tag',
          });
        }
      }
    }
    const src = $(el).attr('src');
    if (src) {
      const resolved = resolveUrl(src, baseUrl);
      if (resolved) {
        entries.push({
          url: resolved,
          tag: 'picture-source',
          attribute: 'src',
          text: undefined,
          source: 'tag',
        });
      }
    }
  });

  // <template> element — parse hidden DOM content for URLs
  $('template').each((_, el) => {
    const content = $(el).html() || '';
    if (content) {
      // Extract URLs from template content using regex
      const urlRegex = /(?:href|src|action|data|background)\s*=\s*["']([^"']+)["']/gi;
      let m: RegExpExecArray | null;
      while ((m = urlRegex.exec(content)) !== null) {
        const resolved = resolveUrl(m[1], baseUrl);
        if (resolved) {
          entries.push({
            url: resolved,
            tag: 'template',
            attribute: 'content',
            text: undefined,
            source: 'tag',
          });
        }
      }
    }
  });

  return entries;
}

// ─── 2. Inline script extraction ─────────────────────────────────────────────

function extractInlineScripts($: cheerio.CheerioAPI, baseUrl: string): RawUrlEntry[] {
  const entries: RawUrlEntry[] = [];

  $('script').each((_, el) => {
    const src = $(el).attr('src');
    const type = ($(el).attr('type') || '').toLowerCase();

    // Skip JSON-LD (handled separately)
    if (type === 'application/ld+json') return;

    const content = $(el).html() || '';
    if (!content.trim()) return;

    // Extract URLs from string literals in JavaScript
    const scriptUrls = extractUrlsFromJsContent(content);
    for (const u of scriptUrls) {
      const resolvedUrl = resolveUrl(u, baseUrl);
      if (resolvedUrl) {
        entries.push({
          url: resolvedUrl,
          tag: 'script',
          attribute: 'inline',
          text: u.length > 200 ? u.substring(0, 200) + '...' : u,
          source: 'inline-script',
        });
      }
    }
  });

  return entries;
}

/**
 * Extract URLs from a block of JavaScript code.
 * Catches string literals, function calls, assignments, template literals, etc.
 */
function extractUrlsFromJsContent(js: string): string[] {
  const urls: string[] = [];
  const seen = new Set<string>();

  const addUrl = (u: string) => {
    u = u.trim();
    if (u && !seen.has(u)) {
      seen.add(u);
      urls.push(u);
    }
  };

  // 1. Full URLs in double-quoted strings
  for (const m of js.matchAll(/"((https?:\/\/|\/\/)[^"\\]*(?:\\.[^"\\]*)*)"/g)) {
    addUrl(m[1]);
  }

  // 2. Full URLs in single-quoted strings
  for (const m of js.matchAll(/'((https?:\/\/|\/\/)[^'\\]*(?:\\.[^'\\]*)*)'/g)) {
    addUrl(m[1]);
  }

  // 3. Template literal URLs (simplified — no complex expressions)
  for (const m of js.matchAll(/`((https?:\/\/|\/\/)[^`\\]*)`/g)) {
    addUrl(m[1]);
  }

  // 4. window.open("url" ...)
  for (const m of js.matchAll(/window\.open\s*\(\s*["']([^"']+)["']/g)) {
    addUrl(m[1]);
  }

  // 5. document.location = "url" / window.location.href = "url"
  for (const m of js.matchAll(/(?:document|window)\.location(?:\.href)?\s*=\s*["']([^"']+)["']/g)) {
    addUrl(m[1]);
  }

  // 6. window.location.replace("url")
  for (const m of js.matchAll(/window\.location\.replace\s*\(\s*["']([^"']+)["']/g)) {
    addUrl(m[1]);
  }

  // 7. fetch("url")
  for (const m of js.matchAll(/fetch\s*\(\s*["']([^"']+)["']/g)) {
    addUrl(m[1]);
  }

  // 8. XMLHttpRequest.open("GET", "url")
  for (const m of js.matchAll(/\.open\s*\(\s*["'](?:GET|POST|PUT|DELETE|PATCH|HEAD|OPTIONS)["']\s*,\s*["']([^"']+)["']/g)) {
    addUrl(m[1]);
  }

  // 9. new URL("url")
  for (const m of js.matchAll(/new\s+URL\s*\(\s*["']([^"']+)["']/g)) {
    addUrl(m[1]);
  }

  // 10. .src = "url" / .href = "url" / .action = "url"
  for (const m of js.matchAll(/\.(src|href|action)\s*=\s*["']([^"']+)["']/g)) {
    const val = m[2];
    if (val.startsWith('/') || val.startsWith('http') || val.startsWith('//')) {
      addUrl(val);
    }
  }

  // 11. Absolute path strings (start with / but not just /)
  for (const m of js.matchAll(/["']((?:\/[^\s"'<>\\]+)+)["']/g)) {
    const val = m[1];
    if (val.length > 1 && val.startsWith('/') && !val.startsWith('//')) {
      addUrl(val);
    }
  }

  // 11b. Relative image paths — common pattern for dynamically loaded images
  // e.g., "images/qr/wechat.png", "upload/qrcode.jpg", "img/code.png"
  // These are often used in JS to construct image URLs at runtime
  for (const m of js.matchAll(/["']((?:[\w-]+\/){1,4}[\w.-]+\.(?:jpg|jpeg|png|gif|webp|bmp|svg|ico|avif)(?:\?[^\s"'<>\\]*)?)["']/gi)) {
    addUrl(m[1]);
  }

  // 11c. Relative paths with common resource directories
  // e.g., "./images/qr.png", "../assets/code.jpg", "static/img/qr.png"
  for (const m of js.matchAll(/["'](\.{0,2}\/(?:[\w-]+\/)*[\w.-]+\.(?:jpg|jpeg|png|gif|webp|bmp|svg|ico|avif|js|css|json)(?:\?[^\s"'<>\\]*)?)["']/gi)) {
    addUrl(m[1]);
  }

  // 12. window.navigate("url")
  for (const m of js.matchAll(/window\.navigate\s*\(\s*["']([^"']+)["']/g)) {
    addUrl(m[1]);
  }

  // 13. self.location = "url" / self.location.href = "url"
  for (const m of js.matchAll(/self\.location(?:\.href)?\s*=\s*["']([^"']+)["']/g)) {
    addUrl(m[1]);
  }

  // 14. top.location = "url" / top.location.href = "url"
  for (const m of js.matchAll(/top\.location(?:\.href)?\s*=\s*["']([^"']+)["']/g)) {
    addUrl(m[1]);
  }

  // 15. parent.location = "url" / parent.location.href = "url"
  for (const m of js.matchAll(/parent\.location(?:\.href)?\s*=\s*["']([^"']+)["']/g)) {
    addUrl(m[1]);
  }

  // 16. history.pushState(null, "", "url")
  for (const m of js.matchAll(/history\.pushState\s*\([^)]*["']([^"']+)["']/g)) {
    addUrl(m[1]);
  }

  // 17. history.replaceState(null, "", "url")
  for (const m of js.matchAll(/history\.replaceState\s*\([^)]*["']([^"']+)["']/g)) {
    addUrl(m[1]);
  }

  return urls;
}

// ─── 3. Inline style / CSS extraction ────────────────────────────────────────

function extractCssUrls($: cheerio.CheerioAPI, baseUrl: string, rawHtml: string): RawUrlEntry[] {
  const entries: RawUrlEntry[] = [];
  const seen = new Set<string>();

  const addEntry = (url: string, tag: string, attribute: string, text: string | undefined, source: string) => {
    const resolvedUrl = resolveUrl(url, baseUrl);
    if (!resolvedUrl || seen.has(resolvedUrl)) return;
    seen.add(resolvedUrl);
    entries.push({ url: resolvedUrl, tag, attribute, text, source });
  };

  // 3a. <style> blocks
  $('style').each((_, el) => {
    const css = $(el).html() || '';
    const cssUrls = extractUrlsFromCss(css);
    for (const u of cssUrls) {
      addEntry(u, 'style', 'inline', u.length > 200 ? u.substring(0, 200) + '...' : u, 'css-url');
    }
  });

  // 3b. Inline style attributes on every element
  $('[style]').each((_, el) => {
    const css = $(el).attr('style') || '';
    const cssUrls = extractUrlsFromCss(css);
    const tagName = ($(el).get(0) as any)?.tagName || 'unknown';
    for (const u of cssUrls) {
      addEntry(u, tagName, 'style', u.length > 200 ? u.substring(0, 200) + '...' : u, 'css-url');
    }
  });

  return entries;
}

/**
 * Extract all url() references from a block of CSS.
 * Handles background-image, content, cursor, list-style-image, @import, @font-face src, etc.
 */
function extractUrlsFromCss(css: string): string[] {
  const urls: string[] = [];
  const seen = new Set<string>();

  // Match url("..."), url('...'), url(...)
  for (const m of css.matchAll(/url\s*\(\s*["']?([^"')]+?)["']?\s*\)/gi)) {
    const raw = m[1].trim();
    // Skip data URIs (they're not external URLs)
    if (raw.startsWith('data:')) continue;
    if (!seen.has(raw)) {
      seen.add(raw);
      urls.push(raw);
    }
  }

  return urls;
}

// ─── 4. Data attribute extraction ────────────────────────────────────────────

function extractDataAttributes($: cheerio.CheerioAPI, baseUrl: string): RawUrlEntry[] {
  const entries: RawUrlEntry[] = [];

  // Iterate all elements and check their attribs for data-* containing URLs
  $('*').each((_, el) => {
    const attribs = (el as any).attribs || {};
    const tagName = (el as any).tagName || 'unknown';

    for (const [attr, value] of Object.entries(attribs)) {
      if (!attr.startsWith('data-')) continue;
      if (!value || typeof value !== 'string') continue;

      // Check if the value looks like a URL
      if (looksLikeUrl(value)) {
        const resolvedUrl = resolveUrl(value, baseUrl);
        if (resolvedUrl) {
          entries.push({
            url: resolvedUrl,
            tag: tagName,
            attribute: attr,
            text: value.length > 200 ? value.substring(0, 200) + '...' : value,
            source: 'data-attr',
          });
        }
      }
    }
  });

  return entries;
}

/**
 * Quick heuristic: does a string look like it could be a URL?
 */
function looksLikeUrl(value: string): boolean {
  const v = value.trim();
  return /^(https?:\/\/|\/\/|\/[\w])/i.test(v) || /\.(html?|php|asp|aspx|jsp|svg|png|jpg|jpeg|gif|webp|css|js|woff2?|ttf|eot|mp4|mp3|pdf|zip)(\?|$)/i.test(v);
}

// ─── 5. HTML comment extraction ──────────────────────────────────────────────

function extractCommentUrls(html: string, baseUrl: string): RawUrlEntry[] {
  const entries: RawUrlEntry[] = [];

  // Extract HTML comments <!-- ... -->
  const commentRegex = /<!--([\s\S]*?)-->/g;
  let match: RegExpExecArray | null;
  while ((match = commentRegex.exec(html)) !== null) {
    const comment = match[1];

    // Find URLs in the comment
    const urlRegex = /(?:https?:\/\/|\/\/)[^\s"'<>]+/g;
    let urlMatch: RegExpExecArray | null;
    while ((urlMatch = urlRegex.exec(comment)) !== null) {
      let url = urlMatch[0].replace(/[.,;:!?)\]}>]+$/, ''); // strip trailing punctuation
      const resolvedUrl = resolveUrl(url, baseUrl);
      if (resolvedUrl) {
        entries.push({
          url: resolvedUrl,
          tag: 'comment',
          attribute: undefined,
          text: comment.length > 200 ? comment.substring(0, 200) + '...' : comment.trim(),
          source: 'comment',
        });
      }
    }
  }

  return entries;
}

// ─── 6. Meta tag extraction ──────────────────────────────────────────────────

function extractMetaTags($: cheerio.CheerioAPI, baseUrl: string): RawUrlEntry[] {
  const entries: RawUrlEntry[] = [];

  // Open Graph meta tags
  $('meta[property^="og:"]').each((_, el) => {
    const content = $(el).attr('content');
    if (content && looksLikeUrl(content)) {
      const resolvedUrl = resolveUrl(content, baseUrl);
      if (resolvedUrl) {
        const property = $(el).attr('property') || 'og:*';
        entries.push({
          url: resolvedUrl,
          tag: 'meta',
          attribute: `property="${property}"`,
          text: content.length > 200 ? content.substring(0, 200) + '...' : content,
          source: 'meta-tag',
        });
      }
    }
  });

  // Twitter meta tags
  $('meta[name^="twitter:"]').each((_, el) => {
    const content = $(el).attr('content');
    if (content && looksLikeUrl(content)) {
      const resolvedUrl = resolveUrl(content, baseUrl);
      if (resolvedUrl) {
        const name = $(el).attr('name') || 'twitter:*';
        entries.push({
          url: resolvedUrl,
          tag: 'meta',
          attribute: `name="${name}"`,
          text: content.length > 200 ? content.substring(0, 200) + '...' : content,
          source: 'meta-tag',
        });
      }
    }
  });

  // Canonical link
  $('link[rel="canonical"]').each((_, el) => {
    const href = $(el).attr('href');
    if (href) {
      const resolvedUrl = resolveUrl(href, baseUrl);
      if (resolvedUrl) {
        entries.push({
          url: resolvedUrl,
          tag: 'link',
          attribute: 'rel="canonical"',
          text: href,
          source: 'meta-tag',
        });
      }
    }
  });

  // Meta refresh: <meta http-equiv="refresh" content="0;url=...">
  $('meta[http-equiv="refresh"]').each((_, el) => {
    const content = $(el).attr('content') || '';
    const urlMatch = content.match(/url\s*=\s*(.+)/i);
    if (urlMatch) {
      const rawUrl = urlMatch[1].trim().replace(/^["']|["']$/g, '');
      const resolvedUrl = resolveUrl(rawUrl, baseUrl);
      if (resolvedUrl) {
        entries.push({
          url: resolvedUrl,
          tag: 'meta',
          attribute: 'http-equiv="refresh"',
          text: content,
          source: 'meta-tag',
        });
      }
    }
  });

  // Other meta tags with URL content
  $('meta[itemprop], meta[name], meta[property]').each((_, el) => {
    const content = $(el).attr('content');
    if (content && looksLikeUrl(content)) {
      // Avoid double-counting og: and twitter: tags
      const prop = $(el).attr('property') || '';
      const name = $(el).attr('name') || '';
      if (prop.startsWith('og:') || name.startsWith('twitter:')) return;

      const resolvedUrl = resolveUrl(content, baseUrl);
      if (resolvedUrl) {
        const identifier = $(el).attr('itemprop') || name || prop || 'unknown';
        entries.push({
          url: resolvedUrl,
          tag: 'meta',
          attribute: identifier,
          text: content.length > 200 ? content.substring(0, 200) + '...' : content,
          source: 'meta-tag',
        });
      }
    }
  });

  return entries;
}

// ─── 7. JSON-LD extraction ───────────────────────────────────────────────────

function extractJsonLd($: cheerio.CheerioAPI, baseUrl: string): RawUrlEntry[] {
  const entries: RawUrlEntry[] = [];

  $('script[type="application/ld+json"]').each((_, el) => {
    const content = $(el).html() || '';
    try {
      const json = JSON.parse(content);
      const urls = extractUrlsFromJson(json);
      for (const u of urls) {
        const resolvedUrl = resolveUrl(u, baseUrl);
        if (resolvedUrl) {
          entries.push({
            url: resolvedUrl,
            tag: 'script',
            attribute: 'type="application/ld+json"',
            text: u.length > 200 ? u.substring(0, 200) + '...' : u,
            source: 'json-ld',
          });
        }
      }
    } catch {
      // Malformed JSON-LD; try regex fallback
      const urlRegex = /https?:\/\/[^\s"'<>\\]+/g;
      let m: RegExpExecArray | null;
      while ((m = urlRegex.exec(content)) !== null) {
        let url = m[0].replace(/[.,;:!?)\]}>]+$/, '');
        const resolvedUrl = resolveUrl(url, baseUrl);
        if (resolvedUrl) {
          entries.push({
            url: resolvedUrl,
            tag: 'script',
            attribute: 'type="application/ld+json"',
            text: url,
            source: 'json-ld',
          });
        }
      }
    }
  });

  return entries;
}

/**
 * Recursively walk a JSON object and collect all string values that look like URLs.
 */
function extractUrlsFromJson(obj: unknown, depth = 0): string[] {
  if (depth > 20) return []; // safety limit
  const urls: string[] = [];

  if (typeof obj === 'string') {
    if (looksLikeUrl(obj)) {
      urls.push(obj.trim());
    }
  } else if (Array.isArray(obj)) {
    for (const item of obj) {
      urls.push(...extractUrlsFromJson(item, depth + 1));
    }
  } else if (obj && typeof obj === 'object') {
    for (const value of Object.values(obj as Record<string, unknown>)) {
      urls.push(...extractUrlsFromJson(value, depth + 1));
    }
  }

  return urls;
}

// ─── 8. Raw HTML regex scan ──────────────────────────────────────────────────

function extractRegexScan(html: string, baseUrl: string): RawUrlEntry[] {
  const entries: RawUrlEntry[] = [];
  const seen = new Set<string>();

  const addEntry = (url: string, source: string, context?: string) => {
    const resolvedUrl = resolveUrl(url, baseUrl);
    if (!resolvedUrl || seen.has(resolvedUrl)) return;
    seen.add(resolvedUrl);
    entries.push({
      url: resolvedUrl,
      tag: undefined,
      attribute: undefined,
      text: context || url,
      source,
    });
  };

  // 8a. http:// and https:// URLs
  for (const m of html.matchAll(/https?:\/\/[^\s"'<>\\)}\]]+/g)) {
    let url = m[0].replace(/[.,;:!?)\]}>]+$/, ''); // strip trailing punctuation
    addEntry(url, 'regex-scan', url);
  }

  // 8b. Protocol-relative URLs with a domain
  for (const m of html.matchAll(/\/\/[^\s"'<>\\)}\]]+\.[a-z]{2,}/gi)) {
    let url = m[0].replace(/[.,;:!?)\]}>]+$/, '');
    // Ensure it looks like a real URL (has a path or at least a TLD)
    if (url.length > 5) {
      addEntry(url, 'regex-scan', url);
    }
  }

  // 8c. Domain patterns without protocol
  const domainRegex = new RegExp(
    `(?<![@\\w.-])[\\w-]+\\.(?:${TLD_LIST})(?![\\w.-])`,
    'gi'
  );
  for (const m of html.matchAll(domainRegex)) {
    const domain = m[0];
    // Skip things that look like file extensions or common words
    if (domain.length < 4) continue;
    // Skip if it's just a TLD-like extension in a filename
    if (/^[\d.]+$/.test(domain)) continue;
    // Add as a protocol-prefixed URL
    addEntry(`http://${domain}`, 'regex-scan', domain);
  }

  return entries;
}

// ─── 9. Noscript content extraction ─────────────────────────────────────────
// <noscript> tags may contain hidden dark links that are visible only when JS is disabled.
// These are commonly abused for SEO spam / dark links.

function extractNoscriptUrls($: cheerio.CheerioAPI, baseUrl: string): RawUrlEntry[] {
  const entries: RawUrlEntry[] = [];

  $('noscript').each((_, el) => {
    const content = $(el).html() || '';
    if (!content.trim()) return;

    // Parse the noscript content as HTML to find links
    const inner$ = cheerio.load(content);

    // Extract links from <a> tags inside noscript
    inner$('a[href]').each((__, aEl) => {
      const href = inner$(aEl).attr('href');
      if (!href || href.startsWith('#') || href.toLowerCase().startsWith('javascript:')) return;
      const resolvedUrl = resolveUrl(href, baseUrl);
      if (resolvedUrl) {
        entries.push({
          url: resolvedUrl,
          tag: 'noscript',
          attribute: 'href',
          text: inner$(aEl).text().trim() || undefined,
          source: 'noscript',
          isVisible: false,
          hideReason: 'noscript标签内的链接 — 仅JS禁用时可见',
          visibilityReasons: [{
            type: 'noscript_hidden',
            severity: 'high',
            description: 'noscript标签中的链接 — 仅在JS禁用时显示，疑似暗链',
            evidence: `noscript href="${href}"`,
          }],
        });
      }
    });

    // Also extract image URLs from noscript (may be QR codes)
    inner$('img[src]').each((__, imgEl) => {
      const src = inner$(imgEl).attr('src');
      if (!src) return;
      const resolvedUrl = resolveUrl(src, baseUrl);
      if (resolvedUrl) {
        entries.push({
          url: resolvedUrl,
          tag: 'noscript',
          attribute: 'src',
          text: undefined,
          source: 'noscript',
          isVisible: false,
          hideReason: 'noscript标签内的图片 — 仅JS禁用时可见',
          visibilityReasons: [{
            type: 'noscript_hidden',
            severity: 'medium',
            description: 'noscript标签中的图片 — 仅在JS禁用时显示',
            evidence: `noscript img src="${src}"`,
          }],
        });
      }
    });

    // Extract iframe URLs from noscript
    inner$('iframe[src]').each((__, iframeEl) => {
      const src = inner$(iframeEl).attr('src');
      if (!src) return;
      const resolvedUrl = resolveUrl(src, baseUrl);
      if (resolvedUrl) {
        entries.push({
          url: resolvedUrl,
          tag: 'noscript',
          attribute: 'src',
          text: undefined,
          source: 'noscript',
          isVisible: false,
          hideReason: 'noscript标签内的iframe — 仅JS禁用时可见',
          visibilityReasons: [{
            type: 'noscript_hidden',
            severity: 'high',
            description: 'noscript标签中的iframe — 仅在JS禁用时显示，疑似暗链',
            evidence: `noscript iframe src="${src}"`,
          }],
        });
      }
    });
  });

  return entries;
}

// ─── 10. Data-URI link detection ────────────────────────────────────────────
// Some dark links use data:text/html,... URIs in href attributes.

function extractDataUriLinks($: cheerio.CheerioAPI, baseUrl: string): RawUrlEntry[] {
  const entries: RawUrlEntry[] = [];

  // Find <a> tags with data: URIs in href
  $('a[href^="data:"]').each((_, el) => {
    const href = $(el).attr('href');
    if (!href) return;

    // Only flag data:text/html and data:application URIs as suspicious
    if (href.startsWith('data:text/html') || href.startsWith('data:application')) {
      entries.push({
        url: href.substring(0, 200), // Truncate data URIs for display
        tag: 'a',
        attribute: 'href',
        text: $(el).text().trim() || undefined,
        source: 'data-uri',
        isVisible: true,
        visibilityReasons: [{
          type: 'data_uri_link',
          severity: 'high',
          description: '链接使用data:URI — 可能隐藏恶意内容',
          evidence: `data:URI href (length: ${href.length})`,
        }],
      });
    }
  });

  // Find <iframe> with data: URIs in src
  $('iframe[src^="data:"]').each((_, el) => {
    const src = $(el).attr('src');
    if (!src) return;

    entries.push({
      url: src.substring(0, 200),
      tag: 'iframe',
      attribute: 'src',
      text: undefined,
      source: 'data-uri',
      isVisible: false,
      hideReason: 'iframe使用data:URI — 可能隐藏内容',
      visibilityReasons: [{
        type: 'data_uri_link',
        severity: 'high',
        description: 'iframe使用data:URI加载内容 — 可能隐藏恶意页面',
        evidence: `data:URI iframe src (length: ${src.length})`,
      }],
    });
  });

  // Find <object> with data: URIs
  $('object[data^="data:"]').each((_, el) => {
    const data = $(el).attr('data');
    if (!data) return;

    entries.push({
      url: data.substring(0, 200),
      tag: 'object',
      attribute: 'data',
      text: undefined,
      source: 'data-uri',
      isVisible: false,
      hideReason: 'object使用data:URI',
      visibilityReasons: [{
        type: 'data_uri_link',
        severity: 'medium',
        description: 'object标签使用data:URI — 可能隐藏内容',
        evidence: `data:URI object data (length: ${data.length})`,
      }],
    });
  });

  return entries;
}

// ─── 11. Object/embed deep inspection ─────────────────────────────────────────
// Extract URLs from <object> params and <embed> attributes more thoroughly.

function extractObjectEmbedUrls($: cheerio.CheerioAPI, baseUrl: string): RawUrlEntry[] {
  const entries: RawUrlEntry[] = [];

  // <object> tag: extract URLs from data attribute and <param> sub-elements
  $('object').each((_, el) => {
    const data = $(el).attr('data');
    if (data && !data.startsWith('data:')) { // data: URIs handled separately
      const resolvedUrl = resolveUrl(data, baseUrl);
      if (resolvedUrl) {
        entries.push({
          url: resolvedUrl,
          tag: 'object',
          attribute: 'data',
          text: undefined,
          source: 'tag',
        });
      }
    }

    // Extract URLs from <param> elements inside <object>
    $(el).find('param').each((__, paramEl) => {
      const name = ($(paramEl).attr('name') || '').toLowerCase();
      const value = $(paramEl).attr('value') || '';

      // Common param names that contain URLs
      const urlParams = ['movie', 'src', 'url', 'link', 'target', 'redirect', 'flashvars', 'base'];
      if (urlParams.includes(name) && looksLikeUrl(value)) {
        const resolvedUrl = resolveUrl(value, baseUrl);
        if (resolvedUrl) {
          entries.push({
            url: resolvedUrl,
            tag: 'param',
            attribute: `name="${name}"`,
            text: value.length > 200 ? value.substring(0, 200) + '...' : value,
            source: 'tag',
          });
        }
      }

      // FlashVars often contain URL-like values even if not strict URLs
      if (name === 'flashvars') {
        const urlRegex = /(?:https?:\/\/|\/\/)[^\s&"'<>]+/g;
        let m: RegExpExecArray | null;
        while ((m = urlRegex.exec(value)) !== null) {
          let url = m[0].replace(/[.,;:!?)\]}>]+$/, '');
          const resolvedUrl = resolveUrl(url, baseUrl);
          if (resolvedUrl) {
            entries.push({
              url: resolvedUrl,
              tag: 'param',
              attribute: `name="flashvars"`,
              text: undefined,
              source: 'tag',
            });
          }
        }
      }

      // codebase param (can point to external domain for loading code)
      if (name === 'codebase' && value) {
        const resolvedUrl = resolveUrl(value, baseUrl);
        if (resolvedUrl) {
          entries.push({
            url: resolvedUrl,
            tag: 'param',
            attribute: 'name="codebase"',
            text: undefined,
            source: 'tag',
          });
        }
      }
    });
  });

  // <embed> tag: extract from all URL-bearing attributes
  $('embed').each((_, el) => {
    for (const attr of ['src', 'movie', 'url', 'link', 'target', 'base']) {
      const value = $(el).attr(attr);
      if (!value) continue;
      if (value.startsWith('data:')) continue; // Handled separately
      const resolvedUrl = resolveUrl(value, baseUrl);
      if (resolvedUrl) {
        entries.push({
          url: resolvedUrl,
          tag: 'embed',
          attribute: attr,
          text: undefined,
          source: 'tag',
        });
      }
    }

    // Check FlashVars on embed
    const flashVars = $(el).attr('flashvars');
    if (flashVars) {
      const urlRegex = /(?:https?:\/\/|\/\/)[^\s&"'<>]+/g;
      let m: RegExpExecArray | null;
      while ((m = urlRegex.exec(flashVars)) !== null) {
        let url = m[0].replace(/[.,;:!?)\]}>]+$/, '');
        const resolvedUrl = resolveUrl(url, baseUrl);
        if (resolvedUrl) {
          entries.push({
            url: resolvedUrl,
            tag: 'embed',
            attribute: 'flashvars',
            text: undefined,
            source: 'tag',
          });
        }
      }
    }
  });

  return entries;
}

// ─── 9. Enhanced visibility analysis ─────────────────────────────────────────

function analyzeVisibility($: cheerio.CheerioAPI, el: any, tag: string): {
  isVisible: boolean;
  hideReason?: string;
  reasons: Array<{ type: DarkLinkType; severity: Severity; description: string; evidence: string }>;
} {
  const reasons: Array<{ type: DarkLinkType; severity: Severity; description: string; evidence: string }> = [];

  const $el = $(el);
  const style = ($el.attr('style') || '').replace(/\s+/g, ' ').trim();
  const className = $el.attr('class') || '';

  // ── CSS display:none ──
  if (/\bdisplay\s*:\s*none\b/i.test(style)) {
    reasons.push({
      type: 'css_hidden',
      severity: 'critical',
      description: '元素通过display:none隐藏',
      evidence: `style="${style}"`,
    });
  }

  // ── CSS visibility:hidden / collapse ──
  if (/\bvisibility\s*:\s*(hidden|collapse)\b/i.test(style)) {
    reasons.push({
      type: 'css_hidden',
      severity: 'high',
      description: '元素通过visibility:hidden隐藏',
      evidence: `style="${style}"`,
    });
  }

  // ── CSS opacity:0 ──
  if (/\bopacity\s*:\s*0(\.0*)?\b/i.test(style)) {
    reasons.push({
      type: 'css_hidden',
      severity: 'high',
      description: '元素通过opacity:0隐藏',
      evidence: `style="${style}"`,
    });
  }

  // ── font-size:0 or very small ──
  const fontSizeMatch = style.match(/font-size\s*:\s*([\d.]+)/i);
  if (fontSizeMatch && parseFloat(fontSizeMatch[1]) <= 1) {
    reasons.push({
      type: 'size_hidden',
      severity: 'high',
      description: '元素文字通过极小字号隐藏',
      evidence: `style="${style}"`,
    });
  }

  // ── width/height:0 or 1px via style ──
  const widthStyleMatch = style.match(/width\s*:\s*([\d.]+)/i);
  const heightStyleMatch = style.match(/height\s*:\s*([\d.]+)/i);
  if ((widthStyleMatch && parseFloat(widthStyleMatch[1]) <= 1) ||
      (heightStyleMatch && parseFloat(heightStyleMatch[1]) <= 1)) {
    reasons.push({
      type: 'size_hidden',
      severity: 'high',
      description: '元素尺寸接近零',
      evidence: `style="${style}"`,
    });
  }

  // ── HTML width/height attributes ──
  const widthAttr = $el.attr('width');
  const heightAttr = $el.attr('height');
  if (widthAttr && parseInt(widthAttr) <= 1) {
    reasons.push({
      type: 'size_hidden',
      severity: 'high',
      description: `元素宽度设为${widthAttr}px`,
      evidence: `width="${widthAttr}"`,
    });
  }
  if (heightAttr && parseInt(heightAttr) <= 1) {
    reasons.push({
      type: 'size_hidden',
      severity: 'high',
      description: `元素高度设为${heightAttr}px`,
      evidence: `height="${heightAttr}"`,
    });
  }

  // ── Position off-screen ──
  if (/\bposition\s*:\s*absolute\b/i.test(style)) {
    const leftMatch = style.match(/left\s*:\s*(-[\d.]+)/i);
    const topMatch = style.match(/top\s*:\s*(-[\d.]+)/i);
    if ((leftMatch && parseFloat(leftMatch[1]) < -999) || (topMatch && parseFloat(topMatch[1]) < -999)) {
      reasons.push({
        type: 'position_hidden',
        severity: 'critical',
        description: '元素通过大负值偏移移出可视区域',
        evidence: `style="${style}"`,
      });
    }
  }

  // ── text-indent hiding ──
  const indentMatch = style.match(/text-indent\s*:\s*(-[\d.]+)/i);
  if (indentMatch && parseFloat(indentMatch[1]) < -999) {
    reasons.push({
      type: 'position_hidden',
      severity: 'high',
      description: '文字通过大负值text-indent隐藏',
      evidence: `style="${style}"`,
    });
  }

  // ── overflow:hidden with small container ──
  if (/\boverflow\s*:\s*hidden\b/i.test(style)) {
    if ((widthStyleMatch && parseFloat(widthStyleMatch[1]) <= 1) ||
        (heightStyleMatch && parseFloat(heightStyleMatch[1]) <= 1)) {
      reasons.push({
        type: 'overflow_hidden',
        severity: 'high',
        description: '内容通过overflow:hidden和小容器隐藏',
        evidence: `style="${style}"`,
      });
    }
  }

  // ── Hiding class names ──
  const hidingClasses = ['hidden', 'invisible', 'hide', 'd-none', 'visually-hidden', 'sr-only', 'visuallyhidden', 'v-hide', 'u-hide'];
  const elClasses = className.split(/\s+/);
  for (const cls of elClasses) {
    if (hidingClasses.includes(cls)) {
      reasons.push({
        type: 'css_hidden',
        severity: 'high',
        description: `元素含有隐藏CSS类: ${cls}`,
        evidence: `class="${className}"`,
      });
      break;
    }
  }

  // ── Color matching (text same as background) ──
  const colorMatch = style.match(/(?:^|;)\s*color\s*:\s*([#\w]+)/i);
  const bgColorMatch = style.match(/background(?:-color)?\s*:\s*([#\w]+)/i);
  if (colorMatch && bgColorMatch) {
    const textColor = colorMatch[1];
    const bgColor = bgColorMatch[1];
    if (textColor.toLowerCase() === bgColor.toLowerCase() || normalizeColor(textColor) === normalizeColor(bgColor)) {
      reasons.push({
        type: 'color_hidden',
        severity: 'critical',
        description: '文字颜色与背景色相同 — 隐藏文字',
        evidence: `style="${style}"`,
      });
    }
  }

  // ── aria-hidden="true" ──
  if ($el.attr('aria-hidden') === 'true') {
    reasons.push({
      type: 'css_hidden',
      severity: 'high',
      description: '元素设置aria-hidden="true" — 对屏幕阅读器隐藏',
      evidence: `aria-hidden="true"`,
    });
  }

  // ── tabindex="-1" on links (removes from tab order) ──
  if (tag === 'a' && $el.attr('tabindex') === '-1') {
    reasons.push({
      type: 'css_hidden',
      severity: 'medium',
      description: '链接设置tabindex="-1" — 已从键盘导航中移除',
      evidence: `tabindex="-1"`,
    });
  }

  // ── pointer-events:none ──
  if (/\bpointer-events\s*:\s*none\b/i.test(style)) {
    reasons.push({
      type: 'css_hidden',
      severity: 'high',
      description: '元素设置pointer-events:none — 不可点击',
      evidence: `style="${style}"`,
    });
  }

  // ── clip: rect(0,0,0,0) hiding ──
  if (/\bclip\s*:\s*rect\s*\(\s*0/i.test(style)) {
    reasons.push({
      type: 'css_hidden',
      severity: 'high',
      description: '元素通过clip:rect(0,0,0,0)隐藏',
      evidence: `style="${style}"`,
    });
  }

  // ── clip-path hiding (polygon(0 0, 0 0, 0 0) or inset(100%)) ──
  if (/\bclip-path\s*:\s*(?:polygon\s*\(\s*0\s+0|inset\s*\(\s*100%|circle\s*\(\s*0)/i.test(style)) {
    reasons.push({
      type: 'css_hidden',
      severity: 'high',
      description: '元素通过clip-path隐藏',
      evidence: `style="${style}"`,
    });
  }

  // ── transform: scale(0) or scale3d(0,0,1) ──
  if (/\btransform\s*:\s*[^;]*scale\s*\(\s*0\b/i.test(style) ||
      /\btransform\s*:\s*[^;]*scale3d\s*\(\s*0\s*,\s*0\s*,\s*1\s*\)/i.test(style) ||
      /\btransform\s*:\s*[^;]*scaleX\s*\(\s*0\b/i.test(style) ||
      /\btransform\s*:\s*[^;]*scaleY\s*\(\s*0\b/i.test(style)) {
    reasons.push({
      type: 'css_hidden',
      severity: 'high',
      description: '元素通过transform:scale(0)隐藏',
      evidence: `style="${style}"`,
    });
  }

  // ── transform: translateX/Y(-9999px) ──
  if (/\btransform\s*:\s*[^;]*translate[XY]?\s*\(\s*-?\s*9{3,}/i.test(style)) {
    reasons.push({
      type: 'position_hidden',
      severity: 'high',
      description: '元素通过transform大偏移量移出可视区域',
      evidence: `style="${style}"`,
    });
  }

  // ── max-height:0 / max-width:0 with overflow:hidden ──
  if (/\boverflow\s*:\s*hidden\b/i.test(style)) {
    const maxHMatch = style.match(/max-height\s*:\s*([\d.]+)/i);
    const maxWMatch = style.match(/max-width\s*:\s*([\d.]+)/i);
    if ((maxHMatch && parseFloat(maxHMatch[1]) === 0) ||
        (maxWMatch && parseFloat(maxWMatch[1]) === 0)) {
      reasons.push({
        type: 'size_hidden',
        severity: 'high',
        description: '元素通过max-height:0/max-width:0配合overflow:hidden隐藏',
        evidence: `style="${style}"`,
      });
    }
  }

  // ── filter: opacity(0%) ──
  if (/\bfilter\s*:[^;]*opacity\s*\(\s*0\s*%\s*\)/i.test(style)) {
    reasons.push({
      type: 'color_hidden',
      severity: 'high',
      description: '元素通过filter:opacity(0%)隐藏',
      evidence: `style="${style}"`,
    });
  }

  // ── writing-mode: vertical-rl combined with tiny container ──
  if (/\bwriting-mode\s*:\s*vertical-rl\b/i.test(style)) {
    const wMatch = style.match(/width\s*:\s*([\d.]+)/i);
    const hMatch = style.match(/height\s*:\s*([\d.]+)/i);
    const wVal = wMatch ? parseFloat(wMatch[1]) : Infinity;
    const hVal = hMatch ? parseFloat(hMatch[1]) : Infinity;
    // Also check HTML attributes
    const wAttr = $el.attr('width');
    const hAttr = $el.attr('height');
    const wAttrVal = wAttr ? parseFloat(wAttr) : Infinity;
    const hAttrVal = hAttr ? parseFloat(hAttr) : Infinity;
    if (Math.min(wVal, wAttrVal) < 2 || Math.min(hVal, hAttrVal) < 2) {
      reasons.push({
        type: 'css_hidden',
        severity: 'medium',
        description: '元素通过writing-mode:vertical-rl配合极小容器隐藏',
        evidence: `style="${style}"`,
      });
    }
  }

  // ── content-visibility: hidden ──
  if (/\bcontent-visibility\s*:\s*hidden\b/i.test(style)) {
    reasons.push({
      type: 'css_hidden',
      severity: 'high',
      description: '元素通过content-visibility:hidden隐藏',
      evidence: `style="${style}"`,
    });
  }

  // ── Parent chain hiding ──
  let parent = $el.parent();
  let parentDepth = 0;
  while (parent.length && parentDepth < 5) {
    const parentStyle = (parent.attr('style') || '').replace(/\s+/g, ' ').trim();
    const parentTag = (parent.get(0) as any)?.tagName || '';

    // Parent display:none
    if (/\bdisplay\s*:\s*none\b/i.test(parentStyle)) {
      reasons.push({
        type: 'css_hidden',
        severity: 'critical',
        description: `Parent <${parentTag}> is hidden with display:none`,
        evidence: `parent <${parentTag}> style="${parentStyle}"`,
      });
      break; // no need to check further parents
    }

    // Parent visibility:hidden
    if (/\bvisibility\s*:\s*hidden\b/i.test(parentStyle)) {
      reasons.push({
        type: 'css_hidden',
        severity: 'high',
        description: `Parent <${parentTag}> is hidden with visibility:hidden`,
        evidence: `parent <${parentTag}> style="${parentStyle}"`,
      });
      break;
    }

    // Parent aria-hidden
    if (parent.attr('aria-hidden') === 'true') {
      reasons.push({
        type: 'css_hidden',
        severity: 'high',
        description: `Parent <${parentTag}> has aria-hidden="true"`,
        evidence: `parent <${parentTag}> aria-hidden="true"`,
      });
      break;
    }

    // Parent hiding class
    const parentClass = parent.attr('class') || '';
    const parentClasses = parentClass.split(/\s+/);
    for (const cls of parentClasses) {
      if (hidingClasses.includes(cls)) {
        reasons.push({
          type: 'css_hidden',
          severity: 'high',
          description: `Parent <${parentTag}> has hiding class: ${cls}`,
          evidence: `parent <${parentTag}> class="${parentClass}"`,
        });
        break;
      }
    }

    parent = parent.parent();
    parentDepth++;
  }

  const isVisible = reasons.length === 0;
  const hideReason = reasons.length > 0 ? reasons.map(r => r.description).join('; ') : undefined;

  return { isVisible, hideReason, reasons };
}

// ─── extractImageUrls (enhanced for QR detection) ─────────────────────────────

export function extractImageUrls(html: string, baseUrl: string): string[] {
  const $ = cheerio.load(html);
  const imageUrls: string[] = [];
  const seen = new Set<string>();

  const addUrl = (u: string) => {
    if (!u || seen.has(u)) return;
    seen.add(u);
    imageUrls.push(u);
  };

  // Helper: resolve a URL or keep data:image URIs as-is
  const resolveImageUrl = (raw: string, base: string): string | null => {
    if (raw.startsWith('data:image/')) return raw; // data URIs stay as-is
    return resolveUrl(raw, base);
  };

  // 1. <img> tags – src, srcset, data-src (lazy loading), data-lazy-src, data-original
  $('img').each((_, el) => {
    for (const attr of ['src', 'data-src', 'data-lazy-src', 'data-original', 'data-lazy']) {
      const val = $(el).attr(attr);
      if (val) {
        const resolved = resolveImageUrl(val, baseUrl);
        if (resolved) addUrl(resolved);
      }
    }
    const srcset = $(el).attr('srcset');
    if (srcset) {
      const urls = srcset.split(',').map(s => s.trim().split(/\s+/)[0]);
      for (const u of urls) {
        const resolved = resolveImageUrl(u, baseUrl);
        if (resolved) addUrl(resolved);
      }
    }
  });

  // 2. <picture> / <source> with srcset/src
  $('picture source').each((_, el) => {
    const srcset = $(el).attr('srcset');
    if (srcset) {
      const urls = srcset.split(',').map(s => s.trim().split(/\s+/)[0]);
      for (const u of urls) {
        const resolved = resolveImageUrl(u, baseUrl);
        if (resolved) addUrl(resolved);
      }
    }
    const src = $(el).attr('src');
    if (src) {
      const resolved = resolveImageUrl(src, baseUrl);
      if (resolved) addUrl(resolved);
    }
  });

  // 3. <video> poster attributes
  $('video[poster]').each((_, el) => {
    const poster = $(el).attr('poster');
    if (poster) {
      const resolved = resolveImageUrl(poster, baseUrl);
      if (resolved) addUrl(resolved);
    }
  });

  // 4. SVG <image> and <use> elements
  $('svg image, svg use').each((_, el) => {
    for (const attr of ['href', 'xlink:href']) {
      const val = $(el).attr(attr);
      if (val) {
        const resolved = resolveImageUrl(val, baseUrl);
        if (resolved) addUrl(resolved);
      }
    }
  });

  // 5. CSS background-image on inline styles (includes data:image/ URIs)
  const bgUrlRegex = /url\s*\(\s*['"]?([^'")]+?)['"]?\s*\)/gi;
  $('[style]').each((_, el) => {
    const style = $(el).attr('style') || '';
    let match: RegExpExecArray | null;
    bgUrlRegex.lastIndex = 0;
    while ((match = bgUrlRegex.exec(style)) !== null) {
      const raw = match[1].trim();
      if (raw.startsWith('data:image/')) {
        addUrl(raw);
      } else if (!raw.startsWith('data:')) {
        const resolved = resolveUrl(raw, baseUrl);
        if (resolved) addUrl(resolved);
      }
    }
  });

  // 6. <style> blocks – background-image URLs (includes data:image/ URIs)
  $('style').each((_, el) => {
    const css = $(el).html() || '';
    let match: RegExpExecArray | null;
    bgUrlRegex.lastIndex = 0;
    while ((match = bgUrlRegex.exec(css)) !== null) {
      const raw = match[1].trim();
      if (raw.startsWith('data:image/')) {
        addUrl(raw);
      } else if (!raw.startsWith('data:')) {
        const resolved = resolveUrl(raw, baseUrl);
        if (resolved) addUrl(resolved);
      }
    }
  });

  // 7. Meta tags with image URLs
  $('meta[property="og:image"], meta[property="og:image:secure_url"], meta[name="twitter:image"], meta[name="twitter:image:src"]').each((_, el) => {
    const content = $(el).attr('content');
    if (content) {
      const resolved = resolveImageUrl(content, baseUrl);
      if (resolved) addUrl(resolved);
    }
  });

  // 8. <input type="image"> src attributes
  $('input[type="image"]').each((_, el) => {
    const src = $(el).attr('src');
    if (src) {
      const resolved = resolveImageUrl(src, baseUrl);
      if (resolved) addUrl(resolved);
    }
  });

  // 9. Body/table background attributes (legacy HTML)
  for (const tag of ['body', 'table', 'td', 'th']) {
    $(`${tag}[background]`).each((_, el) => {
      const bg = $(el).attr('background');
      if (bg) {
        const resolved = resolveImageUrl(bg, baseUrl);
        if (resolved) addUrl(resolved);
      }
    });
  }

  // 10. Any element with a data:image/ URI in any attribute
  $('*').each((_, el) => {
    const attribs = (el as any).attribs || {};
    for (const [attr, value] of Object.entries(attribs)) {
      if (typeof value === 'string' && value.startsWith('data:image/')) {
        addUrl(value);
      }
    }
  });

  // 11. Regex-based catch-all: scan raw HTML for image URLs not caught by DOM methods
  // This catches images in JavaScript code, data attributes, template literals, etc.
  // that cheerio's DOM traversal may miss (e.g., images rendered by JS frameworks).
  const rawImgUrlRegex = /(?:https?:\/\/[^\s"'<>)\\\]]+\.(?:jpg|jpeg|png|gif|webp|bmp|svg|ico|tiff|tif)(?:\?[^\s"'<>)\\\]]*)?)/gi;
  let rawMatch: RegExpExecArray | null;
  while ((rawMatch = rawImgUrlRegex.exec(html)) !== null) {
    const rawUrl = rawMatch[0];
    const resolved = resolveImageUrl(rawUrl, baseUrl);
    if (resolved) addUrl(resolved);
  }

  // Also scan for src/href/data-* attributes with image extensions that might have been missed
  // by cheerio (e.g., inside <script> templates, unusual attributes, etc.)
  const attrImgRegex = /(?:src|href|data-src|data-original|data-lazy-src|data-lazy|data-href|data-bg|data-background|data-thumb|data-image|data-url)\s*[=:]\s*["']([^"']+\.(?:jpg|jpeg|png|gif|webp|bmp|svg|ico|tiff|tif)[^"']*?)["']/gi;
  while ((rawMatch = attrImgRegex.exec(html)) !== null) {
    const rawUrl = rawMatch[1];
    const resolved = resolveImageUrl(rawUrl, baseUrl);
    if (resolved) addUrl(resolved);
  }

  return [...new Set(imageUrls)];
}

// ─── extractExternalResources (new) ──────────────────────────────────────────

export function extractExternalResources(html: string, baseUrl: string): { jsUrls: string[]; cssUrls: string[] } {
  const $ = cheerio.load(html);
  const jsUrls: string[] = [];
  const cssUrls: string[] = [];
  const seenJs = new Set<string>();
  const seenCss = new Set<string>();

  // External JS files
  $('script[src]').each((_, el) => {
    const src = $(el).attr('src');
    if (!src) return;
    const resolved = resolveUrl(src, baseUrl);
    if (resolved && !seenJs.has(resolved)) {
      seenJs.add(resolved);
      jsUrls.push(resolved);
    }
  });

  // External CSS files
  $('link[rel="stylesheet"]').each((_, el) => {
    const href = $(el).attr('href');
    if (!href) return;
    const resolved = resolveUrl(href, baseUrl);
    if (resolved && !seenCss.has(resolved)) {
      seenCss.add(resolved);
      cssUrls.push(resolved);
    }
  });

  // Also pick up @import URLs from <style> blocks
  $('style').each((_, el) => {
    const css = $(el).html() || '';
    for (const m of css.matchAll(/@import\s+(?:url\s*\(\s*)?["']([^"')]+)["']\s*\)?/gi)) {
      const url = m[1].trim();
      const resolved = resolveUrl(url, baseUrl);
      if (resolved && !seenCss.has(resolved)) {
        seenCss.add(resolved);
        cssUrls.push(resolved);
      }
    }
  });

  return { jsUrls, cssUrls };
}

// ─── Utility functions ───────────────────────────────────────────────────────
// extractDomain, isValidDomain, and isSuspiciousDomain are imported from shared-constants.ts

export function resolveUrl(raw: string, base: string): string | null {
  try {
    // Handle protocol-relative URLs
    if (raw.startsWith('//')) {
      const baseProto = new URL(base).protocol;
      return new URL(baseProto + raw).href;
    }
    return new URL(raw, base).href;
  } catch {
    // Fallback: URLs with colons in the first path segment (e.g., "668684647021:ltgw/...")
    // cause new URL() to misinterpret the segment before ":" as a URL scheme and fail.
    // If the raw URL doesn't start with "/" and contains a colon early on (not a known scheme),
    // try prepending "/" to force it to be treated as a path-absolute URL.
    if (!raw.startsWith('/') && !raw.startsWith('data:') && !raw.startsWith('blob:')) {
      const colonIdx = raw.indexOf(':');
      if (colonIdx > 0 && colonIdx < 20) {
        // Looks like a scheme but it failed — probably a colon in a path segment
        try {
          return new URL('/' + raw, base).href;
        } catch {
          // Give up
        }
      }
    }
    return null;
  }
}

function isZeroSize(value: string | undefined): boolean {
  if (!value) return false;
  return parseInt(value) === 0;
}

function isOnePixelSize(value: string | undefined): boolean {
  if (!value) return false;
  return parseInt(value) === 1;
}

function getCssValue($: cheerio.CheerioAPI, el: any, prop: string): string {
  const style = $(el).attr('style') || '';
  const match = style.match(new RegExp(`${prop}:\\s*([^;]+)`, 'i'));
  return match ? match[1].trim() : '';
}

function normalizeColor(color: string): string {
  return color.toLowerCase().replace(/\s/g, '');
}

// isSuspiciousDomain is imported from shared-constants.ts

// ─── Sublink mining: extract all URLs without domain-level dedup ────────────

/**
 * Lightweight URL entry returned by extractAllUrlsFromHtml().
 * Unlike parseHtml()'s UrlDetailData (which is domain-deduped), this returns
 * every individual URL found in the HTML so callers can filter by hostname
 * and get the full set of same-domain sub-paths.
 */
export interface ExtractedUrlEntry {
  url: string;       // resolved absolute URL
  tag?: string;      // HTML tag (e.g. "a", "script", "meta")
  source: string;    // extraction source (e.g. "tag", "inline-script", "css-url", "data-attr")
}

/**
 * Extract ALL URLs from HTML using the full 11-method parser (cheerio-based).
 *
 * This is the same extraction pipeline as parseHtml() but WITHOUT domain-level
 * deduplication, so every individual URL is preserved. This is essential for
 * sublink mining where we need ALL same-domain sub-paths, not just one
 * representative URL per domain.
 *
 * @param html  Raw HTML string
 * @param baseUrl  Base URL for resolving relative links
 * @returns Array of unique extracted URL entries
 */
export function extractAllUrlsFromHtml(html: string, baseUrl: string): ExtractedUrlEntry[] {
  const $ = cheerio.load(html);

  // Resolve any <base href="..."> tag
  const baseHref = $('base').attr('href');
  const effectiveBase = baseHref ? resolveUrl(baseHref, baseUrl) || baseUrl : baseUrl;

  // Collect all raw URL entries from every extraction method (same as parseHtml)
  const rawEntries: RawUrlEntry[] = [];

  // 1. Enhanced basic tag extraction (25+ tag/attribute pairs)
  rawEntries.push(...extractBasicTags($, effectiveBase));

  // 2. Inline script extraction
  rawEntries.push(...extractInlineScripts($, effectiveBase));

  // 3. Inline style / CSS extraction
  rawEntries.push(...extractCssUrls($, effectiveBase, html));

  // 4. Data attribute extraction
  rawEntries.push(...extractDataAttributes($, effectiveBase));

  // 5. HTML comment extraction
  rawEntries.push(...extractCommentUrls(html, effectiveBase));

  // 6. Meta tag extraction
  rawEntries.push(...extractMetaTags($, effectiveBase));

  // 7. JSON-LD extraction
  rawEntries.push(...extractJsonLd($, effectiveBase));

  // 8. Raw HTML regex scan (catch-all)
  rawEntries.push(...extractRegexScan(html, effectiveBase));

  // 9. Noscript content extraction
  rawEntries.push(...extractNoscriptUrls($, effectiveBase));

  // 10. Data-URI link detection
  rawEntries.push(...extractDataUriLinks($, effectiveBase));

  // 11. Object/embed deep inspection
  rawEntries.push(...extractObjectEmbedUrls($, effectiveBase));

  // Dedup by URL string only (keep unique URLs, not domain-level dedup)
  const seen = new Set<string>();
  const results: ExtractedUrlEntry[] = [];

  for (const entry of rawEntries) {
    if (seen.has(entry.url)) continue;
    seen.add(entry.url);
    results.push({
      url: entry.url,
      tag: entry.tag,
      source: entry.source,
    });
  }

  return results;
}

// ─── Re-exports for scan-engine ────────────────────────────────────────────

/** Alias for extractUrlsFromJsContent – used by scan-engine for external JS analysis */
export function extractUrlsFromJs(js: string, _baseUrl: string): string[] {
  return extractUrlsFromJsContent(js).map(u => {
    // Try to resolve relative URLs
    const resolved = resolveUrl(u, _baseUrl);
    return resolved || u;
  });
}

/** Alias for extractUrlsFromCss – used by scan-engine for external CSS analysis */
export function extractUrlsFromCssContent(css: string, _baseUrl: string): string[] {
  return extractUrlsFromCss(css).map(u => {
    const resolved = resolveUrl(u, _baseUrl);
    return resolved || u;
  });
}
