import type { Context } from 'hono';
import type { ContentfulStatusCode } from 'hono/utils/http-status';
import type { ZodType, z } from 'zod';

export class HttpError extends Error {
  constructor(
    readonly status: ContentfulStatusCode,
    readonly code: string,
    message: string,
    readonly fields?: Record<string, string>,
  ) {
    super(message);
    this.name = 'HttpError';
  }
}

export function badRequest(message: string, fields?: Record<string, string>): HttpError {
  return new HttpError(400, 'bad_request', message, fields);
}

export function notFound(message = 'Not found'): HttpError {
  return new HttpError(404, 'not_found', message);
}

export function forbidden(message = 'You do not have permission to do this'): HttpError {
  return new HttpError(403, 'forbidden', message);
}

export function conflict(message: string): HttpError {
  return new HttpError(409, 'conflict', message);
}

/** Parse and validate a JSON body, raising a 400 with per-field messages. */
export async function readBody<S extends ZodType>(c: Context, schema: S): Promise<z.output<S>> {
  let payload: unknown;

  try {
    payload = await c.req.json();
  } catch {
    throw badRequest('Request body must be valid JSON');
  }

  const result = schema.safeParse(payload);
  if (!result.success) {
    const fields: Record<string, string> = {};
    for (const issue of result.error.issues) {
      const key = issue.path.join('.') || 'body';
      if (!fields[key]) fields[key] = issue.message;
    }
    throw badRequest('Please check the highlighted fields', fields);
  }

  return result.data;
}

/** Narrow an unknown thrown value to a message suitable for the client. */
export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Unexpected error';
}
