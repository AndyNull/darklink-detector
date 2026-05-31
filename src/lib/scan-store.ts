'use client';

import { create } from 'zustand';
import type { DarkLinkType, Severity, TaskStatus } from '@/lib/scan-engine/types';
import { isSafeDomain } from '@/lib/safe-domain-whitelist';

export interface UrlConfig {
  id: string;
  url: string;
  method: string;
  headers: Record<string, string>;
  body: string;
  enabled: boolean;
}

export interface DarkLinkResult {
  url: string;
  tag?: string;
  text?: string;
  type: DarkLinkType;
  severity: Severity;
  description?: string;
  evidence?: string;
}

export interface QrCodeResult {
  sourceUrl?: string;
  decodedText: string;
  isSuspicious: boolean;
  reason?: string;
  qrImageBase64?: string;
}

export interface UrlDetailResult {
  url: string;
  tag?: string;
  attribute?: string;
  text?: string;
  isExternal: boolean;
  domain?: string;
  isVisible: boolean;
  hideReason?: string;
  /** How many URLs were found under this domain (domain-level dedup) */
  urlCount?: number;
  /** All sources that found URLs for this domain */
  sources?: string[];
  /** All tags that contained URLs for this domain */
  tags?: string[];
}

export interface ScanResultItem {
  url: string;
  method: string;
  statusCode?: number;
  responseTime?: number;
  title?: string;
  extractedUrls: number;
  darkLinks: number;
  qrCodes: number;
  status: TaskStatus;
  errorMessage?: string;
  urlDetails: UrlDetailResult[];
  darkLinkDetails: DarkLinkResult[];
  qrCodeDetails: QrCodeResult[];
  /** Raw HTML content of the scanned page (for preview) */
  rawHtml?: string;
}

export interface LogEntry {
  id: number;
  level: 'info' | 'warn' | 'error' | 'debug';
  message: string;
  detail?: string;
  timestamp: Date;
}

export interface ScanProgress {
  taskId: string;
  totalUrls: number;
  completedUrls: number;
  progress: number;
  status: TaskStatus;
  currentUrl?: string;
  /** Timestamp when the current URL started processing */
  currentUrlStartTime?: number;
  /** Average time per URL in ms (based on completed URLs) */
  avgTimePerUrl?: number;
  /** Estimated time remaining in ms */
  estimatedTimeRemaining?: number;
  /** Number of dark links found so far */
  darkLinksFound?: number;
}

export interface TaskHistoryItem {
  taskId: string;
  createdAt: number;
  status: string;
  urlCount: number;
  darkLinks: number;
  qrCodes: number;
  firstUrl?: string;
}

export type SeverityFilter = 'all' | 'medium' | 'high' | 'critical' | 'safe';
type ResultFilter = 'all' | 'dark-links' | 'qr-codes' | 'errors';

export type SublinkStatus = 'idle' | 'discovering' | 'discovered' | 'scanning' | 'complete' | 'error';

export interface SublinkProgress {
  /** The source URL being discovered */
  sourceUrl: string;
  /** Total sublinks discovered so far */
  discovered: number;
  /** Sublinks that have been scanned */
  scanned: number;
  /** Total sublinks to scan */
  total: number;
  /** Current URL being scanned */
  currentUrl?: string;
  /** List of discovered sublink URLs */
  sublinks: string[];
  /** Discovery progress for multiple source URLs */
  sourcesProgress: Array<{
    url: string;
    hostname: string;
    sublinkCount: number;
    status: 'pending' | 'discovering' | 'done' | 'error';
  }>;
  /** Estimated time remaining in ms */
  eta?: number;
  /** Discovery start timestamp */
  discoveryStartTime?: number;
}

interface ScanStore {
  // URL configuration
  urls: UrlConfig[];
  addUrl: (url: string, method?: string, headers?: Record<string, string>, body?: string) => void;
  addBatchUrls: (urlsText: string) => void;
  removeUrl: (id: string) => void;
  updateUrl: (id: string, updates: Partial<UrlConfig>) => void;
  toggleUrl: (id: string) => void;
  clearUrls: () => void;

