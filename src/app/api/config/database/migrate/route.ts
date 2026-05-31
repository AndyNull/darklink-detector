import { NextRequest, NextResponse } from 'next/server';
import { requireSessionAuth } from '@/lib/api-auth';
import { db } from '@/lib/db';
import { readFile } from 'fs/promises';
import { join } from 'path';
import { auditLog } from '@/lib/audit-logger';
import { getSessionFromRequest } from '@/lib/server-config';

// ─── Type mappings for Prisma → SQL ────────────────────────────────────────

interface ColumnDef {
  name: string;
  prismaType: string;
  isId: boolean;
  isUnique: boolean;
  hasDefault: boolean;
  isOptional: boolean;
}

interface TableDef {
  name: string;
  columns: ColumnDef[];
}

// Prisma schema definitions - maps model names to their column definitions
const TABLE_DEFINITIONS: TableDef[] = [
  {
    name: 'ScanTask',
    columns: [
      { name: 'id', prismaType: 'String', isId: true, isUnique: false, hasDefault: true, isOptional: false },
      { name: 'name', prismaType: 'String', isId: false, isUnique: false, hasDefault: true, isOptional: false },
      { name: 'status', prismaType: 'String', isId: false, isUnique: false, hasDefault: true, isOptional: false },
      { name: 'totalUrls', prismaType: 'Int', isId: false, isUnique: false, hasDefault: true, isOptional: false },
      { name: 'completedUrls', prismaType: 'Int', isId: false, isUnique: false, hasDefault: true, isOptional: false },
      { name: 'progress', prismaType: 'Float', isId: false, isUnique: false, hasDefault: true, isOptional: false },
      { name: 'concurrency', prismaType: 'Int', isId: false, isUnique: false, hasDefault: true, isOptional: false },
      { name: 'timeout', prismaType: 'Int', isId: false, isUnique: false, hasDefault: true, isOptional: false },
      { name: 'createdAt', prismaType: 'DateTime', isId: false, isUnique: false, hasDefault: true, isOptional: false },
      { name: 'updatedAt', prismaType: 'DateTime', isId: false, isUnique: false, hasDefault: true, isOptional: false },
    ],
  },
  {
    name: 'ScanResult',
    columns: [
      { name: 'id', prismaType: 'String', isId: true, isUnique: false, hasDefault: true, isOptional: false },
      { name: 'taskId', prismaType: 'String', isId: false, isUnique: false, hasDefault: false, isOptional: false },
      { name: 'url', prismaType: 'String', isId: false, isUnique: false, hasDefault: false, isOptional: false },
      { name: 'method', prismaType: 'String', isId: false, isUnique: false, hasDefault: true, isOptional: false },
      { name: 'statusCode', prismaType: 'Int', isId: false, isUnique: false, hasDefault: false, isOptional: true },
      { name: 'responseTime', prismaType: 'Int', isId: false, isUnique: false, hasDefault: false, isOptional: true },
      { name: 'title', prismaType: 'String', isId: false, isUnique: false, hasDefault: false, isOptional: true },
      { name: 'extractedUrls', prismaType: 'Int', isId: false, isUnique: false, hasDefault: true, isOptional: false },
      { name: 'darkLinks', prismaType: 'Int', isId: false, isUnique: false, hasDefault: true, isOptional: false },
      { name: 'qrCodes', prismaType: 'Int', isId: false, isUnique: false, hasDefault: true, isOptional: false },
      { name: 'status', prismaType: 'String', isId: false, isUnique: false, hasDefault: true, isOptional: false },
      { name: 'errorMessage', prismaType: 'String', isId: false, isUnique: false, hasDefault: false, isOptional: true },
      { name: 'rawHtml', prismaType: 'String', isId: false, isUnique: false, hasDefault: false, isOptional: true },
      { name: 'createdAt', prismaType: 'DateTime', isId: false, isUnique: false, hasDefault: true, isOptional: false },
      { name: 'updatedAt', prismaType: 'DateTime', isId: false, isUnique: false, hasDefault: true, isOptional: false },
    ],
  },
  {
    name: 'UrlDetail',
    columns: [
      { name: 'id', prismaType: 'String', isId: true, isUnique: false, hasDefault: true, isOptional: false },
      { name: 'resultId', prismaType: 'String', isId: false, isUnique: false, hasDefault: false, isOptional: false },
      { name: 'url', prismaType: 'String', isId: false, isUnique: false, hasDefault: false, isOptional: false },
      { name: 'tag', prismaType: 'String', isId: false, isUnique: false, hasDefault: false, isOptional: true },
      { name: 'attribute', prismaType: 'String', isId: false, isUnique: false, hasDefault: false, isOptional: true },
      { name: 'text', prismaType: 'String', isId: false, isUnique: false, hasDefault: false, isOptional: true },
      { name: 'isExternal', prismaType: 'Boolean', isId: false, isUnique: false, hasDefault: true, isOptional: false },
      { name: 'domain', prismaType: 'String', isId: false, isUnique: false, hasDefault: false, isOptional: true },
      { name: 'isVisible', prismaType: 'Boolean', isId: false, isUnique: false, hasDefault: true, isOptional: false },
      { name: 'hideReason', prismaType: 'String', isId: false, isUnique: false, hasDefault: false, isOptional: true },
      { name: 'createdAt', prismaType: 'DateTime', isId: false, isUnique: false, hasDefault: true, isOptional: false },
    ],
  },
  {
    name: 'DarkLink',
    columns: [
      { name: 'id', prismaType: 'String', isId: true, isUnique: false, hasDefault: true, isOptional: false },
      { name: 'resultId', prismaType: 'String', isId: false, isUnique: false, hasDefault: false, isOptional: false },
      { name: 'url', prismaType: 'String', isId: false, isUnique: false, hasDefault: false, isOptional: false },
      { name: 'tag', prismaType: 'String', isId: false, isUnique: false, hasDefault: false, isOptional: true },
      { name: 'text', prismaType: 'String', isId: false, isUnique: false, hasDefault: false, isOptional: true },
      { name: 'type', prismaType: 'String', isId: false, isUnique: false, hasDefault: false, isOptional: false },
      { name: 'severity', prismaType: 'String', isId: false, isUnique: false, hasDefault: true, isOptional: false },
      { name: 'description', prismaType: 'String', isId: false, isUnique: false, hasDefault: false, isOptional: true },
      { name: 'evidence', prismaType: 'String', isId: false, isUnique: false, hasDefault: false, isOptional: true },
      { name: 'createdAt', prismaType: 'DateTime', isId: false, isUnique: false, hasDefault: true, isOptional: false },
    ],
  },
  {
    name: 'QrCodeResult',
    columns: [
      { name: 'id', prismaType: 'String', isId: true, isUnique: false, hasDefault: true, isOptional: false },
      { name: 'resultId', prismaType: 'String', isId: false, isUnique: false, hasDefault: false, isOptional: false },
      { name: 'sourceUrl', prismaType: 'String', isId: false, isUnique: false, hasDefault: false, isOptional: true },
      { name: 'decodedText', prismaType: 'String', isId: false, isUnique: false, hasDefault: false, isOptional: false },
      { name: 'isSuspicious', prismaType: 'Boolean', isId: false, isUnique: false, hasDefault: true, isOptional: false },
      { name: 'reason', prismaType: 'String', isId: false, isUnique: false, hasDefault: false, isOptional: true },
      { name: 'qrImageBase64', prismaType: 'String', isId: false, isUnique: false, hasDefault: false, isOptional: true },
      { name: 'createdAt', prismaType: 'DateTime', isId: false, isUnique: false, hasDefault: true, isOptional: false },
    ],
  },
  {
    name: 'ScanLog',
    columns: [
      { name: 'id', prismaType: 'String', isId: true, isUnique: false, hasDefault: true, isOptional: false },
      { name: 'taskId', prismaType: 'String', isId: false, isUnique: false, hasDefault: false, isOptional: false },
      { name: 'level', prismaType: 'String', isId: false, isUnique: false, hasDefault: true, isOptional: false },
      { name: 'message', prismaType: 'String', isId: false, isUnique: false, hasDefault: false, isOptional: false },
      { name: 'detail', prismaType: 'String', isId: false, isUnique: false, hasDefault: false, isOptional: true },
      { name: 'createdAt', prismaType: 'DateTime', isId: false, isUnique: false, hasDefault: true, isOptional: false },
    ],
  },
  {
    name: 'MaliciousDomain',
    columns: [
      { name: 'id', prismaType: 'String', isId: true, isUnique: false, hasDefault: true, isOptional: false },
      { name: 'domain', prismaType: 'String', isId: false, isUnique: true, hasDefault: false, isOptional: false },
      { name: 'reason', prismaType: 'String', isId: false, isUnique: false, hasDefault: false, isOptional: true },
      { name: 'source', prismaType: 'String', isId: false, isUnique: false, hasDefault: true, isOptional: false },
      { name: 'severity', prismaType: 'String', isId: false, isUnique: false, hasDefault: true, isOptional: false },
      { name: 'category', prismaType: 'String', isId: false, isUnique: false, hasDefault: false, isOptional: true },
      { name: 'createdAt', prismaType: 'DateTime', isId: false, isUnique: false, hasDefault: true, isOptional: false },
      { name: 'updatedAt', prismaType: 'DateTime', isId: false, isUnique: false, hasDefault: true, isOptional: false },
    ],
  },
  {
    name: 'MaliciousIP',
    columns: [
      { name: 'id', prismaType: 'String', isId: true, isUnique: false, hasDefault: true, isOptional: false },
      { name: 'ip', prismaType: 'String', isId: false, isUnique: true, hasDefault: false, isOptional: false },
      { name: 'reason', prismaType: 'String', isId: false, isUnique: false, hasDefault: false, isOptional: true },
      { name: 'source', prismaType: 'String', isId: false, isUnique: false, hasDefault: true, isOptional: false },
      { name: 'severity', prismaType: 'String', isId: false, isUnique: false, hasDefault: true, isOptional: false },
      { name: 'category', prismaType: 'String', isId: false, isUnique: false, hasDefault: false, isOptional: true },
      { name: 'country', prismaType: 'String', isId: false, isUnique: false, hasDefault: false, isOptional: true },
      { name: 'createdAt', prismaType: 'DateTime', isId: false, isUnique: false, hasDefault: true, isOptional: false },
      { name: 'updatedAt', prismaType: 'DateTime', isId: false, isUnique: false, hasDefault: true, isOptional: false },
    ],
  },
  {
    name: 'UpdateSchedule',
    columns: [
      { name: 'id', prismaType: 'String', isId: true, isUnique: false, hasDefault: true, isOptional: false },
      { name: 'enabled', prismaType: 'Boolean', isId: false, isUnique: false, hasDefault: true, isOptional: false },
      { name: 'frequency', prismaType: 'String', isId: false, isUnique: false, hasDefault: true, isOptional: false },
      { name: 'lastRunAt', prismaType: 'DateTime', isId: false, isUnique: false, hasDefault: false, isOptional: true },
      { name: 'nextRunAt', prismaType: 'DateTime', isId: false, isUnique: false, hasDefault: false, isOptional: true },
      { name: 'status', prismaType: 'String', isId: false, isUnique: false, hasDefault: true, isOptional: false },
      { name: 'createdAt', prismaType: 'DateTime', isId: false, isUnique: false, hasDefault: true, isOptional: false },
      { name: 'updatedAt', prismaType: 'DateTime', isId: false, isUnique: false, hasDefault: true, isOptional: false },
    ],
  },
  {
    name: 'ThreatIntelSource',
    columns: [
      { name: 'id', prismaType: 'String', isId: true, isUnique: false, hasDefault: true, isOptional: false },
      { name: 'sourceId', prismaType: 'String', isId: false, isUnique: true, hasDefault: false, isOptional: false },
      { name: 'name', prismaType: 'String', isId: false, isUnique: false, hasDefault: false, isOptional: false },
      { name: 'nameEn', prismaType: 'String', isId: false, isUnique: false, hasDefault: false, isOptional: true },
      { name: 'description', prismaType: 'String', isId: false, isUnique: false, hasDefault: false, isOptional: true },
      { name: 'enabled', prismaType: 'Boolean', isId: false, isUnique: false, hasDefault: true, isOptional: false },
      { name: 'requiresApiKey', prismaType: 'Boolean', isId: false, isUnique: false, hasDefault: true, isOptional: false },
      { name: 'apiKey', prismaType: 'String', isId: false, isUnique: false, hasDefault: false, isOptional: true },
      { name: 'status', prismaType: 'String', isId: false, isUnique: false, hasDefault: true, isOptional: false },
      { name: 'lastUpdate', prismaType: 'DateTime', isId: false, isUnique: false, hasDefault: false, isOptional: true },
      { name: 'entryCount', prismaType: 'Int', isId: false, isUnique: false, hasDefault: true, isOptional: false },
      { name: 'error', prismaType: 'String', isId: false, isUnique: false, hasDefault: false, isOptional: true },
      { name: 'createdAt', prismaType: 'DateTime', isId: false, isUnique: false, hasDefault: true, isOptional: false },
      { name: 'updatedAt', prismaType: 'DateTime', isId: false, isUnique: false, hasDefault: true, isOptional: false },
    ],
  },
  {
    name: 'ThreatIntelEntry',
    columns: [
      { name: 'id', prismaType: 'String', isId: true, isUnique: false, hasDefault: true, isOptional: false },
      { name: 'sourceId', prismaType: 'String', isId: false, isUnique: false, hasDefault: false, isOptional: false },
      { name: 'type', prismaType: 'String', isId: false, isUnique: false, hasDefault: false, isOptional: false },
      { name: 'value', prismaType: 'String', isId: false, isUnique: false, hasDefault: false, isOptional: false },
      { name: 'severity', prismaType: 'String', isId: false, isUnique: false, hasDefault: true, isOptional: false },
      { name: 'tags', prismaType: 'String', isId: false, isUnique: false, hasDefault: false, isOptional: true },
      { name: 'createdAt', prismaType: 'DateTime', isId: false, isUnique: false, hasDefault: true, isOptional: false },
    ],
  },
  {
    name: 'ThreatIntelApiKey',
    columns: [
      { name: 'id', prismaType: 'String', isId: true, isUnique: false, hasDefault: true, isOptional: false },
      { name: 'source', prismaType: 'String', isId: false, isUnique: true, hasDefault: false, isOptional: false },
      { name: 'apiKey', prismaType: 'String', isId: false, isUnique: false, hasDefault: false, isOptional: false },
      { name: 'apiUrl', prismaType: 'String', isId: false, isUnique: false, hasDefault: false, isOptional: true },
      { name: 'enabled', prismaType: 'Boolean', isId: false, isUnique: false, hasDefault: true, isOptional: false },
      { name: 'lastValidated', prismaType: 'DateTime', isId: false, isUnique: false, hasDefault: false, isOptional: true },
      { name: 'lastError', prismaType: 'String', isId: false, isUnique: false, hasDefault: false, isOptional: true },
      { name: 'createdAt', prismaType: 'DateTime', isId: false, isUnique: false, hasDefault: true, isOptional: false },
      { name: 'updatedAt', prismaType: 'DateTime', isId: false, isUnique: false, hasDefault: true, isOptional: false },
    ],
  },
  {
    name: 'SyncTask',
    columns: [
      { name: 'id', prismaType: 'String', isId: true, isUnique: false, hasDefault: true, isOptional: false },
      { name: 'name', prismaType: 'String', isId: false, isUnique: false, hasDefault: false, isOptional: false },
      { name: 'sources', prismaType: 'String', isId: false, isUnique: false, hasDefault: false, isOptional: false },
      { name: 'status', prismaType: 'String', isId: false, isUnique: false, hasDefault: true, isOptional: false },
      { name: 'progress', prismaType: 'Float', isId: false, isUnique: false, hasDefault: true, isOptional: false },
      { name: 'totalSources', prismaType: 'Int', isId: false, isUnique: false, hasDefault: true, isOptional: false },
      { name: 'completedSources', prismaType: 'Int', isId: false, isUnique: false, hasDefault: true, isOptional: false },
      { name: 'failedSources', prismaType: 'Int', isId: false, isUnique: false, hasDefault: true, isOptional: false },
      { name: 'results', prismaType: 'String', isId: false, isUnique: false, hasDefault: false, isOptional: true },
      { name: 'error', prismaType: 'String', isId: false, isUnique: false, hasDefault: false, isOptional: true },
      { name: 'createdAt', prismaType: 'DateTime', isId: false, isUnique: false, hasDefault: true, isOptional: false },
      { name: 'startedAt', prismaType: 'DateTime', isId: false, isUnique: false, hasDefault: false, isOptional: true },
      { name: 'completedAt', prismaType: 'DateTime', isId: false, isUnique: false, hasDefault: false, isOptional: true },
      { name: 'createdBy', prismaType: 'String', isId: false, isUnique: false, hasDefault: false, isOptional: true },
    ],
  },
];

