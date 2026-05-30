'use client';

import React, { useState } from 'react';
import { useScanStore, type DarkLinkResult } from '@/lib/scan-store';
import { isSafeDomain } from '@/lib/safe-domain-whitelist';
import { Badge } from '@/components/ui/badge';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import {
  ShieldAlert,
  ShieldCheck,
  AlertCircle,
  Check,
  Copy,
  ExternalLink,
  Globe,
  Tag,
  FileCode,
  MapPin,
  ChevronDown,
  ChevronRight,
  FileSearch,
  Code,
} from 'lucide-react';
import { IP_REGEX } from './types';
import { ThreatIntelResult } from './threat-intel-result';

// ──── Dark Link Card with expand/collapse details + visit button ────
export const DarkLinkCard = React.memo(function DarkLinkCard({ link, onCopy, copiedUrl, inMaliciousDB, inSuspiciousDB, threatIntelConfirmed }: {
  link: DarkLinkResult;
  onCopy: (url: string, e?: React.MouseEvent) => void;
  copiedUrl: string | null;
  inMaliciousDB?: boolean;
  inSuspiciousDB?: boolean;
  threatIntelConfirmed?: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  const [visitWarning, setVisitWarning] = useState(false);

  // Extract hostname for checks
  let displayDomain = link.url;
  let isSafe = false;
  try {
    const urlObj = new URL(link.url);
    displayDomain = urlObj.hostname;
    isSafe = isSafeDomain(displayDomain);
  } catch {}

  const severityColors: Record<string, string> = {
    critical: 'bg-red-500/10 text-red-600 border-red-500/20',
    high: 'bg-orange-500/10 text-orange-600 border-orange-500/20',
    medium: 'bg-yellow-500/10 text-yellow-600 border-yellow-500/20',
    safe: 'bg-green-500/10 text-green-600 border-green-500/20',
  };

  const severityBorderHover: Record<string, string> = {
    critical: 'hover:border-red-500/40',
    high: 'hover:border-orange-500/40',
    medium: 'hover:border-yellow-500/40',
    safe: 'hover:border-green-500/40',
  };

  const severityLabels: Record<string, string> = {
    critical: '严重',
    high: '高危',
    medium: '可疑',
    safe: '安全',
  };

  // Compute effective severity - consider safe whitelist
  const effectiveSeverity = isSafe
    ? 'safe'
    : inMaliciousDB
      ? 'critical'
      : threatIntelConfirmed
        ? 'high'
        : inSuspiciousDB
          ? 'medium'
          : link.severity === 'critical' || link.severity === 'high'
            ? 'high'
            : 'medium';

  const typeLabels: Record<string, string> = {
    css_hidden: 'CSS隐藏',
    size_hidden: '尺寸隐藏',
    color_hidden: '颜色隐藏',
    position_hidden: '位置隐藏',
    overflow_hidden: '溢出隐藏',
    iframe_hidden: '隐藏iframe',
    suspicious_domain: '可疑域名',
    js_injected: 'JS注入',
    malicious_keyword: '恶意关键词',
    suspicious_shortener: '可疑短链',
    cheap_tld: '廉价TLD',
    hidden_text: '隐藏文本',
    keyword_stuffing: '关键词堆砌',
    hidden_div_link: '隐藏DIV链接',
    base_redirect: 'Base重定向',
    meta_refresh: 'Meta刷新',
    form_hijack: '表单劫持',
    js_obfuscated: 'JS混淆',
    data_uri: 'Data URI',
    svg_hidden: 'SVG隐藏',
    nofollow_suspicious: 'Nofollow外链',
  };

  // Determine shield icon style based on threat status
  const shieldColor = inMaliciousDB
    ? 'text-red-600'
    : threatIntelConfirmed
      ? 'text-red-500'
      : inSuspiciousDB
        ? 'text-yellow-600'
        : isSafe
          ? 'text-green-600'
          : 'text-muted-foreground';

  const ShieldIcon = isSafe ? ShieldCheck : ShieldAlert;

  // Toggle expand - ONLY called from header area
  const handleToggle = () => {
    setExpanded(!expanded);
  };

  return (
    <div
      className={`rounded-md border p-1.5 transition-all duration-150 ease-out ${
        severityColors[effectiveSeverity] || ''
      } ${severityBorderHover[effectiveSeverity] || ''}`}
    >
      {/* ── Header: clickable area for expand/collapse ── */}
      <div
        className="flex items-center gap-1 cursor-pointer select-none"
        onClick={handleToggle}
      >
        {/* Expand indicator */}
        {expanded ? (
          <ChevronDown className="h-2.5 w-2.5 text-muted-foreground shrink-0" />
        ) : (
          <ChevronRight className="h-2.5 w-2.5 text-muted-foreground shrink-0" />
        )}

        {/* Badges */}
        <Badge variant="outline" className="text-[8px] px-1 py-0">
          {severityLabels[effectiveSeverity] || effectiveSeverity}
        </Badge>
        <Badge variant="outline" className="text-[8px] px-1 py-0">
          {typeLabels[link.type] || link.type}
        </Badge>
        {inMaliciousDB && (
          <Badge variant="destructive" className="text-[8px] px-1 py-0">
            命中恶意库
          </Badge>
        )}
        {inSuspiciousDB && !inMaliciousDB && (
          <Badge variant="outline" className="text-[8px] px-1 py-0 border-yellow-500/50 text-yellow-600">
            可疑库命中
          </Badge>
        )}
        {threatIntelConfirmed && !inMaliciousDB && !inSuspiciousDB && (
          <Badge variant="outline" className="text-[8px] px-1 py-0 border-orange-500/50 text-orange-600">
            情报确认
          </Badge>
        )}
        {isSafe && !inMaliciousDB && !threatIntelConfirmed && (
          <Badge variant="outline" className="text-[8px] px-1 py-0 border-green-500/50 text-green-600">
            白名单
          </Badge>
        )}

        {/* Action buttons - stop propagation to prevent toggle */}
        <div className="flex items-center gap-0.5 ml-auto shrink-0" onClick={(e) => e.stopPropagation()}>
          {/* Threat intel popover */}
          <Popover>
            <PopoverTrigger asChild>
              <Button variant="ghost" size="sm" className="h-3.5 w-3.5 p-0 shrink-0" onClick={(e) => e.stopPropagation()}>
                <ShieldIcon className={`h-2.5 w-2.5 ${shieldColor}`} />
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-64 p-2 text-[10px]" side="left">
              <ThreatIntelResult type={IP_REGEX.test(displayDomain) ? 'ip' : 'domain'} value={displayDomain} />
            </PopoverContent>
          </Popover>

          {/* Visit button */}
          <Button
            variant="ghost"
            size="sm"
            className="h-3.5 w-3.5 p-0 shrink-0 text-muted-foreground hover:text-foreground"
            onClick={(e) => { e.stopPropagation(); setVisitWarning(true); }}
            title="访问链接"
          >
            <ExternalLink className="h-2 w-2" />
          </Button>

          {/* Copy button */}
          <Button
            variant="ghost"
            size="sm"
            className="h-3.5 w-3.5 p-0 shrink-0"
            onClick={(e) => { e.stopPropagation(); onCopy(link.url, e); }}
          >
            {copiedUrl === link.url ? (
              <Check className="h-2 w-2 text-green-600" />
            ) : (
              <Copy className="h-2 w-2" />
            )}
          </Button>
        </div>
      </div>

      {/* Domain row - also clickable to toggle */}
      <div
        className="flex items-center gap-1 mt-0.5 cursor-pointer"
        onClick={handleToggle}
      >
        <Globe className="h-2.5 w-2.5 text-muted-foreground shrink-0" />
        <span className="text-[10px] font-semibold">{displayDomain}</span>
        {link.description && !expanded && (
          <span className="text-[9px] text-muted-foreground truncate flex-1 min-w-0 ml-1">{link.description}</span>
        )}
      </div>

      {/* ── Expanded details - clicks do NOT trigger collapse ── */}
      {expanded && (
        <div
          className="mt-1.5 rounded border border-border/60 bg-background/80 p-2 space-y-1.5"
          onClick={(e) => e.stopPropagation()}
        >
          {/* Full URL */}
          <div className="flex items-start gap-1.5">
            <Globe className="h-3 w-3 text-blue-500 shrink-0 mt-0.5" />
            <div className="min-w-0 flex-1">
              <div className="text-[9px] font-medium text-muted-foreground mb-0.5">完整链接</div>
              <div className="text-[10px] font-mono break-all leading-relaxed text-foreground/90 bg-muted/40 rounded px-1.5 py-0.5">{link.url}</div>
            </div>
          </div>

          {/* Tag / HTML element */}
          {link.tag && (
            <div className="flex items-start gap-1.5">
              <Tag className="h-3 w-3 text-purple-500 shrink-0 mt-0.5" />
              <div className="min-w-0 flex-1">
                <div className="text-[9px] font-medium text-muted-foreground mb-0.5">HTML标签</div>
                <code className="text-[10px] font-mono bg-purple-500/10 text-purple-700 dark:text-purple-400 rounded px-1.5 py-0.5">&lt;{link.tag}&gt;</code>
              </div>
            </div>
          )}

          {/* Anchor text */}
          {link.text && (
            <div className="flex items-start gap-1.5">
              <FileCode className="h-3 w-3 text-amber-500 shrink-0 mt-0.5" />
              <div className="min-w-0 flex-1">
                <div className="text-[9px] font-medium text-muted-foreground mb-0.5">链接文本</div>
                <div className="text-[10px] break-all bg-amber-500/10 text-amber-700 dark:text-amber-400 rounded px-1.5 py-0.5">{link.text}</div>
              </div>
            </div>
          )}

          {/* Description / Location */}
          {link.description && (
            <div className="flex items-start gap-1.5">
              <MapPin className="h-3 w-3 text-emerald-500 shrink-0 mt-0.5" />
              <div className="min-w-0 flex-1">
                <div className="text-[9px] font-medium text-muted-foreground mb-0.5">发现位置</div>
                <div className="text-[10px] break-all text-foreground/80 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 rounded px-1.5 py-0.5">{link.description}</div>
              </div>
            </div>
          )}

          {/* Evidence */}
          {link.evidence && (
            <div className="mt-1 pt-1 border-t border-border/40">
              <div className="flex items-center gap-1 mb-0.5">
                <FileSearch className="h-3 w-3 text-rose-500" />
                <div className="text-[9px] font-medium text-muted-foreground">关键证据</div>
              </div>
              <div className="text-[10px] font-mono break-all leading-relaxed max-h-28 overflow-y-auto custom-scrollbar bg-rose-500/10 text-rose-700 dark:text-rose-400 rounded px-1.5 py-0.5">{link.evidence}</div>
            </div>
          )}
        </div>
      )}

      {/* Visit warning dialog */}
      <Dialog open={visitWarning} onOpenChange={setVisitWarning}>
        <DialogContent className="sm:max-w-[360px] p-4 gap-3">
          <DialogHeader>
            <DialogTitle className="text-sm flex items-center gap-1.5">
              <AlertCircle className="h-4 w-4 text-yellow-600" />
              安全警告
            </DialogTitle>
          </DialogHeader>
          <p className="text-xs text-muted-foreground">
            即将访问的链接可能包含恶意内容，是否继续？<br />
            <span className="font-mono text-[10px] break-all">{link.url}</span>
          </p>
          <div className="flex justify-end gap-2">
            <Button variant="outline" size="sm" className="text-xs" onClick={() => setVisitWarning(false)}>
              取消
            </Button>
            <Button
              size="sm"
              className="text-xs"
              variant="destructive"
              onClick={() => {
                window.open(link.url, '_blank', 'noopener,noreferrer');
                setVisitWarning(false);
              }}
            >
              <ExternalLink className="h-3 w-3 mr-1" />
              继续访问
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
});
