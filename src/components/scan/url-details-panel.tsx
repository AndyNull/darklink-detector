'use client';

import { useState, useMemo, useEffect } from 'react';
import { useScanStore } from '@/lib/scan-store';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Globe,
  Eye,
  EyeOff,
  Copy,
  Check,
  Search,
  Layers,
  ShieldAlert,
  Loader2,
  Plus,
} from 'lucide-react';

function ThreatIntelResult({ type, value }: { type: 'domain' | 'ip'; value: string }) {
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [adding, setAdding] = useState(false);
  const [added, setAdded] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/threat-intel?type=${type}&value=${encodeURIComponent(value)}`)
      .then(r => r.json())
      .then(d => { if (!cancelled) { setData(d); setLoading(false); } })
      .catch(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [type, value]);

  const handleAddToMalicious = async () => {
    setAdding(true);
    try {
      const res = await fetch('/api/malicious', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type, value, source: 'manual', severity: 'high' }),
      });
      if (res.ok) {
        setAdded(true);
      }
    } catch {}
    setAdding(false);
  };

  if (loading) return <div className="flex items-center gap-1"><Loader2 className="h-3 w-3 animate-spin" /> 查询中...</div>;
  if (!data) return <div>查询失败</div>;

  const localMatched = data.localDB?.matched;
  const tbData = data.threatbook;
  const tbIsMalicious = tbData?.isMalicious || false;
  const tbIsSuspicious = tbData?.isSuspicious || false;

  // Source status badge helper
  const getSourceBadge = (s: any) => {
    const statusMap: Record<string, { label: string; className: string }> = {
      matched: { label: '已命中', className: 'border-destructive/50 text-destructive' },
      suspicious: { label: '可疑', className: 'border-yellow-500/50 text-yellow-600' },
      clean: { label: '安全', className: 'border-green-500/50 text-green-600' },
      not_found: { label: '未命中', className: 'border-muted-foreground/30' },
      not_integrated: { label: '未集成', className: 'border-muted-foreground/20 text-muted-foreground' },
      not_configured: { label: '未配置', className: 'border-muted-foreground/20 text-muted-foreground' },
      rate_limited: { label: '限流', className: 'border-orange-500/50 text-orange-500' },
      error: { label: '查询失败', className: 'border-red-500/30 text-red-500' },
    };
    const info = statusMap[s.status] || { label: s.status, className: '' };
    return (
      <Badge variant="outline" className={`text-[8px] px-1 py-0 ${info.className}`}>
        {info.label}
      </Badge>
    );
  };

  return (
    <div className="space-y-1">
      <div className="font-semibold flex items-center gap-1">
        <ShieldAlert className="h-3 w-3" />
        威胁情报
      </div>
      <div className={localMatched ? 'text-destructive font-medium' : tbIsMalicious ? 'text-destructive font-medium' : tbIsSuspicious ? 'text-yellow-600 font-medium' : 'text-muted-foreground'}>
        {localMatched ? '🔴 本地恶意库命中' : tbIsMalicious ? '⚠️ ThreatBook标记为恶意' : tbIsSuspicious ? '🟡 ThreatBook标记为可疑' : '✅ 未发现威胁'}
      </div>
      {localMatched && data.localDB && (
        <div className="bg-destructive/5 border border-destructive/20 rounded p-1 space-y-0.5">
          {data.localDB.reason && <div className="text-[9px]"><span className="font-medium">原因:</span> {data.localDB.reason}</div>}
          <div className="text-[9px]"><span className="font-medium">来源:</span> {data.localDB.source === 'manual' ? '手动添加' : data.localDB.source === 'scan' ? '扫描发现' : data.localDB.source === 'threatbook' ? '微步情报' : data.localDB.source}</div>
          {data.localDB.category && <div className="text-[9px]"><span className="font-medium">分类:</span> {data.localDB.category}</div>}
        </div>
      )}
      {tbData && !localMatched && (
        <div className={`rounded p-1 space-y-0.5 ${tbIsMalicious ? 'bg-destructive/5 border border-destructive/20' : tbIsSuspicious ? 'bg-yellow-500/5 border border-yellow-500/20' : ''}`}>
          {tbData.confidence > 0 && <div className="text-[9px]"><span className="font-medium">置信度:</span> {tbData.confidence}%</div>}
          {tbData.judgments?.length > 0 && <div className="text-[9px]"><span className="font-medium">判定:</span> {tbData.judgments.join(', ')}</div>}
          {tbData.tags?.length > 0 && <div className="text-[9px] truncate" title={tbData.tags.join(', ')}><span className="font-medium">标签:</span> {tbData.tags.slice(0, 5).join(', ')}{tbData.tags.length > 5 ? '...' : ''}</div>}
          {tbData.autoAdded && <div className="text-[9px] text-green-600">✓ 已自动添加到本地恶意库</div>}
        </div>
      )}
      {data.sources?.map((s: any) => (
        <div key={s.name} className="flex items-center gap-1">
          <span className="font-medium">{s.name}</span>
          {getSourceBadge(s)}
          {s.result && s.status !== 'not_integrated' && s.status !== 'not_configured' && s.status !== 'not_found' && (
            <span className="text-[8px] text-muted-foreground truncate">{s.result}</span>
          )}
        </div>
      ))}
      {!localMatched && !added && !(tbData?.autoAdded) && (
        <Button
          variant="outline"
          size="sm"
          className="h-5 text-[9px] gap-0.5 w-full mt-1"
          onClick={handleAddToMalicious}
          disabled={adding}
        >
          {adding ? <Loader2 className="h-2.5 w-2.5 animate-spin" /> : <Plus className="h-2.5 w-2.5" />}
          加入恶意库
        </Button>
      )}
      {added && (
        <div className="text-[9px] text-green-600 font-medium mt-1">✓ 已加入恶意库</div>
      )}
      <div className="text-[8px] text-muted-foreground mt-1">{data.disclaimer}</div>
    </div>
  );
}

type DomainFilter = 'all' | 'external' | 'internal' | 'hidden';

// IP address regex for detecting IP hostnames
const IP_REGEX = /^(\d{1,3}\.){3}\d{1,3}$/;

/**
 * Extract the dedup key from a URL.
 * If the hostname is an IP address, use the IP as the key.
 * Otherwise, use the domain/hostname.
 */
function extractDedupKey(url: string, domain?: string): string {
  // If domain is already provided and it's not an IP, use it
  if (domain && !IP_REGEX.test(domain)) {
    return domain;
  }

  try {
    const urlObj = new URL(url);
    const hostname = urlObj.hostname;

    // If hostname is an IP address, use the IP as the dedup key
    if (IP_REGEX.test(hostname)) {
      return hostname;
    }

    return hostname;
  } catch {
    // Fallback: if URL parsing fails, use the raw URL or domain
    return domain || url;
  }
}

export function UrlDetailsPanel() {
  const { results } = useScanStore();
  const [domainFilter, setDomainFilter] = useState<DomainFilter>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [copiedUrl, setCopiedUrl] = useState<string | null>(null);

  // Collect ALL urlDetails from all results, then deduplicate by domain/IP ACROSS sources
  const { dedupedDetails, visibleCount, hiddenCount, externalCount, internalCount, totalRawUrls, ipCount } = useMemo(() => {
    const allDetails = results.flatMap((r, ri) =>
      r.urlDetails.map(d => ({ ...d, sourceUrl: r.url, sourceIndex: ri }))
    );

    // Cross-source domain/IP dedup: merge entries that share the same dedup key
    const domainMap = new Map<string, typeof allDetails[0] & { urlCount: number; sources: string[]; tags: string[]; isIP: boolean }>();

    for (const detail of allDetails) {
      const dedupKey = extractDedupKey(detail.url, detail.domain);
      const isIP = IP_REGEX.test(dedupKey);

      const existing = domainMap.get(dedupKey);
      if (existing) {
        // Merge: accumulate URL count, sources, tags
        existing.urlCount += 1;
        if (detail.tag && !existing.tags.includes(detail.tag)) existing.tags.push(detail.tag);
        if (detail.sourceUrl && !existing.sources.includes(detail.sourceUrl)) existing.sources.push(detail.sourceUrl);
        // If the new entry is visible, the domain is visible
        if (detail.isVisible) existing.isVisible = true;
      } else {
        domainMap.set(dedupKey, {
          ...detail,
          domain: dedupKey,
          urlCount: 1,
          sources: detail.sourceUrl ? [detail.sourceUrl] : [],
          tags: detail.tag ? [detail.tag] : [],
          isIP,
        });
      }
    }

    const deduped = [...domainMap.values()];

    return {
      dedupedDetails: deduped,
      visibleCount: deduped.filter(d => d.isVisible).length,
      hiddenCount: deduped.filter(d => !d.isVisible).length,
      externalCount: deduped.filter(d => d.isExternal).length,
      internalCount: deduped.filter(d => !d.isExternal).length,
      totalRawUrls: deduped.reduce((sum, d) => sum + d.urlCount, 0),
      ipCount: deduped.filter(d => d.isIP).length,
    };
  }, [results]);

  // Apply filters
  const filteredDetails = useMemo(() => {
    let filtered = dedupedDetails;

    if (domainFilter === 'external') {
      filtered = filtered.filter(d => d.isExternal);
    } else if (domainFilter === 'internal') {
      filtered = filtered.filter(d => !d.isExternal);
    } else if (domainFilter === 'hidden') {
      filtered = filtered.filter(d => !d.isVisible);
    }

    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      filtered = filtered.filter(d =>
        d.domain?.toLowerCase().includes(q) ||
        d.url.toLowerCase().includes(q) ||
        d.text?.toLowerCase().includes(q)
      );
    }

    return filtered;
  }, [dedupedDetails, domainFilter, searchQuery]);

  const handleCopyUrl = async (url: string) => {
    try {
      await navigator.clipboard.writeText(url);
      setCopiedUrl(url);
      setTimeout(() => setCopiedUrl(null), 2000);
    } catch {}
  };

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Compact inline header */}
      <div className="h-10 px-3 border-b flex items-center gap-2 shrink-0">
        <Globe className="h-3 w-3 text-muted-foreground" />
        <span className="text-xs font-medium">域名列表 ({dedupedDetails.length})</span>
        <div className="ml-auto flex gap-1">
          <Badge variant="secondary" className="text-[9px] gap-0.5">
            <Eye className="h-2 w-2" />
            {visibleCount}
          </Badge>
          <Badge variant="outline" className="text-[9px] gap-0.5 text-destructive">
            <EyeOff className="h-2 w-2" />
            {hiddenCount}
          </Badge>
          {ipCount > 0 && (
            <Badge variant="outline" className="text-[9px] gap-0.5">
              {ipCount} IP
            </Badge>
          )}
        </div>
      </div>
      <div className="px-3 py-0.5 text-[10px] text-muted-foreground shrink-0">
        {dedupedDetails.length} 域名/IP · {totalRawUrls} URL · {externalCount} 外 · {internalCount} 内
      </div>

      {/* Filter bar */}
      <div className="flex items-center gap-2 px-3 py-1 shrink-0">
        <Select value={domainFilter} onValueChange={(v) => setDomainFilter(v as DomainFilter)}>
          <SelectTrigger size="sm" className="w-[70px] text-[10px] px-2 [&>svg]:size-3">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">全部</SelectItem>
            <SelectItem value="external">外部</SelectItem>
            <SelectItem value="internal">内部</SelectItem>
            <SelectItem value="hidden">隐藏</SelectItem>
          </SelectContent>
        </Select>
        <div className="relative flex-1">
          <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3 w-3 text-muted-foreground" />
          <Input
            placeholder="搜索域名/IP..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="h-8 text-[11px] pl-7"
          />
        </div>
      </div>

      {/* Domain list with overflow scroll */}
      <div className="flex-1 min-h-0 overflow-y-auto custom-scrollbar px-2 pb-1">
        {filteredDetails.length === 0 ? (
          <div className="text-center text-muted-foreground py-4 text-xs">
            暂无域名数据
          </div>
        ) : (
          <div className="space-y-0.5">
            {filteredDetails.map((detail, i) => (
              <div
                key={i}
                className={`flex items-center gap-2 rounded px-2 py-1 hover:bg-accent/50 ${!detail.isVisible ? 'bg-destructive/5' : ''}`}
              >
                {/* Visibility icon */}
                <div className="shrink-0">
                  {detail.isVisible ? (
                    <Eye className="h-3 w-3 text-green-600" />
                  ) : (
                    <EyeOff className="h-3 w-3 text-destructive" />
                  )}
                </div>

                {/* Domain name / IP */}
                <div className="flex-1 min-w-0">
                  <div className="text-[11px] font-mono font-semibold truncate flex items-center gap-1" title={detail.url}>
                    <span>{detail.domain || detail.url}</span>
                    {'isIP' in detail && (detail as any).isIP && (
                      <Badge variant="outline" className="text-[8px] px-1 py-0">IP</Badge>
                    )}
                  </div>
                  {!detail.isVisible && detail.hideReason && (
                    <div className="text-[9px] text-destructive truncate">
                      {detail.hideReason}
                    </div>
                  )}
                </div>

                {/* URL count - only show when > 1 */}
                {detail.urlCount > 1 && (
                  <Badge variant="secondary" className="text-[9px] gap-0.5 px-1 py-0 shrink-0" title={`${detail.urlCount}个URL`}>
                    <Layers className="h-2 w-2" />
                    {detail.urlCount}
                  </Badge>
                )}

                {/* Threat intel query */}
                <Popover>
                  <PopoverTrigger asChild>
                    <Button variant="ghost" size="sm" className="h-5 w-5 p-0 shrink-0" onClick={(e) => e.stopPropagation()}>
                      <ShieldAlert className="h-2.5 w-2.5 text-muted-foreground" />
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-64 p-2 text-[10px]" side="left">
                    <ThreatIntelResult type={IP_REGEX.test(detail.domain || '') ? 'ip' : 'domain'} value={detail.domain || detail.url} />
                  </PopoverContent>
                </Popover>

                {/* Copy button */}
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-5 w-5 p-0 shrink-0"
                  onClick={() => handleCopyUrl(detail.url)}
                >
                  {copiedUrl === detail.url ? (
                    <Check className="h-2.5 w-2.5 text-green-600" />
                  ) : (
                    <Copy className="h-2.5 w-2.5" />
                  )}
                </Button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
