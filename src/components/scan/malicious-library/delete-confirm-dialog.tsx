'use client';

import React from 'react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from '@/components/ui/dialog';
import { AlertTriangle, Loader2 } from 'lucide-react';

export function DeleteConfirmDialog({
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
