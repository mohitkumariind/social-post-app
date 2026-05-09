import { validateCronRequest } from '@/lib/cron-auth';
export const runtime = 'nodejs';

function unauthorized(status: number, error: string) {
  return new Response(JSON.stringify({ ok: false, error }), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

export async function GET(req: Request) {
  const cronAuth = validateCronRequest(req);
  if (!cronAuth.ok) return unauthorized(cronAuth.status, cronAuth.error);

  return new Response(JSON.stringify({ ok: true, status: 'success' }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}

