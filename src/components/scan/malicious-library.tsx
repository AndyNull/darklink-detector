'use client';

import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from '@/components/ui/dialog';
import {
  ShieldAlert,
  Globe,
  Search,
  Plus,
  Trash2,
  Loader2,
  AlertTriangle,
  Server,
  Shield,
  FileUp,
  ExternalLink,
  CheckCircle2,
  Download,
  ChevronLeft,
  ChevronRight,
  File,
  RefreshCw,
  Key,
  Clock,
  Hash,
  Trash2 as Trash2Icon,
} from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { IP_REGEX } from '@/lib/constants';
import { useAuth, getAuthHeaders } from '@/lib/auth-context';
import { useDataSyncStore } from '@/lib/data-sync-store';

// --- Types ---

interface MaliciousDomain {
  id: string;
  domain: string;
  reason: string | null;
  source: string;
  severity: string;
  category: string | null;
  createdAt: string;
  updatedAt: string;
}

interface MaliciousIP {
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

type MaliciousEntry = MaliciousDomain | MaliciousIP;

// --- Constants ---

const severityLabels: Record<string, string> = {
  critical: '严重',
  high: '高危',
  medium: '中危',
  low: '低危',
};

const categoryLabels: Record<string, string> = {
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

const sourceLabels: Record<string, string> = {
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
  'feodo-tracker': 'Feodo Tracker',
  'ssl-blacklist': 'SSL Blacklist',
  phishtank: 'PhishTank',
  dshield: 'DShield',
  malwarebazaar: 'MalwareBazaar',
  virustotal: 'VirusTotal',
  abuseipdb: 'AbuseIPDB',
  other: '其他',
};

// --- Sub Components ---

function EmptyState({ type }: { type: 'domain' | 'ip' }) {
  return (
    <div className="text-center text-muted-foreground py-6">
      {type === 'domain' ? (
        <Globe className="h-5 w-5 mx-auto mb-1.5 opacity-20" />
      ) : (
        <Server className="h-5 w-5 mx-auto mb-1.5 opacity-20" />
      )}
      <p className="text-xs">暂无{type === 'domain' ? '域名' : 'IP'}记录</p>
      <p className="text-[10px] mt-0.5">点击右上角添加</p>
    </div>
  );
}

// Compact pagination bar with prev/next + inline page input
function PaginationBar({
  current,
  total,
  totalCount,
  pageSize,
  loading,
  onGoTo,
}: {
  current: number;
  total: number;
  totalCount: number;
  pageSize: number;
  loading: boolean;
  onGoTo: (page: number) => void;
}) {
  const [inputVal, setInputVal] = useState(String(current));

  // Sync input when current page changes externally
  useEffect(() => {
    setInputVal(String(current));
  }, [current]);

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const v = e.target.value;
    // Allow only digits
    if (v === '' || /^\d+$/.test(v)) {
      setInputVal(v);
    }
  };

  const handleInputCommit = () => {
    const num = parseInt(inputVal, 10);
    if (!isNaN(num) && num >= 1 && num <= total) {
      onGoTo(num);
    } else {
      setInputVal(String(current)); // revert
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      handleInputCommit();
      (e.target as HTMLInputElement).blur();
    } else if (e.key === 'Escape') {
      setInputVal(String(current));
      (e.target as HTMLInputElement).blur();
    }
  };

  const startItem = (current - 1) * pageSize + 1;
  const endItem = Math.min(current * pageSize, totalCount);

  return (
    <div className="shrink-0 border-t px-3 py-1.5 flex items-center justify-between gap-2">
      <span className="text-[10px] text-muted-foreground tabular-nums shrink-0">
        {startItem}-{endItem} / {totalCount}
      </span>
      <div className="flex items-center gap-1">
        <Button
          variant="ghost"
          size="sm"
          className="h-6 w-6 p-0"
          disabled={current <= 1 || loading}
          onClick={() => onGoTo(current - 1)}
        >
          <ChevronLeft className="h-3.5 w-3.5" />
        </Button>
        <div className="flex items-center gap-0.5 text-[11px]">
          <input
            type="text"
            value={inputVal}
            onChange={handleInputChange}
            onBlur={handleInputCommit}
            onKeyDown={handleKeyDown}
            className="h-6 w-8 text-center rounded border bg-background text-[11px] tabular-nums focus:outline-none focus:ring-1 focus:ring-ring px-0.5"
            disabled={loading}
          />
          <span className="text-muted-foreground">/</span>
          <span className="tabular-nums text-muted-foreground">{total}</span>
        </div>
        <Button
          variant="ghost"
          size="sm"
          className="h-6 w-6 p-0"
          disabled={current >= total || loading}
          onClick={() => onGoTo(current + 1)}
        >
          <ChevronRight className="h-3.5 w-3.5" />
        </Button>
      </div>
    </div>
  );
}

const EntryCard = React.memo(function EntryCard({
  entry,
  type,
  onDelete,
  deleting,
  selected,
  onSelect,
  selectionMode,
  showDelete,
}: {
  entry: MaliciousEntry;
  type: 'domain' | 'ip';
  onDelete: (id: string) => void;
  deleting: boolean;
  selected?: boolean;
  onSelect?: (id: string, checked: boolean) => void;
  selectionMode?: boolean;
  showDelete?: boolean;
}) {
  const value = type === 'domain' ? (entry as MaliciousDomain).domain : (entry as MaliciousIP).ip;
  const severity = entry.severity || 'high';

  const dotColors: Record<string, string> = {
    critical: 'bg-red-500',
    high: 'bg-orange-500',
    medium: 'bg-yellow-500',
    low: 'bg-emerald-500',
  };

  return (
    <div className={`rounded border px-2 py-1 transition-all duration-150 ease-out group cursor-default ${selected ? 'bg-primary/5 ring-1 ring-primary/30' : 'hover:bg-accent/40 active:bg-accent/60'}`}>
      <div className="flex items-center gap-1.5 min-w-0">
        {/* Selection checkbox */}
        {selectionMode && onSelect && (
          <Checkbox
            checked={selected}
            onCheckedChange={(checked) => onSelect(entry.id, !!checked)}
            className="h-3 w-3 shrink-0"
            onClick={(e) => e.stopPropagation()}
          />
        )}

        {/* Severity dot */}
        <div className={`w-1.5 h-1.5 rounded-full shrink-0 ${dotColors[severity] || 'bg-gray-400'}`} title={severityLabels[severity] || severity} />

        {/* Domain/IP value */}
        {type === 'domain' ? (
          <Globe className="h-3 w-3 text-muted-foreground shrink-0" />
        ) : (
          <Server className="h-3 w-3 text-muted-foreground shrink-0" />
        )}
        <span className="text-[11px] font-mono font-semibold truncate" title={value}>
          {value}
        </span>

        {/* Category badge */}
        {entry.category && (
          <Badge variant="outline" className="text-[8px] px-1 py-0 shrink-0">
            {categoryLabels[entry.category] || entry.category}
          </Badge>
        )}

        {/* Source badge */}
        <Badge variant="outline" className="text-[8px] px-1 py-0 text-muted-foreground shrink-0">
          {sourceLabels[entry.source] || entry.source}
        </Badge>

        {/* Delete button - only show when authenticated */}
        {showDelete && (
          <Button
            variant="ghost"
            size="sm"
            className="h-4 w-4 p-0 ml-auto shrink-0 text-muted-foreground opacity-0 group-hover:opacity-100 hover:text-destructive transition-opacity"
            onClick={() => onDelete(entry.id)}
            disabled={deleting}
          >
            {deleting ? (
              <Loader2 className="h-2.5 w-2.5 animate-spin" />
            ) : (
              <Trash2 className="h-2.5 w-2.5" />
            )}
          </Button>
        )}
      </div>

      {/* Reason - second row, only if present */}
      {entry.reason && (
        <div className="text-[9px] text-muted-foreground truncate mt-0.5 pl-5" title={entry.reason}>
          {entry.reason}
        </div>
      )}
    </div>
  );
});

// --- Add Dialog ---

function AddEntryDialog({
  open,
  onOpenChange,
  type,
  onAdded,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  type: 'domain' | 'ip';
  onAdded: () => void;
}) {
  const [value, setValue] = useState('');
  const [reason, setReason] = useState('');
  const [severity, setSeverity] = useState('high');
  const [category, setCategory] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  // Parse textarea lines
  const parsedValues = value.split('\n').map(l => l.trim()).filter(l => l.length > 0);
  const entryCount = parsedValues.length;

  const resetForm = useCallback(() => {
    setValue('');
    setReason('');
    setSeverity('high');
    setCategory('');
    setError('');
    setSubmitting(false);
  }, []);

  useEffect(() => {
    if (!open) resetForm();
  }, [open, resetForm]);

  const handleSubmit = async () => {
    const lines = value.split('\n').map(l => l.trim()).filter(l => l.length > 0);
    if (lines.length === 0) {
      setError(type === 'domain' ? '请输入域名' : '请输入IP地址');
      return;
    }

    // Validate IP if type is ip and single entry
    if (type === 'ip' && lines.length === 1 && !IP_REGEX.test(lines[0])) {
      setError('IP地址格式不正确');
      return;
    }

    setSubmitting(true);
    setError('');

    try {
      if (lines.length === 1) {
        // Single add
        const res = await fetch('/api/malicious', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
          body: JSON.stringify({
            type,
            value: lines[0],
            reason: reason.trim() || undefined,
            severity,
            category: category || undefined,
            source: 'manual',
          }),
        });

        if (!res.ok) {
          const data = await res.json();
          if (res.status === 409) {
            setError(type === 'domain' ? '该域名已存在' : '该IP已存在');
          } else {
            setError(data.error || '添加失败');
          }
          setSubmitting(false);
          return;
        }
      } else {
        // Batch add
        const res = await fetch('/api/malicious', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
          body: JSON.stringify({
            action: 'batch',
            type,
            values: lines,
            severity,
            category: category || undefined,
            reason: reason.trim() || undefined,
            source: 'manual',
          }),
        });

        if (!res.ok) {
          const data = await res.json();
          setError(data.error || '批量添加失败');
          setSubmitting(false);
          return;
        }
      }

      onOpenChange(false);
      onAdded();
    } catch {
      setError('网络错误，请重试');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[420px] p-4 gap-3">
        <DialogHeader className="pb-0">
          <DialogTitle className="text-sm flex items-center gap-1.5">
            <ShieldAlert className="h-3.5 w-3.5" />
            添加恶意{type === 'domain' ? '域名' : 'IP'}
          </DialogTitle>
          <DialogDescription className="text-[10px]">
            将{type === 'domain' ? '域名' : 'IP地址'}添加到恶意库中
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-2.5">
          <div className="space-y-1">
            <label className="text-[10px] font-medium text-muted-foreground">
              域名/IP地址（每行一个，支持批量输入） <span className="text-destructive">*</span>
            </label>
            <textarea
              placeholder={"例:\nevil1.example.com\nevil2.example.com\n192.168.1.1"}
              value={value}
              onChange={(e) => { setValue(e.target.value); setError(''); }}
              className="flex min-h-[80px] max-h-[160px] w-full rounded-md border border-input bg-background px-3 py-2 text-xs ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 resize-y"
              disabled={submitting}
            />
            {value.trim().length > 0 && (
              <div className="text-[10px] text-muted-foreground">
                已输入 <span className="font-medium text-foreground">{entryCount}</span> 个条目
              </div>
            )}
          </div>

          <div className="space-y-1">
            <label className="text-[10px] font-medium text-muted-foreground">原因</label>
            <Input
              placeholder="标记为恶意的原因"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              className="h-8 text-xs"
            />
          </div>

          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-1">
              <label className="text-[10px] font-medium text-muted-foreground">严重性</label>
              <Select value={severity} onValueChange={setSeverity}>
                <SelectTrigger size="sm" className="text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="critical">严重</SelectItem>
                  <SelectItem value="high">高危</SelectItem>
                  <SelectItem value="medium">中危</SelectItem>
                  <SelectItem value="low">低危</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <label className="text-[10px] font-medium text-muted-foreground">分类</label>
              <Select value={category} onValueChange={setCategory}>
                <SelectTrigger size="sm" className="text-xs">
                  <SelectValue placeholder="选择分类" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="phishing">钓鱼</SelectItem>
                  <SelectItem value="malware">恶意软件</SelectItem>
                  <SelectItem value="c2">C2</SelectItem>
                  <SelectItem value="spam">垃圾邮件</SelectItem>
                  <SelectItem value="botnet">僵尸网络</SelectItem>
                  <SelectItem value="other">其他</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          {error && (
            <div className="flex items-center gap-1 text-destructive text-[10px]">
              <AlertTriangle className="h-3 w-3 shrink-0" />
              {error}
            </div>
          )}
        </div>

        <DialogFooter className="gap-1.5 pt-0">
          <Button
            variant="outline"
            size="sm"
            className="text-xs"
            onClick={() => onOpenChange(false)}
            disabled={submitting}
          >
            取消
          </Button>
          <Button
            size="sm"
            className="text-xs"
            onClick={handleSubmit}
            disabled={submitting || entryCount === 0}
          >
            {submitting && <Loader2 className="h-3 w-3 mr-1 animate-spin" />}
            {entryCount > 1 ? `添加 (${entryCount})` : '添加'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// --- Batch Import Dialog (File Import) ---

function BatchImportDialog({
  open,
  onOpenChange,
  type,
  onAdded,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  type: 'domain' | 'ip';
  onAdded: () => void;
}) {
  const [severity, setSeverity] = useState('high');
  const [category, setCategory] = useState('');
  const [reason, setReason] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [progress, setProgress] = useState<{ added: number; skipped: number; total: number } | null>(null);
  const [error, setError] = useState('');
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const resetForm = useCallback(() => {
    setSeverity('high');
    setCategory('');
    setReason('');
    setError('');
    setSubmitting(false);
    setProgress(null);
    setSelectedFile(null);
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  }, []);

  useEffect(() => {
    if (!open) resetForm();
  }, [open, resetForm]);

  const downloadTemplate = async () => {
    const XLSX = await import('xlsx');
    const wsData = [
      ['value', 'type', 'severity', 'category', 'reason'],
      ['evil.example.com', 'domain', 'high', 'phishing', '钓鱼网站'],
      ['192.168.1.1', 'ip', 'critical', 'c2', 'C2服务器'],
    ];
    const ws = XLSX.utils.aoa_to_sheet(wsData);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, '恶意条目');
    XLSX.writeFile(wb, 'malicious_import_template.xlsx');
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      setSelectedFile(file);
      setError('');
    }
  };

  const handleSubmit = async () => {
    if (!selectedFile) {
      setError('请选择一个文件');
      return;
    }

    setSubmitting(true);
    setError('');
    setProgress(null);

    try {
      const XLSX = await import('xlsx');
      const arrayBuffer = await selectedFile.arrayBuffer();
      const workbook = XLSX.read(arrayBuffer, { type: 'array' });
      const firstSheetName = workbook.SheetNames[0];
      const worksheet = workbook.Sheets[firstSheetName];
      const jsonData = XLSX.utils.sheet_to_json<(string | undefined)[]>(worksheet, { header: 1 });

      // Skip header row
      const rows = jsonData.slice(1).filter((row) => row[0] && String(row[0]).trim());

      if (rows.length === 0) {
        setError('文件中没有有效的数据行');
        setSubmitting(false);
        return;
      }

      setProgress({ added: 0, skipped: 0, total: rows.length });

      // Collect all entries and batch them
      const entries: { value: string; type: string; severity: string; category?: string; reason?: string }[] = [];

      for (const row of rows) {
        const value = String(row[0] || '').trim();
        if (!value) continue;

        const rowType = String(row[1] || '').trim() || type;
        const rowSeverity = String(row[2] || '').trim() || severity;
        const rowCategory = String(row[3] || '').trim() || category || undefined;
        const rowReason = String(row[4] || '').trim() || reason.trim() || undefined;

        entries.push({
          value,
          type: rowType === 'domain' || rowType === 'ip' ? rowType : type,
          severity: ['critical', 'high', 'medium', 'low'].includes(rowSeverity) ? rowSeverity : severity,
          category: rowCategory,
          reason: rowReason,
        });
      }

      // Send as batch (group by type)
      const byType = new Map<string, typeof entries>();
      for (const entry of entries) {
        if (!byType.has(entry.type)) byType.set(entry.type, []);
        byType.get(entry.type)!.push(entry);
      }

      let totalAdded = 0;
      let totalSkipped = 0;

      for (const [entryType, items] of byType) {
        const values = items.map(e => e.value);
        const firstItem = items[0];

        const res = await fetch('/api/malicious', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
          body: JSON.stringify({
            action: 'batch',
            type: entryType,
            values,
            severity: firstItem.severity,
            category: firstItem.category || undefined,
            reason: firstItem.reason || undefined,
            source: 'manual',
          }),
        });

        if (!res.ok) {
          const data = await res.json();
          setError(data.error || '导入失败');
          setSubmitting(false);
          return;
        }

        const data = await res.json();
        totalAdded += data.added || 0;
        totalSkipped += data.skipped || 0;
      }

      setProgress({ added: totalAdded, skipped: totalSkipped, total: entries.length });

      setTimeout(() => {
        onOpenChange(false);
        onAdded();
      }, 1500);
    } catch (err) {
      console.error('File import error:', err);
      setError('文件解析失败，请检查文件格式');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[420px] p-4 gap-3">
        <DialogHeader className="pb-0">
          <DialogTitle className="text-sm flex items-center gap-1.5">
            <FileUp className="h-3.5 w-3.5" />
            导入文件
          </DialogTitle>
          <DialogDescription className="text-[10px]">
            支持 .xlsx, .xls, .csv 格式文件
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-2.5">
          {/* File input */}
          <div className="space-y-1.5">
            <input
              ref={fileInputRef}
              type="file"
              accept=".xlsx,.xls,.csv"
              onChange={handleFileSelect}
              className="hidden"
              disabled={submitting}
            />
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                className="text-[11px] gap-1 flex-1 justify-center"
                onClick={() => fileInputRef.current?.click()}
                disabled={submitting}
              >
                <File className="h-3 w-3" />
                {selectedFile ? selectedFile.name : '选择文件'}
              </Button>
              <Button
                variant="outline"
                size="sm"
                className="text-[11px] gap-1 shrink-0"
                onClick={downloadTemplate}
                disabled={submitting}
              >
                <Download className="h-3 w-3" />
                下载模板
              </Button>
            </div>
            {selectedFile && (
              <div className="text-[10px] text-muted-foreground">
                已选择: {selectedFile.name} ({(selectedFile.size / 1024).toFixed(1)} KB)
              </div>
            )}
          </div>

          {/* Default severity, category, reason */}
          <div className="space-y-1">
            <label className="text-[10px] font-medium text-muted-foreground">默认原因</label>
            <Input
              placeholder="批量标记原因（文件中未指定时使用）"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              className="h-8 text-xs"
              disabled={submitting}
            />
          </div>

          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-1">
              <label className="text-[10px] font-medium text-muted-foreground">默认严重性</label>
              <Select value={severity} onValueChange={setSeverity} disabled={submitting}>
                <SelectTrigger size="sm" className="text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="critical">严重</SelectItem>
                  <SelectItem value="high">高危</SelectItem>
                  <SelectItem value="medium">中危</SelectItem>
                  <SelectItem value="low">低危</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <label className="text-[10px] font-medium text-muted-foreground">默认分类</label>
              <Select value={category} onValueChange={setCategory} disabled={submitting}>
                <SelectTrigger size="sm" className="text-xs">
                  <SelectValue placeholder="选择分类" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="phishing">钓鱼</SelectItem>
                  <SelectItem value="malware">恶意软件</SelectItem>
                  <SelectItem value="c2">C2</SelectItem>
                  <SelectItem value="spam">垃圾邮件</SelectItem>
                  <SelectItem value="botnet">僵尸网络</SelectItem>
                  <SelectItem value="other">其他</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          {progress && (
            <div className="text-[10px] text-muted-foreground flex items-center gap-1.5">
              {submitting ? (
                <Loader2 className="h-3 w-3 animate-spin" />
              ) : (
                <CheckCircle2 className="h-3 w-3 text-green-600" />
              )}
              已添加 {progress.added}/{progress.total} 个{progress.skipped > 0 ? `，${progress.skipped} 个重复跳过` : ''}
            </div>
          )}

          {error && (
            <div className="flex items-center gap-1 text-destructive text-[10px]">
              <AlertTriangle className="h-3 w-3 shrink-0" />
              {error}
            </div>
          )}
        </div>

        <DialogFooter className="gap-1.5 pt-0">
          <Button
            variant="outline"
            size="sm"
            className="text-xs"
            onClick={() => onOpenChange(false)}
            disabled={submitting}
          >
            取消
          </Button>
          <Button
            size="sm"
            className="text-xs"
            onClick={handleSubmit}
            disabled={submitting || !selectedFile}
          >
            {submitting && <Loader2 className="h-3 w-3 mr-1 animate-spin" />}
            导入
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// --- Delete Confirmation Dialog ---

function DeleteConfirmDialog({
  open,
  onOpenChange,
  onConfirm,
  deleting,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: () => void;
  deleting: boolean;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[320px] p-4 gap-3">
        <DialogHeader className="pb-0">
          <DialogTitle className="text-sm flex items-center gap-1.5">
            <AlertTriangle className="h-3.5 w-3.5 text-destructive" />
            确认删除
          </DialogTitle>
          <DialogDescription className="text-[10px]">
            删除后数据将无法恢复，确定要删除该条记录吗？
          </DialogDescription>
        </DialogHeader>
        <DialogFooter className="gap-1.5 pt-0">
          <Button
            variant="outline"
            size="sm"
            className="text-xs"
            onClick={() => onOpenChange(false)}
            disabled={deleting}
          >
            取消
          </Button>
          <Button
            variant="destructive"
            size="sm"
            className="text-xs"
            onClick={onConfirm}
            disabled={deleting}
          >
            {deleting && <Loader2 className="h-3 w-3 mr-1 animate-spin" />}
            删除
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// --- Main Component ---

export function MaliciousLibrary() {
  const { requireAuth, isAuthenticated } = useAuth();
  const dataSync = useDataSyncStore();
  const { maliciousStats, connected: wsConnected } = dataSync;

  const [activeTab, setActiveTab] = useState<'domain' | 'ip' | 'sources'>('domain');
  const [search, setSearch] = useState('');
  const [domainEntries, setDomainEntries] = useState<MaliciousDomain[]>([]);
  const [ipEntries, setIpEntries] = useState<MaliciousIP[]>([]);
  const [domainTotal, setDomainTotal] = useState(0);
  const [ipTotal, setIpTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [domainPage, setDomainPage] = useState(1);
  const [ipPage, setIpPage] = useState(1);
  const PAGE_SIZE = 50;
  const domainTotalPages = Math.max(1, Math.ceil(domainTotal / PAGE_SIZE));
  const ipTotalPages = Math.max(1, Math.ceil(ipTotal / PAGE_SIZE));
  const [addDialogOpen, setAddDialogOpen] = useState(false);
  const [batchDialogOpen, setBatchDialogOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<{ id: string; type: 'domain' | 'ip' } | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [exporting, setExporting] = useState(false);

  // ──── Batch selection state ────
  const [selectionMode, setSelectionMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [batchDeleteConfirmOpen, setBatchDeleteConfirmOpen] = useState(false);
  const [batchDeleting, setBatchDeleting] = useState(false);

  // ──── Refs for current page values (avoids re-creating fetchEntries on page change) ────
  const domainPageRef = useRef(1);
  const ipPageRef = useRef(1);

  // Keep refs in sync with state
  useEffect(() => { domainPageRef.current = domainPage; }, [domainPage]);
  useEffect(() => { ipPageRef.current = ipPage; }, [ipPage]);

  // ──── Initialize data-sync store and request stats ────
  useEffect(() => {
    if (!dataSync.initialized) {
      dataSync.init();
    }
  }, [dataSync]);

  // Request refresh for malicious-stats when stale
  useEffect(() => {
    if (wsConnected && dataSync.isStale('malicious-stats')) {
      dataSync.requestRefresh('malicious-stats');
    }
  }, [wsConnected, dataSync]);

  // ──── Derived total count from WebSocket store (preferred) ────
  const wsTotalCount = wsConnected && (maliciousStats.domainCount > 0 || maliciousStats.ipCount > 0)
    ? maliciousStats.domainCount + maliciousStats.ipCount
    : 0;

  // ──── Source statistics ────
  const [sourceStats, setSourceStats] = useState<Record<string, number>>({});

  // Calculate source stats from entries
  useEffect(() => {
    const stats: Record<string, number> = {};
    const entries = activeTab === 'domain' ? domainEntries : ipEntries;
    for (const entry of entries) {
      stats[entry.source] = (stats[entry.source] || 0) + 1;
    }
    setSourceStats(stats);
  }, [domainEntries, ipEntries, activeTab]);

  // Fetch entries — page-based (no append)
  // Uses refs for page values so the callback reference stays stable
  const fetchEntries = useCallback(async (
    type: 'domain' | 'ip',
    searchQuery: string = '',
    explicitPage?: number,
  ) => {
    const isDomain = type === 'domain';
    const currentPage = explicitPage ?? (isDomain ? domainPageRef.current : ipPageRef.current);
    const page = Math.max(1, currentPage);

    setLoading(true);

    try {
      const params = new URLSearchParams({
        type,
        page: String(page),
        pageSize: String(PAGE_SIZE),
      });
      if (searchQuery) params.set('search', searchQuery);

      const res = await fetch(`/api/malicious?${params.toString()}`);
      if (!res.ok) throw new Error('Failed to fetch');

      const data = await res.json();
      const items = data.items || [];
      const total = data.total || 0;

      if (isDomain) {
        setDomainEntries(items);
        setDomainTotal(total);
        setDomainPage(page);
      } else {
        setIpEntries(items);
        setIpTotal(total);
        setIpPage(page);
      }
    } catch (err) {
      console.error('Failed to fetch malicious entries:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  // Fetch both types on mount
  useEffect(() => {
    fetchEntries('domain');
    fetchEntries('ip');
  }, [fetchEntries]);

  // Search with debounce — only for domain/ip tabs
  useEffect(() => {
    if (activeTab === 'sources') return; // Don't fetch on sources tab
    const timer = setTimeout(() => {
      fetchEntries(activeTab, search);
    }, 300);
    return () => clearTimeout(timer);
  }, [search, activeTab, fetchEntries]);

  // Tab change fetch
  const handleTabChange = (value: string) => {
    const tab = value as 'domain' | 'ip' | 'sources';
    setActiveTab(tab);
    setSearch('');
    if (tab === 'domain' || tab === 'ip') {
      fetchEntries(tab, '', 1);
    }
  };

  // Delete handler
  const handleDelete = async () => {
    if (!deleteTarget) return;
    if (!requireAuth(() => {})) return;

    setDeleting(true);
    try {
      const res = await fetch(
        `/api/malicious?type=${deleteTarget.type}&id=${deleteTarget.id}`,
        { method: 'DELETE', headers: getAuthHeaders() }
      );
      if (!res.ok) throw new Error('Failed to delete');

      fetchEntries(deleteTarget.type, deleteTarget.type === activeTab ? search : '', 1);
      const otherType = deleteTarget.type === 'domain' ? 'ip' : 'domain';
      fetchEntries(otherType, '', 1);
    } catch (err) {
      console.error('Failed to delete entry:', err);
    } finally {
      setDeleting(false);
      setDeleteTarget(null);
    }
  };

  // ──── Batch delete handler ────
  const handleBatchDelete = async () => {
    if (selectedIds.size === 0) return;
    if (!requireAuth(() => {})) return;
    setBatchDeleting(true);
    try {
      const type = activeTab as 'domain' | 'ip';
      for (const id of selectedIds) {
        await fetch(`/api/malicious?type=${type}&id=${id}`, { method: 'DELETE', headers: getAuthHeaders() });
      }
      setSelectedIds(new Set());
      setSelectionMode(false);
      fetchEntries(type, search, 1);
    } catch (err) {
      console.error('Batch delete failed:', err);
    } finally {
      setBatchDeleting(false);
      setBatchDeleteConfirmOpen(false);
    }
  };

  const handleSelectEntry = useCallback((id: string, checked: boolean) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (checked) next.add(id);
      else next.delete(id);
      return next;
    });
  }, []);

  // Page navigation helper
  const goToPage = (page: number) => {
    const isDomain = activeTab === 'domain';
    const totalPages = isDomain ? domainTotalPages : ipTotalPages;
    const clamped = Math.max(1, Math.min(page, totalPages));
    if (activeTab === 'domain' || activeTab === 'ip') {
      fetchEntries(activeTab, search, clamped);
    }
  };

  // Export handler
  const handleExport = async (format: 'json' | 'csv') => {
    const exportType = activeTab === 'ip' ? 'ip' : 'domain';
    setExporting(true);
    try {
      const res = await fetch(`/api/malicious?action=export&type=${exportType}&format=${format}`);
      if (!res.ok) throw new Error('Export failed');

      let blob: Blob;
      let filename: string;
      const dateStr = new Date().toISOString().slice(0, 10);

      if (format === 'csv') {
        const text = await res.text();
        blob = new Blob([text], { type: 'text/csv;charset=utf-8' });
        filename = `malicious_${exportType}s_${dateStr}.csv`;
      } else {
        const data = await res.json();
        const text = JSON.stringify(data, null, 2);
        blob = new Blob([text], { type: 'application/json;charset=utf-8' });
        filename = `malicious_${exportType}s_${dateStr}.json`;
      }

      // Trigger browser download
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (err) {
      console.error('Export failed:', err);
    } finally {
      setExporting(false);
    }
  };

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Header — title + total count */}
      <div className="h-10 px-3 border-b flex items-center gap-2 shrink-0">
        <Shield className="h-3.5 w-3.5 text-muted-foreground" />
        <span className="text-xs font-medium">恶意库</span>
        <Badge variant="outline" className="text-[9px] px-1 py-0 ml-0.5">
          {wsTotalCount > 0 ? wsTotalCount : domainTotal + ipTotal}
        </Badge>
      </div>

      {/* Controls row */}
      <div className="px-3 py-1.5 shrink-0">
        <div className="flex items-center gap-1.5 overflow-x-auto custom-scrollbar">
          <div className="relative w-[120px] sm:w-[160px] shrink-0">
            <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3 w-3 text-muted-foreground" />
            <Input
              placeholder="搜索..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="h-7 w-full text-[11px] pl-6"
            />
          </div>
          {isAuthenticated && (
            <Button
              variant="outline"
              size="sm"
              className="h-7 text-[11px] gap-1 px-2 shrink-0"
              onClick={() => setBatchDialogOpen(true)}
            >
              <FileUp className="h-3 w-3" />
              导入
            </Button>
          )}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="outline"
                size="sm"
                className="h-7 text-[11px] gap-1 px-2 shrink-0"
                disabled={exporting}
              >
                {exporting ? (
                  <Loader2 className="h-3 w-3 animate-spin" />
                ) : (
                  <Download className="h-3 w-3" />
                )}
                导出
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={() => handleExport('json')}>
                <Download className="h-3 w-3 mr-1.5" />
                导出JSON
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => handleExport('csv')}>
                <Download className="h-3 w-3 mr-1.5" />
                导出CSV
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          {isAuthenticated && (
            <Button
              variant="outline"
              size="sm"
              className="h-7 text-[11px] gap-1 px-2 shrink-0"
              onClick={() => setAddDialogOpen(true)}
            >
              <Plus className="h-3 w-3" />
              添加
            </Button>
          )}
          {/* Batch select toggle - auth required */}
          {isAuthenticated && activeTab !== 'sources' && (
            <Button
              variant={selectionMode ? 'default' : 'outline'}
              size="sm"
              className="h-7 text-[11px] gap-1 px-2 shrink-0"
              onClick={() => {
                setSelectionMode(!selectionMode);
                setSelectedIds(new Set());
              }}
            >
              <Hash className="h-3 w-3" />
              {selectionMode ? '取消' : '批量'}
            </Button>
          )}
          {/* Batch delete button */}
          {selectionMode && selectedIds.size > 0 && (
            <Button
              variant="destructive"
              size="sm"
              className="h-7 text-[11px] gap-1 px-2 shrink-0"
              onClick={() => setBatchDeleteConfirmOpen(true)}
              disabled={batchDeleting}
            >
              {batchDeleting ? <Loader2 className="h-3 w-3 animate-spin" /> : <Trash2Icon className="h-3 w-3" />}
              删除({selectedIds.size})
            </Button>
          )}
        </div>
      </div>

      {/* Tabs */}
      <Tabs
        value={activeTab}
        onValueChange={handleTabChange}
        className="flex-1 flex flex-col min-h-0"
      >
        <TabsList className="w-full h-8 shrink-0 px-3 pt-1 bg-transparent gap-1">
          <TabsTrigger value="domain" className="text-[11px] h-7 px-2.5 gap-1 min-w-0 data-[state=active]:bg-blue-500/10 data-[state=active]:text-blue-600 hover:bg-muted/50 transition-colors cursor-pointer [&[data-state=active]_.tab-badge]:!bg-muted/50 [&[data-state=active]_.tab-badge]:!text-muted-foreground">
            <Globe className="h-3 w-3 shrink-0" />
            <span className="truncate">域名</span>
            <Badge variant="secondary" className="tab-badge text-[8px] px-1 py-0 h-4 min-w-[16px] justify-center tabular-nums bg-muted/50 text-muted-foreground">{domainTotal}</Badge>
          </TabsTrigger>
          <TabsTrigger value="ip" className="text-[11px] h-7 px-2.5 gap-1 min-w-0 data-[state=active]:bg-orange-500/10 data-[state=active]:text-orange-600 hover:bg-muted/50 transition-colors cursor-pointer [&[data-state=active]_.tab-badge]:!bg-muted/50 [&[data-state=active]_.tab-badge]:!text-muted-foreground">
            <Server className="h-3 w-3 shrink-0" />
            <span className="truncate">IP</span>
            <Badge variant="secondary" className="tab-badge text-[8px] px-1 py-0 h-4 min-w-[16px] justify-center tabular-nums bg-muted/50 text-muted-foreground">{ipTotal}</Badge>
          </TabsTrigger>
          <TabsTrigger value="sources" className="text-[11px] h-7 px-2.5 gap-1 min-w-0 data-[state=active]:bg-purple-500/10 data-[state=active]:text-purple-600 hover:bg-muted/50 transition-colors cursor-pointer">
            <Shield className="h-3 w-3 shrink-0" />
            <span className="truncate">情报源</span>
          </TabsTrigger>
        </TabsList>

        <TabsContent value="domain" className="flex-1 min-h-0 mt-0 flex flex-col">
          <div className="flex-1 min-h-0 overflow-y-auto px-2 custom-scrollbar">
            {loading && domainEntries.length === 0 ? (
              <div className="flex items-center justify-center py-6 text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin mr-1.5" />
                <span className="text-xs">加载中...</span>
              </div>
            ) : domainEntries.length === 0 ? (
              <EmptyState type="domain" />
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-1">
                {domainEntries.map((entry) => (
                  <EntryCard
                    key={entry.id}
                    entry={entry}
                    type="domain"
                    onDelete={(id) => { setDeleteTarget({ id, type: 'domain' }); }}
                    deleting={deleting && deleteTarget?.id === entry.id}
                    selected={selectedIds.has(entry.id)}
                    onSelect={handleSelectEntry}
                    selectionMode={selectionMode}
                    showDelete={isAuthenticated}
                  />
                ))}
              </div>
            )}
          </div>
          {domainTotal > 0 && (
            <PaginationBar
              current={domainPage}
              total={domainTotalPages}
              totalCount={domainTotal}
              pageSize={PAGE_SIZE}
              loading={loading}
              onGoTo={goToPage}
            />
          )}
        </TabsContent>

        <TabsContent value="ip" className="flex-1 min-h-0 mt-0 flex flex-col">
          <div className="flex-1 min-h-0 overflow-y-auto px-2 custom-scrollbar">
            {loading && ipEntries.length === 0 ? (
              <div className="flex items-center justify-center py-6 text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin mr-1.5" />
                <span className="text-xs">加载中...</span>
              </div>
            ) : ipEntries.length === 0 ? (
              <EmptyState type="ip" />
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-1">
                {ipEntries.map((entry) => (
                  <EntryCard
                    key={entry.id}
                    entry={entry}
                    type="ip"
                    onDelete={(id) => { setDeleteTarget({ id, type: 'ip' }); }}
                    deleting={deleting && deleteTarget?.id === entry.id}
                    selected={selectedIds.has(entry.id)}
                    onSelect={handleSelectEntry}
                    selectionMode={selectionMode}
                    showDelete={isAuthenticated}
                  />
                ))}
              </div>
            )}
          </div>
          {ipTotal > 0 && (
            <PaginationBar
              current={ipPage}
              total={ipTotalPages}
              totalCount={ipTotal}
              pageSize={PAGE_SIZE}
              loading={loading}
              onGoTo={goToPage}
            />
          )}
        </TabsContent>

        {/* Sources tab — show threat intel data sources */}
        <TabsContent value="sources" className="flex-1 min-h-0 mt-0 flex flex-col">
          <div className="flex-1 min-h-0 overflow-y-auto px-2 custom-scrollbar">
            <ThreatIntelSourcesTab
              domainTotal={domainTotal}
              ipTotal={ipTotal}
              onRefresh={() => {
                fetchEntries('domain');
                fetchEntries('ip');
              }}
            />
          </div>
        </TabsContent>
      </Tabs>
      <AddEntryDialog
        open={addDialogOpen}
        onOpenChange={setAddDialogOpen}
        type={activeTab === 'ip' ? 'ip' : 'domain'}
        onAdded={() => {
          fetchEntries(activeTab === 'ip' ? 'ip' : 'domain');
          fetchEntries(activeTab === 'ip' ? 'domain' : 'ip');
        }}
      />

      {/* Batch Import Dialog */}
      <BatchImportDialog
        open={batchDialogOpen}
        onOpenChange={setBatchDialogOpen}
        type={activeTab === 'ip' ? 'ip' : 'domain'}
        onAdded={() => {
          fetchEntries(activeTab === 'ip' ? 'ip' : 'domain');
          fetchEntries(activeTab === 'ip' ? 'domain' : 'ip');
        }}
      />

      {/* Delete Confirmation Dialog */}
      <DeleteConfirmDialog
        open={!!deleteTarget}
        onOpenChange={(open) => { if (!open) setDeleteTarget(null); }}
        onConfirm={handleDelete}
        deleting={deleting}
      />

      {/* Batch Delete Confirmation Dialog */}
      <Dialog open={batchDeleteConfirmOpen} onOpenChange={setBatchDeleteConfirmOpen}>
        <DialogContent className="sm:max-w-[320px] p-4 gap-3">
          <DialogHeader className="pb-0">
            <DialogTitle className="text-sm flex items-center gap-1.5">
              <AlertTriangle className="h-3.5 w-3.5 text-destructive" />
              批量删除确认
            </DialogTitle>
            <DialogDescription className="text-[10px]">
              确定要删除选中的 {selectedIds.size} 条记录吗？此操作不可恢复。
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-1.5 pt-0">
            <Button
              variant="outline"
              size="sm"
              className="text-xs"
              onClick={() => setBatchDeleteConfirmOpen(false)}
              disabled={batchDeleting}
            >
              取消
            </Button>
            <Button
              variant="destructive"
              size="sm"
              className="text-xs"
              onClick={handleBatchDelete}
              disabled={batchDeleting}
            >
              {batchDeleting && <Loader2 className="h-3 w-3 mr-1 animate-spin" />}
              删除 {selectedIds.size} 条
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// --- Threat Intel Sources Tab ---

interface SourceInfo {
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
const QUERY_ONLY_SOURCES = new Set(['virustotal', 'abuseipdb', 'threatbook']);

function ThreatIntelSourcesTab({ domainTotal, ipTotal, onRefresh }: {
  domainTotal: number;
  ipTotal: number;
  onRefresh: () => void;
}) {
  const [allSources, setAllSources] = useState<SourceInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [lastUpdate, setLastUpdate] = useState<string | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [syncTaskId, setSyncTaskId] = useState<string | null>(null);
  const [collectingSource, setCollectingSource] = useState<string | null>(null);
  const [apiKeyInput, setApiKeyInput] = useState<Record<string, string>>({});
  const [savingKey, setSavingKey] = useState<string | null>(null);

  // Filter out query-only sources — they don't contribute bulk data to the malicious library
  const sources = useMemo(() => allSources.filter(s => !QUERY_ONLY_SOURCES.has(s.id) && !s.queryOnly), [allSources]);

  const fetchSources = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/threat-intel/sources');
      if (!res.ok) throw new Error('Failed to fetch');
      const data = await res.json();
      setAllSources(data.sources || []);
    } catch (err) {
      console.error('Failed to fetch threat intel sources:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchSources();
  }, [fetchSources, domainTotal, ipTotal]);

  // Poll for sync task completion
  useEffect(() => {
    if (!syncTaskId) return;
    const interval = setInterval(async () => {
      try {
        const res = await fetch(`/api/threat-intel/update?taskId=${syncTaskId}`);
        if (!res.ok) return;
        const data = await res.json();
        if (data.status === 'completed') {
          setSyncing(false);
          setSyncTaskId(null);
          setLastUpdate(`同步完成: ${new Date().toLocaleString()}`);
          onRefresh();
          fetchSources();
        } else if (data.status === 'failed') {
          setSyncing(false);
          setSyncTaskId(null);
          setLastUpdate(`同步失败: ${data.error || '未知错误'}`);
        }
      } catch {
        // Ignore polling errors
      }
    }, 3000);
    return () => clearInterval(interval);
  }, [syncTaskId, onRefresh, fetchSources]);

  const handleSync = async () => {
    setSyncing(true);
    try {
      const res = await fetch('/api/threat-intel/update', { method: 'POST' });
      if (!res.ok) {
        const data = await res.json();
        setLastUpdate(`同步失败: ${data.error || '已有同步任务运行中'}`);
        setSyncing(false);
        return;
      }
      const data = await res.json();
      setSyncTaskId(data.taskId);
      setLastUpdate('同步中...');
    } catch (err) {
      setLastUpdate('同步失败: 网络错误');
      setSyncing(false);
    }
  };

  const handleCollectSource = async (sourceId: string) => {
    setCollectingSource(sourceId);
    try {
      const res = await fetch('/api/threat-intel/update', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
        body: JSON.stringify({ source: sourceId }),
      });
      if (res.ok) {
        const data = await res.json();
        setLastUpdate(`源 ${sourceId} 收集任务已提交`);
        // Poll for completion
        if (data.taskId) {
          setSyncTaskId(data.taskId);
        }
      } else {
        setLastUpdate(`收集失败`);
      }
    } catch {
      setLastUpdate('收集失败: 网络错误');
    } finally {
      setCollectingSource(null);
    }
  };

  const handleSaveApiKey = async (sourceId: string) => {
    const key = apiKeyInput[sourceId];
    if (!key) return;
    setSavingKey(sourceId);
    try {
      await fetch('/api/threat-intel/sources', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
        body: JSON.stringify({ sourceId, apiKey: key }),
      });
      setApiKeyInput(prev => {
        const next = { ...prev };
        delete next[sourceId];
        return next;
      });
      fetchSources();
    } catch {
      // ignore
    } finally {
      setSavingKey(null);
    }
  };

  // ──── Source stats (use allSources for accurate totals including query-only) ────
  const manualCount = allSources.reduce((acc, s) => acc + (s.id === 'manual' ? s.totalCount : 0), 0);
  const scanCount = allSources.reduce((acc, s) => acc + (s.id === 'scan' ? s.totalCount : 0), 0);
  const intelCount = allSources.reduce((acc, s) => acc + (s.id !== 'manual' && s.id !== 'scan' ? s.totalCount : 0), 0);

  const sourceTypeLabels: Record<string, string> = {
    domain: '域名',
    ip: 'IP',
    both: '域名+IP',
  };

  const sourceTypeColors: Record<string, string> = {
    domain: 'bg-blue-500/10 text-blue-600',
    ip: 'bg-orange-500/10 text-orange-600',
    both: 'bg-purple-500/10 text-purple-600',
  };

  const statusColors: Record<string, string> = {
    idle: 'text-muted-foreground',
    running: 'text-primary',
    completed: 'text-green-600',
    error: 'text-destructive',
  };
  const statusLabels: Record<string, string> = {
    idle: '空闲',
    running: '采集中',
    completed: '完成',
    error: '错误',
  };

  return (
    <div className="space-y-3 py-1">
      {/* Summary card */}
      <div className="rounded-lg border p-3">
        <div className="flex items-center justify-between mb-2">
          <div className="text-xs font-medium">数据概览</div>
        </div>
        <div className="grid grid-cols-3 gap-2">
          <div className="rounded-md bg-primary/5 border p-2 text-center">
            <div className="text-lg font-bold tabular-nums">{wsTotalCount > 0 ? wsTotalCount : domainTotal + ipTotal}</div>
            <div className="text-[10px] text-muted-foreground">总记录</div>
          </div>
          <div className="rounded-md bg-blue-500/5 border p-2 text-center">
            <div className="text-lg font-bold tabular-nums text-blue-600">{wsConnected && maliciousStats.domainCount > 0 ? maliciousStats.domainCount : domainTotal}</div>
            <div className="text-[10px] text-muted-foreground">恶意域名</div>
          </div>
          <div className="rounded-md bg-orange-500/5 border p-2 text-center">
            <div className="text-lg font-bold tabular-nums text-orange-600">{wsConnected && maliciousStats.ipCount > 0 ? maliciousStats.ipCount : ipTotal}</div>
            <div className="text-[10px] text-muted-foreground">恶意IP</div>
          </div>
        </div>
        {/* Source breakdown */}
        <div className="flex items-center gap-3 mt-2 text-[9px] text-muted-foreground">
          <span className="flex items-center gap-0.5"><Plus className="h-2.5 w-2.5" />手动: {manualCount}</span>
          <span className="flex items-center gap-0.5"><Search className="h-2.5 w-2.5" />扫描: {scanCount}</span>
          <span className="flex items-center gap-0.5"><Shield className="h-2.5 w-2.5" />情报: {intelCount}</span>
        </div>
        {lastUpdate && (
          <div className="text-[10px] text-green-600 mt-1.5 flex items-center gap-1">
            <CheckCircle2 className="h-3 w-3" />
            {lastUpdate}
          </div>
        )}
      </div>

      {/* Update command hint */}
      <div className="rounded-md border bg-muted/30 p-2.5">
        <div className="text-[10px] font-medium mb-1">💡 完整更新命令</div>
        <code className="text-[10px] font-mono bg-background px-2 py-1 rounded border block">
          bun scripts/seed-threat-intel.ts
        </code>
        <div className="text-[9px] text-muted-foreground mt-1">
          支持参数: --quick (快速模式) / --dry-run (试运行不写入)
        </div>
      </div>

      {/* Source list */}
      <div className="text-[10px] font-medium text-muted-foreground mb-1">可批量同步的情报源</div>
      <div className="text-[9px] text-muted-foreground/70 mb-1.5">
        仅展示可批量同步的情报源。仅查询类源（微步/VirusTotal/AbuseIPDB）因调用频率限制不适合批量抓取，请在「设置 → 情报源」中查询。
      </div>
      {loading ? (
        <div className="flex items-center justify-center py-6 text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin mr-1.5" />
          <span className="text-xs">加载中...</span>
        </div>
      ) : (
        <div className="space-y-1">
          {sources.map((source) => (
            <div
              key={source.id}
              className="rounded-md border px-2.5 py-2 flex items-center gap-2"
            >
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-1.5">
                  <span className="text-[11px] font-medium">{source.name}</span>
                  <Badge
                    variant="outline"
                    className={`text-[8px] px-1 py-0 ${sourceTypeColors[source.type] || ''}`}
                  >
                    {sourceTypeLabels[source.type] || source.type}
                  </Badge>
                  {/* Status badge */}
                  {source.status && source.status !== 'idle' && (
                    <Badge variant="outline" className={`text-[8px] px-1 py-0 ${statusColors[source.status] || ''}`}>
                      {statusLabels[source.status] || source.status}
                    </Badge>
                  )}
                  {/* API key indicator */}
                  {source.needsApiKey && (
                    <Badge variant="outline" className={`text-[8px] px-1 py-0 ${source.apiKeyConfigured ? 'border-green-500/50 text-green-600' : 'border-yellow-500/50 text-yellow-600'}`}>
                      <Key className="h-2 w-2 mr-0.5" />
                      {source.apiKeyConfigured ? '已配置' : '未配置'}
                    </Badge>
                  )}
                </div>
                <div className="text-[9px] text-muted-foreground mt-0.5">{source.description}</div>
                {/* Last update time */}
                {source.lastUpdated && (
                  <div className="text-[8px] text-muted-foreground flex items-center gap-0.5 mt-0.5">
                    <Clock className="h-2 w-2" />
                    更新: {new Date(source.lastUpdated).toLocaleString('zh-CN')}
                  </div>
                )}
                {/* API key input */}
                {source.needsApiKey && !source.apiKeyConfigured && (
                  <div className="flex items-center gap-1 mt-1">
                    <Input
                      placeholder="输入API Key..."
                      value={apiKeyInput[source.id] || ''}
                      onChange={(e) => setApiKeyInput(prev => ({ ...prev, [source.id]: e.target.value }))}
                      className="h-5 text-[9px] flex-1"
                      type="password"
                    />
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-5 text-[9px] px-1.5 shrink-0"
                      onClick={() => handleSaveApiKey(source.id)}
                      disabled={savingKey === source.id || !apiKeyInput[source.id]}
                    >
                      {savingKey === source.id ? <Loader2 className="h-2.5 w-2.5 animate-spin" /> : '保存'}
                    </Button>
                  </div>
                )}
              </div>
              <div className="shrink-0 text-right">
                <div className="text-xs font-bold tabular-nums">{source.totalCount}</div>
                <div className="text-[8px] text-muted-foreground">
                  {source.domainCount > 0 && `${source.domainCount}域`}
                  {source.domainCount > 0 && source.ipCount > 0 && '/'}
                  {source.ipCount > 0 && `${source.ipCount}IP`}
                </div>
              </div>
              {source.url && (
                <a
                  href={source.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="shrink-0 text-muted-foreground hover:text-foreground transition-colors"
                >
                  <ExternalLink className="h-3 w-3" />
                </a>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
