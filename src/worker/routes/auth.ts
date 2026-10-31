import { Hono, type Context } from 'hono';
import { deleteCookie, getCookie, setCookie } from 'hono/cookie';
import { z } from 'zod';
import type { SessionUser } from '@shared/types';
import type { AppBindings, Env } from '../env';
import { requireAuth, requireOwner } from '../auth/middleware';
import { hashPassword, passwordProblem, verifyPassword } from '../auth/password';
import {
  createSession,
  revokeAllSessions,
  revokeSession,
  SESSION_COOKIE,
} from '../auth/session';
import { audit, newId, nowIso } from '../db/helpers';
import { HttpError, readBody } from '../lib/http';

const emailSchema = z.email().max(200).transform((value) => value.trim().toLowerCase());
const passwordSchema = z.string().min(1, 'Password is required');

const setupSchema = z.object({
  name: z.string().trim().min(2, 'Enter your name').max(120),
  email: emailSchema,
  password: z.string().min(10, 'Password must be at least 10 characters').max(200),
  companyName: z.string().trim().max(160).optional(),
});

const loginSchema = z.object({
  email: emailSchema,
  password: passwordSchema,
  turnstileToken: z.string().optional(),
});

const changePasswordSchema = z.object({
  currentPassword: z.string().min(1),
  newPassword: z.string().min(10, 'Password must be at least 10 characters').max(200),
});

const createUserSchema = z.object({
  name: z.string().trim().min(2, 'Enter a name').max(120),
  email: emailSchema,
  password: z.string().min(10, 'Password must be at least 10 characters').max(200),
  role: z.enum(['owner', 'finance']),
});

interface UserRow {
  id: string;
  email: string;
  name: string;
  role: SessionUser['role'];
  password_hash: string;
  password_salt: string;
  password_iter: number;
  is_active: number;
}

function sessionTtlDays(env: Env): number {
  const parsed = Number.parseInt(env.SESSION_TTL_DAYS ?? '14', 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 14;
}

async function startSession(c: Context<AppBindings>, userId: string): Promise<void> {
  const env = c.env;
  const { token } = await createSession(
    env.DB,
    userId,
    sessionTtlDays(env),
    c.req.header('user-agent') ?? null,
    c.req.header('cf-connecting-ip') ?? null,
  );

  setCookie(c, SESSION_COOKIE, token, {
    httpOnly: true,
    secure: env.APP_ENV === 'production',
    sameSite: 'Lax',
    path: '/',
    maxAge: sessionTtlDays(env) * 24 * 60 * 60,
  });
}

async function verifyTurnstile(env: Env, token: string | undefined, ip: string | null): Promise<boolean> {
  // Turnstile is optional in development: if no secret is configured, skip it.
  if (!env.TURNSTILE_SECRET) return true;
  if (!token) return false;

  const form = new FormData();
  form.append('secret', env.TURNSTILE_SECRET);
  form.append('response', token);
  if (ip) form.append('remoteip', ip);

  const response = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
    method: 'POST',
    body: form,
  });

  if (!response.ok) return false;
  const result = (await response.json()) as { success?: boolean };
  return result.success === true;
}

export const authRoutes = new Hono<AppBindings>();

/** Public: tells the client whether first-run setup is still needed. */
authRoutes.get('/status', async (c) => {
  const row = await c.env.DB.prepare('SELECT COUNT(*) AS count FROM users').first<{ count: number }>();
  return c.json({
    needsSetup: (row?.count ?? 0) === 0,
    turnstileSiteKey: c.env.TURNSTILE_SITE_KEY ?? null,
  });
});

