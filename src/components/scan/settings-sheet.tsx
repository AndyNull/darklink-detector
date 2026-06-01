'use client';

import { useState, useEffect, useCallback } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Separator } from '@/components/ui/separator';
import {
  Settings as SettingsIcon,
  Save,
  Eye,
  EyeOff,
  RotateCcw,
  Shield,
  Globe,
  Server,
  KeyRound,
  Check,
  Loader2,
} from 'lucide-react';
import {
  useSettings,
  type DetectionRuleKey,
} from '@/hooks/use-settings';

// Detection rule definitions
const detectionRules: { key: DetectionRuleKey; label: string }[] = [
  { key: 'css_hidden', label: 'CSS隐藏检测' },
  { key: 'size_hidden', label: '尺寸隐藏检测' },
  { key: 'color_hidden', label: '颜色隐藏检测' },
  { key: 'position_hidden', label: '位置隐藏检测' },
  { key: 'overflow_hidden', label: '溢出隐藏检测' },
  { key: 'iframe_hidden', label: '隐藏iframe检测' },
  { key: 'suspicious_domain', label: '可疑域名检测' },
  { key: 'js_injected', label: 'JS注入检测' },
  { key: 'malicious_keyword', label: '恶意关键词检测' },
  { key: 'suspicious_shortener', label: '可疑短链检测' },
  { key: 'cheap_tld', label: '廉价TLD检测' },
  { key: 'hidden_text', label: '隐藏文本检测' },
  { key: 'keyword_stuffing', label: '关键词堆砌检测' },
  { key: 'hidden_div_link', label: '隐藏DIV链接检测' },
  { key: 'base_redirect', label: 'Base重定向检测' },
  { key: 'meta_refresh', label: 'Meta刷新检测' },
  { key: 'form_hijack', label: '表单劫持检测' },
  { key: 'svg_hidden', label: 'SVG隐藏检测' },
  { key: 'nofollow_suspicious', label: 'Nofollow外链检测' },
  { key: 'link_farm', label: '链接农场检测' },
  { key: 'mixed_content', label: '混合内容检测' },
  { key: 'data_uri', label: 'Data URI链接检测' },
  { key: 'noscript_hidden', label: 'Noscript隐藏检测' },
  { key: 'js_obfuscated', label: 'JS混淆检测' },
];

// Threat intel API source definitions - maps to database sourceId
const threatIntelApiSources: { sourceId: string; label: string; icon: React.ElementType }[] = [
  { sourceId: 'threatbook', label: '微步在线 (ThreatBook)', icon: Shield },
  { sourceId: 'alienvault-otx', label: 'AlienVault OTX', icon: Globe },
  { sourceId: 'virustotal', label: 'VirusTotal', icon: Globe },
  { sourceId: 'abuseipdb', label: 'AbuseIPDB', icon: Server },
];

