'use client';

import React from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Shield,
  Server,
  Loader2,
  Database,
  User,
  Lock,
  Plug,
} from 'lucide-react';
import { DatabaseConfig } from '../types';

export interface ConnectionFormProps {
  config: DatabaseConfig;
  onConfigChange: React.Dispatch<React.SetStateAction<DatabaseConfig>>;
  saving: boolean;
  testing: boolean;
  onSave: () => void;
  onTestConnection: () => void;
}

export function ConnectionForm({
  config,
  onConfigChange,
  saving,
  testing,
  onSave,
  onTestConnection,
}: ConnectionFormProps) {
  return (
    <div className="space-y-3">
      <div className="text-[11px] text-muted-foreground">
        配置数据库连接参数，支持SQLite、MySQL和PostgreSQL
      </div>

      {/* Database Type Selection */}
      <div className="rounded border px-3 py-2 space-y-1.5">
        <div className="flex items-center gap-1.5">
          <Database className="h-3 w-3 text-muted-foreground shrink-0" />
          <span className="text-[11px] font-medium">数据库类型</span>
        </div>
        <Select value={config.type} onValueChange={(val: 'sqlite' | 'mysql' | 'postgresql') => onConfigChange(prev => ({ ...prev, type: val }))}>
          <SelectTrigger className="h-8 text-xs">
            <SelectValue placeholder="选择数据库类型" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="sqlite">SQLite</SelectItem>
            <SelectItem value="mysql">MySQL</SelectItem>
            <SelectItem value="postgresql">PostgreSQL</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* SQLite Config */}
      {config.type === 'sqlite' && (
        <div className="rounded border px-3 py-2 space-y-1.5">
          <div className="flex items-center gap-1.5">
            <Server className="h-3 w-3 text-muted-foreground shrink-0" />
            <span className="text-[11px] font-medium">SQLite 文件路径</span>
          </div>
          <Input
            value={config.sqlite.path}
            onChange={(e) => onConfigChange(prev => ({ ...prev, sqlite: { ...prev.sqlite, path: e.target.value } }))}
            className="h-8 text-xs"
            placeholder="./db/data.db"
          />
        </div>
      )}

      {/* MySQL Config */}
      {config.type === 'mysql' && (
        <>
          <div className="rounded border px-3 py-2 space-y-1.5">
            <div className="flex items-center gap-1.5">
              <Server className="h-3 w-3 text-muted-foreground shrink-0" />
              <span className="text-[11px] font-medium">主机地址</span>
            </div>
            <Input
              value={config.mysql.host}
              onChange={(e) => onConfigChange(prev => ({ ...prev, mysql: { ...prev.mysql, host: e.target.value } }))}
              className="h-8 text-xs"
              placeholder="localhost"
            />
          </div>
          <div className="rounded border px-3 py-2 space-y-1.5">
            <div className="flex items-center gap-1.5">
              <Plug className="h-3 w-3 text-muted-foreground shrink-0" />
              <span className="text-[11px] font-medium">端口</span>
            </div>
            <Input
              type="number"
              value={config.mysql.port}
              onChange={(e) => onConfigChange(prev => ({ ...prev, mysql: { ...prev.mysql, port: parseInt(e.target.value) || 3306 } }))}
              className="h-8 text-xs"
              placeholder="3306"
            />
          </div>
          <div className="rounded border px-3 py-2 space-y-1.5">
            <div className="flex items-center gap-1.5">
              <Database className="h-3 w-3 text-muted-foreground shrink-0" />
              <span className="text-[11px] font-medium">数据库名</span>
            </div>
            <Input
              value={config.mysql.database}
              onChange={(e) => onConfigChange(prev => ({ ...prev, mysql: { ...prev.mysql, database: e.target.value } }))}
              className="h-8 text-xs"
              placeholder="darklink"
            />
          </div>
          <div className="rounded border px-3 py-2 space-y-1.5">
            <div className="flex items-center gap-1.5">
              <User className="h-3 w-3 text-muted-foreground shrink-0" />
              <span className="text-[11px] font-medium">用户名</span>
            </div>
            <Input
              value={config.mysql.username}
              onChange={(e) => onConfigChange(prev => ({ ...prev, mysql: { ...prev.mysql, username: e.target.value } }))}
              className="h-8 text-xs"
              placeholder="root"
            />
          </div>
          <div className="rounded border px-3 py-2 space-y-1.5">
            <div className="flex items-center gap-1.5">
              <Lock className="h-3 w-3 text-muted-foreground shrink-0" />
              <span className="text-[11px] font-medium">密码</span>
            </div>
            <Input
              type="password"
              value={config.mysql.password}
              onChange={(e) => onConfigChange(prev => ({ ...prev, mysql: { ...prev.mysql, password: e.target.value } }))}
              className="h-8 text-xs"
              placeholder="输入密码"
            />
          </div>
        </>
      )}

      {/* PostgreSQL Config */}
      {config.type === 'postgresql' && (
        <>
          <div className="rounded border px-3 py-2 space-y-1.5">
            <div className="flex items-center gap-1.5">
              <Server className="h-3 w-3 text-muted-foreground shrink-0" />
              <span className="text-[11px] font-medium">主机地址</span>
            </div>
            <Input
              value={config.postgresql.host}
              onChange={(e) => onConfigChange(prev => ({ ...prev, postgresql: { ...prev.postgresql, host: e.target.value } }))}
              className="h-8 text-xs"
              placeholder="localhost"
            />
          </div>
          <div className="rounded border px-3 py-2 space-y-1.5">
            <div className="flex items-center gap-1.5">
              <Plug className="h-3 w-3 text-muted-foreground shrink-0" />
              <span className="text-[11px] font-medium">端口</span>
            </div>
            <Input
              type="number"
              value={config.postgresql.port}
              onChange={(e) => onConfigChange(prev => ({ ...prev, postgresql: { ...prev.postgresql, port: parseInt(e.target.value) || 5432 } }))}
              className="h-8 text-xs"
              placeholder="5432"
            />
          </div>
          <div className="rounded border px-3 py-2 space-y-1.5">
            <div className="flex items-center gap-1.5">
              <Database className="h-3 w-3 text-muted-foreground shrink-0" />
              <span className="text-[11px] font-medium">数据库名</span>
            </div>
            <Input
              value={config.postgresql.database}
              onChange={(e) => onConfigChange(prev => ({ ...prev, postgresql: { ...prev.postgresql, database: e.target.value } }))}
              className="h-8 text-xs"
              placeholder="darklink"
            />
          </div>
          <div className="rounded border px-3 py-2 space-y-1.5">
            <div className="flex items-center gap-1.5">
              <User className="h-3 w-3 text-muted-foreground shrink-0" />
              <span className="text-[11px] font-medium">用户名</span>
            </div>
            <Input
              value={config.postgresql.username}
              onChange={(e) => onConfigChange(prev => ({ ...prev, postgresql: { ...prev.postgresql, username: e.target.value } }))}
              className="h-8 text-xs"
              placeholder="postgres"
            />
          </div>
          <div className="rounded border px-3 py-2 space-y-1.5">
            <div className="flex items-center gap-1.5">
              <Lock className="h-3 w-3 text-muted-foreground shrink-0" />
              <span className="text-[11px] font-medium">密码</span>
            </div>
            <Input
              type="password"
              value={config.postgresql.password}
              onChange={(e) => onConfigChange(prev => ({ ...prev, postgresql: { ...prev.postgresql, password: e.target.value } }))}
              className="h-8 text-xs"
              placeholder="输入密码"
            />
          </div>
          <div className="rounded border px-3 py-2 space-y-2">
            <div className="flex items-center gap-1.5">
              <Shield className="h-3 w-3 text-muted-foreground shrink-0" />
              <span className="text-[11px] font-medium">SSL连接</span>
            </div>
            <div className="flex items-center gap-2">
              <Switch
                checked={config.postgresql.ssl}
                onCheckedChange={(checked) => onConfigChange(prev => ({ ...prev, postgresql: { ...prev.postgresql, ssl: checked } }))}
                className="scale-75 origin-left cursor-pointer"
              />
              <span className="text-[10px] text-muted-foreground">
                {config.postgresql.ssl ? '已启用' : '已关闭'}
              </span>
            </div>
          </div>
        </>
      )}

      {/* Action Buttons */}
      <div className="flex items-center gap-2">
        <Button
          variant="outline"
          size="sm"
          className="h-8 text-[10px] gap-1 flex-1"
          onClick={onSave}
          disabled={saving}
        >
          {saving ? <Loader2 className="h-3 w-3 animate-spin" /> : '保存配置'}
        </Button>
        <Button
          variant="default"
          size="sm"
          className="h-8 text-[10px] gap-1 flex-1"
          onClick={onTestConnection}
          disabled={testing}
        >
          {testing ? <Loader2 className="h-3 w-3 animate-spin" /> : <Plug className="h-3 w-3" />}
          测试连接
        </Button>
      </div>
    </div>
  );
}
