import { PrismaClient } from '@prisma/client'
import { getEffectiveProvider } from './config'

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined
}

export const db =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: process.env.NODE_ENV === 'development' ? ['query'] : ['error'],
  })

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = db

// Enable WAL mode for SQLite for better concurrent read/write performance
// WAL allows readers and writers to operate concurrently without blocking
if (getEffectiveProvider() === 'sqlite') {
  db.$executeRawUnsafe('PRAGMA journal_mode=WAL').catch((err: unknown) => {
    console.warn('[DB] Failed to enable WAL mode:', err);
  });
}

// Graceful shutdown: disconnect Prisma on SIGTERM/SIGINT
// Only register once (HMR-safe)
if (!(globalThis as any).__prisma_shutdown_registered) {
  (globalThis as any).__prisma_shutdown_registered = true;
  const shutdown = async () => {
    try {
      await db.$disconnect();
      console.log('[DB] Prisma disconnected gracefully');
    } catch (err) {
      console.warn('[DB] Error disconnecting Prisma:', err);
    }
    process.exit(0);
  };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}