// ─── SQL Type Mapping ──────────────────────────────────────────────────────

function mapPrismaTypeToMySQL(prismaType: string): string {
  switch (prismaType) {
    case 'String': return 'VARCHAR(255)';
    case 'Int': return 'INT';
    case 'Float': return 'DOUBLE';
    case 'Boolean': return 'TINYINT(1)';
    case 'DateTime': return 'DATETIME';
    default: return 'TEXT';
  }
}

function mapPrismaTypeToPostgreSQL(prismaType: string): string {
  switch (prismaType) {
    case 'String': return 'VARCHAR(255)';
    case 'Int': return 'INTEGER';
    case 'Float': return 'DOUBLE PRECISION';
    case 'Boolean': return 'BOOLEAN';
    case 'DateTime': return 'TIMESTAMP';
    default: return 'TEXT';
  }
}

// ─── SQL Value Escaping ────────────────────────────────────────────────────

function escapeSQLValue(value: unknown): string {
  if (value === null || value === undefined) return 'NULL';
  if (typeof value === 'boolean') return value ? '1' : '0';
  if (typeof value === 'number') return String(value);
  if (value instanceof Date) return `'${value.toISOString().slice(0, 19).replace('T', ' ')}'`;
  const str = String(value);
  return `'${str.replace(/'/g, "''")}'`;
}

