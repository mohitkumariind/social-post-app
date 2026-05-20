import { createClient, type SupabaseClient, type User } from '@supabase/supabase-js';
import {
  fetchProfileAccessForMiddleware,
  isAdminRole,
  isCampaignManagerRole,
  isModeratorRole,
  isEditorRole,
  isSuperAdminRole,
} from '@/lib/supabase/session-helpers';
import type { AdminRole } from '@/lib/permissions';
import { canAccessAdminPanel, normalizeProfileRole } from '@/lib/permissions';
import type { RbacUser } from '@/lib/rbac/require';

/**
 * Optional emergency local bypass for development only.
 * Fail-closed in production: even if env is set, bypass is ignored.
 */
export function getAdminEmailBypass(): string | null {
  const configured = process.env.ADMIN_EMAIL_BYPASS?.trim().toLowerCase() ?? '';
  if (!configured) return null;
  if (process.env.NODE_ENV === 'production') {
    console.warn('[security.auth] ADMIN_EMAIL_BYPASS is ignored in production');
    return null;
  }
  return configured;
}

export function isAdminEmailBypass(email: string | null | undefined): boolean {
  const e = email?.toLowerCase().trim();
  const bypass = getAdminEmailBypass();
  return !!e && !!bypass && e === bypass;
}

/**
 * Confirms the cookie session may access admin APIs.
 * In production this always relies on persisted profile roles (no email bypass).
 */
export async function validateAdminSession(
  supabase: SupabaseClient
): Promise<
  | {
      ok: true;
      user: User;
      role: AdminRole;
      assigned_state_ids: number[];
      assigned_group_ids: string[];
      assigned_party_ids: string[];
    }
  | { ok: false; status: 401 | 403 }
> {
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();
  if (error || !user) return { ok: false, status: 401 };
  const { role: rawRole, assigned_state_ids, assigned_group_ids, assigned_party_ids } =
    await fetchProfileAccessForMiddleware(user.id, supabase);
  const normalized = normalizeProfileRole(rawRole);
  if (!normalized || !canAccessAdminPanel(normalized)) {
    return { ok: false, status: 403 };
  }
  const role = normalized as AdminRole;
  if (isAdminRole(role)) {
    return { ok: true, user, role: 'admin', assigned_state_ids, assigned_group_ids, assigned_party_ids };
  }
  if (isSuperAdminRole(role)) {
    return {
      ok: true,
      user,
      role: 'super_admin',
      assigned_state_ids,
      assigned_group_ids,
      assigned_party_ids,
    };
  }
  if (isEditorRole(role)) {
    return {
      ok: true,
      user,
      role: 'editor',
      assigned_state_ids,
      assigned_group_ids: [],
      assigned_party_ids,
    };
  }
  if (isModeratorRole(role)) {
    return {
      ok: true,
      user,
      role: 'moderator',
      assigned_state_ids,
      assigned_group_ids: [],
      assigned_party_ids,
    };
  }
  if (isCampaignManagerRole(role)) {
    return {
      ok: true,
      user,
      role: 'campaign_manager',
      assigned_state_ids,
      assigned_group_ids,
      assigned_party_ids,
    };
  }
  return { ok: false, status: 403 };
}

export function createServiceRoleClient(): SupabaseClient | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!url || !key) return null;
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

export type VerifiedAdminAuth = {
  role: AdminRole;
  user: { id: string };
  assigned_state_ids: number[];
  assigned_group_ids: string[];
  assigned_party_ids: string[];
};

/** Map validated admin session to unified RBAC user (all AdminRole values). */
export function toRbacUser(
  auth: Pick<VerifiedAdminAuth, 'user' | 'role' | 'assigned_state_ids' | 'assigned_group_ids'>
): RbacUser {
  return {
    id: auth.user.id,
    role: auth.role,
    assigned_state_ids: auth.assigned_state_ids,
    assigned_group_ids: auth.assigned_group_ids,
  };
}

export function isAdmin(auth: Pick<VerifiedAdminAuth, 'role'>): boolean {
  return auth.role === 'admin';
}

export function isSuperAdmin(auth: Pick<VerifiedAdminAuth, 'role'>): boolean {
  return auth.role === 'super_admin';
}

export function isEditor(auth: Pick<VerifiedAdminAuth, 'role'>): boolean {
  return auth.role === 'editor';
}

export function isModerator(auth: Pick<VerifiedAdminAuth, 'role'>): boolean {
  return auth.role === 'moderator';
}

export function isCampaignManager(auth: Pick<VerifiedAdminAuth, 'role'>): boolean {
  return auth.role === 'campaign_manager';
}

export function assertAdminRole(auth: Pick<VerifiedAdminAuth, 'role'>): void {
  if (!isAdmin(auth)) {
    throw new Error('RBAC assertion failed: expected admin role');
  }
}
