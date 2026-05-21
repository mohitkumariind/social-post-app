import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { createServerClient, type CookieOptions } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';
import { isAdmin } from '@/lib/permissions';

const __DEV__ = process.env.NODE_ENV !== 'production';

export type CookieToSet = { name: string; value: string; options?: CookieOptions };

/**
 * Supabase SSR client for Next.js `proxy.ts` (formerly `middleware.ts`).
 * Uses `createServerClient` from `@supabase/ssr` (not a separate `createMiddlewareClient` API).
 * Mutates the wrapped `response` when auth refreshes cookies.
 */
export function createSupabaseProxyClient(request: NextRequest) {
  let response = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet: CookieToSet[]) {
          cookiesToSet.forEach(({ name, value }) => {
            request.cookies.set(name, value);
          });
          response = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) => {
            response.cookies.set(name, value, options);
          });
        },
      },
    }
  );

  return { supabase, getSessionResponse: () => response };
}

/**
 * NextResponse.redirect drops cookies set on the session response. Copy them so the browser
 * receives refreshed sb-* session cookies (fixes stale session / false forbidden).
 *
 * @param pathAndQuery — e.g. `/admin`, `/admin/login?next=%2Fadmin%2Fposts`, `/admin/login?error=forbidden`
 */
export function redirectPreservingAuthCookies(
  request: NextRequest,
  sessionResponse: NextResponse,
  pathAndQuery: string
): NextResponse {
  const url = new URL(pathAndQuery, request.url);
  const redirect = NextResponse.redirect(url);
  sessionResponse.cookies.getAll().forEach((cookie) => {
    redirect.cookies.set(cookie.name, cookie.value);
  });
  return redirect;
}

/** Fresh role from DB via user JWT client (subject to RLS). */
export async function fetchProfileRole(
  supabase: SupabaseClient,
  userId: string
): Promise<string | null> {
  const { data, error } = await supabase
    .from('profiles')
    .select('role')
    .eq('id', userId)
    .single();

  if (error || data == null) {
    if (__DEV__ && error?.code !== 'PGRST116') {
      console.warn('[proxy] profiles.role fetch (anon):', error?.message ?? 'no row');
    }
    return null;
  }

  const r = (data as { role?: unknown }).role;
  return typeof r === 'string' ? r.trim() : r != null ? String(r).trim() : null;
}

export type ProfileRoleResult = {
  role: string | null;
  usedServiceRole: boolean;
  errorMessage?: string;
};

export type ProfileAccessResult = {
  role: string | null;
  assigned_state_ids: number[];
  assigned_group_ids: string[];
  assigned_party_ids: string[];
  assigned_loksabha_ids: number[];
  assigned_assembly_ids: number[];
  usedServiceRole: boolean;
  errorMessage?: string;
};

function toPartySlugArr(v: unknown): string[] {
  if (v == null) return [];
  const arr = Array.isArray(v) ? v : [v];
  return arr
    .map((x) => String(x ?? '').trim().toLowerCase())
    .filter((s) => s.length > 0 && s !== 'all');
}

function toNum(v: unknown): number | null {
  if (v == null) return null;
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}

function toNumArr(v: unknown): number[] {
  if (v == null) return [];
  const arr = Array.isArray(v) ? v : [v];
  return arr
    .map((x) => toNum(x))
    .filter((n): n is number => typeof n === 'number' && Number.isFinite(n));
}

/**
 * Prefer service role so RLS cannot hide `profiles.role`. Falls back to anon client if key missing.
 * `userId` must be `auth.users.id` (same as `profiles.id`).
 * Used from root `proxy.ts` (admin gate) and anywhere else that needs the same role resolution.
 */
export async function fetchProfileRoleForMiddleware(
  userId: string,
  anonSupabase: SupabaseClient
): Promise<ProfileRoleResult> {
  const a = await fetchProfileAccessForMiddleware(userId, anonSupabase);
  return { role: a.role, usedServiceRole: a.usedServiceRole, errorMessage: a.errorMessage };
}

/**
 * Prefer service role so RLS cannot hide `profiles.role` / `profiles.assigned_state_ids`.
 * Falls back to anon client if key missing.
 */
