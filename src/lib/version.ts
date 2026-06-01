/**
 * Single source of truth for the application version.
 *
 * In server-side code, reads directly from package.json.
 * In client-side code, uses the NEXT_PUBLIC_APP_VERSION env var
 * which is injected at build time by next.config.ts.
 *
 * To change the version, ONLY edit package.json — all other
 * references (config.ts, UI components, etc.) derive from here.
 */

// Server-side: read from package.json at module load time
function readVersionFromPackageJson(): string {
  // Client-side: use the build-time injected env var
  if (typeof window !== 'undefined') {
    return process.env.NEXT_PUBLIC_APP_VERSION || '0.0.0';
  }

  // Server-side: read package.json directly
  try {
    // Use require() for synchronous loading in Node.js
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const fs = require('fs');
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const path = require('path');

    const paths = [
      path.resolve(process.cwd(), 'package.json'),
      path.resolve(__dirname, '../../package.json'),
    ];

    for (const p of paths) {
      try {
        const content = fs.readFileSync(p, 'utf-8');
        const pkg = JSON.parse(content);
        if (pkg.version) return pkg.version;
      } catch {}
    }
  } catch {}

  // Final fallback: try the build-time env var
  if (process.env.NEXT_PUBLIC_APP_VERSION) {
    return process.env.NEXT_PUBLIC_APP_VERSION;
  }

  return '0.0.0';
}

const _version = readVersionFromPackageJson();

/** Version with 'v' prefix, e.g. 'v1.12.0' */
export const APP_VERSION = `v${_version}`;

/** Numeric version without 'v' prefix, e.g. '1.12.0' */
export const APP_VERSION_NUMBER = _version;

/** Archive name for project downloads */
export const ARCHIVE_NAME = `darklink-detector-${APP_VERSION_NUMBER}.tar.gz`;
