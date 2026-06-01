import { NextRequest, NextResponse } from 'next/server';
import { requireSessionAuth } from '@/lib/api-auth';
import { validateImportData, getSessionFromRequest } from '@/lib/server-config';
import { db } from '@/lib/db';
import { auditLog } from '@/lib/audit-logger';

// ─── Rate Limiting for Import ──────────────────────────────────────────────

const importRateLimitMap = new Map<string, { count: number; lastAttempt: number }>();
const IMPORT_RATE_LIMIT_MAX = 3;       // max requests per window
const IMPORT_RATE_LIMIT_WINDOW = 60000; // 1 minute window

function checkImportRateLimit(key: string): { allowed: boolean; remainingMs: number } {
  const now = Date.now();
  const record = importRateLimitMap.get(key);

  if (!record || now - record.lastAttempt > IMPORT_RATE_LIMIT_WINDOW) {
    importRateLimitMap.set(key, { count: 1, lastAttempt: now });
    return { allowed: true, remainingMs: 0 };
  }

  if (record.count >= IMPORT_RATE_LIMIT_MAX) {
    return { allowed: false, remainingMs: IMPORT_RATE_LIMIT_WINDOW - (now - record.lastAttempt) };
  }

  record.count++;
  record.lastAttempt = now;
  return { allowed: true, remainingMs: 0 };
}

// Clean up old rate limit entries periodically
setInterval(() => {
  const now = Date.now();
  for (const [key, record] of importRateLimitMap.entries()) {
    if (now - record.lastAttempt > IMPORT_RATE_LIMIT_WINDOW) {
      importRateLimitMap.delete(key);
    }
  }
}, 60000);

interface ImportData {
  version: string;
  exportedAt: string;
  tables: {
    ScanTask?: unknown[];
    ScanResult?: unknown[];
    UrlDetail?: unknown[];
    DarkLink?: unknown[];
    QrCodeResult?: unknown[];
    ScanLog?: unknown[];
    MaliciousDomain?: unknown[];
    MaliciousIP?: unknown[];
    UpdateSchedule?: unknown[];
    ThreatIntelEntry?: unknown[];
  };
  counts?: Record<string, number>;
}

// Allowed fields for ThreatIntelEntry import to prevent arbitrary field injection
const THREAT_INTEL_ALLOWED_FIELDS = [
  'id', 'type', 'value', 'source', 'severity', 'category',
  'description', 'tags', 'confidence', 'country', 'asn',
  'createdAt', 'updatedAt',
];

function sanitizeThreatIntelRecord(record: Record<string, unknown>): Record<string, unknown> {
  const sanitized: Record<string, unknown> = {};
  for (const field of THREAT_INTEL_ALLOWED_FIELDS) {
    if (record[field] !== undefined) {
      sanitized[field] = record[field];
    }
  }
  // Ensure id is present and is a string
  if (typeof sanitized.id !== 'string') {
    sanitized.id = String(sanitized.id || '');
  }
  return sanitized;
}

