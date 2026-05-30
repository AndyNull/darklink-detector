'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Globe,
  Wrench,
  Info,
} from 'lucide-react';
import {
  getSystemConfig,
  setSystemConfig,
} from '@/lib/system-config';
import { useAuth } from '@/lib/auth-context';
import { toast } from 'sonner';

export function SystemSettingsSection() {
  const { requireAuth } = useAuth();
  const [systemName, setSystemName] = useState(() => getSystemConfig().systemName);
  const [pageTitle, setPageTitle] = useState(() => getSystemConfig().pageTitle);
  const [copyright, setCopyright] = useState(() => getSystemConfig().copyright);

  const handleSaveSystemName = () => {
    if (!requireAuth(() => {})) return;
    setSystemConfig({ systemName });
    toast.success('保存成功');
  };

  const handleSavePageTitle = () => {
    if (!requireAuth(() => {})) return;
    setSystemConfig({ pageTitle });
    toast.success('保存成功');
  };

  const handleSaveCopyright = () => {
    if (!requireAuth(() => {})) return;
    setSystemConfig({ copyright });
    toast.success('保存成功');
  };

  return (
    <div className="space-y-3">
      <div className="text-[11px] text-muted-foreground">
        配置系统基本信息，包括名称、网页标题和版权信息
      </div>

      {/* System Name */}
      <div className="rounded border px-3 py-2 space-y-1.5">
        <div className="flex items-center gap-1.5">
          <Wrench className="h-3 w-3 text-muted-foreground shrink-0" />
          <span className="text-[11px] font-medium">系统名称</span>
        </div>
        <div className="flex items-center gap-1">
          <Input
            value={systemName}
            onChange={(e) => setSystemName(e.target.value)}
            className="h-8 text-xs"
            placeholder="输入系统名称"
          />
          <Button
            variant="outline"
            size="sm"
            className="h-8 text-[10px] px-2 shrink-0"
            onClick={handleSaveSystemName}
          >
            保存
          </Button>
        </div>
      </div>

      {/* Page Title */}
      <div className="rounded border px-3 py-2 space-y-1.5">
        <div className="flex items-center gap-1.5">
          <Globe className="h-3 w-3 text-muted-foreground shrink-0" />
          <span className="text-[11px] font-medium">网页标题</span>
        </div>
        <div className="flex items-center gap-1">
          <Input
            value={pageTitle}
            onChange={(e) => setPageTitle(e.target.value)}
            className="h-8 text-xs"
            placeholder="输入网页标题"
          />
          <Button
            variant="outline"
            size="sm"
            className="h-8 text-[10px] px-2 shrink-0"
            onClick={handleSavePageTitle}
          >
            保存
          </Button>
        </div>
      </div>

      {/* Copyright */}
      <div className="rounded border px-3 py-2 space-y-1.5">
        <div className="flex items-center gap-1.5">
          <Info className="h-3 w-3 text-muted-foreground shrink-0" />
          <span className="text-[11px] font-medium">版权信息</span>
        </div>
        <div className="flex items-center gap-1">
          <Input
            value={copyright}
            onChange={(e) => setCopyright(e.target.value)}
            className="h-8 text-xs"
            placeholder="输入版权信息"
          />
          <Button
            variant="outline"
            size="sm"
            className="h-8 text-[10px] px-2 shrink-0"
            onClick={handleSaveCopyright}
          >
            保存
          </Button>
        </div>
      </div>
    </div>
  );
}
