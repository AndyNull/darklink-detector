'use client';

import React, { useState } from 'react';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  ArrowRightLeft,
  Loader2,
  AlertTriangle,
  CheckCircle2,
  Download,
  Database,
  HardDrive,
} from 'lucide-react';
import { MigrationResult } from './types';

export type ExportFormat = 'sqlite' | 'mysql' | 'postgresql';

export interface MigrationControlsProps {
  exporting: boolean;
  migrationResult: MigrationResult | null;
  onExport: (format: ExportFormat) => void;
}

const FORMAT_OPTIONS: { value: ExportFormat; label: string; description: string }[] = [
  { value: 'sqlite', label: 'SQLite', description: '原生数据库文件' },
  { value: 'mysql', label: 'MySQL SQL', description: 'MySQL建表+插入语句' },
  { value: 'postgresql', label: 'PostgreSQL SQL', description: 'PostgreSQL建表+插入语句' },
];

export function MigrationControls({
  exporting,
  migrationResult,
  onExport,
}: MigrationControlsProps) {
  const [exportFormat, setExportFormat] = useState<ExportFormat>('sqlite');

  return (
    <div className="space-y-2 pt-2">
      <div className="flex items-center gap-1.5">
        <ArrowRightLeft className="h-3 w-3 text-muted-foreground shrink-0" />
        <span className="text-[11px] font-medium">数据迁移</span>
      </div>

      {/* Warning */}
      <div className="rounded border border-yellow-500/30 bg-yellow-500/5 px-3 py-2 space-y-1">
        <div className="flex items-center gap-1 text-[10px] text-yellow-600">
          <AlertTriangle className="h-3 w-3 shrink-0" />
          <span className="font-medium">注意事项</span>
        </div>
        <ul className="text-[9px] text-yellow-700 space-y-0.5 ml-4 list-disc">
          <li>切换数据库类型需要修改配置文件并重启服务</li>
          <li>建议先导出当前数据作为备份</li>
          <li>导入操作会向当前数据库写入数据，已有记录会跳过（不会覆盖）</li>
          <li>迁移前请确保目标数据库已正确配置并可连接</li>
        </ul>
      </div>

      {/* Export */}
      <div className="rounded border px-3 py-2 space-y-1.5">
        <div className="flex items-center gap-1.5">
          <Download className="h-3 w-3 text-muted-foreground shrink-0" />
          <span className="text-[11px] font-medium">导出数据</span>
        </div>

        {/* Format selector */}
        <div className="space-y-1">
          <div className="flex items-center gap-1.5">
            {exportFormat === 'sqlite' ? (
              <HardDrive className="h-3 w-3 text-muted-foreground shrink-0" />
            ) : (
              <Database className="h-3 w-3 text-muted-foreground shrink-0" />
            )}
            <span className="text-[10px] text-muted-foreground">导出格式</span>
          </div>
          <Select value={exportFormat} onValueChange={(val: ExportFormat) => setExportFormat(val)}>
            <SelectTrigger className="h-7 text-[10px] w-full">
              <SelectValue placeholder="选择导出格式" />
            </SelectTrigger>
            <SelectContent>
              {FORMAT_OPTIONS.map(opt => (
                <SelectItem key={opt.value} value={opt.value}>
                  <span className="text-xs">{opt.label}</span>
                  <span className="text-[9px] text-muted-foreground ml-1">- {opt.description}</span>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="text-[9px] text-muted-foreground">
          {exportFormat === 'sqlite'
            ? '直接下载SQLite数据库文件（原生格式）'
            : exportFormat === 'mysql'
              ? '生成MySQL兼容的CREATE TABLE + INSERT语句'
              : '生成PostgreSQL兼容的CREATE TABLE + INSERT语句'
          }
        </div>

        <Button
          variant="outline"
          size="sm"
          className="h-7 text-[10px] gap-1 w-full"
          onClick={() => onExport(exportFormat)}
          disabled={exporting}
        >
          {exporting ? <Loader2 className="h-3 w-3 animate-spin" /> : <Download className="h-3 w-3" />}
          导出当前数据库
        </Button>
      </div>

      {/* Migration Result */}
      {migrationResult && (
        <div className={`rounded border px-3 py-2 flex items-center gap-1.5 text-[11px] ${
          migrationResult.success ? 'border-green-500/30 bg-green-500/5 text-green-600' : 'border-red-500/30 bg-red-500/5 text-red-500'
        }`}>
          {migrationResult.success ? (
            <CheckCircle2 className="h-3.5 w-3.5 shrink-0" />
          ) : (
            <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
          )}
          {migrationResult.message}
        </div>
      )}
    </div>
  );
}
