import type { SupabaseClient } from '@supabase/supabase-js';

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function asUuidOrNull(v: unknown): string | null {
  const s = String(v ?? '').trim();
  return UUID_RE.test(s) ? s : null;
}

/**
 * Links posts to events for analytics: prefer explicit `event_id`, else match `category` to `events.name`.
 */
export async function resolvePostEventId(
  admin: SupabaseClient,
  payload: { event_id?: unknown; category?: unknown }
): Promise<string | null> {
  const explicit = asUuidOrNull(payload.event_id);
  if (explicit) return explicit;

  const cat = String(payload.category ?? '').trim();
  if (!cat) return null;

  const { data, error } = await admin.from('events').select('id').eq('name', cat).limit(1).maybeSingle();
  if (error || !data) return null;
  return asUuidOrNull((data as { id?: unknown }).id);
}
