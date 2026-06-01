'use client';

import { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Key,
  Loader2,
  CheckCircle2,
  AlertTriangle,
  ExternalLink,
  Eye,
  EyeOff,
} from 'lucide-react';
import { useAuth, getAuthHeaders } from '@/lib/auth-context';
import { toast } from 'sonner';
import { ApiKeyConfig } from './types';
import { loadApiKey } from './helpers';
import { rsaEncrypt } from '@/lib/crypto-client';

export function ApiKeyField({
  config,
  onSaved,
}: {
  config: ApiKeyConfig;
  onSaved: () => void;
}) {
  const { requireAuth } = useAuth();
  const [value, setValue] = useState('');
  const [showKey, setShowKey] = useState(false);
  const [status, setStatus] = useState<'none' | 'configured' | 'verified'>('none');
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);

  useEffect(() => {
    const stored = loadApiKey(config.sourceId);
    setValue(stored);
    if (stored) {
      setStatus('configured');
    }
  }, [config.sourceId]);

  const handleSave = async () => {
    if (!requireAuth(() => {})) return;
    setSaving(true);
    try {
      const encryptedKey = await rsaEncrypt(value);
      const res = await fetch('/api/threat-intel/api-keys', {
        method: 'PUT',
        headers: { ...getAuthHeaders(), 'Content-Type': 'application/json' },
        body: JSON.stringify({ source: config.sourceId, apiKey: encryptedKey, enabled: true }),
      });
      if (res.ok) {
        setStatus(value ? 'configured' : 'none');
        onSaved();
        toast.success('API Key已保存');
      } else {
        toast.error('API Key保存失败');
      }
    } catch {
      toast.error('API Key保存失败');
    } finally {
      setSaving(false);
    }
  };

  const handleTest = async () => {
    if (!requireAuth(() => {})) return;
    setTesting(true);
    try {
      const encryptedKey = await rsaEncrypt(value);
      const res = await fetch(`/api/threat-intel/api-keys?action=validate&source=${config.sourceId}`, {
        method: 'POST',
        headers: { ...getAuthHeaders(), 'Content-Type': 'application/json' },
        body: JSON.stringify({ key: encryptedKey }),
      });
      if (res.ok) {
        const data = await res.json();
        if (data.valid) {
          setStatus('verified');
          toast.success('API Key验证成功');
        } else {
          setStatus('configured');
          toast.error('API Key验证失败');
        }
      } else {
        // If API fails, still mark as configured (key exists)
        if (value) setStatus('configured');
        toast.error('API Key验证请求失败');
      }
    } catch {
      // Fallback: if network error, just mark configured
      if (value) setStatus('configured');
      toast.error('API Key验证网络错误');
    } finally {
      setTesting(false);
    }
  };

  const statusLabels: Record<string, string> = {
    none: '未配置',
    configured: '已配置',
    verified: '已验证',
  };

  const statusColors: Record<string, string> = {
    none: 'text-muted-foreground',
    configured: 'text-yellow-600',
    verified: 'text-green-600',
  };

  return (
    <div className="rounded border px-3 py-2 space-y-1.5">
      <div className="flex items-center gap-1.5">
        <Key className="h-3 w-3 text-muted-foreground shrink-0" />
        <span className="text-[11px] font-medium">{config.name}</span>
        <span className={`text-[9px] ml-auto shrink-0 ${statusColors[status]}`}>
          {status === 'verified' && <CheckCircle2 className="h-2.5 w-2.5 inline mr-0.5" />}
          {status === 'configured' && <AlertTriangle className="h-2.5 w-2.5 inline mr-0.5" />}
          {statusLabels[status]}
        </span>
      </div>
      {config.registerUrl && status === 'none' && (
        <div className="text-[9px] text-blue-600 flex items-center gap-0.5">
          <ExternalLink className="h-2 w-2" />
          <a href={config.registerUrl} target="_blank" rel="noopener noreferrer" className="hover:underline">
            申请API Key
          </a>
        </div>
      )}
      <div className="flex items-center gap-1">
        <div className="relative flex-1">
          <Input
            type={showKey ? 'text' : 'password'}
            placeholder={config.placeholder}
            value={value}
            onChange={(e) => { setValue(e.target.value); setStatus('none'); }}
            className="h-8 text-xs pr-8"
          />
          <Button
            variant="ghost"
            size="sm"
            className="absolute right-0 top-0 h-8 w-8 p-0 cursor-pointer transition-colors hover:bg-accent hover:text-accent-foreground"
            onClick={() => setShowKey(!showKey)}
            aria-label={showKey ? '隐藏密钥' : '显示密钥'}
          >
            {showKey ? <EyeOff className="h-3 w-3" /> : <Eye className="h-3 w-3" />}
          </Button>
        </div>
        <Button
          variant="outline"
          size="sm"
          className="h-8 text-[10px] px-2 shrink-0"
          onClick={handleSave}
          disabled={saving}
        >
          {saving ? <Loader2 className="h-3 w-3 animate-spin" /> : '保存'}
        </Button>
        <Button
          variant="ghost"
          size="sm"
          className="h-8 text-[10px] px-2 shrink-0"
          onClick={handleTest}
          disabled={testing || !value}
        >
          {testing ? <Loader2 className="h-3 w-3 animate-spin" /> : '测试'}
        </Button>
      </div>
    </div>
  );
}
