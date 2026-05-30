'use client';

/** Sort type for dark links */
export type DarkLinkSort = 'severity' | 'domain' | 'type';

/** Severity ordering helper — lower number = more severe */
export const severityOrder: Record<string, number> = { critical: 0, high: 1, medium: 2 };

/** Regex to test if a string is a raw IPv4 address */
export const IP_REGEX = /^(\d{1,3}\.){3}\d{1,3}$/;
