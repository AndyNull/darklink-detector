'use client';

import { useState, useEffect, useCallback } from 'react';
import dynamic from 'next/dynamic';
import { Panel, PanelGroup, PanelResizeHandle } from 'react-resizable-panels';
import { UrlInputPanel } from '@/components/scan/url-input-panel';
import { LogPanel } from '@/components/scan/log-panel';
import { AuthProvider, useAuth } from '@/lib/auth-context';
import { useScanStore } from '@/lib/scan-store';
import { useDataSyncStore } from '@/lib/data-sync-store';
import { useEngineStatusStore } from '@/lib/engine-status-store';
import { useIsMobile } from '@/hooks/use-mobile';
import {
  ShieldAlert,
  Wifi,
  WifiOff,
  Loader2,
  ScanSearch,
  BarChart3,
  CircleDot,
  Activity,
  PauseCircle,
  CheckCircle2,
  XCircle,
  Database,
  Settings,
  User,
  LogOut,
  Lock,
  AlertTriangle,
  LogIn,
  Download,
} from 'lucide-react';
import { ThemeToggle } from '@/components/theme-toggle';
import { getSystemName, getSystemVersion, getPageTitle, getCopyright } from '@/lib/system-config';
import { rsaEncrypt, clearCachedPublicKey } from '@/lib/crypto-client';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuSeparator,
} from '@/components/ui/dropdown-menu';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

// ──── Lazy-loaded page components (only loaded when their tab is active) ────

const ResultsPage = dynamic(
  () => import('@/components/scan/results-page').then(mod => ({ default: mod.ResultsPage })),
  { ssr: false, loading: () => <PageLoadingFallback /> }
);

const MaliciousLibrary = dynamic(
  () => import('@/components/scan/malicious-library/index').then(mod => ({ default: mod.MaliciousLibrary })),
  { ssr: false, loading: () => <PageLoadingFallback /> }
);

const SettingsPanel = dynamic(
  () => import('@/components/scan/settings-panel').then(mod => ({ default: mod.SettingsPanel })),
  { ssr: false, loading: () => <PageLoadingFallback /> }
);

const LoginDialog = dynamic(
  () => import('@/components/login-dialog').then(mod => ({ default: mod.LoginDialog })),
  { ssr: false, loading: () => null }
);

// ──── Loading fallback for lazy pages ────

function PageLoadingFallback() {
  return (
    <div className="flex-1 flex items-center justify-center text-muted-foreground">
      <Loader2 className="h-4 w-4 animate-spin mr-2" />
      <span className="text-xs">加载中...</span>
    </div>
  );
}

// ─── Copyright Bar (small, at the very bottom of main content) ───────────────

function CopyrightBar() {
  const { copyright } = useSystemInfo();
  return (
    <div className="shrink-0 h-5 flex items-center justify-center border-t bg-card/50 px-3 safe-area-bottom">
      <span className="text-[9px] text-muted-foreground/60 truncate">{copyright}</span>
    </div>
  );
}

// ─── Status Components ──────────────────────────────────────────────────────

