import { type NextRequest } from 'next/server';

type SecurityEvent = {
  event: string;
  layer: 'edge';
  pathname: string;
  method: string;
  status: number;
  reason: string;
  userId?: string | null;
  role?: string | null;
  ip?: string | null;
  userAgent?: string | null;
};

function clientIp(request: NextRequest): string | null {
  const hdr = request.headers.get('x-forwarded-for')?.trim() ?? '';
  if (!hdr) return null;
  const first = hdr.split(',')[0]?.trim() ?? '';
  return first || null;
}

/**
 * Structured edge security logs support centralized monitoring and triage.
 * These are intentionally concise and machine-parsable for observability pipelines.
 */
export function logEdgeSecurityEvent(request: NextRequest, evt: Omit<SecurityEvent, 'ip' | 'userAgent'>) {
  const payload: SecurityEvent = {
    ...evt,
    ip: clientIp(request),
    userAgent: request.headers.get('user-agent'),
  };
  console.warn('[security.edge]', JSON.stringify(payload));
}

export function requireCronRequest(
  request: NextRequest
): { ok: true } | { ok: false; status: number; error: string; reason: string } {
  const secret = process.env.CRON_SECRET?.trim() ?? '';
  if (!secret) {
    return {
      ok: false,
      status: 503,
      error: 'CRON_SECRET not configured',
      reason: 'missing-server-cron-secret',
    };
  }

  const xCron = request.headers.get('x-cron-secret')?.trim() ?? '';
  const auth = request.headers.get('authorization')?.trim() ?? '';
  const bearer = auth.toLowerCase().startsWith('bearer ') ? auth.slice(7).trim() : '';

  if (xCron === secret || bearer === secret) {
    return { ok: true };
  }

  return {
    ok: false,
    status: 401,
    error: 'Unauthorized',
    reason: xCron || bearer ? 'invalid-cron-secret' : 'missing-cron-auth-header',
  };
}

export function requireAdminApiRequest(input: {
  hasSessionUser: boolean;
  isAdmin: boolean;
  isModerator: boolean;
  isCampaignManager: boolean;
}): { ok: true } | { ok: false; status: number; error: string; reason: string } {
  if (!input.hasSessionUser) {
    return { ok: false, status: 401, error: 'Unauthorized', reason: 'missing-auth-session' };
  }
  if (!input.isAdmin && !input.isModerator && !input.isCampaignManager) {
    return { ok: false, status: 403, error: 'Forbidden', reason: 'role-not-allowed' };
  }
  return { ok: true };
}