/** Public: create the first owner account, only while no users exist. */
authRoutes.post('/setup', async (c) => {
  const input = await readBody(c, setupSchema);

  const existing = await c.env.DB.prepare('SELECT COUNT(*) AS count FROM users').first<{ count: number }>();
  if ((existing?.count ?? 0) > 0) {
    throw new HttpError(409, 'already_setup', 'This workspace has already been set up');
  }

  const problem = passwordProblem(input.password);
  if (problem) throw new HttpError(400, 'bad_request', problem, { password: problem });

  const record = await hashPassword(input.password);
  const id = newId();
  const timestamp = nowIso();

  await c.env.DB.batch([
    c.env.DB.prepare(
      `INSERT INTO users (id, email, name, role, password_hash, password_salt, password_iter,
                          is_active, created_at, updated_at)
       VALUES (?, ?, ?, 'owner', ?, ?, ?, 1, ?, ?)`,
    ).bind(id, input.email, input.name, record.hash, record.salt, record.iterations, timestamp, timestamp),
  ]);

  if (input.companyName) {
    await c.env.DB.prepare('UPDATE settings SET company_name = ?, updated_at = ? WHERE id = 1')
      .bind(input.companyName.trim(), timestamp)
      .run();
  }

  await audit(c.env.DB, {
    actor: { id, email: input.email, name: input.name, role: 'owner' },
    action: 'user.setup',
    entity: 'user',
    entityId: id,
  });

  await startSession(c, id);

  return c.json({
    user: { id, email: input.email, name: input.name, role: 'owner' satisfies SessionUser['role'] },
  }, 201);
});

/** Public: sign in. */
authRoutes.post('/login', async (c) => {
  const input = await readBody(c, loginSchema);

  const allowed = await verifyTurnstile(
    c.env,
    input.turnstileToken,
    c.req.header('cf-connecting-ip') ?? null,
  );
  if (!allowed) {
    throw new HttpError(400, 'turnstile_failed', 'Please complete the verification challenge');
  }

  const user = await c.env.DB.prepare(
    `SELECT id, email, name, role, password_hash, password_salt, password_iter, is_active
       FROM users WHERE email = ?`,
  )
    .bind(input.email)
    .first<UserRow>();

  // Verify even when the user is missing, so timing does not reveal accounts.
  const record = {
    hash: user?.password_hash ?? 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=',
    salt: user?.password_salt ?? 'AAAAAAAAAAAAAAAAAAAAAA==',
    iterations: user?.password_iter ?? 210_000,
  };
  const valid = await verifyPassword(input.password, record);

  if (!user || !valid || user.is_active !== 1) {
    await audit(c.env.DB, {
      actor: null,
      action: 'auth.login_failed',
      entity: 'user',
      entityId: user?.id ?? null,
      detail: { email: input.email },
    });
    throw new HttpError(401, 'invalid_credentials', 'Email or password is incorrect');
  }

  await c.env.DB.prepare('UPDATE users SET last_login_at = ? WHERE id = ?')
    .bind(nowIso(), user.id)
    .run();

  await startSession(c, user.id);

  await audit(c.env.DB, {
    actor: { id: user.id, email: user.email, name: user.name, role: user.role },
    action: 'auth.login',
    entity: 'user',
    entityId: user.id,
  });

  return c.json({
    user: { id: user.id, email: user.email, name: user.name, role: user.role } satisfies SessionUser,
  });
});

authRoutes.post('/logout', async (c) => {
  const token = getCookie(c, SESSION_COOKIE);
  if (token) await revokeSession(c.env.DB, token);
  deleteCookie(c, SESSION_COOKIE, { path: '/' });
  return c.json({ ok: true });
});

authRoutes.get('/me', requireAuth, (c) => {
  return c.json({ user: c.get('user') satisfies SessionUser });
});

