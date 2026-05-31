// Types for the scan engine

export interface ScanRequest {
  urls: UrlConfig[];
  concurrency?: number;
  timeout?: number;
  taskName?: string;
  disabledRules?: string[]; // rule IDs to skip during scan
}

export interface UrlConfig {
  url: string;
  method?: string;
  headers?: Record<string, string>;
  body?: string;
  followRedirects?: boolean;
}

export interface ScanResultData {
  url: string;
  method: string;
  statusCode?: number;
  responseTime?: number;
  title?: string;
  extractedUrls: number;
  darkLinks: number;
  qrCodes: number;
  status: 'pending' | 'running' | 'completed' | 'error';
  errorMessage?: string;
  /** Raw HTML content of the scanned page (truncated to 200KB) for source code preview */
  rawHtml?: string;
  urlDetails: UrlDetailData[];
  darkLinkDetails: DarkLinkData[];
  qrCodeDetails: QrCodeData[];
}

export interface UrlDetailData {
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

export interface DarkLinkData {
  url: string;
  tag?: string;
  text?: string;
  type: DarkLinkType;
  severity: Severity;
  description?: string;
  evidence?: string;
}

export type DarkLinkType =
  | 'css_hidden'
  | 'size_hidden'
  | 'color_hidden'
  | 'position_hidden'
  | 'overflow_hidden'
  | 'iframe_hidden'
  | 'suspicious_domain'
  | 'js_injected'
  | 'malicious_keyword'
  | 'suspicious_shortener'
  | 'cheap_tld'
  | 'hidden_text'
  | 'keyword_stuffing'
  | 'hidden_div_link'
  | 'base_redirect'
  | 'meta_refresh'
  | 'form_hijack'
  | 'svg_hidden'
  | 'nofollow_suspicious'
  | 'data_uri_link'
  | 'noscript_hidden';

export type Severity = 'low' | 'medium' | 'high' | 'critical';

export interface QrCodeData {
  sourceUrl?: string;
  decodedText: string;
  isSuspicious: boolean;
  reason?: string;
  /** Base64-encoded source image (data URI) for popup verification */
  qrImageBase64?: string;
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
  /** Timestamp (Date.now()) when the task reached a terminal state (completed/stopped) */
  completedAt?: number;
}

export type TaskStatus = 'pending' | 'running' | 'paused' | 'completed' | 'stopped' | 'error';

export interface LogEntry {
  level: 'info' | 'warn' | 'error' | 'debug';
  message: string;
  detail?: string;
  timestamp: Date;
}
