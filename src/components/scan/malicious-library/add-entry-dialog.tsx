'use client';

import React, { useState, useCallback, useEffect } from 'react';
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
import { ShieldAlert, Loader2, AlertTriangle } from 'lucide-react';
import { IP_REGEX } from '@/lib/constants';
import { getAuthHeaders } from '@/lib/auth-context';

export function AddEntryDialog({
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
