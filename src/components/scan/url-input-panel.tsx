'use client';

import { useState, useCallback, useRef, memo } from 'react';
import { toast } from 'sonner';
import { useScanStore } from '@/lib/scan-store';
import { CompactScanControls } from '@/components/scan/scan-controls';
import { SublinkProgressPanel } from '@/components/scan/sublink-progress-panel';
import { useIsMobile } from '@/hooks/use-mobile';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Progress } from '@/components/ui/progress';
import {
  Plus,
  Upload,
  FileText,
  ListPlus,
  Settings2,
  X,
} from 'lucide-react';
import type { UrlConfig } from '@/lib/scan-store';

const URL_DISPLAY_BATCH = 100;

// Memoized URL entry item to prevent re-rendering the entire list on changes
const UrlEntryItem = memo(function UrlEntryItem({
  urlConfig,
  isMobile,
  isExpanded,
  onToggleExpand,
  onToggleEnabled,
  onRemove,
  onUpdateUrl,
  headerKey,
  headerValue,
  setHeaderKey,
  setHeaderValue,
  addHeader,
  removeHeader,
}: {
  urlConfig: UrlConfig;
  isMobile: boolean;
  isExpanded: boolean;
  onToggleExpand: () => void;
  onToggleEnabled: () => void;
  onRemove: () => void;
  onUpdateUrl: (id: string, updates: Partial<UrlConfig>) => void;
  headerKey: string;
  headerValue: string;
  setHeaderKey: (v: string) => void;
  setHeaderValue: (v: string) => void;
  addHeader: (urlId: string) => void;
  removeHeader: (urlId: string, key: string) => void;
}) {
  return (
    <div
      className={`group rounded-md border px-2 py-1.5 transition-all duration-150 ease-out ${
        !urlConfig.enabled ? 'opacity-50 bg-muted/30' : 'bg-card hover:bg-accent/40 active:bg-accent/60'
      }`}
    >
      <div className="flex items-center gap-1.5">
        <Switch
          checked={urlConfig.enabled}
          onCheckedChange={onToggleEnabled}
          className="scale-75"
        />
        <span className="text-[10px] font-mono px-1 py-0 bg-secondary rounded shrink-0">
          {urlConfig.method}
        </span>
        <span className="text-[11px] truncate flex-1 font-mono min-w-0">{urlConfig.url}</span>
        <Button
          variant="ghost"
          size="sm"
          className={`h-5 w-5 p-0 shrink-0 ${isMobile ? 'opacity-70' : 'opacity-0 group-hover:opacity-100'}`}
          onClick={onToggleExpand}
        >
          <Settings2 className="h-3 w-3" />
        </Button>
        <Button
          variant="ghost"
          size="sm"
          className={`h-5 w-5 p-0 text-destructive shrink-0 ${isMobile ? 'opacity-70' : 'opacity-0 group-hover:opacity-100'}`}
          onClick={onRemove}
        >
          <X className="h-3 w-3" />
        </Button>
      </div>

      {/* Expanded config */}
      {isExpanded && (
        <div className="mt-1.5 pt-1.5 border-t space-y-1">
          {/* Method row */}
          <div className="flex gap-1.5 items-center h-7">
            <span className="text-[10px] text-muted-foreground w-10 shrink-0">方式</span>
            <Select
              value={urlConfig.method}
              onValueChange={(v) => onUpdateUrl(urlConfig.id, { method: v })}
            >
              <SelectTrigger size="sm" className="h-7 data-[size=sm]:h-7 text-[10px] w-[62px] px-1.5 [&>svg]:size-3">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="GET">GET</SelectItem>
                <SelectItem value="POST">POST</SelectItem>
                <SelectItem value="PUT">PUT</SelectItem>
                <SelectItem value="DELETE">DELETE</SelectItem>
                <SelectItem value="HEAD">HEAD</SelectItem>
                <SelectItem value="OPTIONS">OPTIONS</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* Headers row */}
          <div className="space-y-0.5">
            {Object.entries(urlConfig.headers).map(([key, value]) => (
              <div key={key} className="flex gap-1 items-center h-7">
                <span className="text-[10px] text-muted-foreground w-10 shrink-0">Header</span>
                <Input
                  className="h-7 text-[10px] font-mono flex-1 min-w-0"
                  value={key}
                  readOnly
                />
                <Input
                  className="h-7 text-[10px] font-mono flex-1 min-w-0"
                  value={value}
                  readOnly
                />
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 w-7 p-0 shrink-0 text-muted-foreground hover:text-destructive"
                  onClick={() => removeHeader(urlConfig.id, key)}
                >
                  <X className="h-3 w-3" />
                </Button>
              </div>
            ))}
            <div className="flex gap-1 items-center h-7">
              <span className="text-[10px] text-muted-foreground w-10 shrink-0">Header</span>
              <Input
                placeholder="名称"
                className="h-7 text-[10px] font-mono flex-1 min-w-0"
                value={headerKey}
                onChange={(e) => setHeaderKey(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && addHeader(urlConfig.id)}
              />
              <Input
                placeholder="值"
                className="h-7 text-[10px] font-mono flex-1 min-w-0"
                value={headerValue}
                onChange={(e) => setHeaderValue(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && addHeader(urlConfig.id)}
              />
              <Button
                variant="outline"
                size="sm"
                className="h-7 w-7 p-0 shrink-0"
                onClick={() => addHeader(urlConfig.id)}
                disabled={!headerKey.trim()}
              >
                <Plus className="h-3 w-3" />
              </Button>
            </div>
          </div>

          {/* Body */}
          {['POST', 'PUT', 'PATCH'].includes(urlConfig.method) && (
            <div className="space-y-0.5">
              <div className="flex gap-1.5 items-center h-7">
                <span className="text-[10px] text-muted-foreground w-10 shrink-0">Body</span>
              </div>
              <Textarea
                className="h-14 text-[10px] font-mono"
                value={urlConfig.body}
                onChange={(e) => onUpdateUrl(urlConfig.id, { body: e.target.value })}
                placeholder="请求体内容..."
              />
            </div>
          )}
        </div>
      )}
    </div>
  );
});

export function UrlInputPanel() {
  const urls = useScanStore(s => s.urls);
  const addUrl = useScanStore(s => s.addUrl);
  const addBatchUrls = useScanStore(s => s.addBatchUrls);
  const removeUrl = useScanStore(s => s.removeUrl);
  const updateUrl = useScanStore(s => s.updateUrl);
  const toggleUrl = useScanStore(s => s.toggleUrl);
  const progress = useScanStore(s => s.progress);
  const isScanning = useScanStore(s => s.isScanning);
  const sublinkEnabled = useScanStore(s => s.sublinkEnabled);
  const sublinkStatus = useScanStore(s => s.sublinkStatus);
  const sublinkProgress = useScanStore(s => s.sublinkProgress);
  const isMobile = useIsMobile();
  const [singleUrl, setSingleUrl] = useState('');
  const [singleMethod, setSingleMethod] = useState('GET');
  const [batchText, setBatchText] = useState('');
  const [expandedUrl, setExpandedUrl] = useState<string | null>(null);
  const [showBatchDialog, setShowBatchDialog] = useState(false);
  const [displayCount, setDisplayCount] = useState(URL_DISPLAY_BATCH);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const progressPercent = progress?.progress ?? 0;

  const handleAddSingle = useCallback(() => {
    if (singleUrl.trim()) {
      addUrl(singleUrl.trim(), singleMethod);
      setSingleUrl('');
    }
  }, [singleUrl, singleMethod, addUrl]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      handleAddSingle();
    }
  }, [handleAddSingle]);

  const handleBatchAdd = useCallback(() => {
    if (batchText.trim()) {
      addBatchUrls(batchText);
      setBatchText('');
      setShowBatchDialog(false);
    }
  }, [batchText, addBatchUrls]);

  const handleFileImport = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      const content = event.target?.result as string;
      // Use addBatchUrls for all file types - it handles JSON, curl, and plain URLs
      addBatchUrls(content);
      toast.success(`已导入 ${file.name}`);
    };
    reader.readAsText(file);

    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  }, [addBatchUrls]);

  const [headerKey, setHeaderKey] = useState('');
  const [headerValue, setHeaderValue] = useState('');

  const addHeader = useCallback((urlId: string) => {
    if (headerKey.trim()) {
      const url = urls.find(u => u.id === urlId);
      if (url) {
        updateUrl(urlId, {
          headers: { ...url.headers, [headerKey.trim()]: headerValue.trim() },
        });
        setHeaderKey('');
        setHeaderValue('');
      }
    }
  }, [headerKey, headerValue, urls, updateUrl]);

  const removeHeader = useCallback((urlId: string, key: string) => {
    const url = urls.find(u => u.id === urlId);
    if (url) {
      const newHeaders = { ...url.headers };
      delete newHeaders[key];
      updateUrl(urlId, { headers: newHeaders });
    }
  }, [urls, updateUrl]);

  // Reset display count when URLs shrink below current display count
  const visibleUrls = urls.slice(0, displayCount);

  // Reset callback: clear the single URL input along with scan state
  const handleResetClearInput = useCallback(() => {
    setSingleUrl('');
    setDisplayCount(URL_DISPLAY_BATCH);
  }, []);

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Compact inline header with progress */}
      <div className="h-10 px-3 border-b flex items-center gap-2 shrink-0">
        <span className="text-xs font-medium truncate">URL输入 ({urls.length})</span>

        {/* Progress bar + percentage - shown in header */}
        {(isScanning || progressPercent > 0) && (
          <>
            <div className="flex-1 max-w-[120px] min-w-[60px]">
              <Progress
                value={progressPercent}
                className={`h-1.5 ${isScanning ? '[&>div]:animate-pulse' : ''}`}
              />
            </div>
            <span className="text-[10px] font-bold tabular-nums shrink-0">
              {progressPercent}%
            </span>
            {isScanning && progress?.estimatedTimeRemaining != null && (
              <span className="text-[9px] text-muted-foreground tabular-nums shrink-0">
                {progress.estimatedTimeRemaining < 1000
                  ? '< 1秒'
                  : progress.estimatedTimeRemaining < 60000
                    ? `~${Math.ceil(progress.estimatedTimeRemaining / 1000)}秒`
                    : `~${Math.ceil(progress.estimatedTimeRemaining / 60000)}分钟`}
              </span>
            )}
          </>
        )}
      </div>

      {/* URL input + action row */}
      <div className={`${isMobile ? 'px-2' : 'px-3'} pt-2 shrink-0`}>
        {/* Row 1: URL input + batch/import buttons */}
        <div className="flex gap-1.5 items-center">
          <Select value={singleMethod} onValueChange={setSingleMethod}>
            <SelectTrigger size="sm" className={`h-7 data-[size=sm]:h-7 ${isMobile ? 'w-[52px]' : 'w-[62px]'} shrink-0 text-[10px] px-1.5 [&>svg]:size-3`}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="GET">GET</SelectItem>
              <SelectItem value="POST">POST</SelectItem>
              <SelectItem value="PUT">PUT</SelectItem>
              <SelectItem value="DELETE">DELETE</SelectItem>
              <SelectItem value="HEAD">HEAD</SelectItem>
              <SelectItem value="OPTIONS">OPTIONS</SelectItem>
            </SelectContent>
          </Select>
          <Input
            type="text"
            placeholder="输入URL地址..."
            value={singleUrl}
            onChange={(e) => setSingleUrl(e.target.value)}
            onKeyDown={handleKeyDown}
            className="flex-1 h-7 text-xs min-w-0"
          />

          <Button size="sm" onClick={handleAddSingle} disabled={!singleUrl.trim()} className="h-7 w-7 p-0 shrink-0">
            <Plus className="h-3.5 w-3.5" />
          </Button>
        </div>

        {/* Row 2: Batch/Import + Scan controls */}
        <div className={`mt-1.5 flex items-center ${isMobile ? 'gap-1 flex-wrap' : 'gap-1.5 flex-wrap'}`}>
          {/* Batch add + Import file (before global button) */}
          <Dialog open={showBatchDialog} onOpenChange={setShowBatchDialog}>
            <DialogTrigger asChild>
              <Button variant="outline" size="sm" className="h-7 gap-1 text-[10px] px-2 shrink-0" title="批量添加">
                <ListPlus className="h-3 w-3" />
                批量
              </Button>
            </DialogTrigger>
            <DialogContent className="max-w-lg max-h-[80vh] flex flex-col">
              <DialogHeader>
                <DialogTitle>批量添加URL</DialogTitle>
              </DialogHeader>
              <div className="flex-1 min-h-0 flex flex-col gap-3 overflow-hidden">
                <p className="text-xs text-muted-foreground leading-relaxed shrink-0">
                  支持URL、JSON、curl命令格式，每行一个或整个粘贴：
                </p>
                <Textarea
                  placeholder={`https://example.com

{"url":"https://api.com","method":"POST","headers":{"Content-Type":"application/json"},"body":"{\"key\":\"value\"}"}

curl -X POST https://api.com -H "Content-Type: application/json" -d '{"key":"value"}'`}
                  value={batchText}
                  onChange={(e) => setBatchText(e.target.value)}
                  className="flex-1 min-h-[160px] font-mono text-xs resize-none focus-visible:ring-1 focus-visible:ring-muted-foreground/30 focus-visible:border-muted-foreground/40"
                />
                <div className="flex items-center justify-between shrink-0">
                  <span className="text-xs text-muted-foreground">
                    {batchText.split('\n').filter(l => l.trim()).length} 行
                  </span>
                  <Button onClick={handleBatchAdd} disabled={!batchText.trim()} size="sm" className="h-7 min-w-[80px]">
                    添加
                  </Button>
                </div>
              </div>
            </DialogContent>
          </Dialog>

          <Button
            variant="outline"
            size="sm"
            className="h-7 gap-1 text-[10px] px-2 shrink-0"
            onClick={() => fileInputRef.current?.click()}
            title="导入文件"
          >
            <Upload className="h-3 w-3" />
            导入
          </Button>
          <input
            ref={fileInputRef}
            type="file"
            accept=".txt,.json,.csv"
            className="hidden"
            onChange={handleFileImport}
          />

          {/* Scan controls: global settings + start/stop + reset */}
          <CompactScanControls onReset={handleResetClearInput} />
        </div>
      </div>

      {/* Sublink progress panel */}
      {sublinkEnabled && sublinkStatus !== 'idle' && sublinkProgress && (
        <SublinkProgressPanel />
      )}

      {/* URL list - scrollable area */}
      <div className="flex-1 min-h-0 overflow-y-auto custom-scrollbar px-3 py-1.5">
        {urls.length === 0 ? (
          <div className="text-center text-muted-foreground py-4 text-xs">
            <FileText className="h-6 w-6 mx-auto mb-1 opacity-30" />
            <p>请添加URL开始扫描</p>
            <p className="text-[10px] mt-0.5">支持单个输入、批量添加或文件导入</p>
          </div>
        ) : (
          <div className="space-y-1">
            {visibleUrls.map((urlConfig) => (
              <UrlEntryItem
                key={urlConfig.id}
                urlConfig={urlConfig}
                isMobile={isMobile}
                isExpanded={expandedUrl === urlConfig.id}
                onToggleExpand={() => setExpandedUrl(expandedUrl === urlConfig.id ? null : urlConfig.id)}
                onToggleEnabled={() => toggleUrl(urlConfig.id)}
                onRemove={() => removeUrl(urlConfig.id)}
                onUpdateUrl={updateUrl}
                headerKey={headerKey}
                headerValue={headerValue}
                setHeaderKey={setHeaderKey}
                setHeaderValue={setHeaderValue}
                addHeader={addHeader}
                removeHeader={removeHeader}
              />
            ))}
            {urls.length > displayCount && (
              <div className="flex items-center justify-center py-2">
                <Button
                  variant="outline"
                  size="sm"
                  className="text-[10px] gap-1"
                  onClick={() => setDisplayCount(prev => prev + URL_DISPLAY_BATCH)}
                >
                  显示更多（还有 {Math.min(URL_DISPLAY_BATCH, urls.length - displayCount)} 条）
                </Button>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
