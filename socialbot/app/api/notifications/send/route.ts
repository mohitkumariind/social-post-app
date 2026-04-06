import Expo from 'expo-server-sdk';
import { createServiceRoleClient, validateAdminSession } from '@/lib/admin-gate';
import { runBroadcast, type BroadcastPayload } from '@/lib/broadcast-send';
import { createSupabaseServerClient } from '@/lib/supabase/server';

export const runtime = 'nodejs';

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
  });
}

/**
 * Admin broadcast: preview (counts) or send via Expo Push API (expo-server-sdk).
 * Tokens come from `public.push_tokens` (Expo tokens from the mobile app — not profiles.expo_push_token).
 */
export async function POST(request: Request) {
  let payload: BroadcastPayload;
  try {
    payload = (await request.json()) as BroadcastPayload;
  } catch {
    return json({ error: 'Invalid JSON body' }, 400);
  }

  const supabase = await createSupabaseServerClient();
  const auth = await validateAdminSession(supabase);
  if (!auth.ok) {
    return json(
      { error: auth.status === 401 ? 'Unauthorized' : 'Forbidden' },
      auth.status
    );
  }

  const admin = createServiceRoleClient();
  if (!admin) {
    return json({ error: 'SUPABASE_SERVICE_ROLE_KEY not configured' }, 503);
  }

  const accessToken = process.env.EXPO_ACCESS_TOKEN?.trim();
  const expo = new Expo(accessToken ? { accessToken } : undefined);

  try {
    const result = await runBroadcast(admin, expo, payload);
    if (!result.ok) {
      const status = result.error.includes('required') ? 400 : 500;
      return json(
        {
          error: result.error,
          ...(result.broadcast_id ? { broadcast_id: result.broadcast_id } : {}),
          ...(result.detail ? { detail: result.detail } : {}),
        },
        status
      );
    }
    return json(result);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return json({ error: msg }, 500);
  }
}
