/**
 * Admin audit log helper. Wraps inserts into `next_auth.admin_audit`
 * so every admin write action gets one row recording who did what,
 * to whom, and when.
 *
 * Convention: only **write** actions are logged. Reading the user
 * list is too noisy to be useful in an audit trail and provides no
 * forensic value.
 *
 * Failure here MUST NOT break the action itself — the underlying
 * operation has already happened by the time `logAdminAction` is
 * called, so we log-and-swallow.
 */

import { supabaseAdmin } from './db';
import { NextRequest } from 'next/server';

export interface AdminAuditEntry {
  /** Who did it — the admin's user id. */
  actorId:       string;
  /** Short verb. Recommended set: `revoke_sessions`, `force_sync`,
   *  `update_allowlist`, `delete_user`, `update_role`, …  */
  action:        string;
  /** Who it was done to. Null for system-wide actions. */
  targetUserId?: string | null;
  /** Full context blob. Strip secrets before passing. */
  payload?:      Record<string, unknown>;
}

/**
 * Record an admin write action. Best-effort — failures are logged
 * but don't propagate.
 */
export async function logAdminAction(entry: AdminAuditEntry, req?: NextRequest | null): Promise<void> {
  try {
    await supabaseAdmin()
      .schema('next_auth')
      .from('admin_audit')
      .insert({
        actor_id:       entry.actorId,
        action:         entry.action,
        target_user_id: entry.targetUserId ?? null,
        payload:        entry.payload ?? {},
        ip:             req ? clientIp(req) : null,
      });
  } catch (err) {
    // Never throw — the action succeeded, we're just losing the trail.
    console.error('[audit] insert failed:', err);
  }
}

function clientIp(req: NextRequest): string | null {
  const forwarded = req.headers.get('x-forwarded-for');
  if (forwarded) return forwarded.split(',')[0].trim();
  return req.headers.get('x-real-ip');
}