  // Scan settings
  concurrency: number;
  timeout: number;
  globalHeaders: Record<string, string>;
  globalBody: string;
  setConcurrency: (val: number) => void;
  setTimeout: (val: number) => void;
  setGlobalHeaders: (headers: Record<string, string>) => void;
  setGlobalBody: (body: string) => void;

  // Scan state
  taskId: string | null;
  scanStatus: string;
  progress: ScanProgress | null;
  results: ScanResultItem[];
  logs: LogEntry[];
  isScanning: boolean;
  scanStartTime: number | null;

  // Auto-navigate
  autoNavigateToResults: boolean;
  setAutoNavigateToResults: (val: boolean) => void;

  // Filters
  severityFilter: SeverityFilter;
  resultFilter: ResultFilter;
  searchQuery: string;
  setSeverityFilter: (f: SeverityFilter) => void;
  setResultFilter: (f: ResultFilter) => void;
  setSearchQuery: (q: string) => void;

  // Sublink scanning
  sublinkEnabled: boolean;
  sublinkDepth: number; // 1-5, how many levels deep to mine sublinks
  sublinkStatus: SublinkStatus;
  sublinkProgress: SublinkProgress | null;
  setSublinkEnabled: (enabled: boolean) => void;
  setSublinkDepth: (depth: number) => void;
  setSublinkStatus: (status: SublinkStatus) => void;
  setSublinkProgress: (progress: SublinkProgress | null | ((prev: SublinkProgress | null) => SublinkProgress | null)) => void;
  resetSublinkScan: () => void;

  // Task history
  taskHistory: TaskHistoryItem[];
  setTaskHistory: (tasks: TaskHistoryItem[]) => void;

  // Actions
  setTaskId: (id: string | null) => void;
  setScanStatus: (status: string) => void;
  setProgress: (progress: ScanProgress | null) => void;
  addResult: (result: ScanResultItem) => void;
  addLog: (log: Omit<LogEntry, 'id'>) => void;
  clearResults: () => void;
  clearLogs: () => void;
  setIsScanning: (val: boolean) => void;
  resetScan: () => void;
  loadTaskResults: (taskId: string) => void;
  updateResultRawHtml: (url: string, rawHtml: string) => void;

  // Computed
  getFilteredResults: () => ScanResultItem[];
  getFilteredDarkLinks: () => DarkLinkResult[];
  getFilteredQrCodes: () => QrCodeResult[];
  getStats: () => { totalUrls: number; darkLinks: number; qrCodes: number; errors: number; criticalLinks: number };
  getEstimatedTimeRemaining: () => string;
}

let urlIdCounter = 0;
let logIdCounter = 0;

/**
 * Parse a curl command string into URL config components.
 * Supports: -X method, -H headers, -d/--data body, URL detection
 */
