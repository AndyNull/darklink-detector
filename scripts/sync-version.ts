/**
 * Version Synchronization Script
 *
 * Reads the version from the root package.json and updates all
 * mini-service package.json files to match. This ensures a single
 * source of truth for the version number.
 *
 * Usage:
 *   bun scripts/sync-version.ts          # Sync versions
 *   bun run version-sync                 # Via npm script
 *
 * This script is also run automatically after `npm version` / `bun version`
 * via the `postversion` script in root package.json.
 */

import { readFileSync, writeFileSync } from 'fs';
import { resolve } from 'path';

const ROOT_DIR = resolve(import.meta.dirname, '..');

// Mini-service package.json files relative to root
const MINI_SERVICE_PACKAGES = [
  'mini-services/scan-engine/package.json',
  'mini-services/data-sync-service/package.json',
];

function main(): void {
  // 1. Read root version
  const rootPkgPath = resolve(ROOT_DIR, 'package.json');
  let rootPkg: Record<string, any>;
  let rootVersion: string;

  try {
    rootPkg = JSON.parse(readFileSync(rootPkgPath, 'utf-8'));
    rootVersion = rootPkg.version;
  } catch (err) {
    console.error(`[sync-version] ERROR: Failed to read root package.json:`, err);
    process.exit(1);
  }

  if (!rootVersion) {
    console.error(`[sync-version] ERROR: Root package.json has no "version" field!`);
    process.exit(1);
  }

  console.log(`[sync-version] Root version: ${rootVersion}`);

  // 2. Update each mini-service package.json
  let updated = 0;
  let skipped = 0;

  for (const relPath of MINI_SERVICE_PACKAGES) {
    const pkgPath = resolve(ROOT_DIR, relPath);

    try {
      const content = readFileSync(pkgPath, 'utf-8');
      const pkg = JSON.parse(content);

      if (pkg.version === rootVersion) {
        console.log(`[sync-version]   ${relPath}: already at ${rootVersion} (skipped)`);
        skipped++;
        continue;
      }

      const oldVersion = pkg.version;
      pkg.version = rootVersion;

      // Write back with 2-space indentation and trailing newline
      writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n', 'utf-8');
      console.log(`[sync-version]   ${relPath}: ${oldVersion} → ${rootVersion} ✓`);
      updated++;
    } catch (err: any) {
      if (err?.code === 'ENOENT') {
        console.warn(`[sync-version]   ${relPath}: not found (skipped)`);
        skipped++;
      } else {
        console.error(`[sync-version]   ${relPath}: ERROR -`, err);
      }
    }
  }

  // 3. Summary
  console.log(`[sync-version] Done: ${updated} updated, ${skipped} skipped`);
}

main();
