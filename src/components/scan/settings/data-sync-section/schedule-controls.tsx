'use client';

import React from 'react';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Clock,
  Loader2,
  RefreshCw,
  Info,
} from 'lucide-react';
import { ScheduleInfo } from '../types';
import { UPDATE_FREQUENCY_OPTIONS } from '@/lib/system-config';
import { STATUS_LABELS, formatTime } from './types';

export interface ScheduleControlsProps {
  autoUpdate: boolean;
  updateFrequency: string;
  schedule: ScheduleInfo | null;
  lastSyncTime: string | null;
  saving: boolean;
  onToggleAutoUpdate: (enabled: boolean) => void;
  onFrequencyChange: (freq: string) => void;
  onManualSync: () => void;
}

export function ScheduleControls({
  autoUpdate,
  updateFrequency,
  schedule,
  lastSyncTime,
  saving,
  onToggleAutoUpdate,
  onFrequencyChange,
  onManualSync,
}: ScheduleControlsProps) {
  return (
    <div className="space-y-2">
      <div className="flex items-center gap-1.5">
        <Clock className="h-3 w-3 text-muted-foreground shrink-0" />
        <span className="text-[11px] font-medium">同步设置</span>
      </div>

      {/* Auto Update */}
      <div className="rounded border px-3 py-2 space-y-2">
        <div className="flex items-center gap-1.5">
          <Clock className="h-3 w-3 text-muted-foreground shrink-0" />
          <span className="text-[11px] font-medium">自动更新</span>
          <span className="text-[9px] text-muted-foreground ml-1">定时同步威胁情报源数据</span>
        </div>
        <div className="flex items-center gap-2">
          <Switch
            checked={autoUpdate}
            onCheckedChange={onToggleAutoUpdate}
            className="scale-75 origin-left cursor-pointer"
          />
          <span className="text-[10px] text-muted-foreground">
            {autoUpdate ? '已启用' : '已关闭'}
          </span>
        </div>
      </div>

      {/* Update Frequency */}
      <div className="rounded border px-3 py-2 space-y-1.5">
        <div className="flex items-center gap-1.5">
          <RefreshCw className="h-3 w-3 text-muted-foreground shrink-0" />
          <span className="text-[11px] font-medium">更新频率</span>
        </div>
        <Select value={updateFrequency} onValueChange={onFrequencyChange}>
          <SelectTrigger className="h-8 text-xs">
            <SelectValue placeholder="选择更新频率" />
          </SelectTrigger>
          <SelectContent>
            {UPDATE_FREQUENCY_OPTIONS.map(opt => (
              <SelectItem key={opt.value} value={opt.value}>
                {opt.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* Schedule Status */}
      <div className="rounded border px-3 py-2 space-y-1.5">
        <div className="flex items-center gap-1.5">
          <Info className="h-3 w-3 text-muted-foreground shrink-0" />
          <span className="text-[11px] font-medium">调度状态</span>
        </div>
        <div className="space-y-1">
          <div className="flex items-center justify-between text-[10px]">
            <span className="text-muted-foreground">调度器状态</span>
            <span className={STATUS_LABELS[schedule?.status || 'idle']?.color || 'text-muted-foreground'}>
              {STATUS_LABELS[schedule?.status || 'idle']?.text || '未知'}
            </span>
          </div>
          <div className="flex items-center justify-between text-[10px]">
            <span className="text-muted-foreground">上次更新时间</span>
            <span className="tabular-nums">{formatTime(schedule?.lastRunAt || lastSyncTime)}</span>
          </div>
          <div className="flex items-center justify-between text-[10px]">
            <span className="text-muted-foreground">下次计划更新</span>
            <span className="tabular-nums">
              {schedule?.nextRunAt && autoUpdate ? formatTime(schedule.nextRunAt) : '-'}
            </span>
          </div>
        </div>
      </div>

      {/* Manual Sync */}
      <div className="rounded border px-3 py-2 space-y-1.5">
        <div className="flex items-center gap-1.5">
          <RefreshCw className="h-3 w-3 text-muted-foreground shrink-0" />
          <span className="text-[11px] font-medium">手动同步</span>
          <span className="text-[9px] text-muted-foreground ml-1">立即更新威胁情报数据</span>
        </div>
        <Button
          variant="outline"
          size="sm"
          className="h-8 text-[10px] gap-1 w-full"
          onClick={onManualSync}
          disabled={saving}
        >
          {saving ? (
            <Loader2 className="h-3 w-3 animate-spin" />
          ) : (
            <RefreshCw className="h-3 w-3" />
          )}
          立即同步
        </Button>
      </div>
    </div>
  );
}
