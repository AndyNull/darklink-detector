'use client';

import React, { useState, useEffect, useMemo, useCallback, useRef, Suspense } from 'react';
import { useScanStore } from '@/lib/scan-store';
import { isSafeDomain } from '@/lib/safe-domain-whitelist';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Search,
  ShieldAlert,
  QrCode,
  AlertCircle,
  Download,
} from 'lucide-react';
import { toast } from 'sonner';
import { IP_REGEX, severityOrder, type DarkLinkSort } from './types';

// ──── Lazy-loaded dialog (only loaded when user opens preview) ────
const HtmlPreviewDialog = React.lazy(() =>
  import('../html-preview-dialog').then(m => ({ default: m.HtmlPreviewDialog }))
);

// ──── Lazy-loaded sub-components ────
const AllResultsTab = React.lazy(() =>
  import('./all-results-tab').then(m => ({ default: m.AllResultsTab }))
);
const DarkLinksTab = React.lazy(() =>
  import('./dark-links-tab').then(m => ({ default: m.DarkLinksTab }))
);
const QrCodesTab = React.lazy(() =>
  import('./qr-codes-tab').then(m => ({ default: m.QrCodesTab }))
);
const ErrorsTab = React.lazy(() =>
  import('./errors-tab').then(m => ({ default: m.ErrorsTab }))
);

/** Minimal loading fallback for Suspense */
function TabLoadingFallback() {
  return (
    <div className="flex items-center justify-center py-8 text-muted-foreground text-xs">
      加载中...
    </div>
  );
}

