export const runtime = 'nodejs';

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

export async function POST() {
  // Minimal stub for build/deploy. (No dummy data.)
  return json({ ok: true });
}

