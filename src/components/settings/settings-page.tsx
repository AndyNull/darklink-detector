'use client';

import { useState, useEffect, useCallback } from 'react';
import { APP_VERSION } from '@/lib/version';
import { Switch } from '@/components/ui/switch';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Separator } from '@/components/ui/separator';
import { Button } from '@/components/ui/button';
import {
  EyeOff,
  Minimize2,
  Palette,
  Move,
  BoxSelect,
  Code,
  Globe,
  FileCode,
  QrCode,
  RefreshCw,
  Link,
  Database,
  ShieldCheck,
  Settings2,
  Info,
  Save,
  CheckCircle2,
  Bell,
  Clock,
  Shield,
  Server,
  ShieldAlert,
  Key,
  ExternalLink,
  Trash2,
  Eye,
  EyeOff as EyeOffIcon,
  Loader2,
  AlertTriangle,
  Package,
  Download,
} from 'lucide-react';

// Detection rules data
const detectionRules = [
  { id: 'css-hidden', name: 'CSS隐藏', icon: EyeOff, description: 'display:none, visibility:hidden, opacity:0', enabled: true },
  { id: 'size-hidden', name: '尺寸隐藏', icon: Minimize2, description: 'font-size:0, width:0, height:0', enabled: true },
  { id: 'color-hidden', name: '颜色隐藏', icon: Palette, description: '文字颜色与背景色相同', enabled: true },
  { id: 'position-hidden', name: '位置隐藏', icon: Move, description: 'position:absolute + 负偏移', enabled: true },
  { id: 'overflow-hidden', name: '溢出隐藏', icon: BoxSelect, description: 'overflow:hidden + 尺寸为0', enabled: true },
  { id: 'iframe-hidden', name: 'iframe隐藏', icon: Code, description: 'width/height=0的iframe', enabled: true },
  { id: 'suspicious-domain', name: '可疑域名', icon: Globe, description: '与主域名差异大的外链', enabled: true },
  { id: 'js-inject', name: 'JS注入', icon: FileCode, description: 'document.write/innerHTML注入', enabled: true },
  { id: 'qr-code', name: 'QR码暗链', icon: QrCode, description: '二维码指向可疑URL', enabled: true },
  { id: 'meta-refresh', name: 'Meta刷新', icon: RefreshCw, description: 'meta refresh跳转', enabled: true },
  { id: 'base-redirect', name: 'Base重定向', icon: Link, description: 'base标签修改相对路径', enabled: true },
  { id: 'data-uri', name: '数据URI', icon: Database, description: 'data:URI编码的链接', enabled: true },
];

// Store enabled state in localStorage
function getRuleStates(): Record<string, boolean> {
  if (typeof window === 'undefined') return {};
  try {
    const stored = localStorage.getItem('detection-rules-states');
    if (stored) return JSON.parse(stored);
  } catch (err) { console.warn('Settings error:', err); }
  const defaults: Record<string, boolean> = {};
  detectionRules.forEach(r => { defaults[r.id] = true; });
  return defaults;
}

function saveRuleStates(states: Record<string, boolean>) {
  try {
    localStorage.setItem('detection-rules-states', JSON.stringify(states));
  } catch (err) { console.warn('Settings error:', err); }
}

// System settings helpers
function getSystemSettings() {
  if (typeof window === 'undefined') return { systemName: '暗链检测系统', scanTimeout: '30', maxConcurrency: '10', autoUpdateHours: '24' };
  try {
    const stored = localStorage.getItem('system-settings');
    if (stored) return JSON.parse(stored);
  } catch (err) { console.warn('Settings error:', err); }
  return { systemName: '暗链检测系统', scanTimeout: '30', maxConcurrency: '10', autoUpdateHours: '24' };
}

function saveSystemSettings(settings: Record<string, string>) {
  try {
    localStorage.setItem('system-settings', JSON.stringify(settings));
  } catch (err) { console.warn('Settings error:', err); }
}

