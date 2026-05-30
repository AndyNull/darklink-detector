'use client';

import React from 'react';
import { type QrCodeResult } from '@/lib/scan-store';
import { Button } from '@/components/ui/button';
import { Check, ClipboardList, QrCode } from 'lucide-react';
import { QrCodeCard } from './qr-code-card';

export interface QrCodesTabProps {
  qrCodes: QrCodeResult[];
  copiedUrl: string | null;
  onCopy: (url: string, e?: React.MouseEvent) => void;
  onBulkCopy: () => void;
}

export function QrCodesTab({ qrCodes, copiedUrl, onCopy, onBulkCopy }: QrCodesTabProps) {
  if (qrCodes.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-8 text-muted-foreground">
        <QrCode className="h-8 w-8 mb-2 text-muted-foreground/20" />
        <p className="text-xs">未检测到QR码</p>
        <p className="text-[10px] text-muted-foreground/60 mt-1">扫描发现的QR码将显示在这里</p>
      </div>
    );
  }

  return (
    <div className="space-y-1">
      {/* Bulk copy button */}
      {qrCodes.length > 1 && (
        <div className="flex justify-end mb-0.5">
          <Button
            variant="outline"
            size="sm"
            className="text-[9px] gap-0.5 h-5 px-1.5"
            onClick={onBulkCopy}
          >
            {copiedUrl === '__bulk_qr__' ? (
              <Check className="h-2.5 w-2.5 text-green-600" />
            ) : (
              <ClipboardList className="h-2.5 w-2.5" />
            )}
            {copiedUrl === '__bulk_qr__' ? '已复制' : `复制全部(${qrCodes.length})`}
          </Button>
        </div>
      )}
      {qrCodes.map((qr, i) => (
        <QrCodeCard key={`${qr.decodedText}-${i}`} qr={qr} onCopy={onCopy} copiedUrl={copiedUrl} />
      ))}
    </div>
  );
}
