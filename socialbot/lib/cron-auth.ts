export function validateCronRequest(request: Request): { ok: true } | { ok: false; status: number; error: string } {
  const secret = process.env.CRON_SECRET?.trim() ?? '';
  if (!secret) {
    return { ok: false, status: 503, error: 'CRON_SECRET not configured' };
  }

  const xCron = request.headers.get('x-cron-secret')?.trim() ?? '';
  const auth = request.headers.get('authorization')?.trim() ?? request.headers.get('Authorization')?.trim() ?? '';
  const bearer = auth.toLowerCase().startsWith('bearer ') ? auth.slice(7).trim() : '';

  if (xCron === secret || bearer === secret) {
    return { ok: true };
  }

  return { ok: false, status: 401, error: 'Unauthorized' };
}
