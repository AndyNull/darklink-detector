'use client';

export interface MaliciousEntry {
  id: string;
  type: string;
  value: string;
  source: string;
  severity: string;
  reason: string | null;
  tags: string | null;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface MaliciousStats {
  total: number;
  active: number;
  bySeverity: {
    critical: number;
    high: number;
    medium: number;
    low: number;
  };
  byType: {
    ip: number;
    domain: number;
  };
}

export const IP_REGEX = /^(\d{1,3}\.){3}\d{1,3}$/;

export const severityColors: Record<string, string> = {
  critical: 'bg-red-500/10 text-red-600 border-red-500/20',
  high: 'bg-orange-500/10 text-orange-600 border-orange-500/20',
  medium: 'bg-yellow-500/10 text-yellow-600 border-yellow-500/20',
  low: 'bg-emerald-500/10 text-emerald-600 border-emerald-500/20',
};

export const severityLabels: Record<string, string> = {
  critical: '严重',
  high: '高危',
  medium: '中危',
  low: '低危',
};

export const sourceLabels: Record<string, string> = {
  manual: '手动',
  threatbook: '微步',
  virustotal: 'VT',
  urlhaus: 'URLhaus',
  scan: '扫描',
  'batch-import': '批量',
};