function escapePostgreSQLValue(value: unknown): string {
  if (value === null || value === undefined) return 'NULL';
  if (typeof value === 'boolean') return value ? 'TRUE' : 'FALSE';
  if (typeof value === 'number') return String(value);
  if (value instanceof Date) return `'${value.toISOString().slice(0, 19).replace('T', ' ')}'`;
  const str = String(value);
  return `'${str.replace(/'/g, "''")}'`;
}

// ─── MySQL SQL Generation ──────────────────────────────────────────────────

function generateMySQLCreateTable(table: TableDef): string {
  const lines: string[] = [];
  lines.push(`CREATE TABLE IF NOT EXISTS \`${table.name}\` (`);

  const colDefs: string[] = [];
  let primaryKey = '';

  for (const col of table.columns) {
    const sqlType = mapPrismaTypeToMySQL(col.prismaType);
    let def = `  \`${col.name}\` ${sqlType}`;

    if (col.isId) {
      if (col.prismaType === 'Int') {
        def += ' NOT NULL AUTO_INCREMENT';
      } else {
        def += ' NOT NULL';
      }
      primaryKey = col.name;
    } else if (!col.isOptional) {
      def += ' NOT NULL';
    } else {
      def += ' DEFAULT NULL';
    }

    if (col.isUnique && !col.isId) {
      def += ',\n  UNIQUE KEY \`uk_${table.name}_${col.name}\` (\`${col.name}\`)';
    }

    colDefs.push(def);
  }

  if (primaryKey) {
    colDefs.push(`  PRIMARY KEY (\`${primaryKey}\`)`);
  }

  lines.push(colDefs.join(',\n'));
  lines.push(') ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;');

  return lines.join('\n');
}

