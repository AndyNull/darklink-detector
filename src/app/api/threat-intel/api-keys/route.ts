import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { checkApiAuth, requireSessionAuth } from '@/lib/api-auth';
import { encrypt, decrypt, isEncrypted } from '@/lib/crypto-server';
import { rsaDecrypt, getSessionFromRequest } from '@/lib/server-config';
import { auditLog } from '@/lib/audit-logger';

export const dynamic = 'force-dynamic';

// Allowed sources that support API key configuration
const ALLOWED_SOURCES = ['threatbook', 'alienvault-otx', 'threatfox', 'phishtank', 'virustotal', 'abuseipdb'] as const;
type AllowedSource = (typeof ALLOWED_SOURCES)[number];

// Source metadata for UI display
const SOURCES_META: Record<
  AllowedSource,
  {
    id: string;
    name: string;
    description: string;
    registerUrl: string;
    apiKeyPlaceholder: string;
    docUrl: string;
    validateEndpoint?: string;
    validateMethod?: (apiKey: string) => Promise<{ valid: boolean; error?: string }>;
  }
> = {
  threatbook: {
    id: 'threatbook',
    name: '微步 ThreatBook',
    description: '微步在线威胁情报查询API',
    registerUrl: 'https://x.threatbook.com/',
    apiKeyPlaceholder: '请输入微步API Key',
    docUrl: 'https://x.threatbook.com/node',
    validateEndpoint: 'https://api.threatbook.cn/v3/asset/ip',
    validateMethod: async (apiKey: string) => {
      try {
        const url = `https://api.threatbook.cn/v3/asset/ip?apikey=${apiKey}&ip=8.8.8.8`;
        const resp = await fetch(url, {
          method: 'GET',
          headers: { 'Accept': 'application/json' },
          signal: AbortSignal.timeout(15000),
        });
        const json = await resp.json();
        if (json.response_code === 0) {
          return { valid: true };
        }
        return { valid: false, error: json.verbose_msg || `错误码: ${json.response_code}` };
      } catch (err: any) {
        return { valid: false, error: err.message || '连接失败' };
      }
    },
  },
  'alienvault-otx': {
    id: 'alienvault-otx',
    name: 'AlienVault OTX',
    description: '开放威胁交换平台API',
    registerUrl: 'https://otx.alienvault.com/',
    apiKeyPlaceholder: '请输入OTX API Key',
    docUrl: 'https://otx.alienvault.com/api',
    validateMethod: async (apiKey: string) => {
      try {
        const url = 'https://otx.alienvault.com/api/v1/pulses/subscribed?limit=1';
        const resp = await fetch(url, {
          method: 'GET',
          headers: {
            'Accept': 'application/json',
            'X-OTX-API-KEY': apiKey,
          },
          signal: AbortSignal.timeout(15000),
        });
        if (resp.ok) {
          return { valid: true };
        }
        return { valid: false, error: `HTTP ${resp.status}` };
      } catch (err: any) {
        return { valid: false, error: err.message || '连接失败' };
      }
    },
  },
  virustotal: {
    id: 'virustotal',
    name: 'VirusTotal',
    description: '多引擎恶意文件/URL/IP检测API（仅查询模式，有调用频率限制）',
    registerUrl: 'https://www.virustotal.com/gui/join-us',
    apiKeyPlaceholder: '请输入VirusTotal API Key',
    docUrl: 'https://developers.virustotal.com/reference/overview',
    validateMethod: async (apiKey: string) => {
      try {
        const resp = await fetch('https://www.virustotal.com/api/v3/domains/google.com', {
          method: 'GET',
          headers: { 'x-apikey': apiKey, 'Accept': 'application/json' },
          signal: AbortSignal.timeout(15000),
        });
        if (resp.ok) {
          return { valid: true };
        }
        if (resp.status === 429) {
          // Key is valid but rate limited
          return { valid: true, error: 'API Key有效，但已达到调用频率限制' };
        }
        if (resp.status === 401) {
          return { valid: false, error: 'API Key无效或已过期' };
        }
        return { valid: false, error: `HTTP ${resp.status}` };
      } catch (err: any) {
        return { valid: false, error: err.message || '连接失败' };
      }
    },
  },
  abuseipdb: {
    id: 'abuseipdb',
    name: 'AbuseIPDB',
    description: 'IP滥用报告查询API（仅查询模式，有调用频率限制）',
    registerUrl: 'https://www.abuseipdb.com/api',
    apiKeyPlaceholder: '请输入AbuseIPDB API Key',
    docUrl: 'https://docs.abuseipdb.com/',
    validateMethod: async (apiKey: string) => {
      try {
        const resp = await fetch('https://api.abuseipdb.com/api/v2/check?ipAddress=8.8.8.8&maxAgeInDays=90', {
          method: 'GET',
          headers: { 'Key': apiKey, 'Accept': 'application/json' },
          signal: AbortSignal.timeout(15000),
        });
        if (resp.ok) {
          return { valid: true };
        }
        if (resp.status === 429) {
          // Key is valid but rate limited
          return { valid: true, error: 'API Key有效，但已达到调用频率限制' };
        }
        if (resp.status === 401 || resp.status === 403) {
          return { valid: false, error: 'API Key无效或权限不足' };
        }
        return { valid: false, error: `HTTP ${resp.status}` };
      } catch (err: any) {
        return { valid: false, error: err.message || '连接失败' };
      }
    },
  },
  threatfox: {
    id: 'threatfox',
    name: 'ThreatFox',
    description: 'Abuse.ch IOC威胁情报API',
    registerUrl: 'https://threatfox.abuse.ch/',
    apiKeyPlaceholder: '请输入ThreatFox API Key',
    docUrl: 'https://threatfox.abuse.ch/api/',
    validateMethod: async (apiKey: string) => {
      try {
        // ThreatFox API doesn't require an API key for basic queries,
        // but we can test if the key is accepted by making a query
        const resp = await fetch('https://threatfox-api.abuse.ch/api/v1/', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Auth-Key': apiKey,
          },
          body: JSON.stringify({ query: 'search', search_term: 'test', limit: 1 }),
          signal: AbortSignal.timeout(15000),
        });
        if (resp.ok) {
          const json = await resp.json();
          // ThreatFox returns data even without auth, but we check for auth errors
          if (json.query_status === 'ok' || json.query_status === 'no_result') {
            return { valid: true };
          }
          return { valid: false, error: json.query_status || '验证失败' };
        }
        return { valid: false, error: `HTTP ${resp.status}` };
      } catch (err: any) {
        return { valid: false, error: err.message || '连接失败' };
      }
    },
  },
  phishtank: {
    id: 'phishtank',
    name: 'PhishTank',
    description: '钓鱼网站数据库API',
    registerUrl: 'https://www.phishtank.com/',
    apiKeyPlaceholder: '请输入PhishTank API Key',
    docUrl: 'https://www.phishtank.com/api_info.php',
    validateMethod: async (apiKey: string) => {
      try {
        // PhishTank's API does not have a dedicated key-validation endpoint.
        // We test the key by calling the check-url API with a known-safe URL.
        // If the key is valid, the API responds with a result (even if the URL
        // is not phishing). If the key is invalid, the API returns an error.
        const resp = await fetch('https://checkurl.phishtank.com/checkurl/', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            url: 'https://google.com',
            app_key: apiKey,
            format: 'json',
          }),
          signal: AbortSignal.timeout(15000),
        });

        if (resp.ok) {
          const json = await resp.json();
          // PhishTank returns meta.status on valid responses
          if (json.meta?.status === 'success' || json.results?.valid !== undefined) {
            return { valid: true };
          }
          // If the response indicates an invalid app_key, report it
          if (json.meta?.error) {
            return { valid: false, error: json.meta.error || 'API Key验证失败' };
          }
          // Ambiguous response — key might be valid but the URL check returned something unexpected
          return { valid: true };
        }

        if (resp.status === 401 || resp.status === 403) {
          return { valid: false, error: `API Key无效 (HTTP ${resp.status})` };
        }
        return { valid: false, error: `HTTP ${resp.status}` };
      } catch (err: any) {
        return { valid: false, error: err.message || '连接失败' };
      }
    },
  },
};