function ServiceStatusIcon({ showLabel }: { showLabel?: boolean }) {
  const scanEngineStatus = useEngineStatusStore(s => s.scanEngineStatus);
  const dataSyncStatus = useEngineStatusStore(s => s.dataSyncStatus);

  // Use the centralized auto-polling from the store (singleton pattern)
  useEffect(() => {
    const unsubscribe = useEngineStatusStore.getState().startAutoPolling();
    return unsubscribe;
  }, []);

  // Derive combined status
  const allOnline = scanEngineStatus === 'online' && dataSyncStatus === 'online';
  const allOffline = scanEngineStatus === 'offline' && dataSyncStatus === 'offline';
  const anyChecking = scanEngineStatus === 'checking' || dataSyncStatus === 'checking';

  let label: string;
  let colorClass: string;
  let IconComponent: React.ElementType;

  if (anyChecking) {
    label = '检测中...';
    colorClass = 'text-yellow-600';
    IconComponent = Loader2;
  } else if (allOnline) {
    label = '服务在线';
    colorClass = 'text-green-600';
    IconComponent = Wifi;
  } else if (allOffline) {
    label = '全部离线';
    colorClass = 'text-red-600';
    IconComponent = WifiOff;
  } else {
    // Partially online — one is online, one is offline
    const offlineServices: string[] = [];
    if (scanEngineStatus === 'offline') offlineServices.push('引擎');
    if (dataSyncStatus === 'offline') offlineServices.push('数据同步');
    label = `${offlineServices.join('/')}离线`;
    colorClass = 'text-orange-600';
    IconComponent = AlertTriangle;
  }

  const isOnline = allOnline;

  if (!showLabel) {
    // Compact mode: just icon + color
    return (
      <div className={`w-full flex items-center justify-center px-1 py-2.5 rounded-md text-[12px] font-medium ${colorClass}`}>
        <IconComponent className={`h-4 w-4 shrink-0 ${isOnline ? 'animate-pulse' : ''} ${anyChecking ? 'animate-spin' : ''}`} />
      </div>
    );
  }

  return (
    <div className={`w-full rounded-md text-[12px] font-medium ${colorClass}`}>
      <div className={`flex items-center gap-2.5 px-2.5 py-1.5`}>
        <IconComponent className={`h-4 w-4 shrink-0 ${isOnline ? 'animate-pulse' : ''} ${anyChecking ? 'animate-spin' : ''}`} />
        <span className={`truncate ${isOnline ? 'animate-pulse' : ''}`}>{label}</span>
      </div>
      {/* Show individual service status when not all the same */}
      {!anyChecking && !allOnline && !allOffline && (
        <div className="px-2.5 pb-1.5 space-y-0.5">
          <div className={`flex items-center gap-1.5 text-[10px] ${scanEngineStatus === 'online' ? 'text-green-600' : 'text-red-500'}`}>
            {scanEngineStatus === 'online' ? <Wifi className="h-2.5 w-2.5" /> : <WifiOff className="h-2.5 w-2.5" />}
            <span>扫描引擎{scanEngineStatus === 'online' ? '在线' : '离线'}</span>
          </div>
          <div className={`flex items-center gap-1.5 text-[10px] ${dataSyncStatus === 'online' ? 'text-green-600' : 'text-red-500'}`}>
            {dataSyncStatus === 'online' ? <Wifi className="h-2.5 w-2.5" /> : <WifiOff className="h-2.5 w-2.5" />}
            <span>数据同步{dataSyncStatus === 'online' ? '在线' : '离线'}</span>
          </div>
        </div>
      )}
    </div>
  );
}

function ScanStatusBadge({ showLabel = true }: { showLabel?: boolean }) {
  const scanStatus = useScanStore(s => s.scanStatus);
  const iconMap: Record<string, { icon: React.ElementType; color: string; label: string }> = {
    idle: { icon: CircleDot, color: 'text-muted-foreground', label: '就绪' },
    running: { icon: Activity, color: 'text-primary', label: '扫描中' },
    completed: { icon: CheckCircle2, color: 'text-green-600', label: '已完成' },
    stopped: { icon: PauseCircle, color: 'text-yellow-600', label: '已停止' },
    error: { icon: XCircle, color: 'text-destructive', label: '错误' },
  };
  const { icon: Icon, color, label } = iconMap[scanStatus] || iconMap.idle;
  const isRunning = scanStatus === 'running';
  return (
    <div className={`w-full flex items-center rounded-md text-[12px] font-medium ${color} ${
      showLabel ? 'gap-2.5 px-2.5 py-2' : 'justify-center px-1 py-2.5'
    }`}>
      <Icon className={`h-4 w-4 shrink-0 ${isRunning ? 'animate-pulse' : ''}`} />
      {showLabel && <span className={`truncate ${isRunning ? 'animate-pulse' : ''}`}>{label}</span>}
    </div>
  );
}

type ActivePage = 'scan' | 'results' | 'malicious' | 'settings';

// ─── System Info Hook ───────────────────────────────────────────────────────