function MaskedApiKeyInput({
  sourceId,
  hasKey,
  onSave,
}: {
  sourceId: string;
  hasKey: boolean;
  onSave: (sourceId: string, apiKey: string) => Promise<void>;
}) {
  const [visible, setVisible] = useState(false);
  const [localValue, setLocalValue] = useState('');
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  const handleSave = async () => {
    if (!localValue.trim()) return;
    setSaving(true);
    try {
      await onSave(sourceId, localValue.trim());
      setSaved(true);
      setLocalValue('');
      setTimeout(() => setSaved(false), 1500);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="flex items-center gap-1">
      <div className="relative flex-1">
        <Input
          type={visible ? 'text' : 'password'}
          value={localValue}
          onChange={(e) => { setLocalValue(e.target.value); setSaved(false); }}
          placeholder={hasKey ? '已配置（输入新值替换）' : '输入API Key...'}
          className="h-7 text-[10px] pr-7"
        />
        <button
          type="button"
          onClick={() => setVisible(!visible)}
          className="absolute right-1.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
          aria-label={visible ? '隐藏密钥' : '显示密钥'}
        >
          {visible ? (
            <EyeOff className="h-3 w-3" />
          ) : (
            <Eye className="h-3 w-3" />
          )}
        </button>
      </div>
      <Button
        variant="outline"
        size="sm"
        className="h-7 text-[9px] px-2 shrink-0 gap-0.5"
        onClick={handleSave}
        disabled={!localValue.trim() || saving}
      >
        {saving ? (
          <Loader2 className="h-2.5 w-2.5 animate-spin" />
        ) : saved ? (
          <Check className="h-2.5 w-2.5 text-green-500" />
        ) : (
          <Save className="h-2.5 w-2.5" />
        )}
        {saved ? '已保存' : '保存'}
      </Button>
      {hasKey && !localValue && (
        <span className="text-[9px] text-emerald-500 shrink-0">✓</span>
      )}
    </div>
  );
}

export function SettingsSheet({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const {
    settings,
    updateSystemName,
    updateDetectionRule,
    resetToDefaults,
  } = useSettings();

  const [systemNameInput, setSystemNameInput] = useState(settings.systemName);
  const [systemNameSaved, setSystemNameSaved] = useState(false);
  const [apiKeysStatus, setApiKeysStatus] = useState<Record<string, boolean>>({});

  // Fetch API key status from backend
  const loadApiKeyStatus = useCallback(async () => {
    try {
      const res = await fetch('/api/threat-intel-sources');
      if (!res.ok) return;
      const data = await res.json();
      const statusMap: Record<string, boolean> = {};
      for (const source of data.sources || []) {
        if (source.requiresApiKey) {
          statusMap[source.sourceId] = source.hasApiKey;
        }
      }
      return statusMap;
    } catch {
      // ignore
    }
    return undefined;
  }, []);

  useEffect(() => {
    if (open) {
      loadApiKeyStatus().then((statusMap) => {
        if (statusMap) setApiKeysStatus(statusMap);
      });
    }
  }, [open, loadApiKeyStatus]);

  const handleSaveSystemName = () => {
    updateSystemName(systemNameInput);
    setSystemNameSaved(true);
    setTimeout(() => setSystemNameSaved(false), 1500);
  };

  const handleSaveApiKey = async (sourceId: string, apiKey: string) => {
    const res = await fetch('/api/threat-intel-sources', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'save-api-key', sourceId, apiKey }),
    });
    if (!res.ok) {
      throw new Error('Failed to save API key');
    }
    // Refresh status
    const statusMap = await loadApiKeyStatus();
    if (statusMap) setApiKeysStatus(statusMap);
  };

  const enabledCount = Object.values(settings.detectionRules).filter(Boolean).length;
  const totalRules = detectionRules.length;

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-[360px] sm:w-[420px] p-0 gap-0">
        <SheetHeader className="px-4 py-3 border-b shrink-0">
          <SheetTitle className="text-sm flex items-center gap-2">
            <SettingsIcon className="h-4 w-4 text-muted-foreground" />
            设置
          </SheetTitle>
        </SheetHeader>

        {/* Scrollable content */}
        <div className="flex-1 min-h-0 overflow-y-auto px-4 py-3 space-y-4">
          {/* System Settings */}
          <section>
            <div className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider mb-2 flex items-center gap-1.5">
              <SettingsIcon className="h-3 w-3" />
              系统设置
            </div>
            <div className="rounded-md border p-3 space-y-2">
              <div className="flex items-center gap-2">
                <label className="text-[10px] text-muted-foreground shrink-0 w-14">
                  系统名称
                </label>
                <Input
                  value={systemNameInput}
                  onChange={(e) => { setSystemNameInput(e.target.value); setSystemNameSaved(false); }}
                  className="h-7 text-[10px] flex-1"
                />
                <Button
                  variant="outline"
                  size="sm"
                  className="h-7 text-[9px] px-2 shrink-0 gap-0.5"
                  onClick={handleSaveSystemName}
                  disabled={systemNameInput === settings.systemName}
                >
                  {systemNameSaved ? <Check className="h-2.5 w-2.5 text-green-500" /> : null}
                  {systemNameSaved ? '已保存' : '保存'}
                </Button>
              </div>
            </div>
          </section>

          <Separator />

          {/* Detection Rules */}
          <section>
            <div className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider mb-2 flex items-center gap-1.5">
              <Shield className="h-3 w-3" />
              检测规则
              <span className="text-[9px] font-normal text-muted-foreground/70">
                ({enabledCount}/{totalRules})
              </span>
            </div>
            <div className="rounded-md border p-1.5 space-y-0">
              {detectionRules.map(({ key, label }) => (
                <div
                  key={key}
                  className="flex items-center justify-between py-1 px-2 rounded hover:bg-accent/50 transition-colors"
                >
                  <span className="text-[10px]">{label}</span>
                  <Switch
                    checked={settings.detectionRules[key]}
                    onCheckedChange={(checked) => updateDetectionRule(key, checked)}
                    className="scale-75 origin-right"
                  />
                </div>
              ))}
            </div>
          </section>

          <Separator />

          {/* Threat Intel API Settings */}
          <section>
            <div className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider mb-2 flex items-center gap-1.5">
              <KeyRound className="h-3 w-3" />
              情报源API密钥
            </div>
            <div className="rounded-md border p-3 space-y-3">
              {threatIntelApiSources.map(({ sourceId, label, icon: Icon }) => (
                <div key={sourceId} className="space-y-1">
                  <div className="flex items-center gap-1.5">
                    <Icon className="h-3 w-3 text-muted-foreground" />
                    <span className="text-[10px] font-medium">{label}</span>
                  </div>
                  <MaskedApiKeyInput
                    sourceId={sourceId}
                    hasKey={!!apiKeysStatus[sourceId]}
                    onSave={handleSaveApiKey}
                  />
                </div>
              ))}
              <p className="text-[9px] text-muted-foreground/70 pt-1">
                配置API Key后，对应的情报源可自动采集数据。密钥安全存储在本地数据库中。
              </p>
            </div>
          </section>

          <Separator />

          {/* Reset */}
          <div className="flex justify-end pb-2">
            <Button
              variant="outline"
              size="sm"
              className="h-7 text-[10px] gap-1 px-2 text-muted-foreground hover:text-foreground"
              onClick={resetToDefaults}
            >
              <RotateCcw className="h-3 w-3" />
              重置所有设置
            </Button>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}
