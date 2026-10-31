/**
 * Worker entry point.
 *
 * `/api/*` is handled here (wrangler's `run_worker_first` sends those requests
 * straight to us); everything else falls through to the React SPA served from
 * Workers Static Assets.
 */

import { Hono } from 'hono';
import type { AppBindings } from './env';
import type { ApiErrorBody } from '@shared/types';
import { HttpError } from './lib/http';
import { authRoutes } from './routes/auth';
import { dashboardRoutes } from './routes/dashboard';
import { projectRoutes } from './routes/projects';
import { quotationRoutes } from './routes/quotations';
import { auditRoutes, fileRoutes, settingsRoutes } from './routes/settings';

const app = new Hono<AppBindings>();

app.onError((error, c) => {
  if (error instanceof HttpError) {
    const body: ApiErrorBody = {
      error: {
        code: error.code,
        message: error.message,
        ...(error.fields ? { fields: error.fields } : {}),
      },
    };
    return c.json(body, error.status);
  }

  console.error('Unhandled worker error', error);

  const body: ApiErrorBody = {
    error: { code: 'server_error', message: 'Something went wrong. Please try again.' },
  };
  return c.json(body, 500);
});

app.route('/api/auth', authRoutes);
app.route('/api/dashboard', dashboardRoutes);
app.route('/api/projects', projectRoutes);
app.route('/api/quotations', quotationRoutes);
app.route('/api/settings', settingsRoutes);
app.route('/api/files', fileRoutes);
app.route('/api/audit', auditRoutes);

app.all('/api/*', (c) => {
  const body: ApiErrorBody = {
    error: { code: 'not_found', message: 'That endpoint does not exist' },
  };
  return c.json(body, 404);
});

// Anything that is not an API call is the SPA, which handles its own routing.
app.get('*', (c) => c.env.ASSETS.fetch(c.req.raw));

export default app;