function useSystemInfo() {
  const [name, setName] = useState(() => getSystemName());
  const [version, setVersion] = useState(() => getSystemVersion());
  const [pageTitle, setPageTitle] = useState(() => getPageTitle());
  const [copyright, setCopyright] = useState(() => getCopyright());

  const refreshAll = useCallback(() => {
    setName(getSystemName());
    setVersion(getSystemVersion());
    setPageTitle(getPageTitle());
    setCopyright(getCopyright());
  }, []);

  // Listen for storage events (cross-tab) and custom events (same-tab)
  // No polling needed — the custom event covers same-tab changes,
  // and storage event covers cross-tab changes.
  useEffect(() => {
    const storageHandler = () => refreshAll();
    const customHandler = () => refreshAll();
    window.addEventListener('storage', storageHandler);
    window.addEventListener('system-config-changed', customHandler);
    return () => {
      window.removeEventListener('storage', storageHandler);
      window.removeEventListener('system-config-changed', customHandler);
    };
  }, [refreshAll]);

  useEffect(() => {
    if (pageTitle) {
      document.title = pageTitle;
    }
  }, [pageTitle]);

  return { name, version, pageTitle, copyright };
}

// ─── User Menu Component ────────────────────────────────────────────────────

function UserMenu({ compact }: { compact?: boolean }) {
  const { username, logout } = useAuth();
  const [showChangePassword, setShowChangePassword] = useState(false);
  const [oldPassword, setOldPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [changeLoading, setChangeLoading] = useState(false);
  const [changeResult, setChangeResult] = useState<{ success: boolean; message: string } | null>(null);

  const [passwordWarning, setPasswordWarning] = useState('');

  const handleChangePassword = async () => {
    if (newPassword !== confirmPassword) {
      setChangeResult({ success: false, message: '两次输入的新密码不一致' });
      return;
    }
    if (newPassword.length < 6) {
      setChangeResult({ success: false, message: '新密码长度不能少于6位' });
      return;
    }
    if (!/[a-zA-Z]/.test(newPassword)) {
      setChangeResult({ success: false, message: '新密码必须包含至少一个字母' });
      return;
    }
    if (!/[0-9]/.test(newPassword)) {
      setChangeResult({ success: false, message: '新密码必须包含至少一个数字' });
      return;
    }

    setChangeLoading(true);
    setChangeResult(null);
    try {
      let encryptedOld: string;
      let encryptedNew: string;
      try {
        encryptedOld = await rsaEncrypt(oldPassword);
        encryptedNew = await rsaEncrypt(newPassword);
      } catch {
        // RSA encryption failed — don't send plaintext passwords
        setChangeResult({ success: false, message: '加密失败，请刷新页面后重试' });
        setChangeLoading(false);
        return;
      }

      const token = localStorage.getItem('darklink-auth-token');
      const res = await fetch('/api/auth/change-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
        body: JSON.stringify({
          oldPassword: encryptedOld,
          newPassword: encryptedNew,
          encrypted: true,
        }),
      });
      const data = await res.json();
      if (res.ok && data.success) {
        setChangeResult({ success: true, message: '密码修改成功' });
        setOldPassword('');
        setNewPassword('');
        setConfirmPassword('');
        setPasswordWarning('');
        setTimeout(() => {
          setShowChangePassword(false);
          setChangeResult(null);
        }, 2000);
      } else {
        if (data.error?.includes('解密失败')) {
          clearCachedPublicKey();
        }
        setChangeResult({ success: false, message: data.error || '修改失败' });
      }
    } catch {
      setChangeResult({ success: false, message: '网络错误' });
    } finally {
      setChangeLoading(false);
    }
  };

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          {compact ? (
            <button className="nav-button w-full flex items-center justify-center px-1 py-2.5 rounded-md text-[12px] font-medium text-muted-foreground"
              aria-label="用户菜单"
            >
              <User className="h-4 w-4 shrink-0" />
            </button>
          ) : (
            <button className="nav-button w-full flex items-center gap-2.5 px-2.5 py-2 rounded-md text-[12px] font-medium text-muted-foreground">
              <User className="h-4 w-4 shrink-0" />
              <span className="truncate text-left flex-1">{username}</span>
            </button>
          )}
        </DropdownMenuTrigger>
        <DropdownMenuContent side="right" align="start" className="w-40">
          <DropdownMenuItem onClick={() => setShowChangePassword(true)}>
            <Lock className="h-3.5 w-3.5 mr-2" />
            修改密码
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={logout} className="text-destructive focus:text-destructive">
            <LogOut className="h-3.5 w-3.5 mr-2" />
            退出登录
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      {/* Change Password Dialog */}
      <Dialog open={showChangePassword} onOpenChange={setShowChangePassword}>
        <DialogContent className="sm:max-w-[400px]">
          <DialogHeader>
            <DialogTitle className="text-sm flex items-center gap-1.5">
              <Lock className="h-4 w-4" />
              修改密码
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <div className="space-y-1">
              <span className="text-[11px] text-muted-foreground">旧密码</span>
              <Input
                type="password"
                value={oldPassword}
                onChange={(e) => setOldPassword(e.target.value)}
                className="h-8 text-xs"
                placeholder="输入旧密码"
              />
            </div>
            <div className="space-y-1">
              <span className="text-[11px] text-muted-foreground">新密码</span>
              <Input
                type="password"
                value={newPassword}
                onChange={(e) => {
                  setNewPassword(e.target.value);
                  const val = e.target.value;
                  if (val.length >= 6 && /[a-zA-Z]/.test(val) && /[0-9]/.test(val) && !/[^a-zA-Z0-9]/.test(val)) {
                    setPasswordWarning('建议添加特殊字符以增强密码强度');
                  } else {
                    setPasswordWarning('');
                  }
                }}
                className="h-8 text-xs"
                placeholder="输入新密码（至少6位，含字母和数字，推荐含特殊字符）"
              />
              {passwordWarning && (
                <span className="text-[10px] text-amber-500 flex items-center gap-1">
                  <AlertTriangle className="h-3 w-3" />
                  {passwordWarning}
                </span>
              )}
            </div>
            <div className="space-y-1">
              <span className="text-[11px] text-muted-foreground">确认新密码</span>
              <Input
                type="password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                className="h-8 text-xs"
                placeholder="再次输入新密码"
                onKeyDown={(e) => { if (e.key === 'Enter') handleChangePassword(); }}
              />
            </div>
            {changeResult && (
              <div className={`rounded border px-3 py-2 flex items-center gap-1.5 text-[11px] ${
                changeResult.success
                  ? 'border-green-500/30 bg-green-500/5 text-green-600'
                  : 'border-red-500/30 bg-red-500/5 text-red-500'
              }`}>
                {changeResult.success ? (
                  <CheckCircle2 className="h-3.5 w-3.5 shrink-0" />
                ) : (
                  <XCircle className="h-3.5 w-3.5 shrink-0" />
                )}
                {changeResult.message}
              </div>
            )}
          </div>
          <DialogFooter className="gap-2">
            <Button
              variant="outline"
              size="sm"
              className="h-8 text-[10px]"
              onClick={() => { setShowChangePassword(false); setChangeResult(null); }}
            >
              取消
            </Button>
            <Button
              variant="default"
              size="sm"
              className="h-8 text-[10px] gap-1"
              onClick={handleChangePassword}
              disabled={changeLoading || !oldPassword || !newPassword || !confirmPassword}
            >
              {changeLoading ? <Loader2 className="h-3 w-3 animate-spin" /> : '确认修改'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

// ─── Login Button (for unauthenticated users) ──────────────────────────────

function LoginButton({ compact }: { compact?: boolean }) {
  const { showLoginDialog } = useAuth();

  return (
    <button
      onClick={showLoginDialog}
      className={`nav-button w-full flex items-center rounded-md text-[12px] font-medium text-primary ${
        compact ? 'justify-center px-1 py-2.5' : 'gap-2.5 px-2.5 py-2'
      }`}
      aria-label="登录"
    >
      <LogIn className="h-4 w-4 shrink-0" />
      {!compact && <span className="truncate">去登录</span>}
    </button>
  );
}

// ─── App Sidebar (unified for desktop & mobile) ─────────────────────────────

function AppSidebar({ activePage, setActivePage }: { activePage: ActivePage; setActivePage: (p: ActivePage) => void }) {
  const isMobile = useIsMobile();
  const { isAuthenticated } = useAuth();
  const { name: appName, version: appVersion } = useSystemInfo();
  const dataSync = useDataSyncStore();
  const hasActiveSync = dataSync.syncTasks.some(t => t.status === 'running' || t.status === 'pending');
  const navItems: { key: ActivePage; icon: React.ElementType; label: string }[] = [
    { key: 'scan', icon: ScanSearch, label: '扫描' },
    { key: 'results', icon: BarChart3, label: '结果' },
    { key: 'malicious', icon: Database, label: '恶意库' },
    // Settings only shown when authenticated — not rendered at all when not logged in
    ...(isAuthenticated ? [{ key: 'settings' as ActivePage, icon: Settings, label: '设置' }] : []),
  ];

  return (
    <aside className={`shrink-0 border-r bg-card flex flex-col ${isMobile ? 'w-[48px]' : 'w-[160px]'}`}>
      {/* Logo + App name */}
      <div className={`h-10 border-b flex items-center shrink-0 ${isMobile ? 'px-2 justify-center' : 'px-3 gap-2'}`}>
        <div className="flex items-center justify-center w-7 h-7 rounded-md bg-primary/10 shrink-0">
          <ShieldAlert className="h-4 w-4 text-primary" />
        </div>
        {!isMobile && (
          <div className="min-w-0 overflow-hidden">
            <div className="text-xs font-bold leading-tight truncate">{appName}</div>
            <div className="text-[10px] text-muted-foreground leading-tight">{appVersion}</div>
          </div>
        )}
      </div>

      {/* Nav items */}
      <nav className={`flex-1 py-2 space-y-0.5 ${isMobile ? 'px-1' : 'px-2'}`}>
        {navItems.map(({ key, icon: NavIcon, label }) => (
          <button
            key={key}
            onClick={() => setActivePage(key)}
            title={isMobile ? label : undefined}
            aria-label={label}
            className={`nav-button w-full flex items-center rounded-md text-[12px] font-medium ${
              isMobile ? 'justify-center px-1 py-2.5' : 'gap-2.5 px-2.5 py-2'
            } ${
              activePage === key
                ? 'bg-primary/10 text-primary font-semibold'
                : 'text-muted-foreground'
            }`}
          >
            <NavIcon className="h-4 w-4 shrink-0" />
            {!isMobile && <span className="truncate">{label}</span>}
          </button>
        ))}
      </nav>

      {/* Status badges + theme toggle + user at bottom */}
      <div className={`space-y-1 ${isMobile ? 'px-1 pb-2 safe-area-bottom' : 'px-2 pb-3'}`}>
        <div className="border-t pt-2 mb-1" />
        <ScanStatusBadge showLabel={!isMobile} />
        <ServiceStatusIcon showLabel={!isMobile} />
        {/* Sync progress button — only visible when authenticated (settings page requires login) */}
        {isAuthenticated && hasActiveSync && (
          <button
            onClick={() => setActivePage('settings')}
            className="w-full flex items-center gap-2 px-2.5 py-2 rounded-md text-[12px] font-medium text-primary/70 hover:text-primary hover:bg-primary/5 transition-colors"
            title="查看同步进度"
          >
            <Download className="h-3.5 w-3.5 animate-pulse" />
            {!isMobile && <span className="truncate">同步中...</span>}
          </button>
        )}
        <div className="border-t pt-1 mt-1" />
        <ThemeToggle compact={isMobile} />
        {isAuthenticated ? (
          <UserMenu compact={isMobile} />
        ) : (
          <LoginButton compact={isMobile} />
        )}
      </div>
    </aside>
  );
}

// ─── Desktop scan page with resizable panels ────────────────────────────────

function ScanPage() {
  return (
    <PanelGroup direction="vertical" className="flex-1 min-h-0">
      <Panel defaultSize={45} minSize={20}>
        <div className="h-full border-b flex flex-col overflow-hidden">
          <UrlInputPanel />
        </div>
      </Panel>
      <PanelResizeHandle className="h-1.5 bg-border/50 hover:bg-primary/30 transition-colors cursor-row-resize flex items-center justify-center group">
        <div className="w-8 h-0.5 rounded-full bg-muted-foreground/30 group-hover:bg-primary/50 transition-colors" />
      </PanelResizeHandle>
      <Panel defaultSize={55} minSize={20}>
        <LogPanel />
      </Panel>
    </PanelGroup>
  );
}

// ─── Mobile scan page ───────────────────────────────────────────────────────

function MobileScanPage() {
  return (
    <div className="flex-1 min-h-0 flex flex-col overflow-hidden">
      <div className="flex-1 min-h-0 border-b flex flex-col overflow-hidden">
        <UrlInputPanel />
      </div>
      <div className="flex-1 min-h-0 flex flex-col overflow-hidden">
        <LogPanel />
      </div>
    </div>
  );
}

// ─── Main Layout ────────────────────────────────────────────────────────────

function HomeInner() {
  const [activePage, setActivePage] = useState<ActivePage>('scan');
  const autoNavigateToResults = useScanStore(s => s.autoNavigateToResults);
  const setAutoNavigateToResults = useScanStore(s => s.setAutoNavigateToResults);
  const isMobile = useIsMobile();
  const { authState, isAuthenticated, loginDialogOpen, setLoginDialogOpen } = useAuth();

  useEffect(() => {
    if (autoNavigateToResults) {
      const timer = setTimeout(() => {
        setActivePage('results');
        setAutoNavigateToResults(false);
      }, 0);
      return () => clearTimeout(timer);
    }
  }, [autoNavigateToResults, setAutoNavigateToResults]);

  // Redirect away from settings if user logs out while on settings page
  const effectivePage = (!isAuthenticated && activePage === 'settings') ? 'scan' : activePage;
  const setActivePageSafe = (p: ActivePage) => {
    if (p === 'settings' && !isAuthenticated) return;
    setActivePage(p);
    // When user navigates to results page to view history, reset scan status to "就绪"
    // This ensures the sidebar badge shows "就绪" instead of "已完成" after viewing
    if (p === 'results') {
      const currentStatus = useScanStore.getState().scanStatus;
      if (currentStatus === 'completed' || currentStatus === 'stopped' || currentStatus === 'error') {
        useScanStore.getState().setScanStatus('idle');
      }
    }
  };

  // Show loading while checking auth
  if (authState === 'checking') {
    return (
      <div className="h-dvh flex items-center justify-center bg-background">
        <div className="flex items-center gap-3 text-muted-foreground">
          <Loader2 className="h-5 w-5 animate-spin" />
          <span className="text-sm">正在检查登录状态...</span>
        </div>
      </div>
    );
  }

  // Show main app regardless of auth state (no more gate)
  return (
    <>
      <div className="h-dvh flex flex-row bg-background overflow-hidden">
        <AppSidebar activePage={effectivePage} setActivePage={setActivePageSafe} />
        <main className="flex-1 min-h-0 min-w-0 flex flex-col overflow-hidden relative">
          {effectivePage === 'scan' ? (
            isMobile ? <MobileScanPage /> : <ScanPage />
          ) : effectivePage === 'results' ? (
            <ResultsPage onNavigateToScan={() => setActivePageSafe('scan')} isMobile={isMobile} />
          ) : effectivePage === 'settings' ? (
            <SettingsPanel onClose={() => setActivePageSafe('scan')} />
          ) : (
            <MaliciousLibrary />
          )}
          {/* Copyright footer - small, at the very bottom */}
          <CopyrightBar />
        </main>
      </div>

      {/* Global Login Dialog */}
      <LoginDialog open={loginDialogOpen} onOpenChange={setLoginDialogOpen} />
    </>
  );
}

export function MainLayout() {
  return (
    <AuthProvider>
      <HomeInner />
    </AuthProvider>
  );
}
