import { createMiddleware } from 'hono/factory';
import { getCookie } from 'hono/cookie';
import type { AppBindings } from '../env';
import { findSessionUser, SESSION_COOKIE } from './session';

function unauthenticated() {
  return {
    error: { code: 'unauthenticated', message: 'Sign in to continue' },
  } as const;
}

/** Resolves the session cookie to a user, or rejects with 401. */
export const requireAuth = createMiddleware<AppBindings>(async (c, next) => {
  const token = getCookie(c, SESSION_COOKIE);
  if (!token) return c.json(unauthenticated(), 401);

  const user = await findSessionUser(c.env.DB, token);
  if (!user) return c.json(unauthenticated(), 401);

  c.set('user', user);
  await next();
});

/** Owner-only actions: settings, approvals, deletions. Run after requireAuth. */
export const requireOwner = createMiddleware<AppBindings>(async (c, next) => {
  const user = c.get('user');
  if (!user || user.role !== 'owner') {
    return c.json(
      { error: { code: 'forbidden', message: 'Only the account owner can do this' } },
      403,
    );
  }
  await next();
});
