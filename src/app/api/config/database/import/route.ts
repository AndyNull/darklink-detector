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

    // Import ScanTasks first (they are referenced by ScanResults and ScanLogs)
    if (body.tables.ScanTask && Array.isArray(body.tables.ScanTask)) {
      let imported = 0;
      let errors = 0;
      for (const item of body.tables.ScanTask) {
        try {
          const record = item as Record<string, unknown>;
          await db.scanTask.upsert({
            where: { id: record.id as string },
            update: {},
            create: {
              id: record.id as string,
              name: (record.name as string) || '未命名任务',
              status: (record.status as string) || 'pending',
              totalUrls: (record.totalUrls as number) || 0,
              completedUrls: (record.completedUrls as number) || 0,
              progress: (record.progress as number) || 0,
              concurrency: (record.concurrency as number) || 10,
              timeout: (record.timeout as number) || 10000,
              createdAt: record.createdAt ? new Date(record.createdAt as string) : new Date(),
              updatedAt: record.updatedAt ? new Date(record.updatedAt as string) : new Date(),
            },
          });
          imported++;
        } catch {
          errors++;
        }
      }
      results.ScanTask = { imported, errors };
    }

    // Import ScanResults (referenced by UrlDetail, DarkLink, QrCodeResult)
    if (body.tables.ScanResult && Array.isArray(body.tables.ScanResult)) {
      let imported = 0;
      let errors = 0;
      for (const item of body.tables.ScanResult) {
        try {
          const record = item as Record<string, unknown>;
          await db.scanResult.upsert({
            where: { id: record.id as string },
            update: {},
            create: {
              id: record.id as string,
              taskId: record.taskId as string,
              url: record.url as string,
              method: (record.method as string) || 'GET',
              statusCode: record.statusCode as number | null,
              responseTime: record.responseTime as number | null,
              title: record.title as string | null,
              extractedUrls: (record.extractedUrls as number) || 0,
              darkLinks: (record.darkLinks as number) || 0,
              qrCodes: (record.qrCodes as number) || 0,
              status: (record.status as string) || 'pending',
              errorMessage: record.errorMessage as string | null,
              rawHtml: record.rawHtml as string | null,
              createdAt: record.createdAt ? new Date(record.createdAt as string) : new Date(),
              updatedAt: record.updatedAt ? new Date(record.updatedAt as string) : new Date(),
            },
          });
          imported++;
        } catch {
          errors++;
        }
      }
      results.ScanResult = { imported, errors };
    }

    // Import UrlDetails
    if (body.tables.UrlDetail && Array.isArray(body.tables.UrlDetail)) {
      let imported = 0;
      let errors = 0;
      for (const item of body.tables.UrlDetail) {
        try {
          const record = item as Record<string, unknown>;
          await db.urlDetail.upsert({
            where: { id: record.id as string },
            update: {},
            create: {
              id: record.id as string,
              resultId: record.resultId as string,
              url: record.url as string,
              tag: record.tag as string | null,
              attribute: record.attribute as string | null,
              text: record.text as string | null,
              isExternal: (record.isExternal as boolean) || false,
              domain: record.domain as string | null,
              isVisible: record.isVisible !== undefined ? record.isVisible as boolean : true,
              hideReason: record.hideReason as string | null,
              createdAt: record.createdAt ? new Date(record.createdAt as string) : new Date(),
            },
          });
          imported++;
        } catch {
          errors++;
        }
      }
      results.UrlDetail = { imported, errors };
    }

    // Import DarkLinks
    if (body.tables.DarkLink && Array.isArray(body.tables.DarkLink)) {
      let imported = 0;
      let errors = 0;
      for (const item of body.tables.DarkLink) {
        try {
          const record = item as Record<string, unknown>;
          await db.darkLink.upsert({
            where: { id: record.id as string },
            update: {},
            create: {
              id: record.id as string,
              resultId: record.resultId as string,
              url: record.url as string,
              tag: record.tag as string | null,
              text: record.text as string | null,
              type: record.type as string,
              severity: (record.severity as string) || 'medium',
              description: record.description as string | null,
              evidence: record.evidence as string | null,
              createdAt: record.createdAt ? new Date(record.createdAt as string) : new Date(),
            },
          });
          imported++;
        } catch {
          errors++;
        }
      }
      results.DarkLink = { imported, errors };
    }

    // Import QrCodeResults
    if (body.tables.QrCodeResult && Array.isArray(body.tables.QrCodeResult)) {
      let imported = 0;
      let errors = 0;
      for (const item of body.tables.QrCodeResult) {
        try {
          const record = item as Record<string, unknown>;
          await db.qrCodeResult.upsert({
            where: { id: record.id as string },
            update: {},
            create: {
              id: record.id as string,
              resultId: record.resultId as string,
              sourceUrl: record.sourceUrl as string | null,
              decodedText: record.decodedText as string,
              isSuspicious: (record.isSuspicious as boolean) || false,
              reason: record.reason as string | null,
              createdAt: record.createdAt ? new Date(record.createdAt as string) : new Date(),
            },
          });
          imported++;
        } catch {
          errors++;
        }
      }
      results.QrCodeResult = { imported, errors };
    }

    // Import ScanLogs
    if (body.tables.ScanLog && Array.isArray(body.tables.ScanLog)) {
      let imported = 0;
      let errors = 0;
      for (const item of body.tables.ScanLog) {
        try {
          const record = item as Record<string, unknown>;
          await db.scanLog.upsert({
            where: { id: record.id as string },
            update: {},
            create: {
              id: record.id as string,
              taskId: record.taskId as string,
              level: (record.level as string) || 'info',
              message: record.message as string,
              detail: record.detail as string | null,
              createdAt: record.createdAt ? new Date(record.createdAt as string) : new Date(),
            },
          });
          imported++;
        } catch {
          errors++;
        }
      }
      results.ScanLog = { imported, errors };
    }

    // Import MaliciousDomains
    if (body.tables.MaliciousDomain && Array.isArray(body.tables.MaliciousDomain)) {
      let imported = 0;
      let errors = 0;
      for (const item of body.tables.MaliciousDomain) {
        try {
          const record = item as Record<string, unknown>;
          await db.maliciousDomain.upsert({
            where: { id: record.id as string },
            update: {},
            create: {
              id: record.id as string,
              domain: record.domain as string,
              reason: record.reason as string | null,
              source: (record.source as string) || 'manual',
              severity: (record.severity as string) || 'high',
              category: record.category as string | null,
              createdAt: record.createdAt ? new Date(record.createdAt as string) : new Date(),
              updatedAt: record.updatedAt ? new Date(record.updatedAt as string) : new Date(),
            },
          });
          imported++;
        } catch {
          errors++;
        }
      }
      results.MaliciousDomain = { imported, errors };
    }

    // Import MaliciousIPs
    if (body.tables.MaliciousIP && Array.isArray(body.tables.MaliciousIP)) {
      let imported = 0;
      let errors = 0;
      for (const item of body.tables.MaliciousIP) {
        try {
          const record = item as Record<string, unknown>;
          await db.maliciousIP.upsert({
            where: { id: record.id as string },
            update: {},
            create: {
              id: record.id as string,
              ip: record.ip as string,
              reason: record.reason as string | null,
              source: (record.source as string) || 'manual',
              severity: (record.severity as string) || 'high',
              category: record.category as string | null,
              country: record.country as string | null,
              createdAt: record.createdAt ? new Date(record.createdAt as string) : new Date(),
              updatedAt: record.updatedAt ? new Date(record.updatedAt as string) : new Date(),
            },
          });
          imported++;
        } catch {
          errors++;
        }
      }
      results.MaliciousIP = { imported, errors };
    }

    // Import UpdateSchedules
    if (body.tables.UpdateSchedule && Array.isArray(body.tables.UpdateSchedule)) {
      let imported = 0;
      let errors = 0;
      for (const item of body.tables.UpdateSchedule) {
        try {
          const record = item as Record<string, unknown>;
          await db.updateSchedule.upsert({
            where: { id: record.id as string },
            update: {},
            create: {
              id: record.id as string,
              enabled: (record.enabled as boolean) || false,
              frequency: (record.frequency as string) || 'daily',
              lastRunAt: record.lastRunAt ? new Date(record.lastRunAt as string) : null,
              nextRunAt: record.nextRunAt ? new Date(record.nextRunAt as string) : null,
              status: (record.status as string) || 'idle',
              createdAt: record.createdAt ? new Date(record.createdAt as string) : new Date(),
              updatedAt: record.updatedAt ? new Date(record.updatedAt as string) : new Date(),
            },
          });
          imported++;
        } catch {
          errors++;
        }
      }
      results.UpdateSchedule = { imported, errors };
    }

    // Import ThreatIntelEntries if they exist - sanitize fields to prevent arbitrary field injection
    if (body.tables.ThreatIntelEntry && Array.isArray(body.tables.ThreatIntelEntry)) {
      let imported = 0;
      let errors = 0;
      for (const item of body.tables.ThreatIntelEntry) {
        try {
          const record = item as Record<string, unknown>;
          const sanitized = sanitizeThreatIntelRecord(record);
          await (db as any).threatIntelEntry.upsert({
            where: { id: sanitized.id as string },
            update: {},
            create: sanitized,
          });
          imported++;
        } catch {
          errors++;
        }
      }
      results.ThreatIntelEntry = { imported, errors };
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
