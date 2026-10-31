import type { SessionUser } from '@shared/types';

export function nowIso(): string {
  return new Date().toISOString();
}

export function newId(): string {
  return crypto.randomUUID();
}

export interface AuditEntry {
  actor: SessionUser | null;
  action: string;
  entity: string;
  entityId: string | null;
  detail?: unknown;
}

/**
 * Append-only audit trail. Failures here must never break the user's action,
 * so the write is best-effort.
 */
export async function audit(db: D1Database, entry: AuditEntry): Promise<void> {
  try {
    await db
      .prepare(
        `INSERT INTO audit_log (id, actor_id, actor_email, action, entity, entity_id, detail_json, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        newId(),
        entry.actor?.id ?? null,
        entry.actor?.email ?? null,
        entry.action,
        entry.entity,
        entry.entityId,
        JSON.stringify(entry.detail ?? {}),
        nowIso(),
      )
      .run();
  } catch (error) {
    console.error('audit write failed', error);
  }
}

/** Generate a human reference like PD-2026-0042 from the current project count. */
export async function nextProjectReference(db: D1Database): Promise<string> {
  const year = new Date().getFullYear();
  const prefix = `PD-${year}-`;

  const row = await db
    .prepare(
      `SELECT reference FROM projects
        WHERE reference LIKE ?
        ORDER BY reference DESC
        LIMIT 1`,
    )
    .bind(`${prefix}%`)
    .first<{ reference: string }>();

  const lastNumber = row ? Number.parseInt(row.reference.slice(prefix.length), 10) : 0;
  const next = Number.isFinite(lastNumber) ? lastNumber + 1 : 1;

  return `${prefix}${String(next).padStart(4, '0')}`;
}

export async function nextQuotationReference(
  db: D1Database,
  projectReference: string,
  version: number,
): Promise<string> {
  return `${projectReference}/Q${String(version).padStart(2, '0')}`;
}
