import { supabase } from '../lib/supabase';
import { gfxLogCapped } from '../utils/dashboardDebug';
import { canUserSeeContent } from '../utils/visibility';
import { isEventActiveNow } from '../utils/lifecycle';

export type DashboardEventRow = {
  name: string;
  start: string;
  end: string;
  state_id?: number[] | number | null;
  loksabha_id?: number[] | number | null;
  assembly_id?: number[] | number | null;
  party_id?: number[] | number | null;
  group_id?: number[] | number | null;
  profile_ids?: string[] | string | null;
};

export type FetchEventsResult = { rows: DashboardEventRow[]; error: string | null; usedRpc: boolean };

function rpcMissingFunction(err: unknown): boolean {
  const msg = String((err as { message?: string })?.message ?? '');
  const code = String((err as { code?: string })?.code ?? '');
  return (
    code === '42883' ||
    msg.includes('does not exist') ||
    msg.includes('Could not find the function') ||
    msg.includes('schema cache')
  );
}

function applySecondaryEventFilter(
  rows: DashboardEventRow[],
  userSnapshot: Record<string, unknown>,
  profileLoaded: boolean
): DashboardEventRow[] {
  const nowUtcMs = Date.now();
  const kept: DashboardEventRow[] = [];
  for (const ev of rows) {
    if (!canUserSeeContent(userSnapshot, ev as Record<string, unknown>, profileLoaded)) continue;
    if (!isEventActiveNow(ev, nowUtcMs)) continue;
    kept.push(ev);
  }
  if (__DEV__ && kept.length !== rows.length) {
    gfxLogCapped('rpcEventsSecondaryStrip', { raw: rows.length, kept: kept.length }, 4);
  }
  return kept;
}

/**
 * Dashboard events: server-enforced via `get_dashboard_events` RPC + RLS.
 * Never falls back to broad `events` table SELECT.
 */
export async function fetchDashboardEvents(opts: {
  profileLoaded: boolean;
  userSnapshot: Record<string, unknown>;
  eventsSchemaOk: boolean | null;
  onEventsSchemaMissing?: () => void;
}): Promise<FetchEventsResult> {
  if (opts.eventsSchemaOk === false) {
    return { rows: [], error: null, usedRpc: true };
  }

  let rpc = await supabase.rpc('get_dashboard_events');
  if (rpc.error && rpcMissingFunction(rpc.error)) {
    rpc = await supabase.rpc('get_dashboard_events_for_reader');
  }

  if (rpc.error) {
    const msg = String(rpc.error.message ?? 'Failed to load events');
    if (msg.includes('does not exist') && opts.onEventsSchemaMissing) {
      opts.onEventsSchemaMissing();
    }
    return { rows: [], error: msg, usedRpc: true };
  }

  if (!Array.isArray(rpc.data)) {
    return { rows: [], error: 'Invalid response from get_dashboard_events', usedRpc: true };
  }

  const rows = rpc.data as DashboardEventRow[];
  const filtered = applySecondaryEventFilter(rows, opts.userSnapshot, opts.profileLoaded);
  return { rows: filtered, error: null, usedRpc: true };
}
