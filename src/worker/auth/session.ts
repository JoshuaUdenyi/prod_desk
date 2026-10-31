/**
 * Opaque-token sessions stored in D1.
 *
 * The cookie carries a random 256-bit token; the database stores only its
 * SHA-256 hash. A database leak therefore does not yield usable sessions.
 */

import type { SessionUser } from '@shared/types';

export const SESSION_COOKIE = 'pd_session';
const TOKEN_BYTES = 32;

export function generateSessionToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(TOKEN_BYTES));
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export async function hashSessionToken(token: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

interface SessionRow {
  user_id: string;
  email: string;
  name: string;
  role: SessionUser['role'];
  expires_at: string;
}

export async function createSession(
  db: D1Database,
  userId: string,
  ttlDays: number,
  userAgent: string | null,
  ip: string | null,
): Promise<{ token: string; expiresAt: string }> {
  const token = generateSessionToken();
  const tokenHash = await hashSessionToken(token);

  const now = new Date();
  const expires = new Date(now.getTime() + ttlDays * 24 * 60 * 60 * 1000);

  await db
    .prepare(
      `INSERT INTO sessions (token_hash, user_id, created_at, expires_at, user_agent, ip)
       VALUES (?, ?, ?, ?, ?, ?)`,
    )
    .bind(tokenHash, userId, now.toISOString(), expires.toISOString(), userAgent, ip)
    .run();

  return { token, expiresAt: expires.toISOString() };
}

export async function findSessionUser(
  db: D1Database,
  token: string,
): Promise<SessionUser | null> {
  const tokenHash = await hashSessionToken(token);

  const row = await db
    .prepare(
      `SELECT s.user_id, s.expires_at, u.email, u.name, u.role
         FROM sessions s
         JOIN users u ON u.id = s.user_id
        WHERE s.token_hash = ? AND u.is_active = 1`,
    )
    .bind(tokenHash)
    .first<SessionRow>();

  if (!row) return null;

  if (new Date(row.expires_at).getTime() <= Date.now()) {
    await db.prepare('DELETE FROM sessions WHERE token_hash = ?').bind(tokenHash).run();
    return null;
  }

  return { id: row.user_id, email: row.email, name: row.name, role: row.role };
}

export async function revokeSession(db: D1Database, token: string): Promise<void> {
  const tokenHash = await hashSessionToken(token);
  await db.prepare('DELETE FROM sessions WHERE token_hash = ?').bind(tokenHash).run();
}

export async function revokeAllSessions(db: D1Database, userId: string): Promise<void> {
  await db.prepare('DELETE FROM sessions WHERE user_id = ?').bind(userId).run();
}

export async function pruneExpiredSessions(db: D1Database): Promise<void> {
  await db
    .prepare('DELETE FROM sessions WHERE expires_at <= ?')
    .bind(new Date().toISOString())
    .run();
}
