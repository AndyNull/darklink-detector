'use client';

import { useState } from 'react';
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from '@/components/ui/sheet';
import { Switch } from '@/components/ui/switch';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Separator } from '@/components/ui/separator';
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
  } catch {}
  // Default: all enabled
  const defaults: Record<string, boolean> = {};
  detectionRules.forEach(r => { defaults[r.id] = true; });
  return defaults;
}

function saveRuleStates(states: Record<string, boolean>) {
  try {
    localStorage.setItem('detection-rules-states', JSON.stringify(states));
  } catch {}
}

export function SettingsDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const [ruleStates, setRuleStates] = useState<Record<string, boolean>>(getRuleStates);

  const toggleRule = (id: string) => {
    setRuleStates(prev => {
      const next = { ...prev, [id]: !prev[id] };
      saveRuleStates(next);
      return next;
    });
  };

  const enabledCount = Object.values(ruleStates).filter(Boolean).length;

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-[360px] sm:max-w-[400px] p-0 gap-0">
        <SheetHeader className="px-4 pt-4 pb-2">
          <SheetTitle className="text-sm flex items-center gap-2">
            <Settings2 className="h-4 w-4" />
            系统设置
          </SheetTitle>
          <SheetDescription className="text-[11px]">
            配置检测规则和系统参数
          </SheetDescription>
        </SheetHeader>

        <Separator />

        <ScrollArea className="flex-1">
          <div className="px-4 py-3 space-y-4">
            {/* Detection Rules Section */}
            <div>
              <div className="flex items-center justify-between mb-2">
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
        </ScrollArea>
      </SheetContent>
    </Sheet>
  );
}
