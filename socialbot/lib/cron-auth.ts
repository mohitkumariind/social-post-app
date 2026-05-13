import crypto from 'node:crypto';

function timingSafeEqualUtf8(a: string, b: string): boolean {
  const ba = Buffer.from(a, 'utf8');
  const bb = Buffer.from(b, 'utf8');
  if (ba.length !== bb.length) return false;
  return crypto.timingSafeEqual(ba, bb);
}

/** When `1` or `true`, only `x-cron-secret` is accepted (Bearer disabled). Default: Bearer allowed for backward compatibility. */
function cronBearerAuthDisabled(): boolean {
  const v = (process.env.CRON_DISABLE_BEARER_AUTH ?? '').trim().toLowerCase();
  return v === '1' || v === 'true' || v === 'yes';
}

export function validateCronRequest(request: Request): { ok: true } | { ok: false; status: number; error: string } {
  const secret = process.env.CRON_SECRET?.trim() ?? '';
  if (!secret) {
    return { ok: false, status: 503, error: 'CRON_SECRET not configured' };
  }

  const xCron = request.headers.get('x-cron-secret')?.trim() ?? '';
  const auth = request.headers.get('authorization')?.trim() ?? request.headers.get('Authorization')?.trim() ?? '';
  const bearer = auth.toLowerCase().startsWith('bearer ') ? auth.slice(7).trim() : '';

  const xOk = xCron.length > 0 && timingSafeEqualUtf8(xCron, secret);
  const bearerOk =
    !cronBearerAuthDisabled() && bearer.length > 0 && timingSafeEqualUtf8(bearer, secret);

  if (xOk || bearerOk) {
    return { ok: true };
  }

  return { ok: false, status: 401, error: 'Unauthorized' };
}
