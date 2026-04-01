export const runtime = 'nodejs';

function unauthorized() {
  return new Response(JSON.stringify({ ok: false, error: 'Unauthorized' }), {
    status: 401,
    headers: { 'content-type': 'application/json' },
  });
}

export async function GET(req: Request) {
  const auth = req.headers.get('authorization') || req.headers.get('Authorization') || '';
  const secret = (process.env.CRON_SECRET || '').trim();
  const expected = secret ? `Bearer ${secret}` : '';

  if (!secret) {
    return new Response(JSON.stringify({ ok: false, error: 'CRON_SECRET not configured' }), {
      status: 500,
      headers: { 'content-type': 'application/json' },
    });
  }

  if (!auth || auth !== expected) return unauthorized();

  return new Response(JSON.stringify({ ok: true, status: 'success' }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}

