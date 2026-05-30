/**
 * System Configuration - shared utility for reading/writing system settings
 * All values are persisted to localStorage with prefix 'darklink-system-'
 */

const SYSTEM_PREFIX = 'darklink-system-';

import { APP_VERSION } from './version';
export { APP_VERSION };

export interface SystemConfig {
  systemName: string;
  systemVersion: string; // READ-ONLY - not editable in UI
  pageTitle: string;       // editable - browser tab title
  copyright: string;       // editable - footer copyright text
  autoUpdate: boolean;
  updateFrequency: string; // hourly, every-6h, every-12h, daily, weekly
}

const DEFAULT_CONFIG: SystemConfig = {
  systemName: '暗链检测系统',
  systemVersion: APP_VERSION,
  pageTitle: '暗链检测系统',
  copyright: '© 2026 暗链检测系统 All Rights Reserved',
  autoUpdate: false,
  updateFrequency: 'daily',
};

function getKey(key: string): string {
  return SYSTEM_PREFIX + key;
}

export function getSystemConfig(): SystemConfig {
  if (typeof window === 'undefined') return DEFAULT_CONFIG;
  try {
    return {
      systemName: localStorage.getItem(getKey('name')) || DEFAULT_CONFIG.systemName,
      systemVersion: localStorage.getItem(getKey('version')) || DEFAULT_CONFIG.systemVersion,
      pageTitle: localStorage.getItem(getKey('page-title')) || DEFAULT_CONFIG.pageTitle,
      copyright: localStorage.getItem(getKey('copyright')) || DEFAULT_CONFIG.copyright,
      autoUpdate: localStorage.getItem(getKey('auto-update')) === 'true',
      updateFrequency: localStorage.getItem(getKey('update-frequency')) || DEFAULT_CONFIG.updateFrequency,
    };
  } catch {
    return DEFAULT_CONFIG;
  }
}

export function setSystemConfig(partial: Partial<SystemConfig>): void {
  if (typeof window === 'undefined') return;
  try {
    if (partial.systemName !== undefined) {
      localStorage.setItem(getKey('name'), partial.systemName);
    }
    if (partial.systemVersion !== undefined) {
      localStorage.setItem(getKey('version'), partial.systemVersion);
    }
    if (partial.autoUpdate !== undefined) {
      localStorage.setItem(getKey('auto-update'), String(partial.autoUpdate));
    }
    if (partial.pageTitle !== undefined) {
      localStorage.setItem(getKey('page-title'), partial.pageTitle);
    }
    if (partial.copyright !== undefined) {
      localStorage.setItem(getKey('copyright'), partial.copyright);
    }
    if (partial.updateFrequency !== undefined) {
      localStorage.setItem(getKey('update-frequency'), partial.updateFrequency);
    }
    // Dispatch custom event so same-tab listeners can react immediately
    window.dispatchEvent(new Event('system-config-changed'));
  } catch {
    // ignore
  }
}

export function getSystemName(): string {
  if (typeof window === 'undefined') return DEFAULT_CONFIG.systemName;
  try {
    return localStorage.getItem(getKey('name')) || DEFAULT_CONFIG.systemName;
  } catch {
    return DEFAULT_CONFIG.systemName;
  }
}

export function getSystemVersion(): string {
  if (typeof window === 'undefined') return DEFAULT_CONFIG.systemVersion;
  try {
    return localStorage.getItem(getKey('version')) || DEFAULT_CONFIG.systemVersion;
  } catch {
    return DEFAULT_CONFIG.systemVersion;
  }
}

export function getPageTitle(): string {
  if (typeof window === 'undefined') return DEFAULT_CONFIG.pageTitle;
  try {
    return localStorage.getItem(getKey('page-title')) || DEFAULT_CONFIG.pageTitle;
  } catch {
    return DEFAULT_CONFIG.pageTitle;
  }
}

export function getCopyright(): string {
  if (typeof window === 'undefined') return DEFAULT_CONFIG.copyright;
  try {
    return localStorage.getItem(getKey('copyright')) || DEFAULT_CONFIG.copyright;
  } catch {
    return DEFAULT_CONFIG.copyright;
  }
}

export function getLastSyncTime(): string | null {
  if (typeof window === 'undefined') return null;
  try {
    return localStorage.getItem('darklink-last-sync-time');
  } catch {
    return null;
  }
}

export function setLastSyncTime(time: string): void {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem('darklink-last-sync-time', time);
  } catch {
    // ignore
  }
}

export const UPDATE_FREQUENCY_OPTIONS = [
  { value: 'hourly', label: '每小时' },
  { value: 'every-6h', label: '每6小时' },
  { value: 'every-12h', label: '每12小时' },
  { value: 'daily', label: '每天' },
  { value: 'weekly', label: '每周' },
] as const;
