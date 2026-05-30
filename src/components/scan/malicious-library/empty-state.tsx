'use client';

import React from 'react';
import { Globe, Server } from 'lucide-react';

export function EmptyState({ type }: { type: 'domain' | 'ip' }) {
  return (
    <div className="text-center text-muted-foreground py-6">
      {type === 'domain' ? (
        <Globe className="h-5 w-5 mx-auto mb-1.5 opacity-20" />
      ) : (
        <Server className="h-5 w-5 mx-auto mb-1.5 opacity-20" />
      )}
      <p className="text-xs">暂无{type === 'domain' ? '域名' : 'IP'}记录</p>
      <p className="text-[10px] mt-0.5">点击右上角添加</p>
    </div>
  );
}
