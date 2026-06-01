'use client';

import { useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Code2,
  Clock,
  Globe,
  ShieldAlert,
  Copy,
  Check,
  FileText,
  Zap,
  Loader2,
} from 'lucide-react';

interface DarkLinkHighlight {
  url: string;
  type: string;
  severity: string;
  description?: string;
}

interface HtmlPreviewDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  url: string;
  statusCode?: number;
  responseTime?: number;
  rawHtml?: string;
  darkLinkDetails?: DarkLinkHighlight[];
  title?: string;
  /** Whether rawHtml is being lazy-loaded from the API */
  htmlLoading?: boolean;
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#x27;')
    .replace(/\//g, '&#x2F;');
}

// Instead of dangerouslySetInnerHTML, render highlighted segments as React elements
// to prevent XSS via attribute injection in title/class attributes
function HighlightedHtml({ html, darkLinkDetails }: { html: string; darkLinkDetails: DarkLinkHighlight[] }) {
  if (darkLinkDetails.length === 0) {
    return <>{escapeHtml(html)}</>;
  }

  const escaped = escapeHtml(html);

  // Build matches from dark links: find href attribute values that contain dark link URLs/domains
  const matches: Array<{ start: number; end: number; colorClass: string; title: string }> = [];

  for (const dl of darkLinkDetails) {
    const escapedUrl = escapeHtml(dl.url);
    const hrefRegex = new RegExp(`(href=["'])([^"']*${escapedUrl.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}[^"']*)(["'])`, 'gi');
    let m: RegExpExecArray | null;
    while ((m = hrefRegex.exec(escaped)) !== null) {
      matches.push({
        start: m.index + m[1].length,
        end: m.index + m[1].length + m[2].length,
        colorClass: 'bg-red-500/20 text-red-600 dark:text-red-400 rounded px-0.5 border-b border-red-500/40',
        title: `暗链: ${dl.url}`,
      });
    }

    try {
      const domain = new URL(dl.url).hostname;
      const escapedDomain = escapeHtml(domain);
      const domainRegex = new RegExp(`(href=["'])([^"']*${escapedDomain.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}[^"']*)(["'])`, 'gi');
      while ((m = domainRegex.exec(escaped)) !== null) {
        // Check not already covered by URL match
        const s = m.index + m[1].length;
        const e = s + m[2].length;
        const overlaps = matches.some(existing => s >= existing.start && s < existing.end);
        if (!overlaps) {
          matches.push({
            start: s,
            end: e,
            colorClass: 'bg-orange-500/20 text-orange-600 dark:text-orange-400 rounded px-0.5 border-b border-orange-500/40',
            title: `可疑域名: ${escapedDomain}`,
          });
        }
      }
    } catch(e) { console.warn('Error:', e); }
  }

  // Sort matches by start position
  matches.sort((a, b) => a.start - b.start);

  // Build segments from matches
  const segments: Array<{ text: string; highlight: boolean; title?: string; colorClass?: string }> = [];
  let lastEnd = 0;
  for (const match of matches) {
    if (match.start > lastEnd) {
      segments.push({ text: escaped.slice(lastEnd, match.start), highlight: false });
    }
    if (match.start >= lastEnd) {
      segments.push({
        text: escaped.slice(match.start, match.end),
        highlight: true,
        title: match.title,
        colorClass: match.colorClass,
      });
    }
    lastEnd = Math.max(lastEnd, match.end);
  }
  if (lastEnd < escaped.length) {
    segments.push({ text: escaped.slice(lastEnd), highlight: false });
  }

  return (
    <>
      {segments.map((seg, i) =>
        seg.highlight ? (
          <span key={i} className={seg.colorClass} title={seg.title}>
            {seg.text}
          </span>
        ) : (
          <span key={i}>{seg.text}</span>
        )
      )}
    </>
  );
}

function getSeverityColor(severity: string): string {
  switch (severity) {
    case 'critical': return 'text-red-600';
    case 'high': return 'text-orange-600';
    case 'medium': return 'text-yellow-600';
    case 'low': return 'text-emerald-600';
    default: return 'text-muted-foreground';
  }
}

