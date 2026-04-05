import { type NextRequest } from 'next/server';
import {
  createSupabaseMiddlewareClient,
  fetchProfileRole,
  isAdminRole,
  redirectPreservingAuthCookies,
} from '@/lib/supabase/session-helpers';

export async function middleware(request: NextRequest) {
  const { supabase, getSessionResponse } = createSupabaseMiddlewareClient(request);

  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  if (authError && process.env.NODE_ENV === 'development') {
    console.warn('[middleware] getUser:', authError.message);
  }

  const pathname = request.nextUrl.pathname;
  const isAuthCallback = pathname.startsWith('/auth/callback');
  const isAdminLogin = pathname === '/admin/login' || pathname.startsWith('/admin/login/');
  const isAdminSection = pathname.startsWith('/admin');

  const sessionResponse = getSessionResponse();

  if (isAuthCallback) {
    return sessionResponse;
  }

  if (isAdminLogin) {
    if (user) {
      const role = await fetchProfileRole(supabase, user.id);
      if (isAdminRole(role)) {
        return redirectPreservingAuthCookies(request, sessionResponse, '/admin');
      }
    }
    return sessionResponse;
  }

  if (isAdminSection) {
    if (!user) {
      const u = new URL('/admin/login', request.url);
      u.searchParams.set('next', pathname);
      return redirectPreservingAuthCookies(request, sessionResponse, u.pathname + u.search);
    }

    const role = await fetchProfileRole(supabase, user.id);
    if (!isAdminRole(role)) {
      return redirectPreservingAuthCookies(request, sessionResponse, '/admin/login?error=forbidden');
    }
  }

  return sessionResponse;
}

export const config = {
  matcher: ['/admin/:path*', '/auth/callback'],
};
