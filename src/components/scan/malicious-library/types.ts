// Types and constants for the malicious library module

export interface MaliciousDomain {
  id: string;
  domain: string;
  reason: string | null;
  source: string;
  severity: string;
  category: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface MaliciousIP {
  id: string;
  ip: string;
  reason: string | null;
  source: string;
  severity: string;
  category: string | null;
  country: string | null;
  createdAt: string;
  updatedAt: string;
}

export type MaliciousEntry = MaliciousDomain | MaliciousIP;

export const severityLabels: Record<string, string> = {
  critical: '严重',
  high: '高危',
  medium: '中危',
  low: '低危',
};

export const categoryLabels: Record<string, string> = {
  phishing: '钓鱼',
  malware: '恶意软件',
  c2: 'C2',
  spam: '垃圾邮件',
  botnet: '僵尸网络',
  bruteforce: '暴力破解',
  suspicious: '可疑',
  'threat-intel': '威胁情报',
  'malicious-ssl': '恶意SSL',
  other: '其他',
};

export const sourceLabels: Record<string, string> = {
  manual: '手动添加',
  scan: '扫描发现',
  threatbook: '微步情报',
  openphish: 'OpenPhish',
  urlhaus: 'URLhaus',
  threatfox: 'ThreatFox',
  'blocklist-de': 'Blocklist.de',
  'cins-army': 'CINS Army',
  'spamhaus-drop': 'Spamhaus DROP',
  'alienvault-otx': 'AlienVault OTX',
  phishtank: 'PhishTank',
  virustotal: 'VirusTotal',
  abuseipdb: 'AbuseIPDB',
  other: '其他',
};

export interface SourceInfo {
  id: string;
  name: string;
  description: string;
  type: string;
  url: string;
  domainCount: number;
  ipCount: number;
  totalCount: number;
  lastUpdated?: string;
  status?: 'idle' | 'running' | 'completed' | 'error';
  needsApiKey?: boolean;
  apiKeyConfigured?: boolean;
  queryOnly?: boolean;
}

// Query-only sources: these are rate-limited and don't contribute bulk data to the malicious library.
// They should be excluded from the sources tab display.
export const QUERY_ONLY_SOURCES = new Set(['virustotal', 'abuseipdb', 'threatbook']);