function generateMySQLInsert(tableName: string, columns: ColumnDef[], rows: Record<string, unknown>[]): string {
  if (rows.length === 0) return '';

  const colNames = columns.map(c => `\`${c.name}\``).join(', ');
  const lines: string[] = [];

  for (const row of rows) {
    const values = columns.map(c => escapeSQLValue(row[c.name])).join(', ');
    lines.push(`INSERT INTO \`${tableName}\` (${colNames}) VALUES (${values});`);
  }

  return lines.join('\n');
}

function generateMySQLSQL(tables: TableDef[], data: Record<string, Record<string, unknown>[]>): string {
  const parts: string[] = [];

  parts.push('-- DarkLink Database Export - MySQL SQL');
  parts.push(`-- Generated at: ${new Date().toISOString()}`);
  parts.push('-- This file was auto-generated from SQLite data');
  parts.push('');
  parts.push('SET NAMES utf8mb4;');
  parts.push('SET FOREIGN_KEY_CHECKS = 0;');
  parts.push('');

  for (const table of tables) {
    const rows = data[table.name] || [];
    parts.push(`-- ─── Table: ${table.name} (${rows.length} rows) ───`);
    parts.push(generateMySQLCreateTable(table));
    parts.push('');
    if (rows.length > 0) {
      parts.push(generateMySQLInsert(table.name, table.columns, rows));
      parts.push('');
    }
  }

  parts.push('SET FOREIGN_KEY_CHECKS = 1;');
  parts.push('');

  return parts.join('\n');
}

