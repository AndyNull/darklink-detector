'use client';

import React from 'react';

// ─── Log text highlighting constants and utilities ──────────────────────────

export const RESULT_INDICATORS = [
  '深度扫描完成', 'QR码检测完成', '扫描完成',
  'HTML解析完成', '外部JS分析完成', '外部CSS分析完成',
  '发现外部资源', '发现\d+个图片URL', 'QR码检测:',
  '发现\d+个QR码', 'data URI中发现', 'HTTP图片中发现',
];

export const RESULT_REGEX = new RegExp(RESULT_INDICATORS.join('|'));

export function isResultLog(msg: string): boolean {
  return RESULT_REGEX.test(msg);
}

// Split text around URLs: URL parts stay default, non-URL parts get sky-blue
export function renderResultText(text: string, colorClass: string): React.ReactNode[] {
  const urlPattern = /https?:\/\/[^\s,，)\]]+/g;
  const parts: React.ReactNode[] = [];
  let last = 0;
  let m: RegExpExecArray | null;

  while ((m = urlPattern.exec(text)) !== null) {
    // Text before URL → colored
    if (m.index > last) {
      parts.push(<span key={`t-${m.index}`} className={colorClass}>{text.slice(last, m.index)}</span>);
    }
    // URL itself → default color
    parts.push(<span key={`u-${m.index}`}>{m[0]}</span>);
    last = urlPattern.lastIndex;
  }
  // Remaining text after last URL → colored
  if (last < text.length) {
    parts.push(<span key={`e-${last}`} className={colorClass}>{text.slice(last)}</span>);
  }
  // No URLs at all → fully colored
  if (parts.length === 0) {
    parts.push(<span key="full" className={colorClass}>{text}</span>);
  }
  return parts;
}

export function formatTime(timestamp: number): string {
  const d = new Date(timestamp);
  return d.toLocaleString('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });
}

export function truncateUrl(url: string, maxLen: number): string {
  if (url.length <= maxLen) return url;
  return url.substring(0, maxLen - 3) + '...';
}
