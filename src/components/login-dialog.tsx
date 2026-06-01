'use client';

import { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import {
  ShieldAlert,
  Lock,
  User,
  Loader2,
  AlertTriangle,
  Eye,
  EyeOff,
} from 'lucide-react';
import { rsaEncrypt, clearCachedPublicKey } from '@/lib/crypto-client';
import { useAuth } from '@/lib/auth-context';

interface LoginDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function LoginDialog({ open, onOpenChange }: LoginDialogProps) {
  const { login } = useAuth();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  // Reset form when dialog opens/closes
  useEffect(() => {
    if (!open) {
      setUsername('');
      setPassword('');
      setError('');
      setLoading(false);
      setShowPassword(false);
    }
  }, [open]);

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
      } catch {
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
          login(data.token, data.username, data.isDefaultPassword);
          onOpenChange(false);
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
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[380px] p-5 gap-3">
        <DialogHeader>
          <DialogTitle className="text-sm flex items-center gap-1.5">
            <ShieldAlert className="h-4 w-4 text-primary" />
            系统登录
          </DialogTitle>
          <DialogDescription className="text-[11px]">
            登录后可进行删除、更新等管理操作
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleLogin} className="space-y-3">
          <div className="space-y-1.5">
            <label className="text-[11px] font-medium text-muted-foreground">用户名</label>
            <div className="relative">
              <User className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
              <Input
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                className="h-8 text-xs pl-8"
                placeholder="请输入用户名"
                autoComplete="username"
                autoFocus
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <label className="text-[11px] font-medium text-muted-foreground">密码</label>
            <div className="relative">
              <Lock className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
              <Input
                type={showPassword ? 'text' : 'password'}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="h-8 text-xs pl-8 pr-8"
                placeholder="请输入密码"
                autoComplete="current-password"
              />
              <button
                type="button"
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground active:text-foreground/80 transition-colors cursor-pointer"
                onClick={() => setShowPassword(!showPassword)}
                aria-label={showPassword ? '隐藏密码' : '显示密码'}
              >
                {showPassword ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
              </button>
            </div>
          </div>

          {error && (
            <div className="flex items-center gap-1.5 text-[11px] text-destructive bg-destructive/5 rounded-md px-2.5 py-1.5">
              <AlertTriangle className="h-3 w-3 shrink-0" />
              {error}
            </div>
          )}

          <Button
            type="submit"
            className="w-full h-8 text-xs gap-1.5"
            disabled={loading || !username || !password}
          >
            {loading ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Lock className="h-3.5 w-3.5" />
            )}
            登录
          </Button>
        </form>

        <p className="text-center text-[10px] text-muted-foreground">
          首次登录请使用默认账户，登录后请立即修改密码
        </p>
      </DialogContent>
    </Dialog>
  );
}
