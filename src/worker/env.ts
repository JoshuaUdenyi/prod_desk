import type { SessionUser } from '@shared/types';

/** Bindings and variables available to the Worker. */
export interface Env {
  DB: D1Database;
  FILES: R2Bucket;
  ASSETS: Fetcher;

  APP_ENV: string;
  SESSION_TTL_DAYS: string;

  /** Set with `wrangler secret put` in production. */
  TURNSTILE_SECRET?: string;
  TURNSTILE_SITE_KEY?: string;
}

export type AppVariables = {
  user: SessionUser;
};

export type AppBindings = {
  Bindings: Env;
  Variables: AppVariables;
};