/**
 * Mask an API key, showing only the last 4 characters.
 * Returns '****' if the key is empty or shorter than 4 chars.
 */
function maskApiKey(key: string): string {
  if (!key || key.length <= 4) {
    return '****';
  }
  return '****' + key.slice(-4);
}

/**
 * Get key status for a source
 */
function getKeyStatus(
  record: { enabled: boolean; lastValidated: Date | null; lastError: string | null } | null
): 'configured' | 'not-configured' | 'error' | 'disabled' {
  if (!record) return 'not-configured';
  if (!record.enabled) return 'disabled';
  if (record.lastError) return 'error';
  return 'configured';
}

// GET /api/threat-intel/api-keys — List all API key configurations with status
export async function GET(request: NextRequest) {
  const authError = checkApiAuth(request);
  if (authError) return authError;

  try {
    const keys = await db.threatIntelApiKey.findMany({
      orderBy: { createdAt: 'asc' },
    });

    // Mask API keys in response — never expose full keys
    const maskedKeys = keys.map((record) => ({
      ...record,
      apiKey: maskApiKey(record.apiKey),
      status: getKeyStatus(record),
    }));

    // Return the source definitions for UI consumption with status
    const sources = ALLOWED_SOURCES.map((id) => {
      const meta = SOURCES_META[id];
      const record = keys.find(k => k.source === id);
      return {
        ...meta,
        // Remove validateMethod from response (functions can't be serialized)
        validateEndpoint: meta.validateEndpoint || null,
        validateMethod: undefined,
        keyConfigured: !!record,
        keyEnabled: record?.enabled ?? false,
        keyStatus: getKeyStatus(record ?? null),
        lastValidated: record?.lastValidated?.toISOString() || null,
        lastError: record?.lastError || null,
      };
    });

    return NextResponse.json({
      keys: maskedKeys,
      sources,
    });
  } catch (error) {
    console.error('Failed to fetch threat intel API keys:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

// PUT /api/threat-intel/api-keys — Update/create an API key for a source
export async function PUT(request: NextRequest) {
  const sessionError = requireSessionAuth(request);
  if (sessionError) return sessionError;
  const authError = checkApiAuth(request);
  if (authError) return authError;

  const actor = getSessionFromRequest(request) || 'system';
  const ip = request.headers.get('x-real-ip') || request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown';

  try {
    const body = await request.json();
    const { source, apiKey, apiUrl, enabled } = body;

    // Validate source
    if (!source || !ALLOWED_SOURCES.includes(source)) {
      return NextResponse.json(
        { error: `Invalid source. Must be one of: ${ALLOWED_SOURCES.join(', ')}` },
        { status: 400 }
      );
    }

    // Validate apiKey is provided
    if (apiKey === undefined || apiKey === null || typeof apiKey !== 'string') {
      return NextResponse.json(
        { error: 'apiKey is required and must be a string' },
        { status: 400 }
      );
    }

    // Validate apiUrl if provided
    if (apiUrl !== undefined && apiUrl !== null && typeof apiUrl !== 'string') {
      return NextResponse.json(
        { error: 'apiUrl must be a string or null' },
        { status: 400 }
      );
    }

    // Validate enabled if provided
    if (enabled !== undefined && typeof enabled !== 'boolean') {
      return NextResponse.json(
        { error: 'enabled must be a boolean' },
        { status: 400 }
      );
    }

    // Decrypt RSA-encrypted API key if needed
    let decryptedApiKey = apiKey;
    if (apiKey && apiKey !== '__keep__') {
      const rsaResult = rsaDecrypt(apiKey);
      if (rsaResult) {
        decryptedApiKey = rsaResult;
      }
      // If rsaDecrypt returns null, it might be a plaintext key (backward compat)
    }

    // Handle special __keep__ value: only update enabled/apiUrl, keep existing key
    const isKeepKey = apiKey === '__keep__';

    // Build update data
    const updateData: Record<string, unknown> = {};
    if (!isKeepKey) {
      // Encrypt the API key before storing
      updateData.apiKey = encrypt(decryptedApiKey);
      // Clear validation error when key is updated
      updateData.lastError = null;
    }
    if (apiUrl !== undefined) {
      updateData.apiUrl = apiUrl || null;
    }
    if (enabled !== undefined) {
      updateData.enabled = enabled;
    }

    // If using __keep__ but no record exists, return error
    if (isKeepKey) {
      const existing = await db.threatIntelApiKey.findUnique({ where: { source } });
      if (!existing) {
        return NextResponse.json(
          { error: 'No existing API key to keep. Please provide a new key.' },
          { status: 400 }
        );
      }
      // Update only enabled/apiUrl
      if (Object.keys(updateData).length > 0) {
        const record = await db.threatIntelApiKey.update({
          where: { source },
          data: updateData,
        });
        auditLog.system('api_key_saved', actor, { source, action: 'update', fields: Object.keys(updateData) }, ip, 'threat_intel_source', source);
        return NextResponse.json({
          ...record,
          apiKey: maskApiKey(record.apiKey),
          status: getKeyStatus(record),
        });
      }
      // Nothing to update
      return NextResponse.json({
        ...existing,
        apiKey: maskApiKey(existing.apiKey),
        status: getKeyStatus(existing),
      });
    }

    // Upsert: create if doesn't exist for this source, update if it does
    const record = await db.threatIntelApiKey.upsert({
      where: { source },
      update: updateData,
      create: {
        source,
        apiKey: encrypt(decryptedApiKey),
        apiUrl: apiUrl || null,
        enabled: enabled ?? true,
      },
    });

    auditLog.system('api_key_saved', actor, { source, action: 'upsert' }, ip, 'threat_intel_source', source);

    // Return with masked API key
    return NextResponse.json({
      ...record,
      apiKey: maskApiKey(record.apiKey),
      status: getKeyStatus(record),
    });
  } catch (error) {
    console.error('Failed to upsert threat intel API key:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

// POST /api/threat-intel/api-keys — Validate an API key
// Body: { action: 'validate', source: string, key?: string }
// Or query: ?action=validate&source=threatbook&key=xxx
export async function POST(request: NextRequest) {
  const sessionError = requireSessionAuth(request);
  if (sessionError) return sessionError;
  const authError = checkApiAuth(request);
  if (authError) return authError;

  const actor = getSessionFromRequest(request) || 'system';
  const ip = request.headers.get('x-real-ip') || request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown';

  try {
    const { searchParams } = new URL(request.url);
    const action = searchParams.get('action') || '';

    if (action === 'validate') {
      const source = searchParams.get('source') as AllowedSource | null;
      const queryKey = searchParams.get('key');

      // Also try reading from body
      let bodySource = source;
      let bodyKey = queryKey;
      try {
        const body = await request.json();
        if (body.source && !bodySource) bodySource = body.source;
        if (body.key && !bodyKey) bodyKey = body.key;
      } catch {
        // No body or invalid JSON
      }

      if (!bodySource || !ALLOWED_SOURCES.includes(bodySource as AllowedSource)) {
        return NextResponse.json(
          { error: `Invalid source. Must be one of: ${ALLOWED_SOURCES.join(', ')}` },
          { status: 400 }
        );
      }

      const sourceId = bodySource as AllowedSource;
      const meta = SOURCES_META[sourceId];

      // If no key provided, try to use the stored key
      // Decrypt RSA-encrypted key if needed
      let keyToValidate = bodyKey;
      if (keyToValidate) {
        const rsaResult = rsaDecrypt(keyToValidate);
        if (rsaResult) {
          keyToValidate = rsaResult;
        }
      }
      if (!keyToValidate) {
        const record = await db.threatIntelApiKey.findUnique({ where: { source: sourceId } });
        if (!record) {
          return NextResponse.json(
            { error: 'No API key configured for this source' },
            { status: 400 }
          );
        }
        // Decrypt stored key
        try {
          keyToValidate = decrypt(record.apiKey);
        } catch {
          // Might be legacy unencrypted key
          keyToValidate = record.apiKey;
        }
      }

      // Validate the key using the source's validate method
      if (meta.validateMethod) {
        const result = await meta.validateMethod(keyToValidate);

        // Update the database record with validation result
        await db.threatIntelApiKey.upsert({
          where: { source: sourceId },
          update: {
            lastValidated: result.valid ? new Date() : undefined,
            lastError: result.error || null,
          },
          create: {
            source: sourceId,
            apiKey: encrypt(keyToValidate),
            enabled: true,
            lastValidated: result.valid ? new Date() : undefined,
            lastError: result.error || null,
          },
        }).catch(() => {});

        auditLog.system('api_key_validated', actor, { source: sourceId, valid: result.valid }, ip, 'threat_intel_source', sourceId);

        return NextResponse.json({
          source: sourceId,
          valid: result.valid,
          error: result.error || null,
          validatedAt: new Date().toISOString(),
        });
      }

      // No validation method available for this source
      return NextResponse.json({
        source: sourceId,
        valid: null,
        error: '此数据源不支持在线验证',
        validatedAt: new Date().toISOString(),
      });
    }

    return NextResponse.json(
      { error: 'Unknown action. Supported actions: validate' },
      { status: 400 }
    );
  } catch (error) {
    console.error('Failed to validate API key:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

// DELETE /api/threat-intel/api-keys — Delete an API key configuration
export async function DELETE(request: NextRequest) {
  const sessionError = requireSessionAuth(request);
  if (sessionError) return sessionError;
  const authError = checkApiAuth(request);
  if (authError) return authError;

  const actor = getSessionFromRequest(request) || 'system';
  const ip = request.headers.get('x-real-ip') || request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown';

  try {
    const { searchParams } = new URL(request.url);
    const source = searchParams.get('source');

    if (!source) {
      return NextResponse.json(
        { error: 'source query parameter is required' },
        { status: 400 }
      );
    }

    // Validate source
    if (!ALLOWED_SOURCES.includes(source as AllowedSource)) {
      return NextResponse.json(
        { error: `Invalid source. Must be one of: ${ALLOWED_SOURCES.join(', ')}` },
        { status: 400 }
      );
    }

    // Find and delete
    const existing = await db.threatIntelApiKey.findUnique({
      where: { source },
    });

    if (!existing) {
      return NextResponse.json(
        { error: `No API key configuration found for source: ${source}` },
        { status: 404 }
      );
    }

    await db.threatIntelApiKey.delete({
      where: { source },
    });

    auditLog.system('api_key_deleted', actor, { source }, ip, 'threat_intel_source', source);

    return NextResponse.json({ success: true, source });
  } catch (error) {
    console.error('Failed to delete threat intel API key:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
