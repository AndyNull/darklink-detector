'use client';

import React, { useState, useEffect, useCallback, useRef } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import { Calendar } from '@/components/ui/calendar';
import {
  FileText,
  Search,
  RefreshCw,
  ChevronLeft,
  ChevronRight,
  Loader2,
  Shield,
  Globe,
  Wrench,
  Database,
  Clock,
  User,
  MapPin,
  AlertTriangle,
  CalendarIcon,
  Link2,
  ChevronDown,
  ChevronUp,
} from 'lucide-react';
import { useAuth, getAuthHeaders } from '@/lib/auth-context';
import { format } from 'date-fns';
import { zhCN } from 'date-fns/locale';

// ─── Types ──────────────────────────────────────────────────────────────────

interface LogEntry {
  timestamp: string;
  action: string;
  actor: string;
  details: string;
  ip?: string;
  category: string;
  metadata?: Record<string, unknown>;
  entityType?: string;
  entityId?: string;
}

interface LogCategoryInfo {
  category: string;
  total: number;
}

// ─── Category metadata ──────────────────────────────────────────────────────

const CATEGORY_META: Record<string, { label: string; icon: React.ElementType; color: string; bg: string }> = {
  auth: { label: '认证', icon: Shield, color: 'text-blue-600', bg: 'bg-blue-500/10' },
  task: { label: '任务', icon: Globe, color: 'text-green-600', bg: 'bg-green-500/10' },
  system: { label: '系统', icon: Wrench, color: 'text-orange-600', bg: 'bg-orange-500/10' },
  data: { label: '数据', icon: Database, color: 'text-purple-600', bg: 'bg-purple-500/10' },
};

// Entity type display names
const ENTITY_TYPE_LABELS: Record<string, string> = {
  scan_task: '扫描任务',
  malicious_domain: '恶意域名',
  malicious_ip: '恶意IP',
  threat_intel_source: '情报源',
  database_config: '数据库配置',
  database: '数据库',
  user: '用户',
};

// ─── Component ──────────────────────────────────────────────────────────────

