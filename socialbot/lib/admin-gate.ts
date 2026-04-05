import { createClient, type SupabaseClient, type User } from '@supabase/supabase-js';
import { fetchProfileRoleForMiddleware, isAdminRole } from '@/lib/supabase/session-helpers';

/** Same allowlist as middleware — must stay in sync for API routes. */
export const ADMIN_EMAIL_BYPASS = 'mohitkumariind@gmail.com';

export function isAdminEmailBypass(email: string | null | undefined): boolean {
  const e = email?.toLowerCase().trim();
  return !!e && e === ADMIN_EMAIL_BYPASS.toLowerCase();
}

/**
 * Confirms the cookie session may access admin APIs (DB role admin or email bypass).
 */
export async function validateAdminSession(
  supabase: SupabaseClient
): Promise<{ ok: true; user: User } | { ok: false; status: 401 | 403 }> {
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();
  if (error || !user) return { ok: false, status: 401 };
  if (isAdminEmailBypass(user.email)) return { ok: true, user };
  const { role } = await fetchProfileRoleForMiddleware(user.id, supabase);
  if (isAdminRole(role)) return { ok: true, user };
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