export async function POST(request: NextRequest) {
  try {
    const sessionError = requireSessionAuth(request);
    if (sessionError) return sessionError;

    // Rate limiting — prevent rapid repeated import requests
    const rateLimitKey = request.headers.get('x-real-ip') ||
                         request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
                         'unknown';
    const rateLimit = checkImportRateLimit(rateLimitKey);
    if (!rateLimit.allowed) {
      return NextResponse.json(
        { error: '导入请求过于频繁，请稍后再试' },
        { status: 429 }
      );
    }

    const actor = getSessionFromRequest(request) || 'system';
    const ip = rateLimitKey;

    const body = await request.json() as ImportData;

    if (!body || !body.tables) {
      return NextResponse.json({ error: '导入数据格式无效' }, { status: 400 });
    }

    if (!body.version) {
      return NextResponse.json({ error: '导入数据缺少版本信息' }, { status: 400 });
    }

    // Validate import data size limits
    const importValidation = validateImportData(body as unknown as Record<string, unknown>);
    if (!importValidation.valid) {
      return NextResponse.json({ error: importValidation.errors[0] }, { status: 400 });
    }

    const results: Record<string, { imported: number; errors: number }> = {};
    const BATCH_SIZE = 500;

    // Helper: batch-insert records using createMany with skipDuplicates.
    // Falls back to sequential insert on batch failure to maximise successful imports.
    async function batchCreateMany(
      tableName: string,
      records: Record<string, unknown>[],
      mapRecord: (r: Record<string, unknown>) => any,
    ): Promise<{ imported: number; errors: number }> {
      if (records.length === 0) return { imported: 0, errors: 0 };

      let imported = 0;
      let errors = 0;
      const model = (db as any)[tableName];

      // Try createMany with skipDuplicates in batches
      for (let i = 0; i < records.length; i += BATCH_SIZE) {
        const batch = records.slice(i, i + BATCH_SIZE);
        try {
          const data = batch.map(mapRecord);
          const result = await model.createMany({ data, skipDuplicates: true });
          imported += result.count;
        } catch {
          // Batch failed — fall back to individual inserts for this batch
          for (const record of batch) {
            try {
              await model.create({ data: mapRecord(record) });
              imported++;
            } catch {
              errors++;
            }
          }
        }
      }
      return { imported, errors };
    }

    // Import ScanTasks first (they are referenced by ScanResults and ScanLogs)
    if (body.tables.ScanTask && Array.isArray(body.tables.ScanTask)) {
      const records = body.tables.ScanTask as Record<string, unknown>[];
      results.ScanTask = await batchCreateMany('scanTask', records, (r) => ({
        id: r.id as string,
        name: (r.name as string) || '未命名任务',
        status: (r.status as string) || 'pending',
        totalUrls: (r.totalUrls as number) || 0,
        completedUrls: (r.completedUrls as number) || 0,
        progress: (r.progress as number) || 0,
        concurrency: (r.concurrency as number) || 10,
        timeout: (r.timeout as number) || 10000,
        createdAt: r.createdAt ? new Date(r.createdAt as string) : new Date(),
        updatedAt: r.updatedAt ? new Date(r.updatedAt as string) : new Date(),
      }));
    }

    // Import ScanResults (referenced by UrlDetail, DarkLink, QrCodeResult)
    if (body.tables.ScanResult && Array.isArray(body.tables.ScanResult)) {
      const records = body.tables.ScanResult as Record<string, unknown>[];
      results.ScanResult = await batchCreateMany('scanResult', records, (r) => ({
        id: r.id as string,
        taskId: r.taskId as string,
        url: r.url as string,
        method: (r.method as string) || 'GET',
        statusCode: r.statusCode as number | null,
        responseTime: r.responseTime as number | null,
        title: r.title as string | null,
        extractedUrls: (r.extractedUrls as number) || 0,
        darkLinks: (r.darkLinks as number) || 0,
        qrCodes: (r.qrCodes as number) || 0,
        status: (r.status as string) || 'pending',
        errorMessage: r.errorMessage as string | null,
        rawHtml: r.rawHtml as string | null,
        createdAt: r.createdAt ? new Date(r.createdAt as string) : new Date(),
        updatedAt: r.updatedAt ? new Date(r.updatedAt as string) : new Date(),
      }));
    }

    // Import UrlDetails
    if (body.tables.UrlDetail && Array.isArray(body.tables.UrlDetail)) {
      const records = body.tables.UrlDetail as Record<string, unknown>[];
      results.UrlDetail = await batchCreateMany('urlDetail', records, (r) => ({
        id: r.id as string,
        resultId: r.resultId as string,
        url: r.url as string,
        tag: r.tag as string | null,
        attribute: r.attribute as string | null,
        text: r.text as string | null,
        isExternal: (r.isExternal as boolean) || false,
        domain: r.domain as string | null,
        isVisible: r.isVisible !== undefined ? r.isVisible as boolean : true,
        hideReason: r.hideReason as string | null,
        createdAt: r.createdAt ? new Date(r.createdAt as string) : new Date(),
      }));
    }

    // Import DarkLinks
    if (body.tables.DarkLink && Array.isArray(body.tables.DarkLink)) {
      const records = body.tables.DarkLink as Record<string, unknown>[];
      results.DarkLink = await batchCreateMany('darkLink', records, (r) => ({
        id: r.id as string,
        resultId: r.resultId as string,
        url: r.url as string,
        tag: r.tag as string | null,
        text: r.text as string | null,
        type: r.type as string,
        severity: (r.severity as string) || 'medium',
        description: r.description as string | null,
        evidence: r.evidence as string | null,
        createdAt: r.createdAt ? new Date(r.createdAt as string) : new Date(),
      }));
    }

    // Import QrCodeResults
    if (body.tables.QrCodeResult && Array.isArray(body.tables.QrCodeResult)) {
      const records = body.tables.QrCodeResult as Record<string, unknown>[];
      results.QrCodeResult = await batchCreateMany('qrCodeResult', records, (r) => ({
        id: r.id as string,
        resultId: r.resultId as string,
        sourceUrl: r.sourceUrl as string | null,
        decodedText: r.decodedText as string,
        isSuspicious: (r.isSuspicious as boolean) || false,
        reason: r.reason as string | null,
        createdAt: r.createdAt ? new Date(r.createdAt as string) : new Date(),
      }));
    }

    // Import ScanLogs
    if (body.tables.ScanLog && Array.isArray(body.tables.ScanLog)) {
      const records = body.tables.ScanLog as Record<string, unknown>[];
      results.ScanLog = await batchCreateMany('scanLog', records, (r) => ({
        id: r.id as string,
        taskId: r.taskId as string,
        level: (r.level as string) || 'info',
        message: r.message as string,
        detail: r.detail as string | null,
        createdAt: r.createdAt ? new Date(r.createdAt as string) : new Date(),
      }));
    }

    // Import MaliciousDomains
    if (body.tables.MaliciousDomain && Array.isArray(body.tables.MaliciousDomain)) {
      const records = body.tables.MaliciousDomain as Record<string, unknown>[];
      results.MaliciousDomain = await batchCreateMany('maliciousDomain', records, (r) => ({
        id: r.id as string,
        domain: r.domain as string,
        reason: r.reason as string | null,
        source: (r.source as string) || 'manual',
        severity: (r.severity as string) || 'high',
        category: r.category as string | null,
        createdAt: r.createdAt ? new Date(r.createdAt as string) : new Date(),
        updatedAt: r.updatedAt ? new Date(r.updatedAt as string) : new Date(),
      }));
    }

    // Import MaliciousIPs
    if (body.tables.MaliciousIP && Array.isArray(body.tables.MaliciousIP)) {
      const records = body.tables.MaliciousIP as Record<string, unknown>[];
      results.MaliciousIP = await batchCreateMany('maliciousIP', records, (r) => ({
        id: r.id as string,
        ip: r.ip as string,
        reason: r.reason as string | null,
        source: (r.source as string) || 'manual',
        severity: (r.severity as string) || 'high',
        category: r.category as string | null,
        country: r.country as string | null,
        createdAt: r.createdAt ? new Date(r.createdAt as string) : new Date(),
        updatedAt: r.updatedAt ? new Date(r.updatedAt as string) : new Date(),
      }));
    }

    // Import UpdateSchedules
    if (body.tables.UpdateSchedule && Array.isArray(body.tables.UpdateSchedule)) {
      const records = body.tables.UpdateSchedule as Record<string, unknown>[];
      results.UpdateSchedule = await batchCreateMany('updateSchedule', records, (r) => ({
        id: r.id as string,
        enabled: (r.enabled as boolean) || false,
        frequency: (r.frequency as string) || 'daily',
        lastRunAt: r.lastRunAt ? new Date(r.lastRunAt as string) : null,
        nextRunAt: r.nextRunAt ? new Date(r.nextRunAt as string) : null,
        status: (r.status as string) || 'idle',
        createdAt: r.createdAt ? new Date(r.createdAt as string) : new Date(),
        updatedAt: r.updatedAt ? new Date(r.updatedAt as string) : new Date(),
      }));
    }

    // Import ThreatIntelEntries — sanitize fields to prevent arbitrary field injection
    if (body.tables.ThreatIntelEntry && Array.isArray(body.tables.ThreatIntelEntry)) {
      const records = (body.tables.ThreatIntelEntry as Record<string, unknown>[]).map(sanitizeThreatIntelRecord);
      results.ThreatIntelEntry = await batchCreateMany('threatIntelEntry', records, (r) => r);
    }

    // Calculate totals
    let totalImported = 0;
    let totalErrors = 0;
    for (const result of Object.values(results)) {
      totalImported += result.imported;
      totalErrors += result.errors;
    }

    auditLog.data('db_imported', actor, { totalImported, totalErrors, tables: Object.keys(results) }, ip, 'database', 'main');

    return NextResponse.json({
      success: true,
      results,
      totalImported,
      totalErrors,
      message: `导入完成：成功 ${totalImported} 条，失败 ${totalErrors} 条`,
    });
  } catch (error) {
    console.error('Database import error:', error);
    return NextResponse.json({ error: '数据导入失败，请检查数据格式' }, { status: 500 });
  }
}