export function HtmlPreviewDialog({
  open,
  onOpenChange,
  url,
  statusCode,
  responseTime,
  rawHtml,
  darkLinkDetails = [],
  title,
  htmlLoading = false,
}: HtmlPreviewDialogProps) {
  const [copiedHtml, setCopiedHtml] = useState(false);

  const handleCopyHtml = async () => {
    if (!rawHtml) return;
    try {
      await navigator.clipboard.writeText(rawHtml);
      setCopiedHtml(true);
      setTimeout(() => setCopiedHtml(false), 2000);
    } catch(e) { console.warn('Error:', e); }
  };

  const htmlSize = rawHtml ? new Blob([rawHtml]).size : 0;
  const formatSize = (bytes: number) => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl max-h-[85vh] flex flex-col p-0 gap-0">
        <DialogHeader className="px-4 pt-4 pb-2 shrink-0">
          <DialogTitle className="text-sm flex items-center gap-2">
            <Code2 className="h-4 w-4" />
            页面源码预览
          </DialogTitle>
          <DialogDescription className="text-xs">
            查看扫描页面的原始HTML及暗链标注
          </DialogDescription>
        </DialogHeader>

        {/* Info bar */}
        <div className="px-4 pb-2 flex items-center gap-3 flex-wrap text-[11px] text-muted-foreground shrink-0 border-b pb-3">
          <span className="flex items-center gap-1">
            <Globe className="h-3 w-3" />
            <span className="font-mono truncate max-w-[300px]" title={url}>{url}</span>
          </span>
          {statusCode && (
            <Badge
              variant={statusCode >= 400 ? 'destructive' : 'secondary'}
              className="text-[10px] font-mono px-1.5 py-0"
            >
              {statusCode}
            </Badge>
          )}
          {responseTime !== undefined && (
            <span className="flex items-center gap-1">
              <Clock className="h-3 w-3" />
              {responseTime}ms
            </span>
          )}
          {htmlSize > 0 && (
            <span className="flex items-center gap-1">
              <FileText className="h-3 w-3" />
              {formatSize(htmlSize)}
            </span>
          )}
          {darkLinkDetails.length > 0 && (
            <span className="flex items-center gap-1 text-destructive">
              <Zap className="h-3 w-3" />
              {darkLinkDetails.length} 暗链
            </span>
          )}
        </div>

        {/* Dark link summary */}
        {darkLinkDetails.length > 0 && (
          <div className="px-4 py-2 shrink-0 border-b bg-destructive/5 space-y-1">
            <div className="text-[10px] font-medium text-destructive flex items-center gap-1">
              <ShieldAlert className="h-3 w-3" />
              发现暗链
            </div>
            <div className="flex flex-wrap gap-1">
              {darkLinkDetails.map((dl, i) => (
                <Badge
                  key={i}
                  variant="outline"
                  className={`text-[9px] px-1 py-0 ${getSeverityColor(dl.severity)}`}
                  title={dl.description}
                >
                  {dl.type}: {(() => { try { return new URL(dl.url).hostname; } catch { return dl.url; } })()}
                </Badge>
              ))}
            </div>
          </div>
        )}

        {/* Tabs: raw vs highlighted */}
        <Tabs defaultValue="highlighted" className="flex-1 min-h-0 flex flex-col">
          <div className="px-4 pt-2 flex items-center justify-between shrink-0">
            <TabsList className="h-7">
              <TabsTrigger value="highlighted" className="text-[11px] h-6 px-2">
                暗链标注
              </TabsTrigger>
              <TabsTrigger value="raw" className="text-[11px] h-6 px-2">
                原始HTML
              </TabsTrigger>
            </TabsList>
            <Button
              variant="ghost"
              size="sm"
              className="h-6 text-[10px] gap-1"
              onClick={handleCopyHtml}
            >
              {copiedHtml ? (
                <Check className="h-3 w-3 text-green-600" />
              ) : (
                <Copy className="h-3 w-3" />
              )}
              复制
            </Button>
          </div>

          <TabsContent value="highlighted" className="flex-1 min-h-0 mt-0 px-2 pb-2">
            <ScrollArea className="h-full max-h-[50vh]">
              {htmlLoading && !rawHtml ? (
                <div className="flex items-center justify-center py-12">
                  <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                  <span className="ml-2 text-muted-foreground text-xs">加载HTML内容...</span>
                </div>
              ) : rawHtml ? (
                <pre className="text-[10px] leading-relaxed font-mono p-3 bg-muted/30 rounded-md whitespace-pre-wrap break-all">
                  <code><HighlightedHtml html={rawHtml} darkLinkDetails={darkLinkDetails} /></code>
                </pre>
              ) : (
                <div className="text-center py-8 text-muted-foreground text-xs">
                  无HTML内容（可能为非HTML页面或扫描失败）
                </div>
              )}
            </ScrollArea>
          </TabsContent>

          <TabsContent value="raw" className="flex-1 min-h-0 mt-0 px-2 pb-2">
            <ScrollArea className="h-full max-h-[50vh]">
              {htmlLoading && !rawHtml ? (
                <div className="flex items-center justify-center py-12">
                  <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                  <span className="ml-2 text-muted-foreground text-xs">加载HTML内容...</span>
                </div>
              ) : rawHtml ? (
                <pre className="text-[10px] leading-relaxed font-mono p-3 bg-muted/30 rounded-md whitespace-pre-wrap break-all">
                  {rawHtml}
                </pre>
              ) : (
                <div className="text-center py-8 text-muted-foreground text-xs">
                  无HTML内容（可能为非HTML页面或扫描失败）
                </div>
              )}
            </ScrollArea>
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}
