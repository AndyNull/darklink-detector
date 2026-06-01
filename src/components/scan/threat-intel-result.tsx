'use client';

import { useState, useEffect } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ShieldAlert, Loader2, Plus } from 'lucide-react';

export function ThreatIntelResult({ type, value }: { type: 'domain' | 'ip'; value: string }) {
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [adding, setAdding] = useState(false);
  const [added, setAdded] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/threat-intel?type=${type}&value=${encodeURIComponent(value)}`)
      .then(r => r.json())
      .then(d => { if (!cancelled) { setData(d); setLoading(false); } })
      .catch(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [type, value]);

  const handleAddToMalicious = async () => {
    setAdding(true);
    try {
      const res = await fetch('/api/malicious', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type, value, source: 'manual', severity: 'high' }),
      });
      if (res.ok) {
        setAdded(true);
      }
    } catch(e) { console.warn('Error:', e); }
    setAdding(false);
  };

  if (loading) return <div className="flex items-center gap-1"><Loader2 className="h-3 w-3 animate-spin" /> 查询中...</div>;
  if (!data) return <div>查询失败</div>;

  const localMatched = data.localDB?.matched;
  const tbData = data.threatbook;
  const tbIsMalicious = tbData?.isMalicious || false;
  const tbIsSuspicious = tbData?.isSuspicious || false;

  // Source status badge helper
  const getSourceBadge = (s: any) => {
    const statusMap: Record<string, { label: string; className: string }> = {
      matched: { label: '已命中', className: 'border-destructive/50 text-destructive' },
      suspicious: { label: '可疑', className: 'border-yellow-500/50 text-yellow-600' },
      clean: { label: '安全', className: 'border-green-500/50 text-green-600' },
      not_found: { label: '未命中', className: 'border-muted-foreground/30' },
      not_integrated: { label: '未集成', className: 'border-muted-foreground/20 text-muted-foreground' },
      not_configured: { label: '未配置', className: 'border-muted-foreground/20 text-muted-foreground' },
      rate_limited: { label: '限流', className: 'border-orange-500/50 text-orange-500' },
      error: { label: '查询失败', className: 'border-red-500/30 text-red-500' },
    };
    const info = statusMap[s.status] || { label: s.status, className: '' };
    return (
      <Badge variant="outline" className={`text-[8px] px-1 py-0 ${info.className}`}>
        {info.label}
      </Badge>
    );
  };

  return (
    <div className="space-y-1">
      <div className="font-semibold flex items-center gap-1">
        <ShieldAlert className="h-3 w-3" />
        威胁情报
      </div>
      <div className={localMatched ? 'text-destructive font-medium' : tbIsMalicious ? 'text-destructive font-medium' : tbIsSuspicious ? 'text-yellow-600 font-medium' : 'text-muted-foreground'}>
        {localMatched ? '🔴 本地恶意库命中' : tbIsMalicious ? '⚠️ ThreatBook标记为恶意' : tbIsSuspicious ? '🟡 ThreatBook标记为可疑' : '✅ 未发现威胁'}
      </div>
      {localMatched && data.localDB && (
        <div className="bg-destructive/5 border border-destructive/20 rounded p-1 space-y-0.5">
          {data.localDB.reason && <div className="text-[9px]"><span className="font-medium">原因:</span> {data.localDB.reason}</div>}
          <div className="text-[9px]"><span className="font-medium">来源:</span> {data.localDB.source === 'manual' ? '手动添加' : data.localDB.source === 'scan' ? '扫描发现' : data.localDB.source === 'threatbook' ? '微步情报' : data.localDB.source}</div>
          {data.localDB.category && <div className="text-[9px]"><span className="font-medium">分类:</span> {data.localDB.category}</div>}
        </div>
      )}
      {tbData && !localMatched && (
        <div className={`rounded p-1 space-y-0.5 ${tbIsMalicious ? 'bg-destructive/5 border border-destructive/20' : tbIsSuspicious ? 'bg-yellow-500/5 border border-yellow-500/20' : ''}`}>
          {tbData.confidence > 0 && <div className="text-[9px]"><span className="font-medium">置信度:</span> {tbData.confidence}%</div>}
          {tbData.judgments?.length > 0 && <div className="text-[9px]"><span className="font-medium">判定:</span> {tbData.judgments.join(', ')}</div>}
          {tbData.tags?.length > 0 && <div className="text-[9px] truncate" title={tbData.tags.join(', ')}><span className="font-medium">标签:</span> {tbData.tags.slice(0, 5).join(', ')}{tbData.tags.length > 5 ? '...' : ''}</div>}
          {tbData.autoAdded && <div className="text-[9px] text-green-600">✓ 已自动添加到本地恶意库</div>}
        </div>
      )}
      {data.sources?.map((s: any) => (
        <div key={s.name} className="flex items-center gap-1">
          <span className="font-medium">{s.name}</span>
          {getSourceBadge(s)}
          {s.result && s.status !== 'not_integrated' && s.status !== 'not_configured' && s.status !== 'not_found' && (
            <span className="text-[8px] text-muted-foreground truncate">{s.result}</span>
          )}
        </div>
      ))}
      {!localMatched && !added && !(tbData?.autoAdded) && (
        <Button
          variant="outline"
          size="sm"
          className="h-5 text-[9px] gap-0.5 w-full mt-1"
          onClick={handleAddToMalicious}
          disabled={adding}
        >
          {adding ? <Loader2 className="h-2.5 w-2.5 animate-spin" /> : <Plus className="h-2.5 w-2.5" />}
          加入恶意库
        </Button>
      )}
      {added && (
        <div className="text-[9px] text-green-600 font-medium mt-1">✓ 已加入恶意库</div>
      )}
      <div className="text-[8px] text-muted-foreground mt-1">{data.disclaimer}</div>
    </div>
  );
}