// Notification settings helpers
function getNotificationSettings(): Record<string, boolean> {
  if (typeof window === 'undefined') return {};
  try {
    const stored = localStorage.getItem('notification-settings');
    if (stored) return JSON.parse(stored);
  } catch (err) { console.warn('Settings error:', err); }
  return { scanComplete: true, scanError: true, intelUpdate: false };
}

function saveNotificationSettings(settings: Record<string, boolean>) {
  try {
    localStorage.setItem('notification-settings', JSON.stringify(settings));
  } catch (err) { console.warn('Settings error:', err); }
}

type SettingsTab = 'general' | 'rules' | 'intel' | 'apikeys' | 'notifications';

export function SettingsPage() {
  const [activeTab, setActiveTab] = useState<SettingsTab>('general');
  const [ruleStates, setRuleStates] = useState<Record<string, boolean>>(getRuleStates);
  const [systemSettings, setSystemSettings] = useState(getSystemSettings);
  const [notifSettings, setNotifSettings] = useState(getNotificationSettings);
  const [saved, setSaved] = useState(false);

  const toggleRule = (id: string) => {
    setRuleStates(prev => {
      const next = { ...prev, [id]: !prev[id] };
      saveRuleStates(next);
      return next;
    });
  };

  const enabledCount = Object.values(ruleStates).filter(Boolean).length;

  const handleSystemChange = useCallback((key: string, value: string) => {
    setSystemSettings(prev => {
      const next = { ...prev, [key]: value };
      saveSystemSettings(next);
      return next;
    });
    setSaved(true);
    setTimeout(() => setSaved(false), 1500);
  }, []);

  const handleNotifChange = useCallback((key: string) => {
    setNotifSettings(prev => {
      const next = { ...prev, [key]: !prev[key] };
      saveNotificationSettings(next);
      return next;
    });
  }, []);

  // Update page title when system name changes
  useEffect(() => {
    const currentTitle = document.title;
    if (currentTitle.includes('暗链检测系统') && systemSettings.systemName !== '暗链检测系统') {
      document.title = currentTitle.replace('暗链检测系统', systemSettings.systemName);
    }
  }, [systemSettings.systemName]);

  const tabs: { key: SettingsTab; icon: React.ElementType; label: string }[] = [
    { key: 'general', icon: Settings2, label: '通用' },
    { key: 'rules', icon: ShieldCheck, label: '检测规则' },
    { key: 'intel', icon: Shield, label: '情报源' },
    { key: 'apikeys', icon: Key, label: 'API密钥' },
    { key: 'notifications', icon: Bell, label: '通知' },
  ];

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Header */}
      <div className="h-10 px-3 border-b flex items-center gap-2 shrink-0">
        <Settings2 className="h-3.5 w-3.5 text-muted-foreground" />
        <span className="text-xs font-medium">系统设置</span>
      </div>

      {/* Tab bar */}
      <div className="px-3 pt-2 shrink-0">
        <div className="flex items-center gap-1 overflow-x-auto scrollbar-thin">
          {tabs.map(({ key, icon: TabIcon, label }) => (
            <button
              key={key}
              onClick={() => setActiveTab(key)}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-[11px] font-medium transition-colors whitespace-nowrap ${
                activeTab === key
                  ? 'bg-accent text-accent-foreground'
                  : 'text-muted-foreground hover:bg-accent/50 hover:text-foreground'
              }`}
            >
              <TabIcon className="h-3.5 w-3.5" />
              {label}
            </button>
          ))}
        </div>
      </div>

      <Separator className="mt-2" />

      {/* Content */}
      <ScrollArea className="flex-1 min-h-0">
        <div className="p-4 max-w-2xl">
          {activeTab === 'general' && (
            <div className="space-y-5">
              {/* System Name */}
              <section>
                <div className="flex items-center gap-1.5 mb-3">
                  <Settings2 className="h-3.5 w-3.5 text-primary" />
                  <span className="text-xs font-semibold">系统信息</span>
                </div>
                <div className="space-y-3">
                  <div className="flex items-center gap-3">
                    <label className="text-[11px] font-medium text-muted-foreground w-20 shrink-0">系统名称</label>
                    <div className="flex-1 flex items-center gap-2">
                      <Input
                        value={systemSettings.systemName}
                        onChange={(e) => handleSystemChange('systemName', e.target.value)}
                        className="h-8 text-xs"
                        placeholder="暗链检测系统"
                      />
                      {saved && (
                        <CheckCircle2 className="h-4 w-4 text-green-600 shrink-0" />
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-3">
                    <label className="text-[11px] font-medium text-muted-foreground w-20 shrink-0">版本</label>
                    <span className="text-[11px] text-muted-foreground">{APP_VERSION}</span>
                  </div>
                </div>
              </section>

              <Separator />

              {/* Download package */}
              <section>
                <div className="flex items-center gap-1.5 mb-3">
                  <Package className="h-3.5 w-3.5 text-primary" />
                  <span className="text-xs font-semibold">项目打包</span>
                </div>
                <DownloadSection />
              </section>

              <Separator />

              {/* Scan Settings */}
              <section>
                <div className="flex items-center gap-1.5 mb-3">
                  <Server className="h-3.5 w-3.5 text-primary" />
                  <span className="text-xs font-semibold">扫描参数</span>
                </div>
                <div className="space-y-3">
                  <div className="flex items-center gap-3">
                    <label className="text-[11px] font-medium text-muted-foreground w-20 shrink-0">超时时间(秒)</label>
                    <Input
                      type="number"
                      value={systemSettings.scanTimeout}
                      onChange={(e) => handleSystemChange('scanTimeout', e.target.value)}
                      className="h-8 text-xs w-24"
                      min="5"
                      max="120"
                    />
                  </div>
                  <div className="flex items-center gap-3">
                    <label className="text-[11px] font-medium text-muted-foreground w-20 shrink-0">最大并发数</label>
                    <Input
                      type="number"
                      value={systemSettings.maxConcurrency}
                      onChange={(e) => handleSystemChange('maxConcurrency', e.target.value)}
                      className="h-8 text-xs w-24"
                      min="1"
                      max="50"
                    />
                  </div>
                </div>
              </section>

              <Separator />

              {/* Info */}
              <div className="rounded-md border bg-muted/30 px-3 py-2">
                <div className="flex items-start gap-2">
                  <Info className="h-3.5 w-3.5 text-muted-foreground shrink-0 mt-0.5" />
                  <p className="text-[10px] text-muted-foreground leading-relaxed">
                    系统名称将在页面标题和导航中显示。扫描参数修改后将应用于下一次扫描任务。
                  </p>
                </div>
              </div>
            </div>
          )}

          {activeTab === 'rules' && (
            <div className="space-y-4">
              {/* Rules header */}
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-1.5">
                  <ShieldCheck className="h-3.5 w-3.5 text-primary" />
                  <span className="text-xs font-semibold">检测规则</span>
                  <Badge variant="outline" className="text-[9px] px-1.5 py-0">
                    {enabledCount}/{detectionRules.length}
                  </Badge>
                </div>
                <div className="flex items-center gap-1">
                  <button
                    className="text-[10px] text-muted-foreground hover:text-foreground transition-colors px-1"
                    onClick={() => {
                      const allOn: Record<string, boolean> = {};
                      detectionRules.forEach(r => { allOn[r.id] = true; });
                      setRuleStates(allOn);
                      saveRuleStates(allOn);
                    }}
                  >
                    全部启用
                  </button>
                  <span className="text-[10px] text-muted-foreground">|</span>
                  <button
                    className="text-[10px] text-muted-foreground hover:text-foreground transition-colors px-1"
                    onClick={() => {
                      const allOff: Record<string, boolean> = {};
                      detectionRules.forEach(r => { allOff[r.id] = false; });
                      setRuleStates(allOff);
                      saveRuleStates(allOff);
                    }}
                  >
                    全部禁用
                  </button>
                </div>
              </div>

              {/* Rules list */}
              <div className="space-y-1">
                {detectionRules.map((rule) => {
                  const Icon = rule.icon;
                  const isEnabled = ruleStates[rule.id] !== false;
                  return (
                    <div
                      key={rule.id}
                      className={`flex items-center gap-2.5 rounded-md border px-3 py-2 transition-colors ${
                        isEnabled ? 'bg-card' : 'bg-muted/30 opacity-60'
                      }`}
                    >
                      <Icon className={`h-4 w-4 shrink-0 ${isEnabled ? 'text-primary' : 'text-muted-foreground'}`} />
                      <div className="flex-1 min-w-0">
                        <p className="text-[11px] font-medium leading-tight">{rule.name}</p>
                        <p className="text-[10px] text-muted-foreground leading-tight mt-0.5">{rule.description}</p>
                      </div>
                      <Switch
                        checked={isEnabled}
                        onCheckedChange={() => toggleRule(rule.id)}
                        className="scale-75 shrink-0"
                      />
                    </div>
                  );
                })}
              </div>

              {/* Info section */}
              <div className="rounded-md border bg-muted/30 px-3 py-2">
                <div className="flex items-start gap-2">
                  <Info className="h-3.5 w-3.5 text-muted-foreground shrink-0 mt-0.5" />
                  <div>
                    <p className="text-[10px] text-muted-foreground leading-relaxed">
                      检测规则控制扫描时启用的暗链检测方式。禁用某些规则可能加快扫描速度，但也可能遗漏特定类型的暗链。
                    </p>
                  </div>
                </div>
              </div>
            </div>
          )}

          {activeTab === 'intel' && (
            <div className="space-y-4">
              <div className="flex items-center gap-1.5">
                <Shield className="h-3.5 w-3.5 text-primary" />
                <span className="text-xs font-semibold">情报源配置</span>
              </div>

              {/* Auto update setting */}
              <div className="flex items-center gap-3 rounded-md border px-3 py-2.5">
                <Clock className="h-4 w-4 text-primary shrink-0" />
                <div className="flex-1">
                  <p className="text-[11px] font-medium">自动更新频率</p>
                  <p className="text-[10px] text-muted-foreground">设置情报源数据自动更新间隔</p>
                </div>
                <select
                  value={systemSettings.autoUpdateHours}
                  onChange={(e) => handleSystemChange('autoUpdateHours', e.target.value)}
                  className="h-7 text-[11px] rounded-md border bg-background px-2"
                >
                  <option value="6">每6小时</option>
                  <option value="12">每12小时</option>
                  <option value="24">每24小时</option>
                  <option value="48">每48小时</option>
                </select>
              </div>

              <Separator />

              {/* Source status table */}
              <div>
                <div className="text-[11px] font-medium mb-2">情报源状态</div>
                <IntelSourceStatus />
              </div>

              <div className="rounded-md border bg-muted/30 px-3 py-2">
                <div className="flex items-start gap-2">
                  <Info className="h-3.5 w-3.5 text-muted-foreground shrink-0 mt-0.5" />
                  <div>
                    <p className="text-[10px] text-muted-foreground leading-relaxed">
                      免费情报源（如URLhaus、Blocklist.de等）通过公开数据订阅自动采集，无需API密钥。
                      部分情报源（微步ThreatBook、AlienVault OTX、ThreatFox）需要API密钥才能采集数据，
                      请在「API密钥」选项卡中配置对应的密钥。
                    </p>
                  </div>
                </div>
              </div>
            </div>
          )}

          {activeTab === 'apikeys' && (
            <ApiKeySettings />
          )}

          {activeTab === 'notifications' && (
            <div className="space-y-4">
              <div className="flex items-center gap-1.5">
                <Bell className="h-3.5 w-3.5 text-primary" />
                <span className="text-xs font-semibold">通知设置</span>
              </div>

              <div className="space-y-1">
                <div className="flex items-center gap-2.5 rounded-md border px-3 py-2">
                  <CheckCircle2 className="h-4 w-4 text-green-600 shrink-0" />
                  <div className="flex-1">
                    <p className="text-[11px] font-medium">扫描完成通知</p>
                    <p className="text-[10px] text-muted-foreground">扫描任务完成时显示通知</p>
                  </div>
                  <Switch
                    checked={notifSettings.scanComplete !== false}
                    onCheckedChange={() => handleNotifChange('scanComplete')}
                    className="scale-75 shrink-0"
                  />
                </div>

                <div className="flex items-center gap-2.5 rounded-md border px-3 py-2">
                  <ShieldAlert className="h-4 w-4 text-red-500 shrink-0" />
                  <div className="flex-1">
                    <p className="text-[11px] font-medium">扫描错误通知</p>
                    <p className="text-[10px] text-muted-foreground">扫描任务出错时显示通知</p>
                  </div>
                  <Switch
                    checked={notifSettings.scanError !== false}
                    onCheckedChange={() => handleNotifChange('scanError')}
                    className="scale-75 shrink-0"
                  />
                </div>

                <div className="flex items-center gap-2.5 rounded-md border px-3 py-2">
                  <RefreshCw className="h-4 w-4 text-blue-500 shrink-0" />
                  <div className="flex-1">
                    <p className="text-[11px] font-medium">情报源更新通知</p>
                    <p className="text-[10px] text-muted-foreground">情报源数据更新完成时显示通知</p>
                  </div>
                  <Switch
                    checked={notifSettings.intelUpdate === true}
                    onCheckedChange={() => handleNotifChange('intelUpdate')}
                    className="scale-75 shrink-0"
                  />
                </div>
              </div>
            </div>
          )}
        </div>
      </ScrollArea>
    </div>
  );
}

// ─── API Key Settings Component ──────────────────────────────────────────────

function ApiKeySettings() {
  const [apiKeys, setApiKeys] = useState<Record<string, { masked: string; enabled: boolean }>>({});
  const [sources, setSources] = useState<Array<{
    id: string; name: string; description: string; registerUrl: string; apiKeyPlaceholder: string; docUrl: string;
  }>>([]);
  const [loading, setLoading] = useState(true);
  const [editValues, setEditValues] = useState<Record<string, string>>({});
  const [showKeys, setShowKeys] = useState<Record<string, boolean>>({});
  const [saving, setSaving] = useState<Record<string, boolean>>({});
  const [saveResults, setSaveResults] = useState<Record<string, 'success' | 'error'>>({});

  // Load API keys on mount
  useEffect(() => {
    loadApiKeys();
  }, []);

  async function loadApiKeys() {
    try {
      const res = await fetch('/api/threat-intel/api-keys');
      if (!res.ok) throw new Error('Failed to fetch');
      const data = await res.json();
      setSources(data.sources || []);
      
      const keyMap: Record<string, { masked: string; enabled: boolean }> = {};
      for (const k of data.keys || []) {
        keyMap[k.source] = { masked: k.apiKey, enabled: k.enabled };
      }
      setApiKeys(keyMap);
    } catch (err) {
      console.error('Failed to load API keys:', err);
    } finally {
      setLoading(false);
    }
  }

  async function saveApiKey(source: string) {
    const value = editValues[source];
    if (value === undefined) return;
    
    setSaving(prev => ({ ...prev, [source]: true }));
    setSaveResults(prev => ({ ...prev, [source]: undefined as any }));
    
    try {
      const res = await fetch('/api/threat-intel/api-keys', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ source, apiKey: value }),
      });
      
      if (!res.ok) throw new Error('Failed to save');
      
      const data = await res.json();
      setApiKeys(prev => ({
        ...prev,
        [source]: { masked: data.apiKey, enabled: data.enabled },
      }));
      setEditValues(prev => {
        const next = { ...prev };
        delete next[source];
        return next;
      });
      setSaveResults(prev => ({ ...prev, [source]: 'success' }));
      
      // Clear success message after 3 seconds
      setTimeout(() => {
        setSaveResults(prev => ({ ...prev, [source]: undefined as any }));
      }, 3000);
    } catch (err) {
      setSaveResults(prev => ({ ...prev, [source]: 'error' }));
    } finally {
      setSaving(prev => ({ ...prev, [source]: false }));
    }
  }

  async function deleteApiKey(source: string) {
    if (!confirm('确定要删除此API密钥吗？')) return;
    
    try {
      const res = await fetch(`/api/threat-intel/api-keys?source=${source}`, { method: 'DELETE' });
      if (!res.ok) throw new Error('Failed to delete');
      
      setApiKeys(prev => {
        const next = { ...prev };
        delete next[source];
        return next;
      });
      setEditValues(prev => {
        const next = { ...prev };
        delete next[source];
        return next;
      });
    } catch (err) {
      console.error('Failed to delete API key:', err);
    }
  }

  async function toggleEnabled(source: string) {
    const current = apiKeys[source];
    if (!current) return;
    
    try {
      const res = await fetch('/api/threat-intel/api-keys', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ source, apiKey: '__keep__', enabled: !current.enabled }),
      });
      
      if (!res.ok) throw new Error('Failed to toggle');
      
      const data = await res.json();
      setApiKeys(prev => ({
        ...prev,
        [source]: { ...prev[source], enabled: data.enabled },
      }));
    } catch (err) {
      console.error('Failed to toggle API key:', err);
    }
  }

  if (loading) {
    return (
      <div className="flex items-center gap-2 py-8 justify-center">
        <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
        <span className="text-[11px] text-muted-foreground">加载API密钥配置...</span>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-1.5">
        <Key className="h-3.5 w-3.5 text-primary" />
        <span className="text-xs font-semibold">API密钥配置</span>
      </div>

      {/* Explanation */}
      <div className="rounded-md border bg-muted/30 px-3 py-2">
        <div className="flex items-start gap-2">
          <Info className="h-3.5 w-3.5 text-muted-foreground shrink-0 mt-0.5" />
          <div className="space-y-1">
            <p className="text-[10px] text-muted-foreground leading-relaxed">
              部分情报源需要API密钥才能采集数据。API密钥用于从这些平台获取威胁情报数据（批量采集），而非仅用于查询。
              配置密钥后，下次数据更新时将自动从对应平台采集数据。
            </p>
            <p className="text-[10px] text-muted-foreground leading-relaxed">
              密钥安全存储在本地数据库中，传输和显示时均会脱敏处理。
            </p>
          </div>
        </div>
      </div>

      {/* API Key cards for each source */}
      <div className="space-y-3">
        {sources.map(source => {
          const existingKey = apiKeys[source.id];
          const isEditing = editValues[source.id] !== undefined;
          const isSaving = saving[source.id];
          const saveResult = saveResults[source.id];

          return (
            <div key={source.id} className="rounded-md border overflow-hidden">
              {/* Header */}
              <div className="flex items-center gap-2 px-3 py-2 bg-muted/20">
                <Key className={`h-4 w-4 shrink-0 ${existingKey ? 'text-green-600' : 'text-yellow-600'}`} />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1.5">
                    <span className="text-[11px] font-semibold">{source.name}</span>
                    {existingKey ? (
                      <Badge variant="outline" className="text-[8px] px-1 py-0 text-green-600 border-green-300">
                        已配置
                      </Badge>
                    ) : (
                      <Badge variant="outline" className="text-[8px] px-1 py-0 text-yellow-600 border-yellow-300">
                        未配置
                      </Badge>
                    )}
                  </div>
                  <p className="text-[10px] text-muted-foreground">{source.description}</p>
                </div>
                {existingKey && (
                  <Switch
                    checked={existingKey.enabled}
                    onCheckedChange={() => toggleEnabled(source.id)}
                    className="scale-75 shrink-0"
                  />
                )}
              </div>

              {/* Content */}
              <div className="px-3 py-2 space-y-2">
                {/* Current key display / edit */}
                <div className="flex items-center gap-2">
                  <label className="text-[10px] font-medium text-muted-foreground w-14 shrink-0">密钥</label>
                  {isEditing ? (
                    <div className="flex-1 flex items-center gap-1.5">
                      <Input
                        type={showKeys[source.id] ? 'text' : 'password'}
                        value={editValues[source.id]}
                        onChange={(e) => setEditValues(prev => ({ ...prev, [source.id]: e.target.value }))}
                        className="h-7 text-[11px] font-mono"
                        placeholder={source.apiKeyPlaceholder}
                      />
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-7 w-7 p-0 shrink-0"
                        onClick={() => setShowKeys(prev => ({ ...prev, [source.id]: !prev[source.id] }))}
                      >
                        {showKeys[source.id] ? <EyeOffIcon className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                      </Button>
                    </div>
                  ) : (
                    <div className="flex-1 flex items-center gap-1.5">
                      <code className="text-[11px] font-mono text-muted-foreground bg-muted/50 px-2 py-0.5 rounded flex-1 truncate">
                        {existingKey ? existingKey.masked : '••••••••'}
                      </code>
                    </div>
                  )}
                </div>

                {/* Action buttons */}
                <div className="flex items-center gap-2 justify-end">
                  {isEditing ? (
                    <>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-6 text-[10px] px-2"
                        onClick={() => {
                          setEditValues(prev => {
                            const next = { ...prev };
                            delete next[source.id];
                            return next;
                          });
                          setShowKeys(prev => {
                            const next = { ...prev };
                            delete next[source.id];
                            return next;
                          });
                        }}
                        disabled={isSaving}
                      >
                        取消
                      </Button>
                      <Button
                        size="sm"
                        className="h-6 text-[10px] px-2"
                        onClick={() => saveApiKey(source.id)}
                        disabled={isSaving || !editValues[source.id]}
                      >
                        {isSaving ? (
                          <Loader2 className="h-3 w-3 animate-spin" />
                        ) : saveResult === 'success' ? (
                          <CheckCircle2 className="h-3 w-3" />
                        ) : saveResult === 'error' ? (
                          <AlertTriangle className="h-3 w-3" />
                        ) : (
                          <Save className="h-3 w-3" />
                        )}
                        保存
                      </Button>
                    </>
                  ) : (
                    <>
                      {existingKey && (
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-6 text-[10px] px-2 text-destructive hover:text-destructive"
                          onClick={() => deleteApiKey(source.id)}
                        >
                          <Trash2 className="h-3 w-3" />
                          删除
                        </Button>
                      )}
                      <Button
                        variant="outline"
                        size="sm"
                        className="h-6 text-[10px] px-2"
                        onClick={() => setEditValues(prev => ({ ...prev, [source.id]: '' }))}
                      >
                        <Key className="h-3 w-3" />
                        {existingKey ? '更新密钥' : '配置密钥'}
                      </Button>
                    </>
                  )}
                </div>

                {/* Register link */}
                <div className="flex items-center gap-2">
                  <a
                    href={source.registerUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-[10px] text-primary hover:underline flex items-center gap-0.5"
                  >
                    <ExternalLink className="h-3 w-3" />
                    注册获取API密钥
                  </a>
                  <span className="text-[10px] text-muted-foreground">·</span>
                  <a
                    href={source.docUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-[10px] text-muted-foreground hover:text-foreground hover:underline flex items-center gap-0.5"
                  >
                    <ExternalLink className="h-3 w-3" />
                    API文档
                  </a>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─── Download Section Component ──────────────────────────────────────────────

function DownloadSection() {
  const [archiveInfo, setArchiveInfo] = useState<{
    name: string;
    size: number;
    sizeMB: string;
    downloadUrl: string;
  } | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  useEffect(() => {
    fetch('/api/download')
      .then(res => {
        if (!res.ok) throw new Error('Not found');
        return res.json();
      })
      .then(data => {
        setArchiveInfo(data);
        setLoading(false);
      })
      .catch(() => {
        setError(true);
        setLoading(false);
      });
  }, []);

  if (loading) {
    return (
      <div className="flex items-center gap-2 py-2">
        <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />
        <span className="text-[10px] text-muted-foreground">加载中...</span>
      </div>
    );
  }

  if (error || !archiveInfo) {
    return (
      <div className="rounded-md border bg-muted/30 px-3 py-2">
        <p className="text-[10px] text-muted-foreground">暂无可用下载包</p>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-3 rounded-md border px-3 py-2.5">
        <div className="flex items-center justify-center w-8 h-8 rounded-md bg-primary/10 shrink-0">
          <Package className="h-4 w-4 text-primary" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-[11px] font-medium truncate">{archiveInfo.name}</p>
          <p className="text-[10px] text-muted-foreground">{archiveInfo.sizeMB} MB</p>
        </div>
        <a
          href={archiveInfo.downloadUrl}
          className="inline-flex items-center gap-1 rounded-md bg-primary px-3 py-1.5 text-[10px] font-medium text-primary-foreground hover:bg-primary/90 transition-colors shrink-0"
        >
          <Download className="h-3 w-3" />
          下载
        </a>
      </div>
      <div className="rounded-md border bg-muted/30 px-3 py-2">
        <div className="flex items-start gap-2">
          <Info className="h-3 w-3 text-muted-foreground shrink-0 mt-0.5" />
          <p className="text-[10px] text-muted-foreground leading-relaxed">
            下载完整项目包后，解压并运行 <code className="bg-muted px-1 py-0.5 rounded text-[9px]">bash start.sh</code> 即可一键启动。
            默认账号 <code className="bg-muted px-1 py-0.5 rounded text-[9px]">admin</code> / <code className="bg-muted px-1 py-0.5 rounded text-[9px]">admin123</code>
          </p>
        </div>
      </div>
    </div>
  );
}

// Inline component to show intel source status
function IntelSourceStatus() {
  const [sources, setSources] = useState<Array<{
    id: string; name: string; description: string; domainCount: number; ipCount: number; totalCount: number;
    requiresApiKey?: boolean; apiKeyConfigured?: boolean; dataType?: string;
  }>>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch('/api/threat-intel/sources')
      .then(res => res.json())
      .then(data => {
        setSources(data.sources || []);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, []);

  if (loading) {
    return <div className="text-[10px] text-muted-foreground py-2">加载中...</div>;
  }

  return (
    <div className="space-y-1">
      {sources.map(source => (
        <div key={source.id} className="flex items-center gap-2 rounded-md border px-2.5 py-1.5 text-[10px]">
          <span className="font-medium min-w-[100px]">{source.name}</span>
          <span className="text-muted-foreground flex-1 truncate">{source.description}</span>
          <div className="flex items-center gap-2 shrink-0">
            {source.requiresApiKey && !source.apiKeyConfigured && (
              <Badge variant="outline" className="text-[8px] px-1 py-0 text-yellow-600 border-yellow-300">
                需配置密钥
              </Badge>
            )}
            {source.requiresApiKey && source.apiKeyConfigured && (
              <Badge variant="outline" className="text-[8px] px-1 py-0 text-green-600 border-green-300">
                密钥已配置
              </Badge>
            )}
            {source.dataType === 'fingerprint' && source.totalCount > 0 && (
              <Badge variant="outline" className="text-[8px] px-1 py-0 text-blue-600 border-blue-300">
                指纹 {source.totalCount.toLocaleString()}
              </Badge>
            )}
            {source.domainCount > 0 && source.dataType !== 'fingerprint' && (
              <Badge variant="outline" className="text-[8px] px-1 py-0">
                域名 {source.domainCount.toLocaleString()}
              </Badge>
            )}
            {source.ipCount > 0 && (
              <Badge variant="outline" className="text-[8px] px-1 py-0">
                IP {source.ipCount.toLocaleString()}
              </Badge>
            )}
            {!source.requiresApiKey && source.totalCount === 0 && (
              <Badge variant="outline" className="text-[8px] px-1 py-0 text-yellow-600 border-yellow-300">
                无数据
              </Badge>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}
