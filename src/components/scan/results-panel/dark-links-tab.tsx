'use client';

import React from 'react';
import { type DarkLinkResult, type SeverityFilter } from '@/lib/scan-store';
import { isSafeDomain } from '@/lib/safe-domain-whitelist';
import { Badge } from '@/components/ui/badge';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { ArrowUpDown, ShieldCheck } from 'lucide-react';
import { type DarkLinkSort } from './types';
import { DarkLinkCard } from './dark-link-card';

export interface DarkLinksTabProps {
  darkLinks: DarkLinkResult[];
  sortedDarkLinks: DarkLinkResult[];
  darkLinkSort: DarkLinkSort;
  setDarkLinkSort: (sort: DarkLinkSort) => void;
  severityFilter: string;
  setSeverityFilter: (filter: SeverityFilter) => void;
  severityCounts: { critical: number; high: number; medium: number; safe: number };
  maliciousMatches: Set<string>;
  suspiciousMatches: Set<string>;
  threatIntelConfirmed: Set<string>;
  copiedUrl: string | null;
  onCopy: (url: string, e?: React.MouseEvent) => void;
}

export function DarkLinksTab({
  darkLinks,
  sortedDarkLinks,
  darkLinkSort,
  setDarkLinkSort,
  severityFilter,
  setSeverityFilter,
  severityCounts,
  maliciousMatches,
  suspiciousMatches,
  threatIntelConfirmed,
  copiedUrl,
  onCopy,
}: DarkLinksTabProps) {
  // Pre-compute hostname → DB match flags once, avoiding new URL() in JSX per render
  const linkMatchFlags = React.useMemo(() => {
    const flags = new Map<string, { inMaliciousDB: boolean; inSuspiciousDB: boolean; threatIntelConfirmed: boolean }>();
    for (const link of sortedDarkLinks) {
      let hostname: string;
      try { hostname = new URL(link.url).hostname; } catch { hostname = ''; }
      flags.set(link.url, {
        inMaliciousDB: hostname ? maliciousMatches.has(hostname) : false,
        inSuspiciousDB: hostname ? suspiciousMatches.has(hostname) : false,
        threatIntelConfirmed: hostname ? threatIntelConfirmed.has(hostname) : false,
      });
    }
    return flags;
  }, [sortedDarkLinks, maliciousMatches, suspiciousMatches, threatIntelConfirmed]);

  return (
    <>
      {/* Toolbar: severity filter + sorting + severity summary */}
      <div className="mb-1 flex items-center gap-1 sticky top-0 bg-background z-10 py-0.5">
        <Select value={severityFilter} onValueChange={(v) => setSeverityFilter(v as any)}>
          <SelectTrigger size="sm" className="w-[80px] h-7 data-[size=sm]:h-7 text-[10px] px-2 [&>svg]:size-3">
            <SelectValue placeholder="严重性" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">全部</SelectItem>
            <SelectItem value="critical">严重</SelectItem>
            <SelectItem value="high">高危</SelectItem>
            <SelectItem value="medium">可疑</SelectItem>
            <SelectItem value="safe">安全</SelectItem>
          </SelectContent>
        </Select>
        <Select value={darkLinkSort} onValueChange={(v) => setDarkLinkSort(v as DarkLinkSort)}>
          <SelectTrigger size="sm" className="w-[80px] h-7 data-[size=sm]:h-7 text-[10px] px-2 [&>svg]:size-3">
            <ArrowUpDown className="h-2.5 w-2.5 mr-0.5" />
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="severity">按严重性</SelectItem>
            <SelectItem value="domain">按域名</SelectItem>
            <SelectItem value="type">按类型</SelectItem>
          </SelectContent>
        </Select>
        {darkLinks.length > 0 && (
          <div className="ml-auto flex items-center gap-1 text-[9px] shrink-0 flex-wrap justify-end">
            <span className="text-red-600 font-medium">严重:{severityCounts.critical}</span>
            <span className="text-muted-foreground">|</span>
            <span className="text-orange-600 font-medium">高危:{severityCounts.high}</span>
            <span className="text-muted-foreground">|</span>
            <span className="text-yellow-600 font-medium">可疑:{severityCounts.medium}</span>
            {severityCounts.safe > 0 && (
              <>
                <span className="text-muted-foreground">|</span>
                <span className="text-green-600 font-medium">安全:{severityCounts.safe}</span>
              </>
            )}
          </div>
        )}
      </div>
      {darkLinks.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-8 text-muted-foreground">
          <ShieldCheck className="h-8 w-8 mb-2 text-green-500/30" />
          <p className="text-xs">未检测到暗链</p>
          <p className="text-[10px] text-muted-foreground/60 mt-1">扫描发现的暗链将显示在这里</p>
        </div>
      ) : (
        <div className="space-y-1">
          {sortedDarkLinks.map((link, i) => {
            const flags = linkMatchFlags.get(link.url);
            return (
              <DarkLinkCard
                key={`${link.url}-${link.type}-${i}`}
                link={link}
                onCopy={onCopy}
                copiedUrl={copiedUrl}
                inMaliciousDB={flags?.inMaliciousDB ?? false}
                inSuspiciousDB={flags?.inSuspiciousDB ?? false}
                threatIntelConfirmed={flags?.threatIntelConfirmed ?? false}
              />
            );
          })}
        </div>
      )}
    </>
  );
}
