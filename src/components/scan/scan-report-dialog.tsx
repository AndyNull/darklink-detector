'use client';

import { useScanStore, ScanResultItem } from '@/lib/scan-store';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import {
  FileText,
  Globe,
  Clock,
  Link2,
  QrCode,
  ShieldAlert,
  ShieldCheck,
  ShieldX,
  AlertTriangle,
  Skull,
  Cpu,
} from 'lucide-react';

interface ScanReportDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  results: ScanResultItem[];
  taskHistoryItem?: {
    taskId: string;
    createdAt: number;
    status: string;
    urlCount: number;
    darkLinks: number;
    qrCodes: number;
  } | null;
}

const severityConfig: Record<string, { label: string; color: string; bgColor: string; barColor: string }> = {
  critical: { label: '严重', color: 'text-red-700 dark:text-red-400', bgColor: 'bg-red-500/10', barColor: 'bg-red-500' },
  high: { label: '高危', color: 'text-orange-700 dark:text-orange-400', bgColor: 'bg-orange-500/10', barColor: 'bg-orange-500' },
  medium: { label: '中危', color: 'text-yellow-700 dark:text-yellow-400', bgColor: 'bg-yellow-500/10', barColor: 'bg-yellow-500' },
  low: { label: '低危', color: 'text-emerald-700 dark:text-emerald-400', bgColor: 'bg-emerald-500/10', barColor: 'bg-emerald-500' },
};

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
  js_obfuscated: 'JS混淆',
  data_uri: 'Data URI',
  svg_hidden: 'SVG隐藏',
};

function formatDuration(ms: number | null): string {
  if (ms === null) return '--';
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  const min = Math.floor(ms / 60000);
  const sec = Math.round((ms % 60000) / 1000);
  return `${min}m${sec > 0 ? `${sec}s` : ''}`;
}

