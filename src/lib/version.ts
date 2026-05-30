/**
 * Single source of truth for the application version.
 * All version references should import from this file.
 *
 * When releasing a new version, only change the value here.
 */

export const APP_VERSION = 'v1.9.0';

/** Numeric version without the 'v' prefix (for package.json, etc.) */
export const APP_VERSION_NUMBER = '1.9.0';

/** Archive name for project downloads */
export const ARCHIVE_NAME = `darklink-detector-${APP_VERSION_NUMBER}.tar.gz`;
