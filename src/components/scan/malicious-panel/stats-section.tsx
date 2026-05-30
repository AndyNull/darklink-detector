'use client';

import { Badge } from '@/components/ui/badge';
import { MaliciousStats, severityColors } from './types';

interface StatsSectionProps {
  stats: MaliciousStats | null;
}

export function StatsSection({ stats }: StatsSectionProps) {
  if (!stats || stats.total <= 0) return null;

  return (
    <div className="px-3 py-1 border-b flex items-center gap-1.5 shrink-0 flex-wrap">
      <span className="text-[9px] text-muted-foreground">严重性:</span>
      {stats.bySeverity.critical > 0 && (
        <Badge className={`text-[8px] px-1 py-0 ${severityColors.critical}`}>
          严重 {stats.bySeverity.critical}
        </Badge>
      )}
      {stats.bySeverity.high > 0 && (
        <Badge className={`text-[8px] px-1 py-0 ${severityColors.high}`}>
          高危 {stats.bySeverity.high}
        </Badge>
      )}
      {stats.bySeverity.medium > 0 && (
        <Badge className={`text-[8px] px-1 py-0 ${severityColors.medium}`}>
          中危 {stats.bySeverity.medium}
        </Badge>
      )}
      {stats.bySeverity.low > 0 && (
        <Badge className={`text-[8px] px-1 py-0 ${severityColors.low}`}>
          低危 {stats.bySeverity.low}
        </Badge>
      )}
      <div className="flex-1" />
      {stats.active < stats.total && (
        <span className="text-[9px] text-muted-foreground">
          {stats.active}/{stats.total} 启用
        </span>
      )}
    </div>
  );
}
