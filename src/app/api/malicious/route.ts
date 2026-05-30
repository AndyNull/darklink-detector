import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { isValidIP } from '@/lib/security';
import { requireSessionAuth } from '@/lib/api-auth';
import { getSessionFromRequest } from '@/lib/server-config';
import { isSafeDomain, isSafeIP } from '@/lib/safe-domain-whitelist';
import { auditLog } from '@/lib/audit-logger';

// GET /api/malicious?type=domain|ip&search=xxx&page=1&pageSize=50
// GET /api/malicious?action=export&type=domain|ip&format=json|csv
// NOTE: Viewing (paginated list) is publicly accessible; Export requires login
export async function GET(request: NextRequest) {

  try {
    const { searchParams } = new URL(request.url);
    const action = searchParams.get('action');
    const type = searchParams.get('type') || 'domain';

    // --- Export action (requires session auth) ---
    if (action === 'export') {
      const sessionError = requireSessionAuth(request);
      if (sessionError) return sessionError;

      const format = searchParams.get('format') || 'json';

      // Audit log for export
      const exportIp = request.headers.get('x-real-ip') || request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown';
      const exportActor = getSessionFromRequest(request) || 'system';
      auditLog.data('malicious_exported', exportActor, `Exported malicious ${type} library (${format} format)`, exportIp).catch(() => {});
      const EXPORT_LIMIT = 50_000; // Prevent OOM on very large databases

      if (type === 'ip') {
        const items = await db.maliciousIP.findMany({
          orderBy: { createdAt: 'desc' },
          take: EXPORT_LIMIT,
        });

        if (format === 'csv') {
          const headers = 'ip,reason,source,severity,category,country,createdAt,updatedAt';
          const rows = items.map(item =>
            [
              csvEscape(item.ip),
              csvEscape(item.reason),
              csvEscape(item.source),
              csvEscape(item.severity),
              csvEscape(item.category),
              csvEscape(item.country),
              csvEscape(item.createdAt?.toISOString() || ''),
              csvEscape(item.updatedAt?.toISOString() || ''),
            ].join(',')
          );
          const csv = [headers, ...rows].join('\n');
          return new NextResponse(csv, {
            headers: {
              'Content-Type': 'text/csv; charset=utf-8',
              'Content-Disposition': `attachment; filename="malicious_ips_${new Date().toISOString().slice(0, 10)}.csv"`,
            },
          });
        }

        // JSON format
        return NextResponse.json(items);
      } else {
        const items = await db.maliciousDomain.findMany({
          orderBy: { createdAt: 'desc' },
          take: EXPORT_LIMIT,
        });

        if (format === 'csv') {
          const headers = 'domain,reason,source,severity,category,createdAt,updatedAt';
          const rows = items.map(item =>
            [
              csvEscape(item.domain),
              csvEscape(item.reason),
              csvEscape(item.source),
              csvEscape(item.severity),
              csvEscape(item.category),
              csvEscape(item.createdAt?.toISOString() || ''),
              csvEscape(item.updatedAt?.toISOString() || ''),
            ].join(',')
          );
          const csv = [headers, ...rows].join('\n');
          return new NextResponse(csv, {
            headers: {
              'Content-Type': 'text/csv; charset=utf-8',
              'Content-Disposition': `attachment; filename="malicious_domains_${new Date().toISOString().slice(0, 10)}.csv"`,
            },
          });
        }

        // JSON format
        return NextResponse.json(items);
      }
    }

    // --- Default: paginated list ---
    const search = searchParams.get('search') || '';
    const page = Math.max(1, parseInt(searchParams.get('page') || '1'));
    const pageSize = Math.min(200, Math.max(1, parseInt(searchParams.get('pageSize') || '50')));

    if (type === 'ip') {
      const where = search
        ? { OR: [{ ip: { contains: search } }, { reason: { contains: search } }, { category: { contains: search } }] }
        : {};

      const [items, total] = await Promise.all([
        db.maliciousIP.findMany({
          where,
          orderBy: { createdAt: 'desc' },
          skip: (page - 1) * pageSize,
          take: pageSize,
        }),
        db.maliciousIP.count({ where }),
      ]);

      return NextResponse.json({ items, total, page, pageSize });
    } else {
      const where = search
        ? { OR: [{ domain: { contains: search } }, { reason: { contains: search } }, { category: { contains: search } }] }
        : {};

      const [items, total] = await Promise.all([
        db.maliciousDomain.findMany({
          where,
          orderBy: { createdAt: 'desc' },
          skip: (page - 1) * pageSize,
          take: pageSize,
        }),
        db.maliciousDomain.count({ where }),
      ]);

      return NextResponse.json({ items, total, page, pageSize });
    }
  } catch (error) {
    console.error('Failed to fetch malicious entries:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

// Helper: escape a value for CSV output
function csvEscape(value: string | null | undefined): string {
  if (value === null || value === undefined) return '';
  const str = String(value);
  if (str.includes(',') || str.includes('"') || str.includes('\n')) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

// POST /api/malicious — Add a malicious domain or IP (single or batch)
export async function POST(request: NextRequest) {
  const sessionError = requireSessionAuth(request);
  if (sessionError) return sessionError;

  try {
    const body = await request.json();

    // --- Batch import ---
    if (body.action === 'batch') {
      const { type, values, reason, source, severity, category } = body;

      if (!type || !Array.isArray(values) || values.length === 0) {
        return NextResponse.json({ error: 'Missing required fields: type, values' }, { status: 400 });
      }

      if (type !== 'domain' && type !== 'ip') {
        return NextResponse.json({ error: 'Type must be "domain" or "ip"' }, { status: 400 });
      }

      // Limit batch size to 5000 (increased for programmatic imports from seed script)
      const batchValues = values.slice(0, 5000).map((v: string) => v.trim()).filter((v: string) => v.length > 0);

      // Filter out safe domains/IPs — never add well-known safe domains to malicious library
      let safeFilteredCount = 0;
      const filteredValues = batchValues.filter((v: string) => {
        if (type === 'domain' && isSafeDomain(v)) {
          safeFilteredCount++;
          return false;
        }
        if (type === 'ip' && isSafeIP(v)) {
          safeFilteredCount++;
          return false;
        }
        return true;
      });
      if (safeFilteredCount > 0) {
        console.log(`[Malicious Batch Import] Filtered out ${safeFilteredCount} safe ${type}(s) from batch import`);
      }

      const validSeverities = ['low', 'medium', 'high', 'critical'];
      const finalSeverity = validSeverities.includes(severity) ? severity : 'high';
      const finalSource = source || 'manual';
      const finalReason = reason || null;
      const finalCategory = category || null;

      let added = 0;
      let skipped = 0;

      if (type === 'ip') {
        // Bulk check existing IPs
        const existingIPs = await db.maliciousIP.findMany({
          where: { ip: { in: filteredValues } },
          select: { ip: true },
        });
        const existingSet = new Set(existingIPs.map(e => e.ip));
        const newValues = filteredValues.filter(v => !existingSet.has(v) && isValidIP(v));
        const invalidCount = filteredValues.filter(v => !existingSet.has(v) && !isValidIP(v)).length;

        if (newValues.length > 0) {
          await db.maliciousIP.createMany({
            data: newValues.map(v => ({
              ip: v,
              reason: finalReason,
              source: finalSource,
              severity: finalSeverity,
              category: finalCategory,
              country: null,
            })),
          });
        }
        added = newValues.length;
        skipped = existingIPs.length + invalidCount + safeFilteredCount;
      } else {
        // Bulk check existing domains
        const existingDomains = await db.maliciousDomain.findMany({
          where: { domain: { in: filteredValues } },
          select: { domain: true },
        });
        const existingSet = new Set(existingDomains.map(e => e.domain));
        const newValues = filteredValues.filter(v => !existingSet.has(v));

        if (newValues.length > 0) {
          await db.maliciousDomain.createMany({
            data: newValues.map(v => ({
              domain: v,
              reason: finalReason,
              source: finalSource,
              severity: finalSeverity,
              category: finalCategory,
            })),
          });
        }
        added = newValues.length;
        skipped = existingDomains.length + safeFilteredCount;
      }

      // Audit log for batch import
      const batchIp = request.headers.get('x-real-ip') || request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown';
      const batchActor = getSessionFromRequest(request) || 'system';
      auditLog.data('malicious_batch_imported', batchActor, `Batch imported ${added} ${type} entries (${skipped} skipped, ${batchValues.length} total)`, batchIp).catch(() => {});

      return NextResponse.json({ added, skipped, total: batchValues.length }, { status: 201 });
    }

    // --- Single add ---
    const { type, value, reason, source, severity, category, country } = body;

    if (!value || !type) {
      return NextResponse.json({ error: 'Missing required fields: type, value' }, { status: 400 });
    }

    // Get IP for logging
    const addIp = request.headers.get('x-real-ip') || request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown';

    // Validate type
    if (type !== 'domain' && type !== 'ip') {
      return NextResponse.json({ error: 'Type must be "domain" or "ip"' }, { status: 400 });
    }

    // Validate severity
    const validSeverities = ['low', 'medium', 'high', 'critical'];
    if (severity && !validSeverities.includes(severity)) {
      return NextResponse.json({ error: 'Invalid severity' }, { status: 400 });
    }

    // Validate IP format if type is ip
    if (type === 'ip' && !isValidIP(value)) {
      return NextResponse.json({ error: 'Invalid IP address format' }, { status: 400 });
    }

    // Block safe domains/IPs from being added to the malicious library
    if (type === 'domain' && isSafeDomain(value)) {
      return NextResponse.json(
        { error: `域名 "${value}" 是已知的可信域名，不能添加到恶意库。如确认该域名被恶意使用，请使用子域名或完整URL。` },
        { status: 400 }
      );
    }
    if (type === 'ip' && isSafeIP(value)) {
      return NextResponse.json(
        { error: `IP "${value}" 属于保留/私有地址段，不能添加到恶意库。` },
        { status: 400 }
      );
    }

    if (type === 'ip') {
      // Check for duplicates
      const existing = await db.maliciousIP.findUnique({ where: { ip: value } });
      if (existing) {
        return NextResponse.json({ error: 'IP already exists in malicious database', item: existing }, { status: 409 });
      }

      const item = await db.maliciousIP.create({
        data: {
          ip: value,
          reason: reason || null,
          source: source || 'manual',
          severity: severity || 'high',
          category: category || null,
          country: country || null,
        },
      });

      const addActor = getSessionFromRequest(request) || 'system';
      auditLog.data('malicious_ip_added', addActor, `Added IP to malicious library: ${value} (source: ${source || 'manual'})`, addIp).catch(() => {});

      return NextResponse.json({ item }, { status: 201 });
    } else {
      // Check for duplicates
      const existing = await db.maliciousDomain.findUnique({ where: { domain: value } });
      if (existing) {
        return NextResponse.json({ error: 'Domain already exists in malicious database', item: existing }, { status: 409 });
      }

      const item = await db.maliciousDomain.create({
        data: {
          domain: value,
          reason: reason || null,
          source: source || 'manual',
          severity: severity || 'high',
          category: category || null,
        },
      });

      const addActor2 = getSessionFromRequest(request) || 'system';
      auditLog.data('malicious_domain_added', addActor2, `Added domain to malicious library: ${value} (source: ${source || 'manual'})`, addIp).catch(() => {});

      return NextResponse.json({ item }, { status: 201 });
    }
  } catch (error) {
    console.error('Failed to add malicious entry:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

// DELETE /api/malicious?type=domain|ip&id=xxx
// DELETE /api/malicious?action=batch (body: { type, ids })
export async function DELETE(request: NextRequest) {
  const sessionError = requireSessionAuth(request);
  if (sessionError) return sessionError;

  try {
    const { searchParams } = new URL(request.url);
    const action = searchParams.get('action');

    // Batch delete
    if (action === 'batch') {
      const body = await request.json();
      const { type, ids } = body;
      if (!type || !Array.isArray(ids)) {
        return NextResponse.json({ error: 'Missing type and ids' }, { status: 400 });
      }
      let deleted = 0;
      if (type === 'ip') {
        const result = await db.maliciousIP.deleteMany({ where: { id: { in: ids } } });
        deleted = result.count;
      } else {
        const result = await db.maliciousDomain.deleteMany({ where: { id: { in: ids } } });
        deleted = result.count;
      }
      // Log batch deletion
      const deleteActor = getSessionFromRequest(request) || 'system';
      const deleteIp = request.headers.get('x-real-ip') || request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown';
      auditLog.data('malicious_batch_deleted', deleteActor, `Batch deleted ${deleted} ${type} entries (${ids.length} requested)`, deleteIp).catch(() => {});

      return NextResponse.json({ deleted });
    }

    // Single delete
    const type = searchParams.get('type');
    const id = searchParams.get('id');

    if (!type || !id) {
      return NextResponse.json({ error: 'Missing required parameters: type, id' }, { status: 400 });
    }

    if (type === 'ip') {
      const item = await db.maliciousIP.delete({ where: { id } });
      // Log single deletion
      const deleteIp = request.headers.get('x-real-ip') || request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown';
      auditLog.data('malicious_ip_deleted', getSessionFromRequest(request) || 'system', `Deleted IP entry: ${item.ip}`, deleteIp).catch(() => {});
      return NextResponse.json({ item });
    } else {
      const item = await db.maliciousDomain.delete({ where: { id } });
      // Log single deletion
      const deleteIp2 = request.headers.get('x-real-ip') || request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown';
      auditLog.data('malicious_domain_deleted', getSessionFromRequest(request) || 'system', `Deleted domain entry: ${item.domain}`, deleteIp2).catch(() => {});
      return NextResponse.json({ item });
    }
  } catch (error: any) {
    if (error?.code === 'P2025') {
      return NextResponse.json({ error: 'Item not found' }, { status: 404 });
    }
    console.error('Failed to delete malicious entry:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

// Batch check: POST /api/malicious with action=check
// Body: { action: 'check', type: 'domain'|'ip', values: string[] }
// Returns: { matches: { value: { matched: boolean, item?: object } } }
export async function PUT(request: NextRequest) {
  // action=check is a read-only lookup — publicly accessible

  try {
    const body = await request.json();
    const { action, type, values } = body;

    if (action !== 'check' || !type || !Array.isArray(values)) {
      return NextResponse.json({ error: 'Invalid request. Requires action=check, type, and values array' }, { status: 400 });
    }

    const matches: Record<string, { matched: boolean; item?: any }> = {};

    if (type === 'ip') {
      const items = await db.maliciousIP.findMany({
        where: { ip: { in: values } },
      });
      for (const v of values) {
        const found = items.find(i => i.ip === v);
        matches[v] = found ? { matched: true, item: found } : { matched: false };
      }
    } else {
      const items = await db.maliciousDomain.findMany({
        where: { domain: { in: values } },
      });
      for (const v of values) {
        const found = items.find(i => i.domain === v);
        matches[v] = found ? { matched: true, item: found } : { matched: false };
      }
    }

    return NextResponse.json({ matches });
  } catch (error) {
    console.error('Failed to check malicious entries:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
