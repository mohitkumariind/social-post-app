import { type NextRequest } from 'next/server';
import { ADMIN_EMAIL_BYPASS } from '@/lib/admin-gate';
import {
  createSupabaseMiddlewareClient,
  fetchProfileRoleForMiddleware,
  isAdminRole,
  redirectPreservingAuthCookies,
} from '@/lib/supabase/session-helpers';

export async function middleware(request: NextRequest) {
  const pathname = request.nextUrl.pathname;
  console.log('[middleware] Step 0: enter', { pathname });

  const { supabase, getSessionResponse } = createSupabaseMiddlewareClient(request);
  const sessionResponse = getSessionResponse();

  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  if (authError) {
    console.log('[middleware] Step 1: getUser error', authError.message);
  } else if (user) {
    console.log('[middleware] Step 1: Session found', {
      userId: user.id,
      userIdLength: user.id?.length,
      email: user.email ?? '(no email)',
    });
  } else {
    console.log('[middleware] Step 1: No session (user null)');
  }

  const isAuthCallback = pathname.startsWith('/auth/callback');
  const isAdminLogin = pathname === '/admin/login' || pathname.startsWith('/admin/login/');
  const isAdminSection = pathname.startsWith('/admin');

  if (isAuthCallback) {
    console.log('[middleware] Step: auth callback passthrough');
    return sessionResponse;
  }

  const emailLower = user?.email?.toLowerCase() ?? '';
  const isBypassEmail = emailLower === ADMIN_EMAIL_BYPASS.toLowerCase();

  if (user && isBypassEmail) {
    console.log('[middleware] Step BYPASS: allowlisted email', { email: user.email });
    if (isAdminLogin) {
      console.log('[middleware] Step BYPASS: redirect /admin');
      return redirectPreservingAuthCookies(request, sessionResponse, '/admin');
    }
    if (isAdminSection) {
      console.log('[middleware] Step BYPASS: NextResponse.next (session cookies preserved)');
      return sessionResponse;
    }
  }

  if (isAdminLogin) {
    if (user) {
      console.log('[middleware] Step 2 (login): fetch role for userId', user.id);
      const { role, usedServiceRole, errorMessage } = await fetchProfileRoleForMiddleware(
        user.id,
        supabase
      );
      console.log('[middleware] Step 3 (login): Role fetched', {
        role,
        usedServiceRole,
        errorMessage,
        isAdmin: isAdminRole(role),
      });
      if (isAdminRole(role)) {
        return redirectPreservingAuthCookies(request, sessionResponse, '/admin');
      }
    }
    return sessionResponse;
  }

  if (isAdminSection) {
    if (!user) {
      console.log('[middleware] Step: unauthenticated admin route → login');
      const u = new URL('/admin/login', request.url);
      u.searchParams.set('next', pathname);
      return redirectPreservingAuthCookies(request, sessionResponse, u.pathname + u.search);
    }

    console.log('[middleware] Step 2 (gate): fetch role for profile id === auth id', user.id);
    const { role, usedServiceRole, errorMessage } = await fetchProfileRoleForMiddleware(
      user.id,
      supabase
    );
    console.log('[middleware] Step 3 (gate): Role fetched', {
      role,
      usedServiceRole,
      errorMessage,
      isAdmin: isAdminRole(role),
    });

    if (!isAdminRole(role)) {
      console.log('[middleware] Step 4: FORBIDDEN → /admin/login?error=forbidden');
      return redirectPreservingAuthCookies(request, sessionResponse, '/admin/login?error=forbidden');
    }

    console.log('[middleware] Step 4: OK allow admin');
  }

  return sessionResponse;
}

export const config = {
  matcher: ['/admin/:path*', '/auth/callback'],
};
