'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { useAuth } from '@/lib/auth-context';
import { toast } from 'sonner';
import { DETECTION_RULES, RULE_CATEGORIES } from './types';
import { loadRules, saveRules } from './helpers';
import { RuleItem } from './rule-item';

export function DetectionRulesSection() {
  const { requireAuth } = useAuth();
  const [rules, setRules] = useState<Record<string, boolean>>(() => loadRules());

  const handleToggle = (id: string, enabled: boolean) => {
    if (!requireAuth(() => {})) return;
    setRules(prev => {
      const next = { ...prev, [id]: enabled };
      saveRules(next);
      return next;
    });
    toast.success(enabled ? `规则 ${id} 已启用` : `规则 ${id} 已禁用`);
  };

  // Must match the display logic: rules[rule.id] ?? rule.defaultEnabled
  const enabledCount = DETECTION_RULES.filter(r => rules[r.id] ?? r.defaultEnabled).length;
  const totalCount = DETECTION_RULES.length;

  const handleReset = () => {
    if (!requireAuth(() => {})) return;
    const defaults: Record<string, boolean> = {};
    DETECTION_RULES.forEach(r => { defaults[r.id] = r.defaultEnabled; });
    setRules(defaults);
    saveRules(defaults);
    toast.success('规则已恢复默认');
  };

  const handleToggleAll = () => {
    if (!requireAuth(() => {})) return;
    const allEnabled = enabledCount === totalCount;
    const next: Record<string, boolean> = {};
    DETECTION_RULES.forEach(r => { next[r.id] = !allEnabled; });
    setRules(next);
    saveRules(next);
  };

  return (
    <div className="space-y-3">
      <div className="text-[11px] text-muted-foreground">
        管理暗链检测规则，控制各类隐藏方式的检测灵敏度
      </div>

      {/* Summary */}
      <div className="flex items-center justify-between">
        <div className="text-[11px] text-muted-foreground">
          已启用 <span className="font-medium text-foreground">{enabledCount}</span> / {totalCount} 条规则
        </div>
        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="sm"
            className="text-[10px] h-6 gap-1 px-2 cursor-pointer transition-colors hover:bg-accent hover:text-accent-foreground"
            onClick={handleToggleAll}
          >
            {enabledCount === totalCount ? '全部关闭' : '全部开启'}
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="text-[10px] h-6 gap-1 px-2"
            onClick={handleReset}
          >
            恢复默认
          </Button>
        </div>
      </div>

      {/* Rule categories - dynamically rendered from RULE_CATEGORIES */}
      {RULE_CATEGORIES.map(category => {
        const Icon = category.icon;
        const categoryRules = DETECTION_RULES.filter(r => category.ruleIds.includes(r.id));
        if (categoryRules.length === 0) return null;
        return (
          <div key={category.label} className="space-y-1">
            <div className="text-[10px] font-medium text-muted-foreground px-1 flex items-center gap-1">
              <Icon className="h-3 w-3" />
              {category.label} ({categoryRules.length})
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-1">
              {categoryRules.map(rule => (
                <RuleItem
                  key={rule.id}
                  rule={rule}
                  enabled={rules[rule.id] ?? rule.defaultEnabled}
                  onToggle={handleToggle}
                />
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}
