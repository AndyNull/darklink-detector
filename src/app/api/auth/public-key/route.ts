import { NextResponse } from 'next/server';
import { getRSAPublicKey } from '@/lib/server-config';

/**
 * GET /api/auth/public-key
 * Returns the server's RSA public key for client-side encryption.
 * The frontend uses this to encrypt sensitive data (passwords) before
 * sending it over the network, preventing plaintext interception.
 */
export async function GET() {
  try {
    const publicKey = getRSAPublicKey();
    return NextResponse.json({ publicKey });
  } catch {
    return NextResponse.json({ error: 'Failed to get public key' }, { status: 500 });
  }
}