export function LogsSection() {
  const { isAuthenticated } = useAuth();
  const [entries, setEntries] = useState<LogEntry[]>([]);
  const [categories, setCategories] = useState<LogCategoryInfo[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Track which entries have expanded metadata
  const [expandedEntries, setExpandedEntries] = useState<Set<string>>(new Set());

  // Filters
  const [selectedCategory, setSelectedCategory] = useState<string>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [startDate, setStartDate] = useState<Date | undefined>(undefined);
  const [endDate, setEndDate] = useState<Date | undefined>(undefined);
  const [startCalendarOpen, setStartCalendarOpen] = useState(false);
  const [endCalendarOpen, setEndCalendarOpen] = useState(false);

  // Pagination
  const [offset, setOffset] = useState(0);
  const limit = 100;

  // Auto-refresh
  const [autoRefresh, setAutoRefresh] = useState(false);
  const refreshTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const fetchLogs = useCallback(async () => {
    if (!isAuthenticated) return;
    setLoading(true);
    setError(null);

    try {
      const params = new URLSearchParams();
      if (selectedCategory !== 'all') params.set('category', selectedCategory);
      if (searchQuery) params.set('search', searchQuery);
      if (startDate) params.set('startDate', startDate.toISOString());
      if (endDate) {
        // Include the entire end day
        const endOfDay = new Date(endDate);
        endOfDay.setHours(23, 59, 59, 999);
        params.set('endDate', endOfDay.toISOString());
      }
      params.set('limit', String(limit));
      params.set('offset', String(offset));

      const res = await fetch(`/api/logs?${params.toString()}`, {
        method: 'GET',
        headers: getAuthHeaders(),
      });

      if (res.ok) {
        const data = await res.json();
        setEntries(data.entries || []);
        setTotal(data.total || 0);
        setCategories(data.categories || []);
      } else {
        setError('加载日志失败，请检查服务状态');
      }
    } catch {
      setError('无法连接服务器');
    } finally {
      setLoading(false);
    }
  }, [isAuthenticated, selectedCategory, searchQuery, startDate, endDate, offset]);

  // Fetch on mount and when filters change
  useEffect(() => {
    fetchLogs();
  }, [fetchLogs]);

  // Auto-refresh
  useEffect(() => {
    if (autoRefresh) {
      refreshTimerRef.current = setInterval(fetchLogs, 10000);
    }
    return () => {
      if (refreshTimerRef.current) clearInterval(refreshTimerRef.current);
    };
  }, [autoRefresh, fetchLogs]);

  const handleSearch = () => {
    setOffset(0);
    fetchLogs();
  };

  const toggleExpanded = (key: string) => {
    setExpandedEntries(prev => {
      const next = new Set(prev);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }
      return next;
    });
  };

  const totalPages = Math.ceil(total / limit);
  const currentPage = Math.floor(offset / limit) + 1;

  const formatTime = (isoStr: string) => {
    try {
      const d = new Date(isoStr);
      return d.toLocaleString('zh-CN', {
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
      });
    } catch {
      return isoStr;
    }
  };

  const getCategoryBadge = (cat: string) => {
    const meta = CATEGORY_META[cat];
    if (!meta) return <Badge variant="outline" className="text-[10px] h-4 px-1">{cat}</Badge>;
    const Icon = meta.icon;
    return (
      <Badge variant="outline" className={`${meta.color} ${meta.bg} text-[10px] gap-0.5 border-0 h-4 px-1.5`}>
        <Icon className="h-2.5 w-2.5" />
        {meta.label}
      </Badge>
    );
  };

  const getEntityTypeBadge = (entityType?: string, entityId?: string) => {
    if (!entityType) return null;
    const label = ENTITY_TYPE_LABELS[entityType] || entityType;
    return (
      <Badge
        variant="outline"
        className="text-[9px] h-4 px-1 gap-0.5 border-0 bg-cyan-500/10 text-cyan-600 cursor-default"
        title={entityId ? `${label}: ${entityId}` : label}
      >
        <Link2 className="h-2 w-2" />
        {label}
        {entityId && <span className="text-cyan-400 max-w-[60px] truncate">{entityId.slice(0, 8)}</span>}
      </Badge>
    );
  };

  if (!isAuthenticated) {
    return (
      <div className="flex items-center justify-center py-8 text-muted-foreground">
        <Shield className="h-4 w-4 mr-2" />
        <span className="text-xs">请登录后查看审计日志</span>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full min-h-0">
      {/* Header - category tabs as primary navigation */}
      <div className="flex items-center justify-between shrink-0 pb-1.5">
        <div className="flex items-center gap-1">
          {Object.entries(CATEGORY_META).map(([key, meta]) => {
            const Icon = meta.icon;
            return (
              <button
                key={key}
                onClick={() => { setSelectedCategory(selectedCategory === key ? 'all' : key); setOffset(0); }}
                className={`flex items-center gap-1 px-2 py-1 h-7 rounded text-xs transition-colors cursor-pointer ${
                  selectedCategory === key
                    ? `${meta.bg} ${meta.color} font-medium`
                    : 'text-muted-foreground hover:bg-muted/50'
                }`}
              >
                <Icon className="h-3 w-3" />
                {meta.label}
              </button>
            );
          })}
          {total > 0 && (
            <span className="text-[9px] text-muted-foreground/50 ml-1">
              共 {total} 条
            </span>
          )}
        </div>
        <div className="flex items-center gap-1">
          <Button
            variant={autoRefresh ? 'default' : 'outline'}
            size="sm"
            className="h-7 text-[10px] cursor-pointer px-1.5"
            onClick={() => setAutoRefresh(!autoRefresh)}
          >
            {autoRefresh && <Loader2 className="h-2.5 w-2.5 animate-spin mr-0.5" />}
            自动刷新
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="h-7 text-[10px] cursor-pointer px-1.5"
            onClick={fetchLogs}
            disabled={loading}
          >
            <RefreshCw className={`h-2.5 w-2.5 mr-0.5 ${loading ? 'animate-spin' : ''}`} />
            刷新
          </Button>
        </div>
      </div>

      {/* Filters - compact row */}
      <div className="flex flex-wrap items-center gap-1.5 shrink-0 pb-1.5">
        <div className="relative flex-1 min-w-[80px] max-w-[160px] flex gap-1">
          <div className="relative flex-1">
            <Search className="absolute left-1.5 top-1/2 -translate-y-1/2 h-2.5 w-2.5 text-muted-foreground" />
            <Input
              placeholder="搜索..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
              className="w-full h-7 text-[10px] pl-5 pr-1.5"
            />
          </div>
          <Button
            variant="outline"
            size="sm"
            className="h-7 text-[10px] px-2 shrink-0 cursor-pointer"
            onClick={handleSearch}
          >
            搜索
          </Button>
        </div>

        {/* Date range with Calendar popovers */}
        <Popover open={startCalendarOpen} onOpenChange={setStartCalendarOpen}>
          <PopoverTrigger asChild>
            <Button
              variant="outline"
              size="sm"
              className="h-7 text-[10px] gap-1 px-1.5 shrink-0 font-normal"
            >
              <CalendarIcon className="h-2.5 w-2.5" />
              {startDate ? format(startDate, 'MM/dd', { locale: zhCN }) : '开始'}
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-auto p-0" align="start">
            <Calendar
              mode="single"
              selected={startDate}
              onSelect={(d) => { setStartDate(d); setStartCalendarOpen(false); setOffset(0); }}
              initialFocus
            />
          </PopoverContent>
        </Popover>

        <span className="text-[9px] text-muted-foreground">~</span>

        <Popover open={endCalendarOpen} onOpenChange={setEndCalendarOpen}>
          <PopoverTrigger asChild>
            <Button
              variant="outline"
              size="sm"
              className="h-7 text-[10px] gap-1 px-1.5 shrink-0 font-normal"
            >
              <CalendarIcon className="h-2.5 w-2.5" />
              {endDate ? format(endDate, 'MM/dd', { locale: zhCN }) : '结束'}
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-auto p-0" align="start">
            <Calendar
              mode="single"
              selected={endDate}
              onSelect={(d) => { setEndDate(d); setEndCalendarOpen(false); setOffset(0); }}
              initialFocus
            />
          </PopoverContent>
        </Popover>

        {(startDate || endDate) && (
          <Button
            variant="ghost"
            size="sm"
            className="h-7 text-[10px] px-1 shrink-0 text-muted-foreground hover:text-foreground"
            onClick={() => { setStartDate(undefined); setEndDate(undefined); setOffset(0); }}
          >
            清除
          </Button>
        )}
      </div>

      {/* Error - compact inline */}
      {error && (
        <div className="flex items-center gap-1.5 text-[10px] text-destructive bg-destructive/10 rounded px-2 py-1 shrink-0 mb-1">
          <AlertTriangle className="h-2.5 w-2.5 shrink-0" />
          {error}
        </div>
      )}

      {/* Log entries - fills remaining space */}
      <div className="flex-1 min-h-0 overflow-y-auto rounded-md border custom-scrollbar">
        <div className="p-1.5">
          {loading && entries.length === 0 ? (
            <div className="flex items-center justify-center py-6 text-muted-foreground">
              <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" />
              <span className="text-[10px]">加载中...</span>
            </div>
          ) : entries.length === 0 ? (
            <div className="flex items-center justify-center py-6 text-muted-foreground">
              <FileText className="h-3.5 w-3.5 mr-1.5" />
              <span className="text-[10px]">暂无日志记录</span>
            </div>
          ) : (
            <div className="space-y-0.5">
              {entries.map((entry, idx) => {
                const entryKey = `${entry.timestamp}-${idx}`;
                const hasMetadata = entry.metadata && Object.keys(entry.metadata).length > 0;
                const isExpanded = expandedEntries.has(entryKey);
                return (
                  <div key={entryKey}>
                    <div
                      className={`flex items-start gap-1.5 px-2 py-1.5 rounded hover:bg-muted/50 transition-colors text-[10px] font-mono ${
                        isExpanded ? 'bg-muted/30' : ''
                      }`}
                    >
                      <div className="shrink-0 w-[100px] text-muted-foreground flex items-center gap-0.5">
                        <Clock className="h-2.5 w-2.5" />
                        {formatTime(entry.timestamp)}
                      </div>
                      <div className="shrink-0">
                        {getCategoryBadge(entry.category)}
                      </div>
                      <div className="shrink-0">
                        {getEntityTypeBadge(entry.entityType, entry.entityId)}
                      </div>
                      <div className="shrink-0 w-[90px] font-medium truncate text-foreground" title={entry.action}>
                        {entry.action}
                      </div>
                      <div className="shrink-0 flex items-center gap-0.5 text-muted-foreground w-[50px]">
                        <User className="h-2.5 w-2.5" />
                        <span className="truncate">{entry.actor}</span>
                      </div>
                      <div className="flex-1 min-w-0 text-muted-foreground truncate" title={entry.details}>
                        {entry.details}
                      </div>
                      {entry.ip && (
                        <div className="shrink-0 flex items-center gap-0.5 text-muted-foreground">
                          <MapPin className="h-2.5 w-2.5" />
                          <span>{entry.ip}</span>
                        </div>
                      )}
                      {hasMetadata && (
                        <button
                          onClick={() => toggleExpanded(entryKey)}
                          className="shrink-0 text-muted-foreground hover:text-foreground transition-colors cursor-pointer"
                          title="查看详情"
                        >
                          {isExpanded
                            ? <ChevronUp className="h-2.5 w-2.5" />
                            : <ChevronDown className="h-2.5 w-2.5" />
                          }
                        </button>
                      )}
                    </div>
                    {/* Expanded metadata row */}
                    {isExpanded && hasMetadata && (
                      <div className="ml-[108px] mr-2 mb-1 px-2 py-1 bg-muted/20 rounded text-[9px] font-mono">
                        <div className="flex flex-wrap gap-x-3 gap-y-0.5">
                          {Object.entries(entry.metadata!).map(([key, value]) => (
                            <span key={key} className="text-muted-foreground">
                              <span className="text-foreground/70">{key}:</span>{' '}
                              {typeof value === 'object' ? JSON.stringify(value) : String(value)}
                            </span>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* Pagination - compact bottom bar */}
      <div className="flex items-center justify-between shrink-0 pt-1.5">
        <span className="text-[10px] text-muted-foreground">
          {total > 0 ? `${currentPage}/${totalPages} 页 · ${total} 条` : '暂无记录'}
        </span>
        <div className="flex items-center gap-0.5">
          {total > limit && (
            <>
              <Button
                variant="outline"
                size="sm"
                className="h-5 w-5 p-0 cursor-pointer"
                disabled={offset === 0 || loading}
                onClick={() => setOffset(Math.max(0, offset - limit))}
              >
                <ChevronLeft className="h-2.5 w-2.5" />
              </Button>
              <Button
                variant="outline"
                size="sm"
                className="h-5 w-5 p-0 cursor-pointer"
                disabled={offset + limit >= total || loading}
                onClick={() => setOffset(offset + limit)}
              >
                <ChevronRight className="h-2.5 w-2.5" />
              </Button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
