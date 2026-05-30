'use client';

import { useState } from 'react';
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
} from '@/components/ui/dialog';
import {
  Ban,
  Plus,
  Loader2,
} from 'lucide-react';

interface AddEntryDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onAdded: () => void;
}

export function AddEntryDialog({ open, onOpenChange, onAdded }: AddEntryDialogProps) {
  const [addType, setAddType] = useState<'ip' | 'domain'>('domain');
  const [addValue, setAddValue] = useState('');
  const [addSeverity, setAddSeverity] = useState('high');
  const [addReason, setAddReason] = useState('');
  const [adding, setAdding] = useState(false);

  const handleAdd = async () => {
    if (!addValue.trim()) return;
    setAdding(true);
    try {
      const res = await fetch('/api/malicious?action=add', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: addType,
          value: addValue.trim(),
          severity: addSeverity,
          reason: addReason.trim() || undefined,
          source: 'manual',
        }),
      });
      if (res.ok) {
        onOpenChange(false);
        setAddValue('');
        setAddReason('');
        setAddSeverity('high');
        onAdded();
      }
    } catch {
      // ignore
    } finally {
      setAdding(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="text-sm flex items-center gap-2">
            <Ban className="h-4 w-4 text-destructive" />
            添加恶意条目
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-3 p-1">
          {/* Type selector */}
          <div className="flex items-center gap-2">
            <span className="text-xs text-muted-foreground w-12">类型</span>
            <Select value={addType} onValueChange={(v: any) => setAddType(v)}>
              <SelectTrigger size="sm" className="w-[100px] text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="domain">域名</SelectItem>
                <SelectItem value="ip">IP地址</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* Value input */}
          <div className="flex items-center gap-2">
            <span className="text-xs text-muted-foreground w-12">{addType === 'ip' ? 'IP' : '域名'}</span>
            <Input
              placeholder={addType === 'ip' ? '例如: 1.2.3.4' : '例如: evil.example.com'}
              value={addValue}
              onChange={(e) => setAddValue(e.target.value)}
              className="h-8 text-xs"
            />
          </div>

          {/* Severity */}
          <div className="flex items-center gap-2">
            <span className="text-xs text-muted-foreground w-12">严重性</span>
            <Select value={addSeverity} onValueChange={setAddSeverity}>
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

          {/* Reason */}
          <div className="flex items-center gap-2">
            <span className="text-xs text-muted-foreground w-12">原因</span>
            <Input
              placeholder="标记原因..."
              value={addReason}
              onChange={(e) => setAddReason(e.target.value)}
              className="h-8 text-xs"
            />
          </div>

          <Button
            className="w-full h-8 text-xs gap-1"
            onClick={handleAdd}
            disabled={adding || !addValue.trim()}
          >
            {adding ? (
              <Loader2 className="h-3 w-3 animate-spin" />
            ) : (
              <Plus className="h-3 w-3" />
            )}
            添加到恶意库
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