export async function fetchProfileAccessForMiddleware(
  userId: string,
  anonSupabase: SupabaseClient
): Promise<ProfileAccessResult> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();

  const emptyAccess = (): ProfileAccessResult => ({
    role: null,
    assigned_state_ids: [],
    assigned_group_ids: [],
    assigned_party_ids: [],
    assigned_loksabha_ids: [],
    assigned_assembly_ids: [],
    usedServiceRole: false,
    errorMessage: 'NEXT_PUBLIC_SUPABASE_URL missing',
  });

  if (!url) {
    return emptyAccess();
  }

  if (serviceKey) {
    const admin = createClient(url, serviceKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const selectFull =
      'role, assigned_state_ids, assigned_group_ids, assigned_party_ids, assigned_loksabha_ids, assigned_assembly_ids';
    const selectNoConstituency =
      'role, assigned_state_ids, assigned_group_ids, assigned_party_ids';
    const selectNoParties = 'role, assigned_state_ids, assigned_group_ids';
    const selectNoGroups = 'role, assigned_state_ids';
    const selectRoleOnly = 'role';

    const fetchRow = async (cols: string) =>
      admin.from('profiles').select(cols).eq('id', userId).single();

    const downgrade = (err: { message?: string } | null, token: string) => {
      const msg = String(err?.message ?? '').toLowerCase();
      return msg.includes(token) && (msg.includes('does not exist') || msg.includes('schema cache'));
    };

    let cols = selectFull;
    let { data, error } = await fetchRow(cols);
    if (error && downgrade(error, 'assigned_assembly_ids')) {
      cols = selectNoConstituency;
      ({ data, error } = await fetchRow(cols));
    }
    if (error && downgrade(error, 'assigned_loksabha_ids')) {
      cols = selectNoConstituency;
      ({ data, error } = await fetchRow(cols));
    }
    if (error && downgrade(error, 'assigned_party_ids')) {
      cols = selectNoParties;
      ({ data, error } = await fetchRow(cols));
    }
    if (error && downgrade(error, 'assigned_group_ids')) {
      cols = selectNoGroups;
      ({ data, error } = await fetchRow(cols));
    }
    if (error && downgrade(error, 'assigned_state_ids')) {
      cols = selectRoleOnly;
      ({ data, error } = await fetchRow(cols));
    }

    if (error || data == null) {
      return {
        ...emptyAccess(),
        usedServiceRole: true,
        errorMessage: error?.message ?? 'no row (service role)',
      };
    }

    return parseProfileAccessRow(data, true);
  }

  const fetchAnon = async (cols: string) =>
    anonSupabase.from('profiles').select(cols).eq('id', userId).single();

  const downgrade = (err: { message?: string } | null, token: string) => {
    const msg = String(err?.message ?? '').toLowerCase();
    return msg.includes(token) && (msg.includes('does not exist') || msg.includes('schema cache'));
  };

  let cols =
    'role, assigned_state_ids, assigned_group_ids, assigned_party_ids, assigned_loksabha_ids, assigned_assembly_ids';
  let { data, error } = await fetchAnon(cols);
  if (error && downgrade(error, 'assigned_assembly_ids')) {
    cols = 'role, assigned_state_ids, assigned_group_ids, assigned_party_ids';
    ({ data, error } = await fetchAnon(cols));
  }
  if (error && downgrade(error, 'assigned_loksabha_ids')) {
    cols = 'role, assigned_state_ids, assigned_group_ids, assigned_party_ids';
    ({ data, error } = await fetchAnon(cols));
  }
  if (error && downgrade(error, 'assigned_party_ids')) {
    cols = 'role, assigned_state_ids, assigned_group_ids';
    ({ data, error } = await fetchAnon(cols));
  }
  if (error && downgrade(error, 'assigned_group_ids')) {
    cols = 'role, assigned_state_ids';
    ({ data, error } = await fetchAnon(cols));
  }

  if (error || data == null) {
    if (__DEV__ && error?.code !== 'PGRST116') {
      console.warn('[proxy] profiles.role fetch (anon):', error?.message ?? 'no row');
    }
    return {
      ...emptyAccess(),
      errorMessage: 'SUPABASE_SERVICE_ROLE_KEY not set; used anon (RLS may block)',
    };
  }

  return {
    ...parseProfileAccessRow(data, false),
    errorMessage: 'SUPABASE_SERVICE_ROLE_KEY not set; used anon (RLS may block)',
  };
}

function parseProfileAccessRow(
  data: Record<string, unknown>,
  usedServiceRole: boolean
): ProfileAccessResult {
  const r = data.role;
  const role = typeof r === 'string' ? r.trim() : r != null ? String(r).trim() : null;
  const assigned_state_ids = toNumArr(data.assigned_state_ids);
  const assigned_group_ids = Array.isArray(data.assigned_group_ids)
    ? data.assigned_group_ids.map((x) => String(x ?? '').trim()).filter(Boolean)
    : [];
  const assigned_party_ids = toPartySlugArr(data.assigned_party_ids);
  const assigned_loksabha_ids = toNumArr(data.assigned_loksabha_ids);
  const assigned_assembly_ids = toNumArr(data.assigned_assembly_ids);
  return {
    role,
    assigned_state_ids,
    assigned_group_ids,
    assigned_party_ids,
    assigned_loksabha_ids,
    assigned_assembly_ids,
    usedServiceRole,
  };
}

/** Canonical admin check — only `profiles.role = 'admin'`. */
export function isAdminRole(role: string | null): boolean {
  return isAdmin(role);
}

export function isModeratorRole(role: string | null): boolean {
  return role != null && role.toLowerCase() === 'moderator';
}

export function isCampaignManagerRole(role: string | null): boolean {
  return role != null && role.toLowerCase() === 'campaign_manager';
}

export function isSuperAdminRole(role: string | null): boolean {
  return role != null && role.toLowerCase() === 'super_admin';
}

export function isEditorRole(role: string | null): boolean {
  return role != null && role.toLowerCase() === 'editor';
}

export function isWorkerRole(role: string | null): boolean {
  return role != null && role.toLowerCase() === 'worker';
}

export function isUserRole(role: string | null): boolean {
  return role != null && role.toLowerCase() === 'user';
}
