import {
  DETECTION_RULES,
  RULES_STORAGE_KEY,
  API_KEY_PREFIX,
  QUERY_ONLY_SOURCES,
  API_KEY_SOURCES,
  SourceInfo,
} from './types';

// --- Helper: localStorage ---

export function loadRules(): Record<string, boolean> {
  if (typeof window === 'undefined') return {};
  try {
    const raw = localStorage.getItem(RULES_STORAGE_KEY);
    if (raw) return JSON.parse(raw);
  } catch {
    // ignore
  }
  const defaults: Record<string, boolean> = {};
  DETECTION_RULES.forEach(r => { defaults[r.id] = r.defaultEnabled; });
  return defaults;
}

export function saveRules(rules: Record<string, boolean>) {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(RULES_STORAGE_KEY, JSON.stringify(rules));
  } catch {
    // ignore
  }
}

export function loadApiKey(sourceId: string): string {
  if (typeof window === 'undefined') return '';
  try {
    return localStorage.getItem(API_KEY_PREFIX + sourceId) || '';
  } catch {
    return '';
  }
}

export function saveApiKey(sourceId: string, key: string) {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(API_KEY_PREFIX + sourceId, key);
  } catch {
    // ignore
  }
}

// --- Source status helpers ---

export function getSourceStatus(
  source: SourceInfo,
  hasApiKey: boolean,
  _totalCount: number,
  enabled?: boolean
): 'active' | 'inactive' | 'needs-key' | 'deprecated' | 'stale' | 'query-only' {
  if (source.status === 'deprecated') return 'deprecated';
  if (source.status === 'stale') return 'stale';
  // Query-only sources (VirusTotal, ThreatBook, AbuseIPDB)
  if (QUERY_ONLY_SOURCES.has(source.id)) {
    return hasApiKey ? 'query-only' : 'needs-key';
  }
  // Bulk sources that need API key
  if (API_KEY_SOURCES.has(source.id)) {
    return hasApiKey ? 'active' : 'needs-key';
  }
  // Free sources: if the source is marked active and toggle is enabled, show 'active'
  // Only show 'inactive' when the toggle is OFF
  if (source.status === 'active' && enabled !== false) return 'active';
  return enabled ? 'active' : 'inactive';
}
