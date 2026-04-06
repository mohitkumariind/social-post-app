import { type NextRequest } from 'next/server';
import { ADMIN_EMAIL_BYPASS } from '@/lib/admin-gate';

const mwDebug = process.env.NODE_ENV === 'development';
const mwLog = (...args: Parameters<typeof console.log>) => {
  if (mwDebug) console.log(...args);
};
import {
  createSupabaseMiddlewareClient,
  fetchProfileRoleForMiddleware,
  isAdminRole,
  redirectPreservingAuthCookies,
} from '@/lib/supabase/session-helpers';

export async function middleware(request: NextRequest) {
  const pathname = request.nextUrl.pathname;
  mwLog('[middleware] Step 0: enter', { pathname });

  const { supabase, getSessionResponse } = createSupabaseMiddlewareClient(request);
  const sessionResponse = getSessionResponse();

  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  if (authError) {
    mwLog('[middleware] Step 1: getUser error', authError.message);
  } else if (user) {
    mwLog('[middleware] Step 1: Session found', {
      userId: user.id,
      userIdLength: user.id?.length,
      email: user.email ?? '(no email)',
    });
  } else {
    mwLog('[middleware] Step 1: No session (user null)');
  }

  const isAuthCallback = pathname.startsWith('/auth/callback');
  const isAdminLogin = pathname === '/admin/login' || pathname.startsWith('/admin/login/');
  const isAdminSection = pathname.startsWith('/admin');

  if (isAuthCallback) {
    mwLog('[middleware] Step: auth callback passthrough');
    return sessionResponse;
  }

  const emailLower = user?.email?.toLowerCase() ?? '';
  const isBypassEmail = emailLower === ADMIN_EMAIL_BYPASS.toLowerCase();

  if (user && isBypassEmail) {
    mwLog('[middleware] Step BYPASS: allowlisted email', { email: user.email });
    if (isAdminLogin) {
      mwLog('[middleware] Step BYPASS: redirect /admin');
      return redirectPreservingAuthCookies(request, sessionResponse, '/admin');
    }
    if (isAdminSection) {
      mwLog('[middleware] Step BYPASS: NextResponse.next (session cookies preserved)');
      return sessionResponse;
    }
  }

  if (isAdminLogin) {
    if (user) {
      mwLog('[middleware] Step 2 (login): fetch role for userId', user.id);
      const { role, usedServiceRole, errorMessage } = await fetchProfileRoleForMiddleware(
        user.id,
        supabase
      );
      mwLog('[middleware] Step 3 (login): Role fetched', {
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
      mwLog('[middleware] Step: unauthenticated admin route → login');
      const u = new URL('/admin/login', request.url);
      u.searchParams.set('next', pathname);
      return redirectPreservingAuthCookies(request, sessionResponse, u.pathname + u.search);
    }

    mwLog('[middleware] Step 2 (gate): fetch role for profile id === auth id', user.id);
    const { role, usedServiceRole, errorMessage } = await fetchProfileRoleForMiddleware(
      user.id,
      supabase
    );
    mwLog('[middleware] Step 3 (gate): Role fetched', {
      role,
      usedServiceRole,
      errorMessage,
      isAdmin: isAdminRole(role),
    });

    if (!isAdminRole(role)) {
      mwLog('[middleware] Step 4: FORBIDDEN → /admin/login?error=forbidden');
      return redirectPreservingAuthCookies(request, sessionResponse, '/admin/login?error=forbidden');
    }

    mwLog('[middleware] Step 4: OK allow admin');
  }

  return sessionResponse;
}

export const config = {
  matcher: ['/admin/:path*', '/auth/callback'],
};