function parseCurl(curlStr: string): { url: string; method: string; headers: Record<string, string>; body: string } | null {
  try {
    // Remove "curl" prefix and normalize
    let str = curlStr.replace(/^curl\s+/, '').trim();
    // Remove line-continuation backslashes
    str = str.replace(/\\\s*\n/g, ' ').replace(/\\\s+/g, ' ');

    let method = '';
    const headers: Record<string, string> = {};
    let body = '';
    let url = '';

    // Tokenize respecting quoted strings
    const tokens: string[] = [];
    let current = '';
    let inQuote = false;
    let quoteChar = '';
    for (let i = 0; i < str.length; i++) {
      const ch = str[i];
      if (inQuote) {
        if (ch === quoteChar) {
          inQuote = false;
        } else {
          current += ch;
        }
      } else if (ch === '"' || ch === "'") {
        inQuote = true;
        quoteChar = ch;
      } else if (ch === ' ' || ch === '\t') {
        if (current) {
          tokens.push(current);
          current = '';
        }
      } else {
        current += ch;
      }
    }
    if (current) tokens.push(current);

    let i = 0;
    while (i < tokens.length) {
      const token = tokens[i];
      if (token === '-X' || token === '--request') {
        method = tokens[++i] || '';
      } else if (token === '-H' || token === '--header') {
        const headerStr = tokens[++i] || '';
        const colonIdx = headerStr.indexOf(':');
        if (colonIdx > 0) {
          const key = headerStr.substring(0, colonIdx).trim();
          const val = headerStr.substring(colonIdx + 1).trim();
          headers[key] = val;
        }
      } else if (token === '-d' || token === '--data' || token === '--data-raw' || token === '--data-binary' || token === '--data-urlencode') {
        body = tokens[++i] || '';
        if (!method) method = 'POST';
      } else if (!token.startsWith('-')) {
        // Positional argument = URL
        if (!url) url = token;
      }
      i++;
    }

    if (!url) return null;
    if (!method) method = body ? 'POST' : 'GET';

    return { url, method, headers, body };
  } catch {
    return null;
  }
}

