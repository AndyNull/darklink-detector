'use client';

import React from 'react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import {
  Loader2,
  AlertTriangle,
  Upload,
} from 'lucide-react';

export interface ImportControlsProps {
  importing: boolean;
  importFile: File | null;
  showMigrationConfirm: boolean;
  onFileChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
  onShowMigrationConfirm: (show: boolean) => void;
  onImport: () => void;
}

export function ImportControls({
  importing,
  importFile,
  showMigrationConfirm,
  onFileChange,
  onShowMigrationConfirm,
  onImport,
}: ImportControlsProps) {
  return (
    <>
      {/* Import */}
      <div className="rounded border px-3 py-2 space-y-1.5">
        <div className="flex items-center gap-1.5">
          <Upload className="h-3 w-3 text-muted-foreground shrink-0" />
          <span className="text-[11px] font-medium">导入数据</span>
          <span className="text-[9px] text-muted-foreground ml-1">从JSON文件恢复数据到当前数据库</span>
        </div>
        <div className="flex items-center gap-1.5">
          <input
            id="import-file-input"
            type="file"
            accept=".json"
            onChange={onFileChange}
            className="text-[10px] file:mr-1.5 file:py-1 file:px-2 file:rounded file:border-0 file:text-[10px] file:font-medium file:bg-muted file:text-muted-foreground hover:file:bg-muted/80 file:cursor-pointer w-full"
          />
        </div>
        {importFile && (
          <div className="flex items-center gap-1.5">
            <span className="text-[9px] text-muted-foreground truncate flex-1">
              已选择: {importFile.name} ({(importFile.size / 1024).toFixed(1)} KB)
            </span>
            <Button
              variant="default"
              size="sm"
              className="h-7 text-[10px] gap-1 shrink-0"
              onClick={() => onShowMigrationConfirm(true)}
              disabled={importing}
            >
              {importing ? <Loader2 className="h-3 w-3 animate-spin" /> : <Upload className="h-3 w-3" />}
              导入
            </Button>
          </div>
        )}
      </div>

      {/* Migration Confirm Dialog */}
      <Dialog open={showMigrationConfirm} onOpenChange={onShowMigrationConfirm}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-base">
              <AlertTriangle className="h-5 w-5 text-yellow-600" />
              确认导入数据
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-2 text-sm">
            <p>
              确定要将文件 <span className="font-medium">{importFile?.name}</span> 中的数据导入到当前数据库吗？
            </p>
            <div className="rounded border border-yellow-500/30 bg-yellow-500/5 px-3 py-2 text-xs text-yellow-700 space-y-1">
              <p>• 已存在的记录将被跳过（不会覆盖）</p>
              <p>• 导入过程中请勿关闭页面</p>
              <p>• 建议先导出备份当前数据</p>
            </div>
          </div>
          <DialogFooter className="gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => onShowMigrationConfirm(false)}
              disabled={importing}
            >
              取消
            </Button>
            <Button
              size="sm"
              onClick={() => {
                onShowMigrationConfirm(false);
                onImport();
              }}
              disabled={importing}
            >
              {importing ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" /> : null}
              确认导入
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
