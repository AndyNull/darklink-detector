'use client';

import React, { useState } from 'react';
import { type QrCodeResult } from '@/lib/scan-store';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import {
  QrCode,
  AlertCircle,
  Check,
  Copy,
} from 'lucide-react';

// ──── QR Code Card with inline thumbnail ────
export const QrCodeCard = React.memo(function QrCodeCard({ qr, onCopy, copiedUrl }: {
  qr: QrCodeResult;
  onCopy: (url: string, e?: React.MouseEvent) => void;
  copiedUrl: string | null;
}) {
  const [showImage, setShowImage] = useState(false);

  return (
    <>
      <div
        className={`rounded-md border p-1.5 cursor-pointer transition-all duration-150 ease-out hover:bg-accent/40 active:bg-accent/60 ${qr.isSuspicious ? 'bg-destructive/5 border-destructive/30' : ''}`}
        onClick={() => setShowImage(true)}
      >
        <div className="flex items-center gap-1 mb-0.5">
          {/* Inline QR thumbnail */}
          {qr.qrImageBase64 ? (
            <img
              src={qr.qrImageBase64}
              alt="QR缩略图"
              className="h-5 w-5 rounded border shrink-0 object-contain bg-white"
              onClick={(e) => { e.stopPropagation(); setShowImage(true); }}
            />
          ) : (
            <QrCode className="h-2.5 w-2.5 shrink-0" />
          )}
          {qr.isSuspicious && (
            <Badge variant="destructive" className="text-[8px] px-1 py-0">可疑</Badge>
          )}
          {qr.qrImageBase64 && !qr.isSuspicious && (
            <Badge variant="outline" className="text-[8px] px-1 py-0">点击查看原图</Badge>
          )}
          <Button
            variant="ghost"
            size="sm"
            className="h-3.5 w-3.5 p-0 ml-auto shrink-0"
            onClick={(e) => { e.stopPropagation(); onCopy(qr.decodedText, e); }}
          >
            {copiedUrl === qr.decodedText ? (
              <Check className="h-2 w-2 text-green-600" />
            ) : (
              <Copy className="h-2 w-2" />
            )}
          </Button>
        </div>
        <div className="text-[10px] font-mono truncate" title={qr.decodedText}>{qr.decodedText}</div>
        {qr.reason && (
          <div className="text-[9px] text-destructive mt-0.5">{qr.reason}</div>
        )}
      </div>

      {/* QR Image Popup Dialog */}
      <Dialog open={showImage} onOpenChange={setShowImage}>
        <DialogContent className="sm:max-w-[420px] max-w-[calc(100vw-2rem)] p-4">
          <DialogHeader>
            <DialogTitle className="text-sm flex items-center gap-1.5">
              <QrCode className="h-4 w-4" />
              QR码原始图片
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            {qr.qrImageBase64 ? (
              <div className="flex justify-center items-center bg-muted/30 rounded-md p-4 w-full aspect-square max-w-[360px] mx-auto overflow-hidden">
                <img
                  src={qr.qrImageBase64}
                  alt="QR码原始图片"
                  className="w-full h-full object-contain rounded"
                />
              </div>
            ) : (
              <div className="flex flex-col justify-center items-center bg-muted/30 rounded-md p-4 w-full aspect-square max-w-[360px] mx-auto">
                <p className="text-muted-foreground text-xs">原始图片数据不可用</p>
                {qr.sourceUrl && (
                  <a
                    href={qr.sourceUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-primary hover:underline break-all text-[10px] mt-1 inline-block text-center"
                  >
                    点击查看来源图片 →
                  </a>
                )}
              </div>
            )}
            <div className="space-y-1">
              <div className="text-[10px] text-muted-foreground">解码内容:</div>
              <div className="text-[11px] font-mono break-all bg-muted/30 rounded p-2 max-h-[80px] overflow-y-auto custom-scrollbar">{qr.decodedText}</div>
            </div>
            {qr.sourceUrl && (
              <div className="space-y-1">
                <div className="text-[10px] text-muted-foreground">来源图片URL:</div>
                <div className="text-[10px] font-mono break-all" title={qr.sourceUrl}>{qr.sourceUrl}</div>
              </div>
            )}
            {qr.reason && (
              <div className="text-[9px] text-destructive flex items-center gap-1">
                <AlertCircle className="h-3 w-3 shrink-0" />
                {qr.reason}
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
});
