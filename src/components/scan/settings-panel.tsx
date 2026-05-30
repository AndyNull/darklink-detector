'use client';

import React, { useState, useEffect, Suspense } from 'react';
import { Button } from '@/components/ui/button';
import {
  Settings,
  X,
  Loader2,
} from 'lucide-react';
import { useIsMobile } from '@/hooks/use-mobile';
import { useDataSyncStore } from '@/lib/data-sync-store';
import { SettingsCategory, SIDEBAR_ITEMS } from './settings/types';

// Lazy-loaded section components for code splitting
const SystemSettingsSection = React.lazy(() =>
  import('./settings/system-settings-section').then(m => ({ default: m.SystemSettingsSection }))
);
const EngineSection = React.lazy(() =>
  import('./settings/engine-section').then(m => ({ default: m.EngineSection }))
);
const DataSyncSection = React.lazy(() =>
  import('./settings/data-sync-section').then(m => ({ default: m.DataSyncSection }))
);
const SyncProgressSection = React.lazy(() =>
  import('./settings/sync-progress-section').then(m => ({ default: m.SyncProgressSection }))
);
const DetectionRulesSection = React.lazy(() =>
  import('./settings/detection-rules-section').then(m => ({ default: m.DetectionRulesSection }))
);
const DatabaseConfigSection = React.lazy(() =>
  import('./settings/database-config-section').then(m => ({ default: m.DatabaseConfigSection }))
);
const AccountManagementSection = React.lazy(() =>
  import('./settings/account-section').then(m => ({ default: m.AccountManagementSection }))
);
const LogsSection = React.lazy(() =>
  import('./settings/logs-section').then(m => ({ default: m.LogsSection }))
);

// Loading fallback for lazy sections
function SectionLoadingFallback() {
  return (
    <div className="flex items-center justify-center py-6 text-muted-foreground">
      <Loader2 className="h-4 w-4 animate-spin mr-1.5" />
      <span className="text-xs">加载中...</span>
    </div>
  );
}

export function SettingsPanel({ onClose }: { onClose: () => void }) {
  const [activeCategory, setActiveCategory] = useState<SettingsCategory>('system');
  const isMobile = useIsMobile();

  // Initialize data-sync store when settings panel opens
  useEffect(() => {
    const dataSync = useDataSyncStore.getState();
    if (!dataSync.initialized) {
      dataSync.init();
    }
    // Do NOT destroy the store on unmount — the store has its own lifecycle
    // management and polling is lightweight when idle (30s interval). Destroying
    // it here causes users to lose visibility into running sync tasks when they
    // navigate away from Settings.
  }, []);

  const renderContent = () => {
    const content = (() => {
      switch (activeCategory) {
        case 'system':
          return <SystemSettingsSection />;
        case 'engine':
          return <EngineSection />;
        case 'data-sync':
          return <DataSyncSection />;
        case 'sync-progress':
          return <SyncProgressSection />;
        case 'detection-rules':
          return <DetectionRulesSection />;
        case 'database':
          return <DatabaseConfigSection />;
        case 'account':
          return <AccountManagementSection />;
        case 'logs':
          return <LogsSection />;
        default:
          return null;
      }
    })();
    return <Suspense fallback={<SectionLoadingFallback />}>{content}</Suspense>;
  };

  // Mobile: use horizontal scrollable tabs at top, then content below
  if (isMobile) {
    return (
      <div className="flex flex-col h-full overflow-hidden">
        {/* Header */}
        <div className="h-10 px-3 border-b flex items-center gap-2 shrink-0">
          <Settings className="h-3.5 w-3.5 text-muted-foreground" />
          <span className="text-xs font-medium">设置</span>
          <Button
            variant="ghost"
            size="sm"
            className="h-6 w-6 p-0 ml-auto cursor-pointer transition-colors hover:bg-accent hover:text-accent-foreground"
            onClick={onClose}
          >
            <X className="h-3.5 w-3.5" />
          </Button>
        </div>

        {/* Mobile: horizontal scrollable category tabs */}
        <div className="shrink-0 border-b overflow-x-auto">
          <div className="flex items-center px-2 py-1 gap-0.5 min-w-max">
            {SIDEBAR_ITEMS.map(({ key, icon: ItemIcon, label }) => (
              <button
                key={key}
                onClick={() => setActiveCategory(key)}
                className={`flex items-center gap-1 px-2.5 py-1.5 rounded-md text-[11px] font-medium transition-all duration-150 ease-out whitespace-nowrap ${
                  activeCategory === key
                    ? 'bg-accent text-accent-foreground'
                    : 'text-muted-foreground hover:bg-accent/60 hover:text-foreground active:bg-accent active:text-accent-foreground'
                }`}
              >
                <ItemIcon className="h-3 w-3 shrink-0" />
                {label}
              </button>
            ))}
          </div>
        </div>

        {/* Content */}
        <div className="flex-1 min-h-0 overflow-y-auto px-3 py-2">
          {renderContent()}
        </div>
      </div>
    );
  }

  // Desktop: left sidebar + right content
  return (
    <div className="flex h-full overflow-hidden">
      {/* Left Sidebar */}
      <aside className="w-[150px] shrink-0 border-r bg-card/50 flex flex-col">
        {/* Header */}
        <div className="h-10 px-3 border-b flex items-center gap-2 shrink-0">
          <Settings className="h-3.5 w-3.5 text-muted-foreground" />
          <span className="text-xs font-medium">设置</span>
          <Button
            variant="ghost"
            size="sm"
            className="h-6 w-6 p-0 ml-auto cursor-pointer transition-colors hover:bg-accent hover:text-accent-foreground"
            onClick={onClose}
          >
            <X className="h-3.5 w-3.5" />
          </Button>
        </div>

        {/* Category List */}
        <nav className="flex-1 py-2 px-2 space-y-0.5">
          {SIDEBAR_ITEMS.map(({ key, icon: NavIcon, label }) => (
            <button
              key={key}
              onClick={() => setActiveCategory(key)}
              className={`w-full flex items-center gap-2 px-2.5 py-2 rounded-md text-[11px] font-medium transition-all duration-150 ease-out ${
                activeCategory === key
                  ? 'bg-accent text-accent-foreground'
                  : 'text-muted-foreground hover:bg-accent/60 hover:text-foreground active:bg-accent active:text-accent-foreground'
              }`}
            >
              <NavIcon className="h-3.5 w-3.5 shrink-0" />
              <span>{label}</span>
            </button>
          ))}
        </nav>
      </aside>

      {/* Right Content Area */}
      <div className="flex-1 min-w-0 flex flex-col overflow-hidden">
        {/* Content Header */}
        <div className="h-10 px-4 border-b flex items-center gap-2 shrink-0">
          {(() => {
            const item = SIDEBAR_ITEMS.find(i => i.key === activeCategory);
            if (!item) return null;
            const Icon = item.icon;
            return (
              <>
                <Icon className="h-3.5 w-3.5 text-muted-foreground" />
                <span className="text-xs font-medium">{item.label}</span>
              </>
            );
          })()}
        </div>

        {/* Content Body */}
        <div className="flex-1 min-h-0 overflow-y-auto px-4 py-3">
          {renderContent()}
        </div>
      </div>
    </div>
  );
}
