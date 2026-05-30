'use client';

// ─── Types and Constants for DataSyncSection ────────────────────────────────

export const STATUS_LABELS: Record<string, { text: string; color: string }> = {
  idle: { text: '空闲', color: 'text-muted-foreground' },
  running: { text: '运行中', color: 'text-blue-600' },
  completed: { text: '已完成', color: 'text-green-600' },
  failed: { text: '失败', color: 'text-red-500' },
};

export function formatTime(isoStr: string | null): string {
  if (!isoStr) return '从未';
  try {
    const d = new Date(isoStr);
    return d.toLocaleString('zh-CN', {
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit',
    });
  } catch {
    return isoStr;
  }
}