// ─── PostgreSQL SQL Generation ──────────────────────────────────────────────

function generatePostgreSQLCreateTable(table: TableDef): string {
  const lines: string[] = [];
  lines.push(`CREATE TABLE IF NOT EXISTS "${table.name}" (`);

  const colDefs: string[] = [];
  const uniqueConstraints: string[] = [];
  let primaryKey = '';

  for (const col of table.columns) {
    const sqlType = mapPrismaTypeToPostgreSQL(col.prismaType);
    let def = `  "${col.name}" `;

    if (col.isId) {
      if (col.prismaType === 'Int') {
        def += 'INTEGER GENERATED ALWAYS AS IDENTITY';
      } else {
        def += sqlType;
      }
      def += ' NOT NULL';
      primaryKey = col.name;
    } else if (!col.isOptional) {
      def += `${sqlType} NOT NULL`;
    } else {
      def += `${sqlType}`;
    }

    if (col.isUnique && !col.isId) {
      uniqueConstraints.push(`  CONSTRAINT "uk_${table.name}_${col.name}" UNIQUE ("${col.name}")`);
    }

    colDefs.push(def);
  }

  if (primaryKey) {
    colDefs.push(`  PRIMARY KEY ("${primaryKey}")`);
  }

  const allDefs = [...colDefs, ...uniqueConstraints];
  lines.push(allDefs.join(',\n'));
  lines.push(');');

  // Add index for composite unique constraints that Prisma defines
  if (table.name === 'ThreatIntelEntry') {
    lines.push('');
    lines.push('CREATE INDEX IF NOT EXISTS "idx_threat_intel_entry_type_value" ON "ThreatIntelEntry" ("type", "value");');
    lines.push('CREATE INDEX IF NOT EXISTS "idx_threat_intel_entry_source_id" ON "ThreatIntelEntry" ("sourceId");');
    lines.push('CREATE INDEX IF NOT EXISTS "idx_threat_intel_entry_value" ON "ThreatIntelEntry" ("value");');
    lines.push('CREATE UNIQUE INDEX IF NOT EXISTS "uk_threat_intel_entry_source_id_type_value" ON "ThreatIntelEntry" ("sourceId", "type", "value");');
  }

  return lines.join('\n');
}

