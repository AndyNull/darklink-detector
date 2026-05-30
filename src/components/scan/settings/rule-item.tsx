'use client';

import { Switch } from '@/components/ui/switch';
import { Badge } from '@/components/ui/badge';
import { DetectionRule } from './types';

export function RuleItem({
  rule,
  enabled,
  onToggle,
}: {
  rule: DetectionRule;
  enabled: boolean;
  onToggle: (id: string, enabled: boolean) => void;
}) {
  return (
    <div className="flex items-center gap-2 rounded border px-3 py-2">
      <Switch
        checked={enabled}
        onCheckedChange={(checked) => onToggle(rule.id, checked)}
        className="scale-75 origin-left cursor-pointer"
      />
      <div className="flex-1 min-w-0">
        <div className="text-[11px] font-medium">{rule.name}</div>
        <div className="text-[9px] text-muted-foreground truncate">{rule.description}</div>
      </div>
      <Badge variant={enabled ? 'default' : 'outline'} className="text-[8px] px-1 py-0 shrink-0">
        {rule.id}
      </Badge>
    </div>
  );
}
