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
  if (auth.role === 'moderator' && auth.assigned_state_ids.length === 0) {
    return json({ error: 'Moderator is missing assigned_state_ids' }, 403);
  }

  const admin = createServiceRoleClient();
  if (!admin) {
    return json({ error: 'SUPABASE_SERVICE_ROLE_KEY not configured' }, 503);
  }

  const accessToken = process.env.EXPO_ACCESS_TOKEN?.trim();
  const expo = new Expo(accessToken ? { accessToken } : undefined);

  try {
    // Enforce moderator: only assigned state users, regardless of provided filters.
    if (auth.role === 'moderator') {
      payload = {
        ...payload,
        all_workers: false,
        filters: {
          ...(payload.filters ?? {}),
          assigned_state_ids: auth.assigned_state_ids,
        } as any,
      };
    }

    if (auth.role === 'campaign_manager') {
      // Campaign manager: groups-only targeting (owned groups).
      payload = {
        ...payload,
        all_workers: false,
        filters: {
          group_ids: [],
        } as any,
      };

      const { data: groups, error: gErr } = await admin.from('groups').select('id').eq('created_by', auth.user.id);
      if (gErr) return json({ error: gErr.message }, 500);
      const groupIds = (groups ?? []).map((g: any) => Number(g.id)).filter((n) => Number.isFinite(n));
      if (groupIds.length === 0) return json({ error: 'Forbidden: no owned groups to target' }, 403);

      (payload.filters as any).group_ids = groupIds;
    }

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
