'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import {
  User,
  LogOut,
  Lock,
  Loader2,
  CheckCircle2,
  AlertTriangle,
  Info,
  LogIn,
  Pencil,
} from 'lucide-react';
import { useAuth, AUTH_TOKEN_KEY } from '@/lib/auth-context';
import { rsaEncrypt, clearCachedPublicKey } from '@/lib/crypto-client';
import { toast } from 'sonner';

/**
 * 强制加密辅助函数 - 加密失败则抛出错误，不允许明文传输
 */
async function enforceEncrypt(plaintext: string, label: string): Promise<string> {
  try {
    return await rsaEncrypt(plaintext);
  } catch {
    // 清除缓存重试一次
    clearCachedPublicKey();
    try {
      return await rsaEncrypt(plaintext);
    } catch {
      throw new Error(`${label}加密失败，无法建立安全连接，请刷新页面重试`);
    }
  }
}

export function AccountManagementSection() {
  const { isAuthenticated, username: authUsername, logout, showLoginDialog } = useAuth();
  const [showChangePassword, setShowChangePassword] = useState(false);
  const [oldPassword, setOldPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [changePasswordLoading, setChangePasswordLoading] = useState(false);
  const [changePasswordResult, setChangePasswordResult] = useState<{ success: boolean; message: string } | null>(null);

  // 修改用户名状态
  const [showChangeUsername, setShowChangeUsername] = useState(false);
  const [newUsername, setNewUsername] = useState('');
  const [usernamePassword, setUsernamePassword] = useState('');
  const [changeUsernameLoading, setChangeUsernameLoading] = useState(false);
  const [changeUsernameResult, setChangeUsernameResult] = useState<{ success: boolean; message: string } | null>(null);

  // Not authenticated: show login prompt
  if (!isAuthenticated) {
    return (
      <div className="space-y-3">
        <div className="text-[11px] text-muted-foreground">
          管理系统登录账户，修改密码和用户名
        </div>
        <div className="rounded border px-4 py-6 text-center space-y-3">
          <div className="flex items-center justify-center w-10 h-10 rounded-full bg-primary/10 mx-auto">
            <User className="h-5 w-5 text-primary" />
          </div>
          <div className="text-xs font-medium">未登录</div>
          <div className="text-[10px] text-muted-foreground">登录后可管理账户和修改密码</div>
          <Button
            variant="default"
            size="sm"
            className="h-8 text-[11px] gap-1.5"
            onClick={showLoginDialog}
          >
            <LogIn className="h-3 w-3" />
            去登录
          </Button>
        </div>
      </div>
    );
  }

  // Authenticated: show account management

  const handleChangePassword = async () => {
    if (newPassword !== confirmPassword) {
      setChangePasswordResult({ success: false, message: '两次输入的新密码不一致' });
      return;
    }
    if (newPassword.length < 6) {
      setChangePasswordResult({ success: false, message: '新密码长度不能少于6位，需包含字母和数字' });
      return;
    }
    if (!/[a-zA-Z]/.test(newPassword)) {
      setChangePasswordResult({ success: false, message: '新密码必须包含至少一个字母' });
      return;
    }
    if (!/[0-9]/.test(newPassword)) {
      setChangePasswordResult({ success: false, message: '新密码必须包含至少一个数字' });
      return;
    }

    setChangePasswordLoading(true);
    setChangePasswordResult(null);
    try {
      const token = typeof window !== 'undefined' ? localStorage.getItem(AUTH_TOKEN_KEY) : null;

      // 强制加密，不允许明文传输
      const encryptedOld = await enforceEncrypt(oldPassword, '旧密码');
      const encryptedNew = await enforceEncrypt(newPassword, '新密码');

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
        setChangePasswordResult({ success: true, message: '密码修改成功' });
        setOldPassword('');
        setNewPassword('');
        setConfirmPassword('');
        setTimeout(() => {
          setShowChangePassword(false);
          setChangePasswordResult(null);
        }, 2000);
      } else {
        setChangePasswordResult({ success: false, message: data.error || '修改失败' });
      }
    } catch (err: any) {
      setChangePasswordResult({ success: false, message: err.message || '网络错误' });
    } finally {
      setChangePasswordLoading(false);
    }
  };

  const handleChangeUsername = async () => {
    if (!newUsername.trim()) {
      setChangeUsernameResult({ success: false, message: '新用户名不能为空' });
      return;
    }
    if (newUsername.length < 2) {
      setChangeUsernameResult({ success: false, message: '用户名长度不能少于2个字符' });
      return;
    }
    if (newUsername.length > 50) {
      setChangeUsernameResult({ success: false, message: '用户名长度不能超过50个字符' });
      return;
    }
    if (!/^[a-zA-Z0-9_\u4e00-\u9fa5]+$/.test(newUsername)) {
      setChangeUsernameResult({ success: false, message: '用户名只能包含字母、数字、下划线和中文' });
      return;
    }
    if (newUsername === authUsername) {
      setChangeUsernameResult({ success: false, message: '新用户名与当前用户名相同' });
      return;
    }

    setChangeUsernameLoading(true);
    setChangeUsernameResult(null);
    try {
      const token = typeof window !== 'undefined' ? localStorage.getItem(AUTH_TOKEN_KEY) : null;

      // 强制加密密码，不允许明文传输
      const encryptedPassword = await enforceEncrypt(usernamePassword, '密码');

      const res = await fetch('/api/auth/change-username', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
        body: JSON.stringify({
          newUsername: newUsername.trim(),
          password: encryptedPassword,
          encrypted: true,
        }),
      });
      const data = await res.json();
      if (res.ok && data.success) {
        setChangeUsernameResult({ success: true, message: '用户名修改成功' });
        setUsernamePassword('');
        setNewUsername('');
        // 更新本地存储的用户名
        window.dispatchEvent(new CustomEvent('auth-change', { detail: { username: data.username } }));
        setTimeout(() => {
          setShowChangeUsername(false);
          setChangeUsernameResult(null);
        }, 2000);
      } else {
        setChangeUsernameResult({ success: false, message: data.error || '修改失败' });
      }
    } catch (err: any) {
      setChangeUsernameResult({ success: false, message: err.message || '网络错误' });
    } finally {
      setChangeUsernameLoading(false);
    }
  };

  return (
    <div className="space-y-3">
      <div className="text-[11px] text-muted-foreground">
        管理系统登录账户，修改密码和用户名
      </div>

      {/* Current User Info */}
      <div className="rounded border px-3 py-3 space-y-2">
        <div className="flex items-center gap-2">
          <div className="flex items-center justify-center w-8 h-8 rounded-full bg-primary/10 shrink-0">
            <User className="h-4 w-4 text-primary" />
          </div>
          <div>
            <div className="text-[11px] font-medium">{authUsername || 'admin'}</div>
            <div className="text-[9px] text-muted-foreground">管理员 · 当前登录用户</div>
          </div>
          <Button
            variant="ghost"
            size="sm"
            className="h-7 text-[10px] gap-1 ml-auto px-2 cursor-pointer transition-colors text-destructive hover:bg-destructive/10 hover:text-destructive"
            onClick={logout}
          >
            <LogOut className="h-3 w-3" />
            退出登录
          </Button>
        </div>
        <div className="flex gap-2">
          <Button
            variant="outline"
            size="sm"
            className="h-8 text-[10px] gap-1 flex-1"
            onClick={() => { setShowChangeUsername(true); setNewUsername(''); setUsernamePassword(''); setChangeUsernameResult(null); }}
          >
            <Pencil className="h-3 w-3" />
            修改用户名
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="h-8 text-[10px] gap-1 flex-1"
            onClick={() => { setShowChangePassword(true); setOldPassword(''); setNewPassword(''); setConfirmPassword(''); setChangePasswordResult(null); }}
          >
            <Lock className="h-3 w-3" />
            修改密码
          </Button>
        </div>
      </div>

      {/* Security Tips */}
      <div className="rounded-md border bg-muted/30 px-3 py-2">
        <div className="flex items-start gap-2">
          <Info className="h-3.5 w-3.5 text-muted-foreground shrink-0 mt-0.5" />
          <div className="text-[10px] text-muted-foreground leading-relaxed space-y-1">
            <p>• 首次登录后请立即修改默认密码</p>
            <p>• 密码需至少6位，包含字母和数字</p>
            <p>• 所有敏感操作均强制加密传输</p>
            <p>• 未登录时可使用扫描和查看功能，管理操作需登录</p>
          </div>
        </div>
      </div>

      {/* Change Username Dialog */}
      <Dialog open={showChangeUsername} onOpenChange={setShowChangeUsername}>
        <DialogContent className="sm:max-w-[400px]">
          <DialogHeader>
            <DialogTitle className="text-sm flex items-center gap-1.5">
              <Pencil className="h-4 w-4" />
              修改用户名
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <div className="space-y-1">
              <span className="text-[11px] text-muted-foreground">当前用户名</span>
              <div className="h-8 px-3 rounded-md border bg-muted/50 flex items-center text-xs text-muted-foreground">
                {authUsername}
              </div>
            </div>
            <div className="space-y-1">
              <span className="text-[11px] text-muted-foreground">新用户名</span>
              <Input
                value={newUsername}
                onChange={(e) => setNewUsername(e.target.value)}
                className="h-8 text-xs"
                placeholder="输入新用户名（2-50位，字母/数字/下划线/中文）"
                autoFocus
              />
            </div>
            <div className="space-y-1">
              <span className="text-[11px] text-muted-foreground">确认密码</span>
              <Input
                type="password"
                value={usernamePassword}
                onChange={(e) => setUsernamePassword(e.target.value)}
                className="h-8 text-xs"
                placeholder="输入当前密码以确认身份"
                onKeyDown={(e) => { if (e.key === 'Enter') handleChangeUsername(); }}
              />
            </div>
            {changeUsernameResult && (
              <div className={`rounded border px-3 py-2 flex items-center gap-1.5 text-[11px] ${
                changeUsernameResult.success
                  ? 'border-green-500/30 bg-green-500/5 text-green-600'
                  : 'border-red-500/30 bg-red-500/5 text-red-500'
              }`}>
                {changeUsernameResult.success ? (
                  <CheckCircle2 className="h-3.5 w-3.5 shrink-0" />
                ) : (
                  <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
                )}
                {changeUsernameResult.message}
              </div>
            )}
          </div>
          <DialogFooter className="gap-2">
            <Button
              variant="outline"
              size="sm"
              className="h-8 text-[10px]"
              onClick={() => { setShowChangeUsername(false); setChangeUsernameResult(null); }}
            >
              取消
            </Button>
            <Button
              variant="default"
              size="sm"
              className="h-8 text-[10px] gap-1"
              onClick={handleChangeUsername}
              disabled={changeUsernameLoading || !newUsername || !usernamePassword}
            >
              {changeUsernameLoading ? <Loader2 className="h-3 w-3 animate-spin" /> : '确认修改'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

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
                onChange={(e) => setNewPassword(e.target.value)}
                className="h-8 text-xs"
                placeholder="输入新密码（至少6位，包含字母和数字）"
              />
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
            {changePasswordResult && (
              <div className={`rounded border px-3 py-2 flex items-center gap-1.5 text-[11px] ${
                changePasswordResult.success
                  ? 'border-green-500/30 bg-green-500/5 text-green-600'
                  : 'border-red-500/30 bg-red-500/5 text-red-500'
              }`}>
                {changePasswordResult.success ? (
                  <CheckCircle2 className="h-3.5 w-3.5 shrink-0" />
                ) : (
                  <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
                )}
                {changePasswordResult.message}
              </div>
            )}
          </div>
          <DialogFooter className="gap-2">
            <Button
              variant="outline"
              size="sm"
              className="h-8 text-[10px]"
              onClick={() => { setShowChangePassword(false); setChangePasswordResult(null); }}
            >
              取消
            </Button>
            <Button
              variant="default"
              size="sm"
              className="h-8 text-[10px] gap-1"
              onClick={handleChangePassword}
              disabled={changePasswordLoading || !oldPassword || !newPassword || !confirmPassword}
            >
              {changePasswordLoading ? <Loader2 className="h-3 w-3 animate-spin" /> : '确认修改'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