function generatePostgreSQLInsert(tableName: string, columns: ColumnDef[], rows: Record<string, unknown>[]): string {
  if (rows.length === 0) return '';

  const colNames = columns.map(c => `"${c.name}"`).join(', ');
  const lines: string[] = [];

  for (const row of rows) {
    const values = columns.map(c => escapePostgreSQLValue(row[c.name])).join(', ');
    lines.push(`INSERT INTO "${tableName}" (${colNames}) VALUES (${values});`);
  }

  return lines.join('\n');
}

function generatePostgreSQLSQL(tables: TableDef[], data: Record<string, Record<string, unknown>[]>): string {
  const parts: string[] = [];

  parts.push('-- DarkLink Database Export - PostgreSQL SQL');
  parts.push(`-- Generated at: ${new Date().toISOString()}`);
  parts.push('-- This file was auto-generated from SQLite data');
  parts.push('');
  parts.push('BEGIN;');
  parts.push('');

  for (const table of tables) {
    const rows = data[table.name] || [];
    parts.push(`-- ─── Table: ${table.name} (${rows.length} rows) ───`);
    parts.push(generatePostgreSQLCreateTable(table));
    parts.push('');
    if (rows.length > 0) {
      parts.push(generatePostgreSQLInsert(table.name, table.columns, rows));
      parts.push('');
    }
  }

  parts.push('COMMIT;');
  parts.push('');

  return parts.join('\n');
}

