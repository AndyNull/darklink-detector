'use client';

import React, { Suspense, useState, useEffect } from 'react';
import { Loader2 } from 'lucide-react';
import { useAuth, getAuthHeaders, AUTH_TOKEN_KEY } from '@/lib/auth-context';
import { toast } from 'sonner';
import { DatabaseConfig } from '../types';
import { MigrationResult } from './types';
import { ConnectionForm } from './connection-form';
import { MigrationControls, ExportFormat } from './migration-controls';
import { ImportControls } from './import-controls';
import { rsaEncrypt } from '@/lib/crypto-client';

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

  // Migration states
  const [exporting, setExporting] = useState(false);
  const [importing, setImporting] = useState(false);
  const [migrationResult, setMigrationResult] = useState<MigrationResult | null>(null);
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
      // RSA-encrypt passwords before sending
      const configPayload: DatabaseConfig = {
        ...config,
        mysql: {
          ...config.mysql,
          password: config.mysql.password && config.mysql.password !== '******'
            ? await rsaEncrypt(config.mysql.password)
            : config.mysql.password,
        },
        postgresql: {
          ...config.postgresql,
          password: config.postgresql.password && config.postgresql.password !== '******'
            ? await rsaEncrypt(config.postgresql.password)
            : config.postgresql.password,
        },
      };
      const res = await fetch('/api/config/database', {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          ...getAuthHeaders(),
        },
        body: JSON.stringify({ config: configPayload }),
      });
      if (res.status === 401) {
        toast.error('未登录，请先登录');
        return;
      }
      if (res.ok) {
        const data = await res.json();
        if (data.config) {
          setConfig(data.config);
        }
        toast.success('配置已保存');
      } else {
        const errorData = await res.json().catch(() => ({ error: '保存失败' }));
        toast.error(errorData.error || '保存失败');
      }
    } catch {
      toast.error('保存失败');
    } finally {
      setSaving(false);
    }
  };

  const handleTestConnection = async () => {
    if (!requireAuth(() => {})) return;
    setTesting(true);
    toast.info('正在测试数据库连接...');
    try {
      // Build config payload, RSA-encrypting passwords before sending
      const configPayload: DatabaseConfig = {
        ...config,
        mysql: {
          ...config.mysql,
          password: config.mysql.password
            ? await rsaEncrypt(config.mysql.password)
            : '',
        },
        postgresql: {
          ...config.postgresql,
          password: config.postgresql.password
            ? await rsaEncrypt(config.postgresql.password)
            : '',
        },
      };

      const res = await fetch('/api/config/database/test-connection', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...getAuthHeaders(),
        },
        body: JSON.stringify({ config: configPayload }),
      });

      if (res.status === 401) {
        toast.error('未登录，请先登录');
        return;
      }

      const data = await res.json();
      if (data.success) {
        toast.success(data.message || '连接成功');
      } else {
        toast.error(data.message || '连接失败');
      }
    } catch {
      toast.error('连接测试失败，请检查网络连接');
    } finally {
      setTesting(false);
    }
  };

  const handleExport = async (format: ExportFormat) => {
    if (!requireAuth(() => {})) return;
    setExporting(true);
    setMigrationResult(null);
    try {
      const res = await fetch(`/api/config/database/migrate?format=${format}`, {
        method: 'POST',
        headers: getAuthHeaders(),
      });
      if (res.status === 401) {
        setMigrationResult({ success: false, message: '未登录，请先登录' });
        return;
      }
      if (res.ok) {
        if (format === 'sqlite') {
          // SQLite binary format - response is application/x-sqlite3
          const blob = await res.blob();
          const url = URL.createObjectURL(blob);
          const a = document.createElement('a');
          a.href = url;
          a.download = `darklink-db-export-${new Date().toISOString().slice(0, 10)}.db`;
          document.body.appendChild(a);
          a.click();
          document.body.removeChild(a);
          URL.revokeObjectURL(url);

          const fileSize = blob.size;
          const sizeMB = (fileSize / (1024 * 1024)).toFixed(2);
          setMigrationResult({ success: true, message: `导出成功，数据库文件大小 ${sizeMB} MB` });
        } else {
          // SQL format - response is text/sql
          const sqlContent = await res.text();
          const ext = format === 'mysql' ? 'mysql' : 'postgresql';
          const blob = new Blob([sqlContent], { type: 'text/sql' });
          const url = URL.createObjectURL(blob);
          const a = document.createElement('a');
          a.href = url;
          a.download = `darklink-db-export-${new Date().toISOString().slice(0, 10)}.${ext}.sql`;
          document.body.appendChild(a);
          a.click();
          document.body.removeChild(a);
          URL.revokeObjectURL(url);

          const lineCount = sqlContent.split('\n').length;
          setMigrationResult({ success: true, message: `导出成功，生成 ${ext.toUpperCase()} SQL（${lineCount} 行）` });
        }
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
      <Suspense fallback={null}>
        <ConnectionForm
          config={config}
          onConfigChange={setConfig}
          saving={saving}
          testing={testing}
          onSave={handleSave}
          onTestConnection={handleTestConnection}
        />
      </Suspense>

      <Suspense fallback={null}>
        <MigrationControls
          exporting={exporting}
          migrationResult={migrationResult}
          onExport={handleExport}
        />
      </Suspense>

      <Suspense fallback={null}>
        <ImportControls
          importing={importing}
          importFile={importFile}
          showMigrationConfirm={showMigrationConfirm}
          onFileChange={handleFileChange}
          onShowMigrationConfirm={setShowMigrationConfirm}
          onImport={handleImport}
        />
      </Suspense>
    </div>
  );
}
