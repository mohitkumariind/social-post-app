import type { SupabaseClient } from '@supabase/supabase-js';
import { toRbacActor, type VerifiedAdminAuth } from '@/lib/admin-gate';
import type { EditorEventScope } from '@/lib/event-access';
import type { EventVisibilityUser } from '@/lib/rbac/event-visibility-engine';
import type { RbacActor } from '@/lib/rbac/scope-types';

function toNumArr(v: unknown): number[] {
  if (v == null) return [];
  const arr = Array.isArray(v) ? v : [v];
  return arr
    .map((x) => (typeof x === 'number' ? x : Number(x)))
    .filter((n) => Number.isFinite(n));
}

function toPartySlugArr(v: unknown): string[] {
  if (v == null) return [];
  const arr = Array.isArray(v) ? v : [v];
  return arr
    .map((x) => String(x ?? '').trim().toLowerCase())
    .filter((s) => s.length > 0 && s !== 'all');
}

/**
 * List/read visibility for editors: own rows + published global feed only.
 * Uses empty state/party on the visibility user so the unified engine does not add
 * cross-role published state+party clauses (no per-role branch in event-visibility-engine).
 */
export function eventVisibilityUserFromAuth(
  auth: Pick<VerifiedAdminAuth, 'user' | 'role' | 'assigned_state_ids' | 'assigned_party_ids'>
): EventVisibilityUser {
  if (auth.role !== 'editor') {
    return {
      id: auth.user.id,
      role: auth.role,
      assigned_state_ids: auth.assigned_state_ids,
      assigned_party_ids: auth.assigned_party_ids,
    };
  }
  return {
    id: auth.user.id,
    role: auth.role,
    assigned_state_ids: [],
    assigned_party_ids: [],
  };
}

/** In-memory read checks for editors — same empty scope as {@link eventVisibilityUserFromAuth}. */
export function toRbacActorForEventRead(auth: VerifiedAdminAuth): RbacActor {
  const base = toRbacActor(auth);
  if (auth.role !== 'editor') return base;
  return {
    ...base,
    assigned_state_ids: [],
    assigned_party_ids: [],
  };
}

/**
 * Profile-backed create limits (optional). List/read ignore these fields for editors.
 */
export async function resolveEditorAssignmentScope(
  admin: SupabaseClient | null,
  userId: string,
  fallback: Pick<VerifiedAdminAuth, 'assigned_state_ids' | 'assigned_party_ids'>
): Promise<EditorEventScope> {
  if (!admin) {
    return {
      assignedStateIds: fallback.assigned_state_ids,
      assignedPartyIds: fallback.assigned_party_ids ?? [],
    };
  }
  const { data, error } = await admin
    .from('profiles')
    .select('assigned_state_ids, assigned_party_ids')
    .eq('id', userId)
    .maybeSingle();
  if (error || !data) {
    return {
      assignedStateIds: fallback.assigned_state_ids,
      assignedPartyIds: fallback.assigned_party_ids ?? [],
    };
  }
  return {
    assignedStateIds: toNumArr((data as { assigned_state_ids?: unknown }).assigned_state_ids),
    assignedPartyIds: toPartySlugArr((data as { assigned_party_ids?: unknown }).assigned_party_ids),
  };
}
