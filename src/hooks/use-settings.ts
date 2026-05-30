'use client';

import { useState, useCallback } from 'react';

// Detection rule keys
export type DetectionRuleKey =
  | 'css_hidden'
  | 'size_hidden'
  | 'color_hidden'
  | 'position_hidden'
  | 'overflow_hidden'
  | 'iframe_hidden'
  | 'suspicious_domain'
  | 'js_injected'
  | 'malicious_keyword'
  | 'suspicious_shortener'
  | 'cheap_tld'
  | 'hidden_text'
  | 'keyword_stuffing'
  | 'hidden_div_link';

// Threat intel API source keys
export type ThreatIntelSourceKey = 'threatbook' | 'virustotal' | 'abuseipdb' | 'shodan';

export interface Settings {
  systemName: string;
  detectionRules: Record<DetectionRuleKey, boolean>;
  threatIntelApis: Record<ThreatIntelSourceKey, string>;
}

const DEFAULT_SETTINGS: Settings = {
  systemName: '暗链检测系统',
  detectionRules: {
    css_hidden: true,
    size_hidden: true,
    color_hidden: true,
    position_hidden: true,
    overflow_hidden: true,
    iframe_hidden: true,
    suspicious_domain: true,
    js_injected: true,
    malicious_keyword: true,
    suspicious_shortener: true,
    cheap_tld: true,
    hidden_text: true,
    keyword_stuffing: true,
    hidden_div_link: true,
  },
  threatIntelApis: {
    threatbook: '',
    virustotal: '',
    abuseipdb: '',
    shodan: '',
  },
};

const STORAGE_KEY = 'darklink-detector-settings';

function loadSettings(): Settings {
  if (typeof window === 'undefined') return DEFAULT_SETTINGS;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_SETTINGS;
    const parsed = JSON.parse(raw);
    // Merge with defaults to handle new keys added later
    return {
      systemName: parsed.systemName ?? DEFAULT_SETTINGS.systemName,
      detectionRules: {
        ...DEFAULT_SETTINGS.detectionRules,
        ...(parsed.detectionRules || {}),
      },
      threatIntelApis: {
        ...DEFAULT_SETTINGS.threatIntelApis,
        ...(parsed.threatIntelApis || {}),
      },
    };
  } catch {
    return DEFAULT_SETTINGS;
  }
}

function saveSettings(settings: Settings) {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  } catch {
    // localStorage might be full or unavailable
  }
}

export function useSettings() {
  const [settings, setSettingsState] = useState<Settings>(() => loadSettings());

  // Persist to localStorage on change
  const setSettings = useCallback((newSettings: Settings) => {
    setSettingsState(newSettings);
    saveSettings(newSettings);
  }, []);

  const updateSystemName = useCallback((name: string) => {
    setSettingsState((prev) => {
      const next = { ...prev, systemName: name };
      saveSettings(next);
      return next;
    });
  }, []);

  const updateDetectionRule = useCallback((key: DetectionRuleKey, enabled: boolean) => {
    setSettingsState((prev) => {
      const next = {
        ...prev,
        detectionRules: { ...prev.detectionRules, [key]: enabled },
      };
      saveSettings(next);
      return next;
    });
  }, []);

  const updateThreatIntelApi = useCallback((key: ThreatIntelSourceKey, value: string) => {
    setSettingsState((prev) => {
      const next = {
        ...prev,
        threatIntelApis: { ...prev.threatIntelApis, [key]: value },
      };
      saveSettings(next);
      return next;
    });
  }, []);

  const resetToDefaults = useCallback(() => {
    setSettings(DEFAULT_SETTINGS);
  }, [setSettings]);

  return {
    settings,
    setSettings,
    updateSystemName,
    updateDetectionRule,
    updateThreatIntelApi,
    resetToDefaults,
  };
}
