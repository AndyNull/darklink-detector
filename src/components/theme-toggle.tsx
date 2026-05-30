'use client';

import { useTheme } from 'next-themes';
import { Moon, Sun } from 'lucide-react';

export function ThemeToggle({ compact }: { compact?: boolean }) {
  const { theme, setTheme } = useTheme();

  return (
    <button
      onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
      aria-label="切换主题"
      className={`nav-button w-full flex items-center rounded-md text-[12px] font-medium text-muted-foreground ${
        compact ? 'justify-center px-1 py-2.5' : 'gap-2.5 px-2.5 py-2'
      }`}
    >
      <span className="relative inline-flex items-center justify-center h-4 w-4 shrink-0">
        <Sun className="h-4 w-4 rotate-0 scale-100 transition-all dark:-rotate-90 dark:scale-0" />
        <Moon className="absolute h-4 w-4 rotate-90 scale-0 transition-all dark:rotate-0 dark:scale-100" />
      </span>
      {!compact && <span className="truncate dark:hidden">浅色模式</span>}
      {!compact && <span className="truncate hidden dark:inline">深色模式</span>}
    </button>
  );
}