export const useScanStore = create<ScanStore>((set, get) => ({
  urls: [],
  concurrency: 10,
  timeout: 15000,
  globalHeaders: {},
  globalBody: '',
  taskId: null,
  scanStatus: 'idle',
  progress: null,
  results: [],
  logs: [],
  isScanning: false,
  scanStartTime: null,
  severityFilter: 'all',
  resultFilter: 'all',
  searchQuery: '',
  taskHistory: [],
  autoNavigateToResults: false,
  sublinkEnabled: false,
  sublinkDepth: 2,
  sublinkStatus: 'idle',
  sublinkProgress: null,

  addUrl: (url, method = 'GET', headers = {}, body = '') => {
    const id = `url-${++urlIdCounter}`;
    set((state) => ({ urls: [...state.urls, { id, url, method, headers, body, enabled: true }] }));
  },

  addBatchUrls: (urlsText: string) => {
    const newUrls: UrlConfig[] = [];
    // Try to parse the entire input as JSON first
    let parsedAsJson = false;
    try {
      const data = JSON.parse(urlsText.trim());
      parsedAsJson = true;
      if (Array.isArray(data)) {
        for (const item of data) {
          if (typeof item === 'string') {
            newUrls.push({ id: `url-${++urlIdCounter}`, url: item, method: 'GET', headers: {}, body: '', enabled: true });
          } else if (item.url) {
            newUrls.push({ id: `url-${++urlIdCounter}`, url: item.url, method: item.method || 'GET', headers: item.headers || {}, body: item.body || '', enabled: true });
          }
        }
      } else if (data.url) {
        newUrls.push({ id: `url-${++urlIdCounter}`, url: data.url, method: data.method || 'GET', headers: data.headers || {}, body: data.body || '', enabled: true });
      }
    } catch {}

    if (!parsedAsJson) {
      const lines = urlsText.split('\n');
      let currentCurl = '';
      const flushCurl = () => {
        if (currentCurl.trim()) {
          const parsed = parseCurl(currentCurl.trim());
          if (parsed) newUrls.push({ id: `url-${++urlIdCounter}`, ...parsed, enabled: true });
          currentCurl = '';
        }
      };
      for (const rawLine of lines) {
        const line = rawLine.trim();
        if (!line) continue;
        if (line.startsWith('curl ')) {
          flushCurl();
          currentCurl = line;
        } else if (currentCurl) {
          currentCurl += ' ' + line;
        } else {
          // Try per-line JSON
          try {
            const parsed = JSON.parse(line);
            if (parsed.url) {
              newUrls.push({ id: `url-${++urlIdCounter}`, url: parsed.url, method: parsed.method || 'GET', headers: parsed.headers || {}, body: parsed.body || '', enabled: true });
              continue;
            }
          } catch {}
          // Plain URL
          newUrls.push({ id: `url-${++urlIdCounter}`, url: line, method: 'GET', headers: {}, body: '', enabled: true });
        }
      }
      flushCurl();
    }

    if (newUrls.length > 0) {
      set((state) => ({ urls: [...state.urls, ...newUrls] }));
    }
  },

  removeUrl: (id) => set((state) => ({ urls: state.urls.filter(u => u.id !== id) })),
  updateUrl: (id, updates) => set((state) => ({
    urls: state.urls.map(u => u.id === id ? { ...u, ...updates } : u),
  })),
  toggleUrl: (id) => set((state) => ({
    urls: state.urls.map(u => u.id === id ? { ...u, enabled: !u.enabled } : u),
  })),
  clearUrls: () => set({ urls: [] }),

  setConcurrency: (val) => set({ concurrency: val }),
  setTimeout: (val) => set({ timeout: val }),
  setGlobalHeaders: (headers) => set({ globalHeaders: headers }),
  setGlobalBody: (body) => set({ globalBody: body }),

  setTaskId: (id) => set({ taskId: id }),
  setScanStatus: (status) => set({ scanStatus: status }),
  setProgress: (progress) => set({ progress }),
  addResult: (result) => set((state) => ({ results: [...state.results, result] })),
  addLog: (log) => set((state) => {
    const entry: LogEntry = { ...log, id: ++logIdCounter };
    const logs = [...state.logs, entry];
    return { logs: logs.length > 2000 ? logs.slice(-2000) : logs };
  }),
  clearResults: () => set({ results: [] }),
  clearLogs: () => set({ logs: [] }),
  setIsScanning: (val) => set({ isScanning: val }),

  setTaskHistory: (tasks) => set({ taskHistory: tasks }),
  setAutoNavigateToResults: (val) => set({ autoNavigateToResults: val }),

  setSublinkEnabled: (enabled) => set({ sublinkEnabled: enabled }),
  setSublinkDepth: (depth) => set({ sublinkDepth: depth }),
  setSublinkStatus: (status) => set({ sublinkStatus: status }),
  setSublinkProgress: (progress) => {
    if (typeof progress === 'function') {
      set({ sublinkProgress: progress(get().sublinkProgress) });
    } else {
      set({ sublinkProgress: progress });
    }
  },
  resetSublinkScan: () => set({
    sublinkStatus: 'idle',
    sublinkProgress: null,
  }),

  resetScan: () => set({
    taskId: null,
    scanStatus: 'idle',
    progress: null,
    results: [],
    logs: [],
    isScanning: false,
    scanStartTime: null,
    autoNavigateToResults: false,
    urls: [],
    sublinkStatus: 'idle',
    sublinkProgress: null,
  }),

  loadTaskResults: async (taskId: string) => {
    try {
      const res = await fetch(`/api/scan?action=results&taskId=${encodeURIComponent(taskId)}`);
      if (!res.ok) return;
      const data = await res.json();
      if (data.results) {
        // Only update results and taskId - do NOT touch progress, scanStatus,
        // isScanning, scanStartTime, or logs, as those belong to the active
        // scan page and should not be affected by viewing history.
        set({
          results: data.results,
          taskId: data.taskId,
        });
      }
    } catch (err) {
      console.error('Failed to load task results:', err);
    }
  },

  updateResultRawHtml: (url: string, rawHtml: string) => {
    set(state => ({
      results: state.results.map(r => r.url === url ? { ...r, rawHtml } : r),
    }));
  },

  setSeverityFilter: (f) => set({ severityFilter: f }),
  setResultFilter: (f) => set({ resultFilter: f }),
  setSearchQuery: (q) => set({ searchQuery: q }),

  getFilteredResults: () => {
    const { results, resultFilter, searchQuery } = get();
    let filtered = results;

    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      filtered = filtered.filter(r =>
        r.url.toLowerCase().includes(q) ||
        r.title?.toLowerCase().includes(q)
      );
    }

    if (resultFilter === 'dark-links') {
      filtered = filtered.filter(r => r.darkLinks > 0);
    } else if (resultFilter === 'qr-codes') {
      filtered = filtered.filter(r => r.qrCodes > 0);
    } else if (resultFilter === 'errors') {
      filtered = filtered.filter(r => r.status === 'error');
    }

    return filtered;
  },

  getFilteredDarkLinks: () => {
    const { results, severityFilter, searchQuery } = get();
    let allLinks = results.flatMap(r => r.darkLinkDetails);

    // Filter by effective severity (consistent with display logic)
    // We use the safe-domain-whitelist to determine "safe" items
    if (severityFilter !== 'all') {
      if (severityFilter === 'safe') {
        // Only show links whose domain is in the safe whitelist
        allLinks = allLinks.filter(l => {
          try { return isSafeDomain(new URL(l.url).hostname); } catch { return false; }
        });
      } else if (severityFilter === 'critical') {
        allLinks = allLinks.filter(l => l.severity === 'critical');
      } else if (severityFilter === 'high') {
        allLinks = allLinks.filter(l => l.severity === 'critical' || l.severity === 'high');
      } else if (severityFilter === 'medium') {
        // Exclude safe-domain items from "medium" filter
        allLinks = allLinks.filter(l => {
          const isLow = l.severity === 'medium' || l.severity === 'low';
          if (!isLow) return false;
          try { return !isSafeDomain(new URL(l.url).hostname); } catch { return true; }
        });
      }
    }

    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      allLinks = allLinks.filter(l =>
        l.url.toLowerCase().includes(q) ||
        l.description?.toLowerCase().includes(q) ||
        l.text?.toLowerCase().includes(q)
      );
    }

    // Deduplicate by hostname (works for both domains and IP addresses)
    // hostname returns the IP for IP-based URLs, so IPs are naturally deduped
    const domainMap = new Map<string, typeof allLinks[0]>();
    const severityOrder: Record<string, number> = { critical: 0, high: 1, medium: 2, low: 3 };
    for (const link of allLinks) {
      let hostname: string;
      try { hostname = new URL(link.url).hostname; } catch { hostname = link.url; }
      const existing = domainMap.get(hostname);
      if (!existing || (severityOrder[link.severity] ?? 99) < (severityOrder[existing.severity] ?? 99)) {
        domainMap.set(hostname, link);
      }
    }

    return [...domainMap.values()];
  },

  getFilteredQrCodes: () => {
    const { results, searchQuery } = get();
    let allQr = results.flatMap(r => r.qrCodeDetails);

    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      allQr = allQr.filter(qr =>
        qr.decodedText.toLowerCase().includes(q) ||
        qr.sourceUrl?.toLowerCase().includes(q)
      );
    }

    // Deduplicate by decoded text
    const seen = new Set<string>();
    return allQr.filter(qr => {
      if (seen.has(qr.decodedText)) return false;
      seen.add(qr.decodedText);
      return true;
    });
  },

  getStats: () => {
    const { results } = get();
    return {
      totalUrls: results.length,
      darkLinks: results.reduce((sum, r) => sum + r.darkLinks, 0),
      qrCodes: results.reduce((sum, r) => sum + r.qrCodes, 0),
      errors: results.filter(r => r.status === 'error').length,
      criticalLinks: results.reduce((sum, r) => sum + r.darkLinkDetails.filter(d => d.severity === 'critical').length, 0),
    };
  },

  getEstimatedTimeRemaining: () => {
    const { progress, scanStartTime } = get();
    if (!progress || !scanStartTime || progress.completedUrls === 0) return '--';
    const elapsed = Date.now() - scanStartTime;
    const avgTimePerUrl = elapsed / progress.completedUrls;
    const remaining = (progress.totalUrls - progress.completedUrls) * avgTimePerUrl;
    if (remaining < 1000) return '< 1秒';
    if (remaining < 60000) return `~${Math.ceil(remaining / 1000)}秒`;
    return `~${Math.ceil(remaining / 60000)}分钟`;
  },
}));