// ─── Rate Limiting for Export ──────────────────────────────────────────────

const exportRateLimitMap = new Map<string, { count: number; lastAttempt: number }>();
const EXPORT_RATE_LIMIT_MAX = 5;       // max requests per window
const EXPORT_RATE_LIMIT_WINDOW = 60000; // 1 minute window

function checkExportRateLimit(key: string): { allowed: boolean; remainingMs: number } {
  const now = Date.now();
  const record = exportRateLimitMap.get(key);

  if (!record || now - record.lastAttempt > EXPORT_RATE_LIMIT_WINDOW) {
    exportRateLimitMap.set(key, { count: 1, lastAttempt: now });
    return { allowed: true, remainingMs: 0 };
  }

  if (record.count >= EXPORT_RATE_LIMIT_MAX) {
    return { allowed: false, remainingMs: EXPORT_RATE_LIMIT_WINDOW - (now - record.lastAttempt) };
  }

  record.count++;
  record.lastAttempt = now;
  return { allowed: true, remainingMs: 0 };
}

// Clean up old rate limit entries periodically
setInterval(() => {
  const now = Date.now();
  for (const [key, record] of exportRateLimitMap.entries()) {
    if (now - record.lastAttempt > EXPORT_RATE_LIMIT_WINDOW) {
      exportRateLimitMap.delete(key);
    }
  }
}, 60000);

// ─── SQLite DB File Path ──────────────────────────────────────────────────

function getSqliteDbPath(): string {
  // DATABASE_URL format: file:/home/z/my-project/db/custom.db
  const dbUrl = process.env.DATABASE_URL || '';
  if (dbUrl.startsWith('file:')) {
    // Remove "file:" prefix — handles both "file:/path" and "file:///path"
    const filePath = dbUrl.replace(/^file:/, '');
    return filePath;
  }
  // Fallback: default path relative to project root
  return join(process.cwd(), 'db', 'custom.db');
}

// ─── Main Handler ──────────────────────────────────────────────────────────

