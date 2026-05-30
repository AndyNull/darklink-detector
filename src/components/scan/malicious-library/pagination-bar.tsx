'use client';

import React, { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { ChevronLeft, ChevronRight } from 'lucide-react';

// Compact pagination bar with prev/next + inline page input
export function PaginationBar({
  current,
  total,
  totalCount,
  pageSize,
  loading,
  onGoTo,
}: {
  current: number;
  total: number;
  totalCount: number;
  pageSize: number;
  loading: boolean;
  onGoTo: (page: number) => void;
}) {
  const [inputVal, setInputVal] = useState(String(current));

  // Sync input when current page changes externally
  useEffect(() => {
    setInputVal(String(current));
  }, [current]);

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const v = e.target.value;
    // Allow only digits
    if (v === '' || /^\d+$/.test(v)) {
      setInputVal(v);
    }
  };

  const handleInputCommit = () => {
    const num = parseInt(inputVal, 10);
    if (!isNaN(num) && num >= 1 && num <= total) {
      onGoTo(num);
    } else {
      setInputVal(String(current)); // revert
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      handleInputCommit();
      (e.target as HTMLInputElement).blur();
    } else if (e.key === 'Escape') {
      setInputVal(String(current));
      (e.target as HTMLInputElement).blur();
    }
  };

  const startItem = (current - 1) * pageSize + 1;
  const endItem = Math.min(current * pageSize, totalCount);

  return (
    <div className="shrink-0 border-t px-3 py-1.5 flex items-center justify-between gap-2">
      <span className="text-[10px] text-muted-foreground tabular-nums shrink-0">
        {startItem}-{endItem} / {totalCount}
      </span>
      <div className="flex items-center gap-1">
        <Button
          variant="ghost"
          size="sm"
          className="h-6 w-6 p-0"
          disabled={current <= 1 || loading}
          onClick={() => onGoTo(current - 1)}
        >
          <ChevronLeft className="h-3.5 w-3.5" />
        </Button>
        <div className="flex items-center gap-0.5 text-[11px]">
          <input
            type="text"
            value={inputVal}
            onChange={handleInputChange}
            onBlur={handleInputCommit}
            onKeyDown={handleKeyDown}
            className="h-6 w-8 text-center rounded border bg-background text-[11px] tabular-nums focus:outline-none focus:ring-1 focus:ring-ring px-0.5"
            disabled={loading}
          />
          <span className="text-muted-foreground">/</span>
          <span className="tabular-nums text-muted-foreground">{total}</span>
        </div>
        <Button
          variant="ghost"
          size="sm"
          className="h-6 w-6 p-0"
          disabled={current >= total || loading}
          onClick={() => onGoTo(current + 1)}
        >
          <ChevronRight className="h-3.5 w-3.5" />
        </Button>
      </div>
    </div>
  );
}
