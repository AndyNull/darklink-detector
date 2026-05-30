'use client';

import React, { useState, useCallback, useEffect, useRef } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from '@/components/ui/dialog';
import { FileUp, File, Download, Loader2, AlertTriangle, CheckCircle2 } from 'lucide-react';
import { getAuthHeaders } from '@/lib/auth-context';

export function BatchImportDialog({
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
