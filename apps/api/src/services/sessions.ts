import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';

/**
 * Anonymous sessions (no accounts in v1). A token is `s1.<sessionId>.<hmac>`;
 * the server only needs its secret to verify it. Records store an owner hash
 * derived from the session id, never the token itself.
 */
export class SessionService {
  constructor(private readonly secret: Buffer) {
    if (secret.length < 32) throw new Error('Session secret must be at least 32 bytes');
  }

  private sign(sessionId: string): string {
    return createHmac('sha256', this.secret).update(`s1.${sessionId}`).digest('base64url');
  }

  static ownerIdFor(sessionId: string): string {
    return createHash('sha256').update(`owner:${sessionId}`).digest('hex').slice(0, 32);
  }

  issue(): { token: string; sessionId: string; ownerId: string } {
    const sessionId = randomBytes(18).toString('base64url');
    return { token: `s1.${sessionId}.${this.sign(sessionId)}`, sessionId, ownerId: SessionService.ownerIdFor(sessionId) };
  }

  verify(token: unknown): { sessionId: string; ownerId: string } | null {
    if (typeof token !== 'string' || token.length > 128) return null;
    const m = /^s1\.([A-Za-z0-9_-]{24})\.([A-Za-z0-9_-]{43})$/.exec(token);
    if (!m) return null;
    const [, sessionId, sig] = m as unknown as [string, string, string];
    const expected = Buffer.from(this.sign(sessionId));
    const given = Buffer.from(sig);
    if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null;
    return { sessionId, ownerId: SessionService.ownerIdFor(sessionId) };
  }
}

/** Use SESSION_SECRET if set, else a random secret persisted in DATA_DIR (created on first start). */
export async function loadSessionSecret(dataDir: string, configured?: string): Promise<Buffer> {
  if (configured) {
    const buf = Buffer.from(configured, 'utf8');
    if (buf.length < 32) throw new Error('SESSION_SECRET must be at least 32 characters');
    return buf;
  }
  const file = path.join(dataDir, 'secret', 'session.key');
  try {
    return await fs.readFile(file);
  } catch {
    await fs.mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
    const secret = randomBytes(48);
    await fs.writeFile(file, secret, { mode: 0o600, flag: 'wx' }).catch(async (err) => {
      if ((err as NodeJS.ErrnoException).code !== 'EEXIST') throw err;
    });
    return fs.readFile(file);
  }
}
