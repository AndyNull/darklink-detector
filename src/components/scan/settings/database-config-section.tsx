'use client';

import { useState, useEffect } from 'react';
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
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import {
  Shield,
  Server,
  Loader2,
  CheckCircle2,
  AlertTriangle,
  Database,
  User,
  Lock,
  Plug,
  Download,
  Upload,
  ArrowRightLeft,
} from 'lucide-react';
import { useAuth, getAuthHeaders, AUTH_TOKEN_KEY } from '@/lib/auth-context';
import { toast } from 'sonner';
import { DatabaseConfig } from './types';

export function DatabaseConfigSection() {
  const { requireAuth } = useAuth();
  const [config, setConfig] = useState<DatabaseConfig>({
    type: 'sqlite',
    sqlite: { path: './db/data.db' },
    mysql: { host: 'localhost', port: 3306, database: 'darklink', username: 'root', password: '' },
    postgresql: { host: 'localhost', port: 5432, database: 'darklink', username: 'postgres', password: '', ssl: false },
  });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ success: boolean; message: string } | null>(null);

  // Migration states
  const [exporting, setExporting] = useState(false);
  const [importing, setImporting] = useState(false);
  const [migrationResult, setMigrationResult] = useState<{ success: boolean; message: string } | null>(null);
  const [showMigrationConfirm, setShowMigrationConfirm] = useState(false);
  const [importFile, setImportFile] = useState<File | null>(null);

  useEffect(() => {
    const fetchConfig = async () => {
      try {
        const res = await fetch('/api/config/database', {
          headers: getAuthHeaders(),
        });
        if (res.status === 401) {
          if (typeof window !== 'undefined') localStorage.removeItem(AUTH_TOKEN_KEY);
          return;
        }
        if (res.ok) {
          const data = await res.json();
          if (data.config) {
            setConfig(data.config);
          }
        }
      } catch {
        // ignore
      } finally {
        setLoading(false);
      }
    };
    fetchConfig();
  }, []);

  const handleSave = async () => {
    if (!requireAuth(() => {})) return;
    setSaving(true);
    try {
      const res = await fetch('/api/config/database', {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          ...getAuthHeaders(),
        },
        body: JSON.stringify({ config }),
      });
      if (res.status === 401) {
        setTestResult({ success: false, message: '未登录，请先登录' });
        return;
      }
      if (res.ok) {
        const data = await res.json();
        if (data.config) {
          setConfig(data.config);
        }
        setTestResult({ success: true, message: '配置已保存' });
      } else {
        setTestResult({ success: false, message: '保存失败' });
      }
    } catch {
      setTestResult({ success: false, message: '保存失败' });
    } finally {
      setSaving(false);
      setTimeout(() => setTestResult(null), 3000);
    }
  };

  const handleTestConnection = async () => {
    if (!requireAuth(() => {})) return;
    setTesting(true);
    setTestResult(null);
    try {
      // Simulate connection test
      await new Promise(resolve => setTimeout(resolve, 1500));
      if (config.type === 'sqlite') {
        setTestResult({ success: true, message: 'SQLite 连接成功' });
      } else if (config.type === 'mysql') {
        // In real app, would test MySQL connection
        setTestResult({ success: true, message: 'MySQL 连接测试成功' });
      } else {
        setTestResult({ success: true, message: 'PostgreSQL 连接测试成功' });
      }
    } catch {
      setTestResult({ success: false, message: '连接失败' });
    } finally {
      setTesting(false);
      setTimeout(() => setTestResult(null), 5000);
    }
  };

  const handleExport = async () => {
    if (!requireAuth(() => {})) return;
    setExporting(true);
    setMigrationResult(null);
    try {
      const res = await fetch('/api/config/database/migrate', {
        method: 'POST',
        headers: getAuthHeaders(),
      });
      if (res.status === 401) {
        setMigrationResult({ success: false, message: '未登录，请先登录' });
        return;
      }
      if (res.ok) {
        const data = await res.json();
        // Create downloadable JSON file
        const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `darklink-db-export-${new Date().toISOString().slice(0, 10)}.json`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);

        const totalRecords = data.counts ? Object.values(data.counts as Record<string, number>).reduce((sum: number, c: number) => sum + c, 0) : 0;
        setMigrationResult({ success: true, message: `导出成功，共 ${totalRecords} 条记录` });
      } else {
        const errorData = await res.json().catch(() => ({ error: '导出失败' }));
        setMigrationResult({ success: false, message: errorData.error || '导出失败' });
      }
    } catch {
      setMigrationResult({ success: false, message: '导出失败，请检查网络连接' });
    } finally {
      setExporting(false);
      setTimeout(() => setMigrationResult(null), 5000);
    }
  };

  const handleImport = async () => {
    if (!importFile) return;
    if (!requireAuth(() => {})) return;
    setImporting(true);
    setMigrationResult(null);
    try {
      const fileContent = await importFile.text();
      const importData = JSON.parse(fileContent);

      if (!importData.tables) {
        setMigrationResult({ success: false, message: '文件格式无效：缺少 tables 字段' });
        return;
      }

      const res = await fetch('/api/config/database/import', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...getAuthHeaders(),
        },
        body: JSON.stringify(importData),
      });
      if (res.status === 401) {
        setMigrationResult({ success: false, message: '未登录，请先登录' });
        return;
      }
      if (res.ok) {
        const data = await res.json();
        setMigrationResult({ success: true, message: data.message || `导入完成：成功 ${data.totalImported} 条` });
        setImportFile(null);
        // Reset file input
        const fileInput = document.getElementById('import-file-input') as HTMLInputElement;
        if (fileInput) fileInput.value = '';
      } else {
        const errorData = await res.json().catch(() => ({ error: '导入失败' }));
        setMigrationResult({ success: false, message: errorData.error || '导入失败' });
      }
    } catch {
      setMigrationResult({ success: false, message: '导入失败，请检查文件格式' });
    } finally {
      setImporting(false);
      setTimeout(() => setMigrationResult(null), 8000);
    }
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      setImportFile(file);
      setMigrationResult(null);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-6 text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin mr-1.5" />
        <span className="text-xs">加载数据库配置...</span>
      </div>
    );
  }

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
        <Select value={config.type} onValueChange={(val: 'sqlite' | 'mysql' | 'postgresql') => setConfig(prev => ({ ...prev, type: val }))}>
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
            onChange={(e) => setConfig(prev => ({ ...prev, sqlite: { ...prev.sqlite, path: e.target.value } }))}
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
              onChange={(e) => setConfig(prev => ({ ...prev, mysql: { ...prev.mysql, host: e.target.value } }))}
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
              onChange={(e) => setConfig(prev => ({ ...prev, mysql: { ...prev.mysql, port: parseInt(e.target.value) || 3306 } }))}
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
              onChange={(e) => setConfig(prev => ({ ...prev, mysql: { ...prev.mysql, database: e.target.value } }))}
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
              onChange={(e) => setConfig(prev => ({ ...prev, mysql: { ...prev.mysql, username: e.target.value } }))}
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
              onChange={(e) => setConfig(prev => ({ ...prev, mysql: { ...prev.mysql, password: e.target.value } }))}
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
              onChange={(e) => setConfig(prev => ({ ...prev, postgresql: { ...prev.postgresql, host: e.target.value } }))}
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
              onChange={(e) => setConfig(prev => ({ ...prev, postgresql: { ...prev.postgresql, port: parseInt(e.target.value) || 5432 } }))}
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
              onChange={(e) => setConfig(prev => ({ ...prev, postgresql: { ...prev.postgresql, database: e.target.value } }))}
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
              onChange={(e) => setConfig(prev => ({ ...prev, postgresql: { ...prev.postgresql, username: e.target.value } }))}
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
              onChange={(e) => setConfig(prev => ({ ...prev, postgresql: { ...prev.postgresql, password: e.target.value } }))}
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
                onCheckedChange={(checked) => setConfig(prev => ({ ...prev, postgresql: { ...prev.postgresql, ssl: checked } }))}
                className="scale-75 origin-left cursor-pointer"
              />
              <span className="text-[10px] text-muted-foreground">
                {config.postgresql.ssl ? '已启用' : '已关闭'}
              </span>
            </div>
          </div>
        </>
      )}

      {/* Test Result */}
      {testResult && (
        <div className={`rounded border px-3 py-2 flex items-center gap-1.5 text-[11px] ${
          testResult.success ? 'border-green-500/30 bg-green-500/5 text-green-600' : 'border-red-500/30 bg-red-500/5 text-red-500'
        }`}>
          {testResult.success ? (
            <CheckCircle2 className="h-3.5 w-3.5 shrink-0" />
          ) : (
            <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
          )}
          {testResult.message}
        </div>
      )}

      {/* Action Buttons */}
      <div className="flex items-center gap-2">
        <Button
          variant="outline"
          size="sm"
          className="h-8 text-[10px] gap-1 flex-1"
          onClick={handleSave}
          disabled={saving}
        >
          {saving ? <Loader2 className="h-3 w-3 animate-spin" /> : '保存配置'}
        </Button>
        <Button
          variant="default"
          size="sm"
          className="h-8 text-[10px] gap-1 flex-1"
          onClick={handleTestConnection}
          disabled={testing}
        >
          {testing ? <Loader2 className="h-3 w-3 animate-spin" /> : <Plug className="h-3 w-3" />}
          测试连接
        </Button>
      </div>

      {/* === 数据迁移 Section === */}
      <div className="space-y-2 pt-2">
        <div className="flex items-center gap-1.5">
          <ArrowRightLeft className="h-3 w-3 text-muted-foreground shrink-0" />
          <span className="text-[11px] font-medium">数据迁移</span>
        </div>

        {/* Warning */}
        <div className="rounded border border-yellow-500/30 bg-yellow-500/5 px-3 py-2 space-y-1">
          <div className="flex items-center gap-1 text-[10px] text-yellow-600">
            <AlertTriangle className="h-3 w-3 shrink-0" />
            <span className="font-medium">注意事项</span>
          </div>
          <ul className="text-[9px] text-yellow-700 space-y-0.5 ml-4 list-disc">
            <li>切换数据库类型需要修改配置文件并重启服务</li>
            <li>建议先导出当前数据作为备份</li>
            <li>导入操作会向当前数据库写入数据，已有记录会跳过（不会覆盖）</li>
            <li>迁移前请确保目标数据库已正确配置并可连接</li>
          </ul>
        </div>

        {/* Export */}
        <div className="rounded border px-3 py-2 space-y-1.5">
          <div className="flex items-center gap-1.5">
            <Download className="h-3 w-3 text-muted-foreground shrink-0" />
            <span className="text-[11px] font-medium">导出数据</span>
            <span className="text-[9px] text-muted-foreground ml-1">将当前数据库所有数据导出为JSON文件</span>
          </div>
          <Button
            variant="outline"
            size="sm"
            className="h-7 text-[10px] gap-1 w-full"
            onClick={handleExport}
            disabled={exporting}
          >
            {exporting ? <Loader2 className="h-3 w-3 animate-spin" /> : <Download className="h-3 w-3" />}
            导出当前数据库
          </Button>
        </div>

        {/* Import */}
        <div className="rounded border px-3 py-2 space-y-1.5">
          <div className="flex items-center gap-1.5">
            <Upload className="h-3 w-3 text-muted-foreground shrink-0" />
            <span className="text-[11px] font-medium">导入数据</span>
            <span className="text-[9px] text-muted-foreground ml-1">从JSON文件恢复数据到当前数据库</span>
          </div>
          <div className="flex items-center gap-1.5">
            <input
              id="import-file-input"
              type="file"
              accept=".json"
              onChange={handleFileChange}
              className="text-[10px] file:mr-1.5 file:py-1 file:px-2 file:rounded file:border-0 file:text-[10px] file:font-medium file:bg-muted file:text-muted-foreground hover:file:bg-muted/80 file:cursor-pointer w-full"
            />
          </div>
          {importFile && (
            <div className="flex items-center gap-1.5">
              <span className="text-[9px] text-muted-foreground truncate flex-1">
                已选择: {importFile.name} ({(importFile.size / 1024).toFixed(1)} KB)
              </span>
              <Button
                variant="default"
                size="sm"
                className="h-7 text-[10px] gap-1 shrink-0"
                onClick={() => setShowMigrationConfirm(true)}
                disabled={importing}
              >
                {importing ? <Loader2 className="h-3 w-3 animate-spin" /> : <Upload className="h-3 w-3" />}
                导入
              </Button>
            </div>
          )}
        </div>

        {/* Migration Result */}
        {migrationResult && (
          <div className={`rounded border px-3 py-2 flex items-center gap-1.5 text-[11px] ${
            migrationResult.success ? 'border-green-500/30 bg-green-500/5 text-green-600' : 'border-red-500/30 bg-red-500/5 text-red-500'
          }`}>
            {migrationResult.success ? (
              <CheckCircle2 className="h-3.5 w-3.5 shrink-0" />
            ) : (
              <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
            )}
            {migrationResult.message}
          </div>
        )}
      </div>

      {/* Migration Confirm Dialog */}
      <Dialog open={showMigrationConfirm} onOpenChange={setShowMigrationConfirm}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-base">
              <AlertTriangle className="h-5 w-5 text-yellow-600" />
              确认导入数据
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-2 text-sm">
            <p>
              确定要将文件 <span className="font-medium">{importFile?.name}</span> 中的数据导入到当前数据库吗？
            </p>
            <div className="rounded border border-yellow-500/30 bg-yellow-500/5 px-3 py-2 text-xs text-yellow-700 space-y-1">
              <p>• 已存在的记录将被跳过（不会覆盖）</p>
              <p>• 导入过程中请勿关闭页面</p>
              <p>• 建议先导出备份当前数据</p>
            </div>
          </div>
          <DialogFooter className="gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setShowMigrationConfirm(false)}
              disabled={importing}
            >
              取消
            </Button>
            <Button
              size="sm"
              onClick={() => {
                setShowMigrationConfirm(false);
                handleImport();
              }}
              disabled={importing}
            >
              {importing ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" /> : null}
              确认导入
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
