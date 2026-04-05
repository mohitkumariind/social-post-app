import type { SupabaseClient } from '@supabase/supabase-js';
import { createServerClient, type CookieOptions } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';

export type CookieToSet = { name: string; value: string; options?: CookieOptions };

/**
 * Supabase SSR client for middleware. Mutates `response` when auth refreshes cookies.
 */
export function createSupabaseMiddlewareClient(request: NextRequest) {
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

/** Fresh role from DB (not JWT claims). */
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
    if (process.env.NODE_ENV === 'development' && error?.code !== 'PGRST116') {
      console.warn('[middleware] profiles.role fetch:', error?.message ?? 'no row');
    }
    return null;
  }

  const r = (data as { role?: unknown }).role;
  return typeof r === 'string' ? r.trim() : r != null ? String(r).trim() : null;
}

export function isAdminRole(role: string | null): boolean {
  return role != null && role.toLowerCase() === 'admin';
}
