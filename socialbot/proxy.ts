import { type NextRequest } from 'next/server';
import { ADMIN_EMAIL_BYPASS } from '@/lib/admin-gate';
import {
  createSupabaseProxyClient,
  fetchProfileAccessForMiddleware,
  isAdminRole,
  isCampaignManagerRole,
  isModeratorRole,
  redirectPreservingAuthCookies,
} from '@/lib/supabase/session-helpers';

const proxyDebug = process.env.NODE_ENV === 'development';
const proxyLog = (...args: Parameters<typeof console.log>) => {
  if (proxyDebug) console.log(...args);
};

/**
 * Next.js 16+: root `proxy.ts` replaces deprecated `middleware.ts` (same matcher + cookie flow).
 * Supabase uses `createServerClient` from `@supabase/ssr` via `createSupabaseProxyClient` — correct for this boundary.
 */
export async function proxy(request: NextRequest) {
  const pathname = request.nextUrl.pathname;
  proxyLog('[proxy] Step 0: enter', { pathname });

  const { supabase, getSessionResponse } = createSupabaseProxyClient(request);
  const sessionResponse = getSessionResponse();

  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  if (authError) {
    proxyLog('[proxy] Step 1: getUser error', authError.message);
  } else if (user) {
    proxyLog('[proxy] Step 1: Session found', {
      userId: user.id,
      userIdLength: user.id?.length,
      email: user.email ?? '(no email)',
    });
  } else {
    proxyLog('[proxy] Step 1: No session (user null)');
  }

  const isAuthCallback = pathname.startsWith('/auth/callback');
  const isAdminLogin = pathname === '/admin/login' || pathname.startsWith('/admin/login/');
  const isAdminSection = pathname.startsWith('/admin');

  if (isAuthCallback) {
    proxyLog('[proxy] Step: auth callback passthrough');
    return sessionResponse;
  }

  const emailLower = user?.email?.toLowerCase() ?? '';
  const isBypassEmail = emailLower === ADMIN_EMAIL_BYPASS.toLowerCase();

  if (user && isBypassEmail) {
    proxyLog('[proxy] Step BYPASS: allowlisted email', { email: user.email });
    if (isAdminLogin) {
      proxyLog('[proxy] Step BYPASS: redirect /admin');
      return redirectPreservingAuthCookies(request, sessionResponse, '/admin');
    }
    if (isAdminSection) {
      proxyLog('[proxy] Step BYPASS: NextResponse.next (session cookies preserved)');
      return sessionResponse;
    }
  }

  if (isAdminLogin) {
    if (user) {
      proxyLog('[proxy] Step 2 (login): fetch role for userId', user.id);
      const { role, usedServiceRole, errorMessage } = await fetchProfileAccessForMiddleware(
        user.id,
        supabase
      );
      proxyLog('[proxy] Step 3 (login): Role fetched', {
        role,
        usedServiceRole,
        errorMessage,
        isAdmin: isAdminRole(role),
      });
      if (isAdminRole(role) || isModeratorRole(role) || isCampaignManagerRole(role)) {
        return redirectPreservingAuthCookies(request, sessionResponse, '/admin');
      }
    }
    return sessionResponse;
  }

  if (isAdminSection) {
    if (!user) {
      proxyLog('[proxy] Step: unauthenticated admin route → login');
      const u = new URL('/admin/login', request.url);
      u.searchParams.set('next', pathname);
      return redirectPreservingAuthCookies(request, sessionResponse, u.pathname + u.search);
    }

    proxyLog('[proxy] Step 2 (gate): fetch role/access for profile id === auth id', user.id);
    const { role, usedServiceRole, errorMessage } = await fetchProfileAccessForMiddleware(
      user.id,
      supabase
    );
    proxyLog('[proxy] Step 3 (gate): Role fetched', {
      role,
      usedServiceRole,
      errorMessage,
      isAdmin: isAdminRole(role),
    });

    const isAdmin = isAdminRole(role);
    const isModerator = isModeratorRole(role);
    const isCampaignManager = isCampaignManagerRole(role);

    if (!isAdmin && !isModerator && !isCampaignManager) {
      proxyLog('[proxy] Step 4: FORBIDDEN → /admin/login?error=forbidden');
      return redirectPreservingAuthCookies(request, sessionResponse, '/admin/login?error=forbidden');
    }

    if (isModerator) {
      const allowed =
        pathname === '/admin' ||
        pathname.startsWith('/admin/users') ||
        pathname.startsWith('/admin/events') ||
        pathname.startsWith('/admin/notifications') ||
        pathname.startsWith('/admin/groups');
      if (!allowed) {
        proxyLog('[proxy] Step 4: moderator blocked route', { pathname });
        return redirectPreservingAuthCookies(request, sessionResponse, '/admin');
      }
    }

    if (isCampaignManager) {
      const allowed =
        pathname === '/admin' ||
        pathname.startsWith('/admin/users') ||
        pathname.startsWith('/admin/events') ||
        pathname.startsWith('/admin/notifications') ||
        pathname.startsWith('/admin/groups');
      if (!allowed) {
        proxyLog('[proxy] Step 4: campaign_manager blocked route', { pathname });
        return redirectPreservingAuthCookies(request, sessionResponse, '/admin');
      }
    }

    proxyLog('[proxy] Step 4: OK allow admin');
  }

  return sessionResponse;
}

export const config = {
  matcher: ['/admin/:path*', '/auth/callback'],
};