export async function POST(request: NextRequest) {
  try {
    const sessionError = requireSessionAuth(request);
    if (sessionError) return sessionError;

    // Rate limiting — prevent rapid repeated export requests
    const rateLimitKey = request.headers.get('x-real-ip') ||
                         request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
                         'unknown';
    const rateLimit = checkExportRateLimit(rateLimitKey);
    if (!rateLimit.allowed) {
      return NextResponse.json(
        { error: '导出请求过于频繁，请稍后再试' },
        { status: 429 }
      );
    }

    const actor = getSessionFromRequest(request) || 'system';
    const ip = rateLimitKey;

    const format = (request.nextUrl.searchParams.get('format') || 'sqlite') as 'sqlite' | 'mysql' | 'postgresql';

    // ── SQLite native export: copy the .db file as binary ──
    if (format === 'sqlite') {
      const dbPath = getSqliteDbPath();
      try {
        const fileBuffer = await readFile(dbPath);
        auditLog.data('db_exported', actor, { format: 'sqlite' }, ip, 'database', 'main');
        return new NextResponse(fileBuffer, {
          status: 200,
          headers: {
            'Content-Type': 'application/x-sqlite3',
            'Content-Disposition': `attachment; filename="darklink-db-export-${new Date().toISOString().slice(0, 10)}.db"`,
          },
        });
      } catch {
        return NextResponse.json({ error: 'SQLite数据库文件不存在或无法读取' }, { status: 500 });
      }
    }

    // ── SQL format export (mysql / postgresql) ──

    // Export all data from current database
    const [
      scanTasks,
      scanResults,
      urlDetails,
      darkLinks,
      qrCodeResults,
      scanLogs,
      maliciousDomains,
      maliciousIPs,
      updateSchedules,
    ] = await Promise.all([
      db.scanTask.findMany(),
      db.scanResult.findMany(),
      db.urlDetail.findMany(),
      db.darkLink.findMany(),
      db.qrCodeResult.findMany(),
      db.scanLog.findMany(),
      db.maliciousDomain.findMany(),
      db.maliciousIP.findMany(),
      db.updateSchedule.findMany(),
    ]);

    // Try to export ThreatIntelEntry if it exists
    let threatIntelEntries: unknown[] = [];
    try {
      threatIntelEntries = await (db as any).threatIntelEntry.findMany() as unknown[];
    } catch {
      // ThreatIntelEntry model may not exist, skip it
    }

    // Try to export ThreatIntelSource if it exists
    let threatIntelSources: unknown[] = [];
    try {
      threatIntelSources = await (db as any).threatIntelSource.findMany() as unknown[];
    } catch {
      // ThreatIntelSource model may not exist, skip it
    }

    // Try to export ThreatIntelApiKey if it exists
    let threatIntelApiKeys: unknown[] = [];
    try {
      threatIntelApiKeys = await (db as any).threatIntelApiKey.findMany() as unknown[];
    } catch {
      // ThreatIntelApiKey model may not exist, skip it
    }

    // Try to export SyncTask if it exists
    let syncTasks: unknown[] = [];
    try {
      syncTasks = await (db as any).syncTask.findMany() as unknown[];
    } catch {
      // SyncTask model may not exist, skip it
    }

    const data: Record<string, Record<string, unknown>[]> = {
      ScanTask: scanTasks as Record<string, unknown>[],
      ScanResult: scanResults as Record<string, unknown>[],
      UrlDetail: urlDetails as Record<string, unknown>[],
      DarkLink: darkLinks as Record<string, unknown>[],
      QrCodeResult: qrCodeResults as Record<string, unknown>[],
      ScanLog: scanLogs as Record<string, unknown>[],
      MaliciousDomain: maliciousDomains as Record<string, unknown>[],
      MaliciousIP: maliciousIPs as Record<string, unknown>[],
      UpdateSchedule: updateSchedules as Record<string, unknown>[],
      ThreatIntelEntry: threatIntelEntries as Record<string, unknown>[],
      ThreatIntelSource: threatIntelSources as Record<string, unknown>[],
      ThreatIntelApiKey: threatIntelApiKeys as Record<string, unknown>[],
      SyncTask: syncTasks as Record<string, unknown>[],
    };

    // Filter tables that have data (or include empty ones for CREATE TABLE)
    // Use only tables that have corresponding definitions
    const activeTables = TABLE_DEFINITIONS.filter(t => data[t.name] !== undefined);

    let sqlContent: string;
    if (format === 'mysql') {
      sqlContent = generateMySQLSQL(activeTables, data);
    } else {
      sqlContent = generatePostgreSQLSQL(activeTables, data);
    }

    auditLog.data('db_exported', actor, { format }, ip, 'database', 'main');

    return new NextResponse(sqlContent, {
      status: 200,
      headers: {
        'Content-Type': 'text/sql; charset=utf-8',
        'Content-Disposition': `attachment; filename="darklink-db-export-${new Date().toISOString().slice(0, 10)}.${format === 'mysql' ? 'mysql' : 'postgresql'}.sql"`,
      },
    });
  } catch (error) {
    console.error('Database export error:', error);
    return NextResponse.json({ error: '数据导出失败，请检查数据库连接' }, { status: 500 });
  }
}