authRoutes.post('/change-password', requireAuth, async (c) => {
  const user = c.get('user');
  const input = await readBody(c, changePasswordSchema);

  const row = await c.env.DB.prepare(
    'SELECT id, password_hash, password_salt, password_iter FROM users WHERE id = ?',
  )
    .bind(user.id)
    .first<{ id: string; password_hash: string; password_salt: string; password_iter: number }>();

  if (!row) throw new HttpError(401, 'unauthenticated', 'Sign in to continue');

  const valid = await verifyPassword(input.currentPassword, {
    hash: row.password_hash,
    salt: row.password_salt,
    iterations: row.password_iter,
  });
  if (!valid) {
    throw new HttpError(400, 'invalid_password', 'Current password is incorrect', {
      currentPassword: 'Current password is incorrect',
    });
  }

  const record = await hashPassword(input.newPassword);
  await c.env.DB.prepare(
    `UPDATE users SET password_hash = ?, password_salt = ?, password_iter = ?, updated_at = ?
      WHERE id = ?`,
  )
    .bind(record.hash, record.salt, record.iterations, nowIso(), user.id)
    .run();

  // Every other session is invalidated; the current one is replaced.
  await revokeAllSessions(c.env.DB, user.id);
  await startSession(c, user.id);

  await audit(c.env.DB, {
    actor: user,
    action: 'user.password_changed',
    entity: 'user',
    entityId: user.id,
  });

  return c.json({ ok: true });
});

authRoutes.get('/users', requireAuth, requireOwner, async (c) => {
  const result = await c.env.DB.prepare(
    `SELECT id, email, name, role, is_active, created_at, last_login_at
       FROM users ORDER BY created_at ASC`,
  ).all<{
    id: string;
    email: string;
    name: string;
    role: SessionUser['role'];
    is_active: number;
    created_at: string;
    last_login_at: string | null;
  }>();

  return c.json({
    users: result.results.map((row) => ({
      id: row.id,
      email: row.email,
      name: row.name,
      role: row.role,
      isActive: row.is_active === 1,
      createdAt: row.created_at,
      lastLoginAt: row.last_login_at,
    })),
  });
});

authRoutes.post('/users', requireAuth, requireOwner, async (c) => {
  const actor = c.get('user');
  const input = await readBody(c, createUserSchema);

  const problem = passwordProblem(input.password);
  if (problem) throw new HttpError(400, 'bad_request', problem, { password: problem });

  const existing = await c.env.DB.prepare('SELECT id FROM users WHERE email = ?')
    .bind(input.email)
    .first<{ id: string }>();
  if (existing) {
    throw new HttpError(409, 'email_taken', 'That email already has an account', {
      email: 'That email already has an account',
    });
  }

  const record = await hashPassword(input.password);
  const id = newId();
  const timestamp = nowIso();

  await c.env.DB.prepare(
    `INSERT INTO users (id, email, name, role, password_hash, password_salt, password_iter,
                        is_active, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, ?)`,
  )
    .bind(id, input.email, input.name, input.role, record.hash, record.salt, record.iterations, timestamp, timestamp)
    .run();

  await audit(c.env.DB, {
    actor,
    action: 'user.created',
    entity: 'user',
    entityId: id,
    detail: { email: input.email, role: input.role },
  });

  return c.json({ user: { id, email: input.email, name: input.name, role: input.role } }, 201);
});

authRoutes.patch('/users/:id', requireAuth, requireOwner, async (c) => {
  const actor = c.get('user');
  const targetId = c.req.param('id');
  const input = await readBody(
    c,
    z.object({ isActive: z.boolean().optional(), name: z.string().trim().min(2).max(120).optional() }),
  );

  if (targetId === actor.id && input.isActive === false) {
    throw new HttpError(400, 'bad_request', 'You cannot deactivate your own account');
  }

  const sets: string[] = [];
  const values: unknown[] = [];
  if (input.isActive !== undefined) {
    sets.push('is_active = ?');
    values.push(input.isActive ? 1 : 0);
  }
  if (input.name !== undefined) {
    sets.push('name = ?');
    values.push(input.name);
  }
  if (sets.length === 0) throw new HttpError(400, 'bad_request', 'Nothing to update');

  sets.push('updated_at = ?');
  values.push(nowIso());

  await c.env.DB.prepare(`UPDATE users SET ${sets.join(', ')} WHERE id = ?`)
    .bind(...values, targetId)
    .run();

  if (input.isActive === false) await revokeAllSessions(c.env.DB, targetId);

  await audit(c.env.DB, {
    actor,
    action: 'user.updated',
    entity: 'user',
    entityId: targetId,
    detail: input,
  });

  return c.json({ ok: true });
});
