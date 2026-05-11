import { type NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import { isAdminEmailBypass } from '@/lib/admin-gate';
import {
  createSupabaseProxyClient,
  fetchProfileAccessForMiddleware,
  isAdminRole,
  isCampaignManagerRole,
  isModeratorRole,
  redirectPreservingAuthCookies,
} from '@/lib/supabase/session-helpers';
import {
  logEdgeSecurityEvent,
  requireAdminApiRequest,
  requireCronRequest,
} from '@/lib/edge-security';

const proxyDebug = process.env.NODE_ENV === 'development';
const proxyLog = (...args: Parameters<typeof console.log>) => {
  if (proxyDebug) console.log(...args);
};

function jsonPreservingAuthCookies(
  sessionResponse: NextResponse,
  body: Record<string, unknown>,
  status: number
): NextResponse {
  const response = NextResponse.json(body, { status });
  sessionResponse.cookies.getAll().forEach((cookie) => {
    response.cookies.set(cookie.name, cookie.value);
  });
  return response;
}

/**
 * Next.js 16+: root `proxy.ts` replaces deprecated `middleware.ts` (same matcher + cookie flow).
 * Supabase uses `createServerClient` from `@supabase/ssr` via `createSupabaseProxyClient` — correct for this boundary.
 */
export async function proxy(request: NextRequest) {
  const pathname = request.nextUrl.pathname;
  const method = request.method;
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
  // Legacy admin endpoint kept outside /api/admin namespace for backward compatibility.
  const isLegacyAdminApi = pathname === '/api/notifications/send';
  const isAdminApi = pathname === '/api/admin' || pathname.startsWith('/api/admin/') || isLegacyAdminApi;
  const isJobsApi = pathname === '/api/jobs' || pathname.startsWith('/api/jobs/');
  const isCronApi = pathname === '/api/cron' || pathname.startsWith('/api/cron/');
  const isProtectedAdminSurface = isAdminSection || isAdminApi;

  if (isAuthCallback) {
    proxyLog('[proxy] Step: auth callback passthrough');
    return sessionResponse;
  }

  if (isJobsApi || isCronApi) {
    const cronGate = requireCronRequest(request);
    if (!cronGate.ok) {
      logEdgeSecurityEvent(request, {
        event: isJobsApi ? 'job_api_rejected' : 'cron_api_rejected',
        layer: 'edge',
        pathname,
        method,
        status: cronGate.status,
        reason: cronGate.reason,
      });
      return jsonPreservingAuthCookies(sessionResponse, { error: cronGate.error }, cronGate.status);
    }
    proxyLog('[proxy] Step: cron/jobs auth accepted', { pathname });
    return sessionResponse;
  }

  const isBypassEmail = isAdminEmailBypass(user?.email);

  if (user && isBypassEmail) {
    proxyLog('[proxy] Step BYPASS: non-production ADMIN_EMAIL_BYPASS', { email: user.email });
    if (isAdminLogin) {
      proxyLog('[proxy] Step BYPASS: redirect /admin');
      return redirectPreservingAuthCookies(request, sessionResponse, '/admin');
    }
    if (isAdminSection) {
      proxyLog('[proxy] Step BYPASS: NextResponse.next (session cookies preserved)');
      return sessionResponse;
    }
    if (isAdminApi) {
      proxyLog('[proxy] Step BYPASS: allow /api/admin');
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

  if (isProtectedAdminSurface) {
    if (!user) {
      if (isAdminApi) {
        proxyLog('[proxy] Step: unauthenticated /api/admin/* → 401');
        logEdgeSecurityEvent(request, {
          event: 'admin_api_rejected',
          layer: 'edge',
          pathname,
          method,
          status: 401,
          reason: 'missing-auth-session',
        });
        return jsonPreservingAuthCookies(sessionResponse, { error: 'Unauthorized' }, 401);
      }
      proxyLog('[proxy] Step: unauthenticated admin route → login');
      const u = new URL('/admin/login', request.url);
      u.searchParams.set('next', pathname);
      return redirectPreservingAuthCookies(request, sessionResponse, u.pathname + u.search);
    }

    /**
     * Defense-in-depth gate:
     * - Route-level `validateAdminSession()` remains mandatory.
     * - This edge gate blocks unauthorized traffic to `/admin/*` and `/api/admin/*`
     *   before handler execution, reducing blast radius for future route mistakes.
     * - On role/session parsing failures we fail closed.
     */
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

    const adminApiGate = requireAdminApiRequest({
      hasSessionUser: Boolean(user),
      isAdmin,
      isModerator,
      isCampaignManager,
    });
    if (!adminApiGate.ok && isAdminApi) {
      proxyLog('[proxy] Step 4: FORBIDDEN /api/admin/*', { errorMessage, reason: adminApiGate.reason });
      logEdgeSecurityEvent(request, {
        event: 'admin_api_rejected',
        layer: 'edge',
        pathname,
        method,
        status: adminApiGate.status,
        reason: adminApiGate.reason,
        userId: user?.id ?? null,
        role: role ?? null,
      });
      return jsonPreservingAuthCookies(sessionResponse, { error: adminApiGate.error }, adminApiGate.status);
    }

    if (!isAdmin && !isModerator && !isCampaignManager) {
      if (isAdminApi) {
        proxyLog('[proxy] Step 4: FORBIDDEN /api/admin/* → 403', { errorMessage });
        return jsonPreservingAuthCookies(sessionResponse, { error: 'Forbidden' }, 403);
      }
      proxyLog('[proxy] Step 4: FORBIDDEN → /admin/login?error=forbidden');
      return redirectPreservingAuthCookies(request, sessionResponse, '/admin/login?error=forbidden');
    }

    // API routes are role-gated here; fine-grained RBAC remains in route handlers.
    if (!isAdminApi && isModerator) {
      const allowed =
        pathname === '/admin' ||
        pathname.startsWith('/admin/users') ||
        pathname.startsWith('/admin/leaderboard') ||
        pathname.startsWith('/admin/analytics') ||
        pathname.startsWith('/admin/events') ||
        pathname.startsWith('/admin/notifications') ||
        pathname.startsWith('/admin/groups');
      if (!allowed) {
        proxyLog('[proxy] Step 4: moderator blocked route', { pathname });
        return redirectPreservingAuthCookies(request, sessionResponse, '/admin');
      }
    }

    if (!isAdminApi && isCampaignManager) {
      const allowed =
        pathname === '/admin' ||
        pathname.startsWith('/admin/users') ||
        pathname.startsWith('/admin/leaderboard') ||
        pathname.startsWith('/admin/analytics') ||
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
  /**
   * Layered security matcher:
   * - /admin/* + /api/admin/*: session + role gate at edge, then route-level validation and RBAC.
   * - /api/jobs/* + /api/cron/*: cron secret gate at edge, then route-level cron checks.
   * - /api/notifications/send: legacy privileged endpoint kept explicitly protected.
   */
  matcher: [
    '/admin/:path*',
    '/api/admin/:path*',
    '/api/jobs/:path*',
    '/api/cron/:path*',
    '/api/notifications/send',
    '/auth/callback',
  ],
};
