'use client';

import React, { useState, useCallback, useEffect, useRef } from 'react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  Database,
  Plus,
  RefreshCw,
  Loader2,
  Globe,
  MapPin,
  Download,
  Upload,
} from 'lucide-react';
import { MaliciousEntry, MaliciousStats } from './types';
import { StatsSection } from './stats-section';
import { EntryList } from './entry-list';
import { useDataSyncStore } from '@/lib/data-sync-store';

// Lazy-load dialog components for code splitting
const AddEntryDialog = React.lazy(() =>
  import('./add-entry-dialog').then((mod) => ({ default: mod.AddEntryDialog }))
);
const BatchAddDialog = React.lazy(() =>
  import('./batch-add-dialog').then((mod) => ({ default: mod.BatchAddDialog }))
);

export function MaliciousPanel() {
  const [entries, setEntries] = useState<MaliciousEntry[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [typeFilter, setTypeFilter] = useState<string>('all');
  const [stats, setStats] = useState<MaliciousStats | null>(null);

  // Add dialog state
  const [showAddDialog, setShowAddDialog] = useState(false);

  // Batch import dialog state
  const [showImportDialog, setShowImportDialog] = useState(false);

  // Batch delete state
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [batchDeleting, setBatchDeleting] = useState(false);

  // Delete state
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const dataSync = useDataSyncStore();
  const { maliciousStats } = dataSync;

  // Use ref to track if initial load has been done to prevent duplicate requests
  const initialLoadDone = useRef(false);
  // Use ref to track the latest filter values without causing re-renders
  const typeFilterRef = useRef(typeFilter);
  const searchQueryRef = useRef(searchQuery);

  // Keep refs in sync with state
  useEffect(() => {
    typeFilterRef.current = typeFilter;
  }, [typeFilter]);
  useEffect(() => {
    searchQueryRef.current = searchQuery;
  }, [searchQuery]);

  // Initialize data-sync store for malicious stats (only once)
  useEffect(() => {
    if (!dataSync.initialized) {
      dataSync.init();
    }
  }, [dataSync]);

  // Sync maliciousStats from store to local stats state
  useEffect(() => {
    if (maliciousStats.domainCount > 0 || maliciousStats.ipCount > 0) {
      setStats({
        total: maliciousStats.domainCount + maliciousStats.ipCount,
        active: maliciousStats.domainCount + maliciousStats.ipCount,
        bySeverity: { critical: 0, high: 0, medium: 0, low: 0 },
        byType: { ip: maliciousStats.ipCount, domain: maliciousStats.domainCount },
      });
    }
  }, [maliciousStats]);

  // Core data fetching function - domain and IP each once
  const fetchAllEntries = useCallback(async (type?: string, search?: string) => {
    setLoading(true);
    try {
      const effectiveType = type || typeFilterRef.current;
      const effectiveSearch = search || searchQueryRef.current;

      // Fetch domain and IP entries in parallel (2 requests max)
      const fetchPromises: Promise<{ items: any[]; total: number }>[] = [];

      if (effectiveType === 'all' || effectiveType === 'domain') {
        const domainParams = new URLSearchParams({ type: 'domain', page: '1', pageSize: '250' });
        if (effectiveSearch.trim()) domainParams.set('search', effectiveSearch.trim());
        fetchPromises.push(
          fetch(`/api/malicious?${domainParams}`).then(r => r.ok ? r.json() : { items: [], total: 0 })
        );
      }

      if (effectiveType === 'all' || effectiveType === 'ip') {
        const ipParams = new URLSearchParams({ type: 'ip', page: '1', pageSize: '250' });
        if (effectiveSearch.trim()) ipParams.set('search', effectiveSearch.trim());
        fetchPromises.push(
          fetch(`/api/malicious?${ipParams}`).then(r => r.ok ? r.json() : { items: [], total: 0 })
        );
      }

      const results = await Promise.all(fetchPromises);

      // Merge and normalize entries
      const allEntries: MaliciousEntry[] = [];
      let totalCount = 0;

      for (const result of results) {
        if (result.items && Array.isArray(result.items)) {
          const normalized = result.items.map((item: any) => ({
            id: item.id,
            type: item.domain ? 'domain' : 'ip',
            value: item.domain || item.ip || '',
            source: item.source || 'unknown',
            severity: item.severity || 'medium',
            reason: item.reason || null,
            tags: item.tags || null,
            isActive: item.isActive !== false,
            createdAt: item.createdAt || new Date().toISOString(),
            updatedAt: item.updatedAt || new Date().toISOString(),
          }));
          allEntries.push(...normalized);
          totalCount += result.total || 0;
        }
      }

      // Sort by createdAt descending
      allEntries.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

      setEntries(allEntries);
      setTotal(totalCount);
    } catch (err) {
      console.error('Failed to fetch malicious entries:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  // Fetch stats via API
  const fetchStatsFromApi = useCallback(async () => {
    try {
      const res = await fetch('/api/threat-intel/sources');
      if (res.ok) {
        const data = await res.json();
        const summary = data.summary || {};
        setStats({
          total: (summary.totalDomains || 0) + (summary.totalIps || 0),
          active: (summary.totalDomains || 0) + (summary.totalIps || 0),
          bySeverity: { critical: 0, high: 0, medium: 0, low: 0 },
          byType: { ip: summary.totalIps || 0, domain: summary.totalDomains || 0 },
        });
      }
    } catch {
      // ignore
    }
  }, []);

  // Initial data load - only once
  useEffect(() => {
    if (!initialLoadDone.current) {
      initialLoadDone.current = true;
      fetchAllEntries();
      fetchStatsFromApi();
    }
  }, [fetchAllEntries, fetchStatsFromApi]);

  // Re-fetch when filters change (not on every render)
  useEffect(() => {
    if (initialLoadDone.current) {
      fetchAllEntries(typeFilter, searchQuery);
    }
  }, [typeFilter, searchQuery, fetchAllEntries]);

  const refreshAll = () => {
    fetchAllEntries();
    fetchStatsFromApi();
  };

  const handleDelete = async (id: string) => {
    setDeletingId(id);
    try {
      // Determine type from entry
      const entry = entries.find(e => e.id === id);
      const entryType = entry?.type || 'domain';

      const res = await fetch(`/api/malicious?type=${entryType}&id=${id}`, {
        method: 'DELETE',
      });
      if (res.ok) {
        dataSync.refreshMaliciousStats();
        setEntries(prev => prev.filter(e => e.id !== id));
        setTotal(prev => prev - 1);
        setSelectedIds(prev => {
          const next = new Set(prev);
          next.delete(id);
          return next;
        });
      }
    } catch {
      // ignore
    } finally {
      setDeletingId(null);
    }
  };

  const handleToggleActive = async (entry: MaliciousEntry) => {
    try {
      const res = await fetch('/api/malicious?action=update', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: entry.id, isActive: !entry.isActive }),
      });
      if (res.ok) {
        setEntries(prev =>
          prev.map(e => e.id === entry.id ? { ...e, isActive: !e.isActive } : e)
        );
      }
    } catch {
      // ignore
    }
  };

  // Batch export
  const handleExport = () => {
    const exportData = {
      exportTime: new Date().toISOString(),
      total: entries.length,
      entries: entries.map(e => ({
        type: e.type,
        value: e.value,
        severity: e.severity,
        source: e.source,
        reason: e.reason,
        isActive: e.isActive,
        tags: e.tags,
        createdAt: e.createdAt,
      })),
    };
    const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `malicious-db-${Date.now()}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  // Batch delete
  const handleBatchDelete = async () => {
    if (selectedIds.size === 0) return;
    setBatchDeleting(true);
    try {
      const res = await fetch('/api/malicious?action=batch-delete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids: [...selectedIds] }),
      });
      if (res.ok) {
        const data = await res.json();
        dataSync.refreshMaliciousStats();
        setEntries(prev => prev.filter(e => !selectedIds.has(e.id)));
        setTotal(prev => prev - (data.deleted || 0));
        setSelectedIds(new Set());
      }
    } catch {
      // ignore
    } finally {
      setBatchDeleting(false);
    }
  };

  const toggleSelect = (id: string) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleSelectAll = () => {
    if (selectedIds.size === entries.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(entries.map(e => e.id)));
    }
  };

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Header */}
      <div className="py-1.5 px-3 border-b flex items-center gap-2 shrink-0">
        <Database className="h-3 w-3 text-muted-foreground" />
        <span className="text-xs font-medium">恶意库 ({total})</span>
        <div className="flex items-center gap-1 ml-1">
          {stats?.byType.ip !== undefined && stats.byType.ip > 0 && (
            <Badge variant="secondary" className="text-[9px] px-1 py-0">
              <MapPin className="h-2 w-2 mr-0.5" />{stats.byType.ip} IP
            </Badge>
          )}
          {stats?.byType.domain !== undefined && stats.byType.domain > 0 && (
            <Badge variant="secondary" className="text-[9px] px-1 py-0">
              <Globe className="h-2 w-2 mr-0.5" />{stats.byType.domain} 域名
            </Badge>
          )}
        </div>
        <div className="ml-auto flex items-center gap-1">
          <Button
            variant="outline"
            size="sm"
            className="h-7 gap-1 text-[10px] px-2"
            onClick={() => setShowImportDialog(true)}
          >
            <Upload className="h-3 w-3" />
            批量导入
          </Button>
          {entries.length > 0 && (
            <Button
              variant="outline"
              size="sm"
              className="h-7 gap-1 text-[10px] px-2"
              onClick={handleExport}
            >
              <Download className="h-3 w-3" />
              导出
            </Button>
          )}
          <Button
            variant="outline"
            size="sm"
            className="h-7 gap-1 text-[10px] px-2"
            onClick={() => setShowAddDialog(true)}
          >
            <Plus className="h-3 w-3" />
            添加
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="h-7 w-7 p-0"
            onClick={refreshAll}
            disabled={loading}
          >
            <RefreshCw className={`h-3 w-3 ${loading ? 'animate-spin' : ''}`} />
          </Button>
        </div>
      </div>

      {/* Stats badges */}
      <StatsSection stats={stats} />

      {/* Entry list with filters and batch actions */}
      <EntryList
        entries={entries}
        loading={loading}
        searchQuery={searchQuery}
        onSearchChange={setSearchQuery}
        typeFilter={typeFilter}
        onTypeFilterChange={setTypeFilter}
        selectedIds={selectedIds}
        onToggleSelect={toggleSelect}
        onToggleSelectAll={toggleSelectAll}
        deletingId={deletingId}
        onToggleActive={handleToggleActive}
        onDelete={handleDelete}
        onBatchDelete={handleBatchDelete}
        batchDeleting={batchDeleting}
        onClearSelection={() => setSelectedIds(new Set())}
      />

      {/* Lazy-loaded dialogs */}
      <React.Suspense fallback={null}>
        {showAddDialog && (
          <AddEntryDialog
            open={showAddDialog}
            onOpenChange={setShowAddDialog}
            onAdded={refreshAll}
          />
        )}
      </React.Suspense>

      <React.Suspense fallback={null}>
        {showImportDialog && (
          <BatchAddDialog
            open={showImportDialog}
            onOpenChange={setShowImportDialog}
            onImported={refreshAll}
          />
        )}
      </React.Suspense>
    </div>
  );
}
