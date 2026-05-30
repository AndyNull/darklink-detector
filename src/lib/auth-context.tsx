'use client';

import { createContext, useContext, useState, useEffect, useCallback, ReactNode } from 'react';
import { toast } from 'sonner';

// Auth token key
export const AUTH_TOKEN_KEY = 'darklink-auth-token';

/**
 * Get authorization headers for protected API calls.
 * Reads the auth token from localStorage and returns
 * an Authorization: Bearer header object.
 */
export function getAuthHeaders(): Record<string, string> {
  if (typeof window === 'undefined') return {};
  const token = localStorage.getItem(AUTH_TOKEN_KEY);
  if (!token) return {};
  return { Authorization: `Bearer ${token}` };
}

type AuthState = 'checking' | 'authenticated' | 'unauthenticated';

interface AuthContextType {
  authState: AuthState;
  username: string | null;
  isAuthenticated: boolean;
  login: (token: string, username: string, isDefaultPassword?: boolean) => void;
  logout: () => Promise<void>;
  requireAuth: (action: () => void) => boolean;
  showLoginDialog: () => void;
  loginDialogOpen: boolean;
  setLoginDialogOpen: (open: boolean) => void;
}

const AuthContext = createContext<AuthContextType | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [authState, setAuthState] = useState<AuthState>('checking');
  const [username, setUsername] = useState<string | null>(null);
  const [loginDialogOpen, setLoginDialogOpen] = useState(false);

  const handleUnauthenticated = useCallback(() => {
    localStorage.removeItem(AUTH_TOKEN_KEY);
    setUsername(null);
    setAuthState('unauthenticated');
  }, []);

  const doSessionCheck = useCallback(async (token: string): Promise<'authenticated' | 'client-error' | 'server-error' | 'network-error'> => {
    try {
      const res = await fetch('/api/auth/session', {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        const data = await res.json();
        if (data.authenticated && data.username) {
          setUsername(data.username);
          setAuthState('authenticated');
          if (data.isDefaultPassword) {
            toast.warning('安全提醒：请尽快修改默认密码', { description: '点击用户菜单中的"修改密码"进行修改' });
          }
          return 'authenticated';
        }
      }
      // Differentiate between client errors (4xx) and server errors (5xx)
      if (res.status >= 500) {
        return 'server-error';
      }
      return 'client-error';
    } catch {
      return 'network-error';
    }
  }, []);

  const checkSession = useCallback(async (): Promise<boolean> => {
    const token = localStorage.getItem(AUTH_TOKEN_KEY);
    if (!token) {
      handleUnauthenticated();
      return false;
    }

    const result = await doSessionCheck(token);

    if (result === 'authenticated') {
      return true;
    }

    // Network errors or client errors (4xx, including 401) → show app immediately as unauthenticated.
    // Only retry once briefly on server errors (5xx) since those may be transient.
    if (result === 'server-error') {
      // Brief retry for server errors — don't block the UI for long
      await new Promise(resolve => setTimeout(resolve, 1500));
      const retryResult = await doSessionCheck(token);
      if (retryResult === 'authenticated') {
        return true;
      }
    }

    // network-error, client-error, or failed retry → show app immediately
    handleUnauthenticated();
    return false;
  }, [handleUnauthenticated, doSessionCheck]);

  // Initial session check
  useEffect(() => {
    let cancelled = false;
    const doCheck = async () => {
      await checkSession();
      if (cancelled) return;
    };
    doCheck();
    return () => { cancelled = true; };
  }, [checkSession]);

  // Listen for auth change events
  useEffect(() => {
    const handleAuthChange = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      if (detail?.username) {
        setUsername(detail.username);
        setAuthState('authenticated');
      } else {
        setUsername(null);
        setAuthState('unauthenticated');
        localStorage.removeItem(AUTH_TOKEN_KEY);
      }
    };
    window.addEventListener('auth-change', handleAuthChange);
    return () => window.removeEventListener('auth-change', handleAuthChange);
  }, []);

  // Listen for session expiry events dispatched by apiFetch on 401 responses
  useEffect(() => {
    const handleSessionExpired = () => {
      localStorage.removeItem(AUTH_TOKEN_KEY);
      setAuthState('unauthenticated');
      setLoginDialogOpen(true);
    };
    window.addEventListener('auth-session-expired', handleSessionExpired);
    return () => window.removeEventListener('auth-session-expired', handleSessionExpired);
  }, []);

  // Poll session every 3 minutes
  useEffect(() => {
    if (authState !== 'authenticated') return;
    const interval = setInterval(() => { checkSession(); }, 180000);
    return () => clearInterval(interval);
  }, [authState, checkSession]);

  const login = useCallback((token: string, user: string, isDefaultPassword?: boolean) => {
    localStorage.setItem(AUTH_TOKEN_KEY, token);
    setUsername(user);
    setAuthState('authenticated');
    setLoginDialogOpen(false);
    if (isDefaultPassword) {
      toast.warning('安全提醒：请尽快修改默认密码', { description: '点击用户菜单中的"修改密码"进行修改' });
    }
  }, []);

  const logout = useCallback(async () => {
    const token = localStorage.getItem(AUTH_TOKEN_KEY);
    if (token) {
      try {
        await fetch('/api/auth/logout', {
          method: 'POST',
          headers: { Authorization: `Bearer ${token}` },
        });
      } catch {
        // ignore
      }
    }
    localStorage.removeItem(AUTH_TOKEN_KEY);
    setUsername(null);
    setAuthState('unauthenticated');
    window.dispatchEvent(new CustomEvent('auth-change', { detail: { username: null } }));
  }, []);

  const requireAuth = useCallback((action: () => void): boolean => {
    if (authState === 'authenticated') {
      action();
      return true;
    }
    setLoginDialogOpen(true);
    return false;
  }, [authState]);

  const showLoginDialog = useCallback(() => {
    setLoginDialogOpen(true);
  }, []);

  return (
    <AuthContext.Provider value={{
      authState,
      username,
      isAuthenticated: authState === 'authenticated',
      login,
      logout,
      requireAuth,
      showLoginDialog,
      loginDialogOpen,
      setLoginDialogOpen,
    }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}