export function ResultsPanel() {
  const {
    getFilteredResults,
    getFilteredDarkLinks,
    getFilteredQrCodes,
    resultFilter,
    setResultFilter,
    severityFilter,
    setSeverityFilter,
    searchQuery,
    setSearchQuery,
    results,
    getStats,
    scanStatus,
  } = useScanStore();

  const [copiedUrl, setCopiedUrl] = useState<string | null>(null);
  const [previewResult, setPreviewResult] = useState<{
    url: string;
    statusCode?: number;
    responseTime?: number;
    rawHtml?: string;
    darkLinkDetails: any[];
    title?: string;
  } | null>(null);

  // ──── Malicious library batch check ────
  const [maliciousMatches, setMaliciousMatches] = useState<Set<string>>(new Set());
  // ──── Suspicious library batch check (medium/low severity matches) ────
  const [suspiciousMatches, setSuspiciousMatches] = useState<Set<string>>(new Set());

  // ──── Threat intel batch check ────
  const [threatIntelConfirmed, setThreatIntelConfirmed] = useState<Set<string>>(new Set());

  // ──── Dark link sorting ────
  const [darkLinkSort, setDarkLinkSort] = useState<DarkLinkSort>('severity');

  // ──── Debounced results tracking ────
  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [debouncedResults, setDebouncedResults] = useState(results);

  useEffect(() => {
    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
    }
    debounceTimerRef.current = setTimeout(() => {
      setDebouncedResults(results);
    }, 300);
    return () => {
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
      }
    };
  }, [results]);

  useEffect(() => {
    // Only check threat intel when scan is complete, not during active scanning.
    // 'idle' means viewing historical results — allow check in that case too.
    if (scanStatus === 'scanning') return;

    const allDarkLinks = debouncedResults.flatMap(r => r.darkLinkDetails);
    if (allDarkLinks.length === 0) {
      return;
    }

    // Extract unique domains and IPs
    const domains = new Set<string>();
    const ips = new Set<string>();
    for (const link of allDarkLinks) {
      try {
        const hostname = new URL(link.url).hostname;
        if (IP_REGEX.test(hostname)) {
          ips.add(hostname);
        } else {
          domains.add(hostname);
        }
      } catch {}
    }

    let cancelled = false;

    const checkMalicious = async () => {
      const malicious = new Set<string>();
      const suspicious = new Set<string>();

      const processMatches = (data: any) => {
        for (const [value, info] of Object.entries(data.matches || {})) {
          const matchInfo = info as any;
          if (matchInfo?.matched) {
            const severity = matchInfo.item?.severity || 'high';
            const category = matchInfo.item?.category || '';
            // Only "critical" and "high" severity count as malicious DB matches
            // "medium"/"low" severity (like CINS Army suspicious) count as suspicious
            if (severity === 'critical' || severity === 'high') {
              malicious.add(value);
            } else {
              suspicious.add(value);
            }
          }
        }
      };

      // Check domains
      if (domains.size > 0) {
        try {
          const res = await fetch('/api/malicious', {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ action: 'check', type: 'domain', values: [...domains] }),
          });
          // Silently skip on 401 (unauthenticated) — malicious check is optional for unauthenticated users
          if (res.status === 401) {
            // no-op: skip gracefully
          } else if (res.ok) {
            const data = await res.json();
            processMatches(data);
          }
        } catch {}
      }

      // Check IPs
      if (ips.size > 0) {
        try {
          const res = await fetch('/api/malicious', {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ action: 'check', type: 'ip', values: [...ips] }),
          });
          // Silently skip on 401 (unauthenticated) — malicious check is optional for unauthenticated users
          if (res.status === 401) {
            // no-op: skip gracefully
          } else if (res.ok) {
            const data = await res.json();
            processMatches(data);
          }
        } catch {}
      }

      if (!cancelled) {
        setMaliciousMatches(malicious);
        setSuspiciousMatches(suspicious);
      }
      return { malicious, suspicious };
    };

    // ──── Threat intel batch query (ThreatBook) ────
    const checkThreatIntel = async (maliciousDBMatches: Set<string>) => {
      const confirmed = new Set<string>();
      const allValues = [...domains, ...ips];
      const toQuery = allValues.filter(v => !maliciousDBMatches.has(v));

      // Query with concurrency of 2 (respect ThreatBook rate limits)
      const CONCURRENCY = 2;
      const executing = new Set<Promise<void>>();

      for (const value of toQuery) {
        if (cancelled) break;

        const p = (async () => {
          try {
            const type = IP_REGEX.test(value) ? 'ip' : 'domain';
            const res = await fetch(`/api/threat-intel?type=${type}&value=${encodeURIComponent(value)}`);
            if (res.ok) {
              const data = await res.json();
              if (data.threatbook?.isMalicious || data.threatbook?.isSuspicious) {
                confirmed.add(value);
              }
            }
          } catch {}
        })();

        executing.add(p);
        p.finally(() => executing.delete(p));

        if (executing.size >= CONCURRENCY) {
          await Promise.race(executing);
        }
      }

      await Promise.allSettled([...executing]);
      if (!cancelled) setThreatIntelConfirmed(confirmed);
    };

    // Run malicious DB check first, then threat intel check
    checkMalicious().then((result) => {
      if (!cancelled) {
        // Skip threat intel check for both malicious AND suspicious DB matches
        const skipSet = new Set([...result.malicious, ...result.suspicious]);
        checkThreatIntel(skipSet);
      }
    });

    return () => { cancelled = true; };
  }, [debouncedResults, scanStatus]);

  const filteredResults = getFilteredResults();
  const darkLinks = getFilteredDarkLinks();
  const qrCodes = getFilteredQrCodes();
  const stats = getStats();

  // ──── Severity count summary for dark-links tab ────
  // Compute on ALL dark links (unfiltered), matching the effectiveSeverity logic in DarkLinkCard
  const allDarkLinksUnfiltered = useMemo(() => {
    const allLinks = results.flatMap(r => r.darkLinkDetails);
    // Deduplicate by hostname (same logic as getFilteredDarkLinks)
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
  }, [results]);

  const severityCounts = useMemo(() => {
    let critical = 0;
    let high = 0;
    let medium = 0;
    let safe = 0;
    for (const link of allDarkLinksUnfiltered) {
      let hostname = link.url;
      try { hostname = new URL(link.url).hostname; } catch {}
      const inDB = maliciousMatches.has(hostname);
      const tiConfirmed = threatIntelConfirmed.has(hostname);
      const inSuspicious = suspiciousMatches.has(hostname);
      const isSafe = isSafeDomain(hostname);
      // Match effectiveSeverity logic in DarkLinkCard exactly
      if (isSafe) {
        safe++;
      } else if (inDB) {
        critical++;
      } else if (tiConfirmed) {
        high++;
      } else if (inSuspicious) {
        medium++;
      } else if (link.severity === 'critical' || link.severity === 'high') {
        high++;
      } else {
        medium++;
      }
    }
    return { critical, high, medium, safe };
  }, [allDarkLinksUnfiltered, maliciousMatches, threatIntelConfirmed, suspiciousMatches]);

  // ──── Sorted dark links ────
  const sortedDarkLinks = useMemo(() => {
    const sorted = [...darkLinks];
    if (darkLinkSort === 'severity') {
      sorted.sort((a, b) => {
        const getEffective = (link: typeof a) => {
          let hostname = link.url;
          try { hostname = new URL(link.url).hostname; } catch {}
          if (isSafeDomain(hostname)) return 'safe';
          if (maliciousMatches.has(hostname)) return 'critical';
          if (threatIntelConfirmed.has(hostname)) return 'high';
          if (suspiciousMatches.has(hostname)) return 'medium';
          return link.severity === 'critical' || link.severity === 'high' ? 'high' : 'medium';
        };
        const extendedOrder: Record<string, number> = { critical: 0, high: 1, medium: 2, safe: 3 };
        return (extendedOrder[getEffective(a)] ?? 99) - (extendedOrder[getEffective(b)] ?? 99);
      });
    } else if (darkLinkSort === 'domain') {
      sorted.sort((a, b) => {
        let ha = a.url, hb = b.url;
        try { ha = new URL(a.url).hostname; } catch {}
        try { hb = new URL(b.url).hostname; } catch {}
        return ha.localeCompare(hb);
      });
    } else if (darkLinkSort === 'type') {
      sorted.sort((a, b) => a.type.localeCompare(b.type));
    }
    return sorted;
  }, [darkLinks, darkLinkSort, maliciousMatches, threatIntelConfirmed]);

  const handleCopyUrl = useCallback(async (url: string, e?: React.MouseEvent) => {
    e?.stopPropagation();
    try {
      await navigator.clipboard.writeText(url);
      setCopiedUrl(url);
      setTimeout(() => setCopiedUrl(null), 2000);
    } catch {}
  }, []);

  const handleExportResults = useCallback(() => {
    try {
      const exportData = {
        exportTime: new Date().toISOString(),
        stats,
        results: results.map(r => ({
          url: r.url,
          method: r.method,
          statusCode: r.statusCode,
          responseTime: r.responseTime,
          title: r.title,
          extractedUrls: r.extractedUrls,
          darkLinks: r.darkLinks,
          qrCodes: r.qrCodes,
          status: r.status,
          errorMessage: r.errorMessage,
          darkLinkDetails: r.darkLinkDetails,
          qrCodeDetails: r.qrCodeDetails,
        })),
      };
      const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `darklink-scan-${Date.now()}.json`;
      a.click();
      URL.revokeObjectURL(url);
      toast.success('结果已导出');
    } catch {
      toast.error('导出失败');
    }
  }, [results, stats]);

  // ──── Bulk copy all QR decoded texts ────
  const handleBulkCopyQrTexts = useCallback(async () => {
    const allTexts = qrCodes.map(qr => qr.decodedText).join('\n');
    try {
      await navigator.clipboard.writeText(allTexts);
      setCopiedUrl('__bulk_qr__');
      setTimeout(() => setCopiedUrl(null), 2000);
    } catch {}
  }, [qrCodes]);

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Compact inline header */}
      <div className="h-10 px-3 border-b flex items-center gap-2 shrink-0">
        <ShieldAlert className="h-3 w-3 text-muted-foreground" />
        <span className="text-xs font-medium">扫描结果</span>
        <div className="ml-auto flex items-center gap-1.5">
          <div className="relative">
            <Search className="absolute left-1.5 top-1/2 -translate-y-1/2 h-3 w-3 text-muted-foreground" />
            <Input
              placeholder="搜索..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="h-8 w-[120px] text-[11px] pl-7"
            />
          </div>
          {results.length > 0 && (
            <Button
              variant="outline"
              size="sm"
              className="text-[10px] gap-0.5 px-1.5"
              onClick={handleExportResults}
            >
              <Download className="h-3 w-3" />
              导出
            </Button>
          )}
        </div>
      </div>

      {/* Tabs + content */}
      <Tabs value={resultFilter} onValueChange={(v) => setResultFilter(v as any)} className="flex-1 flex flex-col min-h-0">
        <TabsList className="w-full justify-start h-7 shrink-0 px-3 pt-1 bg-transparent">
          <TabsTrigger value="all" className="text-[11px] h-7 px-2">
            全部 ({results.length})
          </TabsTrigger>
          <TabsTrigger value="dark-links" className="text-[11px] h-7 px-2">
            <ShieldAlert className="h-2.5 w-2.5 mr-0.5" />
            暗链 ({darkLinks.length})
          </TabsTrigger>
          <TabsTrigger value="qr-codes" className="text-[11px] h-7 px-2">
            <QrCode className="h-2.5 w-2.5 mr-0.5" />
            QR码 ({qrCodes.length})
          </TabsTrigger>
          <TabsTrigger value="errors" className="text-[11px] h-7 px-2">
            <AlertCircle className="h-2.5 w-2.5 mr-0.5" />
            错误{stats.errors > 0 ? ` (${stats.errors})` : ''}
          </TabsTrigger>
        </TabsList>

        <TabsContent value="all" className="flex-1 min-h-0 mt-0 overflow-y-auto custom-scrollbar px-2">
          <Suspense fallback={<TabLoadingFallback />}>
            <AllResultsTab
              filteredResults={filteredResults}
              copiedUrl={copiedUrl}
              onCopy={handleCopyUrl}
              onPreview={setPreviewResult}
            />
          </Suspense>
        </TabsContent>

        <TabsContent value="dark-links" className="flex-1 min-h-0 mt-0 overflow-y-auto custom-scrollbar px-2">
          <Suspense fallback={<TabLoadingFallback />}>
            <DarkLinksTab
              darkLinks={darkLinks}
              sortedDarkLinks={sortedDarkLinks}
              darkLinkSort={darkLinkSort}
              setDarkLinkSort={setDarkLinkSort}
              severityFilter={severityFilter}
              setSeverityFilter={setSeverityFilter}
              severityCounts={severityCounts}
              maliciousMatches={maliciousMatches}
              suspiciousMatches={suspiciousMatches}
              threatIntelConfirmed={threatIntelConfirmed}
              copiedUrl={copiedUrl}
              onCopy={handleCopyUrl}
            />
          </Suspense>
        </TabsContent>

        <TabsContent value="qr-codes" className="flex-1 min-h-0 mt-0 overflow-y-auto custom-scrollbar px-2">
          <Suspense fallback={<TabLoadingFallback />}>
            <QrCodesTab
              qrCodes={qrCodes}
              copiedUrl={copiedUrl}
              onCopy={handleCopyUrl}
              onBulkCopy={handleBulkCopyQrTexts}
            />
          </Suspense>
        </TabsContent>

        <TabsContent value="errors" className="flex-1 min-h-0 mt-0 overflow-y-auto custom-scrollbar px-2">
          <Suspense fallback={<TabLoadingFallback />}>
            <ErrorsTab results={results} />
          </Suspense>
        </TabsContent>
      </Tabs>

      {/* HTML Preview Dialog — lazy-loaded, only fetched when user opens preview */}
      <Suspense fallback={null}>
        <HtmlPreviewDialog
          open={previewResult !== null}
          onOpenChange={(open) => { if (!open) setPreviewResult(null); }}
          url={previewResult?.url || ''}
          statusCode={previewResult?.statusCode}
          responseTime={previewResult?.responseTime}
          rawHtml={previewResult?.rawHtml}
          darkLinkDetails={previewResult?.darkLinkDetails || []}
          title={previewResult?.title}
        />
      </Suspense>
    </div>
  );
}