function formatTime(timestamp: number): string {
  const d = new Date(timestamp);
  return d.toLocaleString('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });
}

/** Horizontal bar for visual display */
function VisualBar({ value, max, color }: { value: number; max: number; color: string }) {
  const pct = max > 0 ? Math.max((value / max) * 100, value > 0 ? 4 : 0) : 0;
  return (
    <div className="h-3 w-full rounded-full bg-muted overflow-hidden">
      <div className={`h-full rounded-full transition-all duration-500 ${color}`} style={{ width: `${pct}%` }} />
    </div>
  );
}

export function ScanReportDialog({ open, onOpenChange, results, taskHistoryItem }: ScanReportDialogProps) {
  const { getStats, getScanDuration, maliciousMatches } = useScanStore();

  const stats = results.length > 0 ? getStats() : null;
  const scanDuration = results.length > 0 ? getScanDuration() : null;

  // Severity breakdown
  const allDarkLinks = results.flatMap(r => r.darkLinkDetails);
  const severityCounts: Record<string, number> = { critical: 0, high: 0, medium: 0, low: 0 };
  for (const link of allDarkLinks) {
    if (severityCounts[link.severity] !== undefined) {
      severityCounts[link.severity]++;
    }
  }
  const maxSeverityCount = Math.max(...Object.values(severityCounts), 1);

  // Type distribution
  const typeCounts: Record<string, number> = {};
  for (const link of allDarkLinks) {
    const label = typeLabels[link.type] || link.type;
    typeCounts[label] = (typeCounts[label] || 0) + 1;
  }
  const sortedTypes = Object.entries(typeCounts).sort((a, b) => b[1] - a[1]);
  const maxTypeCount = sortedTypes.length > 0 ? sortedTypes[0][1] : 1;

  // QR code stats
  const allQrCodes = results.flatMap(r => r.qrCodeDetails);
  const suspiciousQrCodes = allQrCodes.filter(qr => qr.isSuspicious).length;

  // Malicious match count
  const maliciousMatchCount = Object.keys(maliciousMatches).length;

  // Risk assessment
  const totalDarkLinks = stats?.darkLinks ?? 0;
  const criticalCount = severityCounts.critical;
  const highCount = severityCounts.high;
  let riskLevel: 'safe' | 'low' | 'medium' | 'high' | 'critical' = 'safe';
  let riskLabel = '安全';
  let riskColor = 'text-green-700 dark:text-green-400';
  let riskBg = 'bg-green-500/10 border-green-500/20';
  let riskIcon = <ShieldCheck className="h-5 w-5" />;
  let recommendations: string[] = [];

  if (criticalCount > 0) {
    riskLevel = 'critical';
    riskLabel = '极高风险';
    riskColor = 'text-red-700 dark:text-red-400';
    riskBg = 'bg-red-500/10 border-red-500/20';
    riskIcon = <ShieldX className="h-5 w-5" />;
    recommendations = [
      '立即处理所有严重级别暗链，下线或删除相关页面',
      '对受影响服务器进行全面安全审计',
      '检查服务器是否已被入侵，修改所有凭据',
      '向安全团队报告并启动应急响应流程',
    ];
  } else if (highCount > 0) {
    riskLevel = 'high';
    riskLabel = '高风险';
    riskColor = 'text-orange-700 dark:text-orange-400';
    riskBg = 'bg-orange-500/10 border-orange-500/20';
    riskIcon = <ShieldAlert className="h-5 w-5" />;
    recommendations = [
      '优先处理高危暗链，移除隐藏的外部链接',
      '检查页面模板和CMS是否存在漏洞',
      '审查近期文件变更记录',
      '加强输入验证和内容审核机制',
    ];
  } else if (totalDarkLinks > 0) {
    riskLevel = 'medium';
    riskLabel = '中等风险';
    riskColor = 'text-yellow-700 dark:text-yellow-400';
    riskBg = 'bg-yellow-500/10 border-yellow-500/20';
    riskIcon = <AlertTriangle className="h-5 w-5" />;
    recommendations = [
      '排查并清除所有发现的暗链',
      '检查第三方脚本和广告代码',
      '定期复查网站内容',
      '部署网站篡改监控',
    ];
  } else if (suspiciousQrCodes > 0 || maliciousMatchCount > 0) {
    riskLevel = 'low';
    riskLabel = '低风险';
    riskColor = 'text-emerald-700 dark:text-emerald-400';
    riskBg = 'bg-emerald-500/10 border-emerald-500/20';
    riskIcon = <AlertTriangle className="h-5 w-5" />;
    recommendations = [
      '关注可疑QR码和恶意库匹配结果',
      '定期复查和监控',
      '加强安全防护措施',
    ];
  } else {
    recommendations = [
      '未发现明显安全威胁',
      '建议定期执行安全扫描',
      '保持安全防护策略更新',
    ];
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl max-h-[85vh] flex flex-col p-0">
        <DialogHeader className="shrink-0 px-6 pt-6 pb-2">
          <DialogTitle className="text-base flex items-center gap-2">
            <FileText className="h-4 w-4" />
            扫描报告
          </DialogTitle>
          <DialogDescription className="text-xs text-muted-foreground">
            暗链扫描结果摘要报告
          </DialogDescription>
        </DialogHeader>

        <div className="flex-1 min-h-0 overflow-y-auto custom-scrollbar px-6 pb-6 space-y-5">
          {/* ── 基本信息 ── */}
          <section>
            <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">基本信息</h3>
            <div className="grid grid-cols-2 gap-x-6 gap-y-1.5 text-xs">
              <div className="flex items-center gap-1.5">
                <Clock className="h-3 w-3 text-muted-foreground shrink-0" />
                <span className="text-muted-foreground">扫描时间</span>
                <span className="ml-auto font-medium tabular-nums">
                  {taskHistoryItem ? formatTime(taskHistoryItem.createdAt) : '--'}
                </span>
              </div>
              <div className="flex items-center gap-1.5">
                <Clock className="h-3 w-3 text-muted-foreground shrink-0" />
                <span className="text-muted-foreground">扫描耗时</span>
                <span className="ml-auto font-medium tabular-nums">{formatDuration(scanDuration)}</span>
              </div>
              <div className="flex items-center gap-1.5">
                <Globe className="h-3 w-3 text-muted-foreground shrink-0" />
                <span className="text-muted-foreground">扫描URL数</span>
                <span className="ml-auto font-medium tabular-nums">{stats?.totalUrls ?? 0}</span>
              </div>
              <div className="flex items-center gap-1.5">
                <Cpu className="h-3 w-3 text-muted-foreground shrink-0" />
                <span className="text-muted-foreground">引擎版本</span>
                <span className="ml-auto font-medium">v1.0</span>
              </div>
            </div>
          </section>

          <Separator />

          {/* ── 风险概览 ── */}
          <section>
            <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">风险概览</h3>
            <div className="rounded-lg border p-3 space-y-2.5">
              <div className="flex items-center justify-between mb-1">
                <span className="text-xs font-medium">暗链总数</span>
                <span className="text-lg font-bold text-destructive tabular-nums">{totalDarkLinks}</span>
              </div>
              {(['critical', 'high', 'medium', 'low'] as const).map((sev) => {
                const cfg = severityConfig[sev];
                const count = severityCounts[sev];
                return (
                  <div key={sev} className="space-y-0.5">
                    <div className="flex items-center justify-between text-[11px]">
                      <span className={`font-medium ${cfg.color}`}>{cfg.label}</span>
                      <span className={`tabular-nums ${count > 0 ? 'font-semibold' : 'text-muted-foreground'}`}>{count}</span>
                    </div>
                    <VisualBar value={count} max={maxSeverityCount} color={cfg.barColor} />
                  </div>
                );
              })}
            </div>
          </section>

          <Separator />

          {/* ── 暗链类型分布 ── */}
          <section>
            <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">暗链类型分布</h3>
            {sortedTypes.length === 0 ? (
              <div className="text-xs text-muted-foreground py-2 text-center">未发现暗链</div>
            ) : (
              <div className="rounded-lg border p-3 space-y-2">
                {sortedTypes.map(([type, count]) => (
                  <div key={type} className="space-y-0.5">
                    <div className="flex items-center justify-between text-[11px]">
                      <span className="font-medium">{type}</span>
                      <span className="tabular-nums text-muted-foreground">{count}</span>
                    </div>
                    <VisualBar value={count} max={maxTypeCount} color="bg-primary/60" />
                  </div>
                ))}
              </div>
            )}
          </section>

          <Separator />

          {/* ── 恶意库匹配 ── */}
          <section>
            <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">恶意库匹配</h3>
            <div className="rounded-lg border p-3">
              <div className="flex items-center gap-2">
                <Skull className={`h-4 w-4 ${maliciousMatchCount > 0 ? 'text-red-500' : 'text-muted-foreground/30'}`} />
                <span className="text-xs">匹配恶意库的域名/URL数量</span>
                <span className={`ml-auto text-lg font-bold tabular-nums ${maliciousMatchCount > 0 ? 'text-red-600 dark:text-red-400' : 'text-muted-foreground'}`}>
                  {maliciousMatchCount}
                </span>
              </div>
              {maliciousMatchCount > 0 && (
                <div className="mt-2 flex flex-wrap gap-1">
                  {Object.entries(maliciousMatches).slice(0, 10).map(([domain, info]) => (
                    <Badge key={domain} variant="destructive" className="text-[9px] px-1.5 py-0">
                      {domain}
                      {info.item?.reason && `: ${info.item.reason}`}
                    </Badge>
                  ))}
                  {maliciousMatchCount > 10 && (
                    <Badge variant="secondary" className="text-[9px] px-1.5 py-0">
                      +{maliciousMatchCount - 10} 更多
                    </Badge>
                  )}
                </div>
              )}
            </div>
          </section>

          <Separator />

          {/* ── QR码检测 ── */}
          <section>
            <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">QR码检测</h3>
            <div className="rounded-lg border p-3">
              <div className="grid grid-cols-2 gap-3">
                <div className="flex items-center gap-2">
                  <QrCode className="h-4 w-4 text-muted-foreground" />
                  <div>
                    <div className="text-[10px] text-muted-foreground">QR码总数</div>
                    <div className="text-sm font-semibold tabular-nums">{allQrCodes.length}</div>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <AlertTriangle className={`h-4 w-4 ${suspiciousQrCodes > 0 ? 'text-orange-500' : 'text-muted-foreground/30'}`} />
                  <div>
                    <div className="text-[10px] text-muted-foreground">可疑QR码</div>
                    <div className={`text-sm font-semibold tabular-nums ${suspiciousQrCodes > 0 ? 'text-orange-600 dark:text-orange-400' : ''}`}>
                      {suspiciousQrCodes}
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </section>

          <Separator />

          {/* ── 建议措施 ── */}
          <section>
            <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">建议措施</h3>
            <div className={`rounded-lg border p-3 ${riskBg}`}>
              <div className="flex items-center gap-2 mb-2">
                <span className={riskColor}>{riskIcon}</span>
                <span className={`text-sm font-bold ${riskColor}`}>风险等级: {riskLabel}</span>
              </div>
              <ul className="space-y-1">
                {recommendations.map((rec, i) => (
                  <li key={i} className="flex items-start gap-1.5 text-[11px]">
                    <span className="text-muted-foreground shrink-0 mt-0.5">•</span>
                    <span>{rec}</span>
                  </li>
                ))}
              </ul>
            </div>
          </section>

          {/* Footer with timestamp */}
          <div className="text-[10px] text-muted-foreground text-center pt-1">
            报告生成时间: {new Date().toLocaleString('zh-CN', { hour12: false })}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
