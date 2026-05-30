'use client';

import { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  ShieldAlert,
  Lock,
  User,
  Loader2,
  AlertTriangle,
  Eye,
  EyeOff,
} from 'lucide-react';
import { getSystemName, getSystemVersion, APP_VERSION } from '@/lib/system-config';
import { rsaEncrypt, clearCachedPublicKey } from '@/lib/crypto-client';
import { AUTH_TOKEN_KEY } from '@/lib/auth-context';

export function LoginPage() {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [systemName, setSystemName] = useState('暗链检测系统');
  const [systemVersion, setSystemVersion] = useState(APP_VERSION);

  useEffect(() => {
    setSystemName(getSystemName());
    setSystemVersion(getSystemVersion());
  }, []);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!username || !password) return;

    setLoading(true);
    setError('');

    try {
      // 强制RSA加密密码，不允许明文传输
      let encryptedPassword: string;
      try {
        encryptedPassword = await rsaEncrypt(password);
      } catch (encErr) {
        // 加密失败时清除缓存并重试一次
        clearCachedPublicKey();
        try {
          encryptedPassword = await rsaEncrypt(password);
        } catch {
          setError('加密失败，无法建立安全连接，请刷新页面重试');
          setLoading(false);
          return;
        }
      }

      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          username,
          password: encryptedPassword,
          encrypted: true, // 强制加密，始终为true
        }),
      });

      if (res.ok) {
        const data = await res.json();
        if (data.success && data.token) {
          localStorage.setItem(AUTH_TOKEN_KEY, data.token);
          // Dispatch event for the app to detect login
          window.dispatchEvent(new CustomEvent('auth-change', { detail: { username: data.username } }));
          // Reload to trigger auth check in main page
          window.location.reload();
        }
      } else {
        const data = await res.json();
        setError(data.error || '登录失败');
      }
    } catch {
      setError('网络错误，请重试');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-dvh flex items-center justify-center bg-background p-4">
      <div className="w-full max-w-sm">
        {/* Logo and Title */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-primary/10 mb-4">
            <ShieldAlert className="h-8 w-8 text-primary" />
          </div>
          <h1 className="text-xl font-bold">{systemName}</h1>
          <p className="text-sm text-muted-foreground mt-1">{systemVersion}</p>
        </div>

        {/* Login Card */}
        <div className="rounded-lg border bg-card p-6 shadow-sm">
          <div className="flex items-center gap-2 mb-5">
            <Lock className="h-4 w-4 text-primary" />
            <span className="text-sm font-semibold">系统登录</span>
          </div>

          <form onSubmit={handleLogin} className="space-y-4">
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground">用户名</label>
              <div className="relative">
                <User className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  className="h-9 text-sm pl-9"
                  placeholder="请输入用户名"
                  autoComplete="username"
                  autoFocus
                />
              </div>
            </div>

            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground">密码</label>
              <div className="relative">
                <Lock className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  type={showPassword ? 'text' : 'password'}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="h-9 text-sm pl-9 pr-9"
                  placeholder="请输入密码"
                  autoComplete="current-password"
                />
                <button
                  type="button"
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
                  onClick={() => setShowPassword(!showPassword)}
                >
                  {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
            </div>

            {error && (
              <div className="flex items-center gap-1.5 text-xs text-destructive bg-destructive/5 rounded-md px-3 py-2">
                <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
                {error}
              </div>
            )}

            <Button
              type="submit"
              className="w-full h-9 text-sm gap-1.5"
              disabled={loading || !username || !password}
            >
              {loading ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Lock className="h-4 w-4" />
              )}
              登录
            </Button>
          </form>
        </div>

        {/* Default credentials hint */}
        <div className="mt-4 rounded-md border border-dashed border-muted-foreground/25 bg-muted/30 px-4 py-2.5 text-center">
          <p className="text-xs text-muted-foreground">
            默认账号: <span className="font-medium text-foreground/80">admin</span> / <span className="font-medium text-foreground/80">admin123</span>
            <span className="text-muted-foreground/60">（首次登录后请修改密码）</span>
          </p>
        </div>

        {/* Footer */}
        <p className="text-center text-xs text-muted-foreground/60 mt-4">
          首次登录请使用默认账户，登录后请立即修改密码
        </p>
      </div>
    </div>
  );
}
