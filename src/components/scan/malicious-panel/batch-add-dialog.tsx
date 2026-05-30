'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Textarea } from '@/components/ui/textarea';
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
} from '@/components/ui/dialog';
import {
  Upload,
  Loader2,
  CheckCircle2,
} from 'lucide-react';
import { IP_REGEX } from './types';

interface BatchAddDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onImported: () => void;
}

export function BatchAddDialog({ open, onOpenChange, onImported }: BatchAddDialogProps) {
  const [importText, setImportText] = useState('');
  const [importSeverity, setImportSeverity] = useState('high');
  const [importing, setImporting] = useState(false);
  const [importResult, setImportResult] = useState<{ added: number; total: number; errors: number } | null>(null);

  // Parse import text for preview
  const importLines = importText.trim().split('\n').map(l => l.trim()).filter(l => l);
  const importIPCount = importLines.filter(l => IP_REGEX.test(l)).length;
  const importDomainCount = importLines.length - importIPCount;

  const handleBatchImport = async () => {
    if (!importText.trim()) return;
    setImporting(true);
    setImportResult(null);

    const lines = importText.trim().split('\n').map(l => l.trim()).filter(l => l);
    const items = lines.map(line => {
      const isIP = IP_REGEX.test(line);
      return { type: isIP ? 'ip' : 'domain', value: line };
    });

    try {
      const res = await fetch('/api/malicious?action=batch-add', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          items,
          severity: importSeverity,
          source: 'batch-import',
        }),
      });
      if (res.ok) {
        const data = await res.json();
        const errors = data.results?.filter((r: any) => r.status !== 'added').length || 0;
        setImportResult({ added: data.added, total: data.total, errors });
        onImported();
      }
    } catch {
      setImportResult({ added: 0, total: items.length, errors: items.length });
    } finally {
      setImporting(false);
    }
  };

  const handleOpenChange = (open: boolean) => {
    if (!open) {
      onOpenChange(false);
      setImportText('');
      setImportResult(null);
    } else {
      onOpenChange(true);
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="text-sm flex items-center gap-2">
            <Upload className="h-4 w-4" />
            批量导入
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-3 p-1">
          {/* Instructions */}
          <div className="text-[10px] text-muted-foreground bg-muted/50 rounded-md px-3 py-2">
            每行一个IP或域名，系统将自动识别类型。
            <br />
            示例: <code className="text-[9px]">1.2.3.4</code> → IP &nbsp; <code className="text-[9px]">evil.com</code> → 域名
          </div>

          {/* Textarea */}
          <Textarea
            placeholder={"1.2.3.4\nevil.example.com\nmalware.site.org"}
            value={importText}
            onChange={(e) => { setImportText(e.target.value); setImportResult(null); }}
            className="h-32 text-xs font-mono"
          />

          {/* Preview stats */}
          {importLines.length > 0 && (
            <div className="flex items-center gap-2 text-[10px]">
              <span className="text-muted-foreground">
                识别: {importIPCount} IP, {importDomainCount} 域名, 共 {importLines.length} 条
              </span>
            </div>
          )}

          {/* Default severity */}
          <div className="flex items-center gap-2">
            <span className="text-xs text-muted-foreground">默认严重性</span>
            <Select value={importSeverity} onValueChange={setImportSeverity}>
              <SelectTrigger size="sm" className="w-[100px] text-xs">
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

          {/* Import result */}
          {importResult && (
            <div className={`text-[10px] rounded-md px-3 py-2 ${
              importResult.errors > 0
                ? 'bg-yellow-500/10 text-yellow-700 border border-yellow-500/20'
                : 'bg-green-500/10 text-green-700 border border-green-500/20'
            }`}>
              <div className="flex items-center gap-1">
                <CheckCircle2 className="h-3 w-3" />
                成功导入 {importResult.added}/{importResult.total} 条
              </div>
              {importResult.errors > 0 && (
                <div className="mt-0.5">{importResult.errors} 条跳过（格式无效或已存在）</div>
              )}
            </div>
          )}

          <Button
            className="w-full h-8 text-xs gap-1"
            onClick={handleBatchImport}
            disabled={importing || importLines.length === 0}
          >
            {importing ? (
              <Loader2 className="h-3 w-3 animate-spin" />
            ) : (
              <Upload className="h-3 w-3" />
            )}
            导入 {importLines.length > 0 ? `(${importLines.length}条)` : ''}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
