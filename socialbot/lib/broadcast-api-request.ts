import type { BroadcastFilterLabels, BroadcastFilters, BroadcastPayload } from '@/lib/broadcast-send';
import {
  BROADCAST_EVENT_CAMPAIGN_REQUIRES_EVENT_MSG,
  NOTIFICATION_DATA_TYPE_EVENT_CAMPAIGN,
  optionalEventIdFromPayload,
} from '@/lib/broadcast-send';

export type BroadcastApiBroadcastMode = 'event' | 'global';

/** Canonical HTTP body for `POST /api/notifications/send` (v2). Legacy `BroadcastPayload` is still accepted. */
export type BroadcastApiRequestV2 = {
  preview_only?: boolean;
  title?: string;
  message?: string;
  broadcast_mode: BroadcastApiBroadcastMode;
  /** Required when `broadcast_mode` is `event` (UUID). Must be null/absent when `broadcast_mode` is `global`. */
  event_id?: string | null;
  audience_filters: Record<string, unknown>;
  image_url?: string | null;
  filter_labels?: BroadcastFilterLabels;
  target_user_ids?: string[] | null;
  /** Extra push keys merged under `data` after `type` / `event_id` sanitation. */
  data?: Record<string, unknown> | null;
};

function isRecord(x: unknown): x is Record<string, unknown> {
  return x != null && typeof x === 'object' && !Array.isArray(x);
}

function isV2BroadcastRequest(b: Record<string, unknown>): boolean {
  const m = b.broadcast_mode;
  return (
    (m === 'event' || m === 'global') &&
    b.audience_filters != null &&
    typeof b.audience_filters === 'object' &&
    !Array.isArray(b.audience_filters)
  );
}

function toNumArrayOrNull(v: unknown): number[] | null {
  if (!Array.isArray(v)) return null;
  const out = v.map((x) => Number(x)).filter((n) => Number.isFinite(n));
  return out.length ? out : null;
}

function audienceRecordToFilters(af: Record<string, unknown>): BroadcastFilters {
  return {
    party: typeof af.party === 'string' && af.party.trim() ? af.party : null,
    state: typeof af.state === 'string' && af.state.trim() ? af.state : null,
    loksabha_id: af.loksabha_id != null && String(af.loksabha_id).trim() !== '' ? Number(af.loksabha_id) : null,
    assembly_id: af.assembly_id != null && String(af.assembly_id).trim() !== '' ? Number(af.assembly_id) : null,
    assigned_state_ids: toNumArrayOrNull(af.assigned_state_ids),
    group_ids: toNumArrayOrNull(af.group_ids),
  };
}

function v2ToBroadcastPayload(
  b: Record<string, unknown>
): { ok: true; payload: BroadcastPayload } | { ok: false; error: string } {
  const mode = String(b.broadcast_mode).trim() as BroadcastApiBroadcastMode;
  if (mode !== 'event' && mode !== 'global') return { ok: false, error: 'Invalid broadcast_mode' };

  const previewOnly = b.preview_only === true;
  const title = typeof b.title === 'string' ? b.title : '';
  const message = typeof b.message === 'string' ? b.message : '';

  if (!previewOnly && (!title.trim() || !message.trim())) {
    return { ok: false, error: 'title and message are required unless preview_only is true' };
  }

  const af = b.audience_filters as Record<string, unknown>;
  const all_workers = typeof af.all_workers === 'boolean' ? af.all_workers : true;

  const nestedLabels = af.filter_labels;
  const filter_labels =
    (isRecord(b.filter_labels) ? (b.filter_labels as BroadcastFilterLabels) : null) ??
    (isRecord(nestedLabels) ? (nestedLabels as BroadcastFilterLabels) : undefined);

  const filters = audienceRecordToFilters(af);

  let event_id: string | null = null;
  if (mode === 'event') {
    const parsed = optionalEventIdFromPayload({ event_id: b.event_id } as BroadcastPayload);
    if (parsed == null) return { ok: false, error: BROADCAST_EVENT_CAMPAIGN_REQUIRES_EVENT_MSG };
    event_id = parsed;
  } else {
    const raw = b.event_id;
    if (raw != null && String(raw).trim() !== '') {
      return { ok: false, error: 'event_id must be null or omitted when broadcast_mode is global' };
    }
    event_id = null;
  }

  const extra =
    b.data != null && typeof b.data === 'object' && !Array.isArray(b.data)
      ? { ...(b.data as Record<string, unknown>) }
      : {};
  delete extra.type;
  delete extra.event_id;

  const data: Record<string, unknown> = {
    ...extra,
    type: mode === 'event' ? NOTIFICATION_DATA_TYPE_EVENT_CAMPAIGN : 'broadcast',
  };

  const image_url =
    b.image_url == null || String(b.image_url).trim() === ''
      ? null
      : typeof b.image_url === 'string'
        ? b.image_url.trim()
        : null;

  const rawTargets = b.target_user_ids;
  const target_user_ids = Array.isArray(rawTargets)
    ? [...new Set(rawTargets.map((x) => String(x ?? '').trim()).filter(Boolean))]
    : undefined;

  const payload: BroadcastPayload = {
    preview_only: previewOnly,
    title,
    body: message,
    image_url,
    all_workers,
    filters,
    filter_labels,
    data,
    event_id,
    ...(target_user_ids && target_user_ids.length > 0 ? { target_user_ids } : {}),
  };

  return { ok: true, payload };
}

export type NormalizeBroadcastIncomingResult =
  | { ok: true; payload: BroadcastPayload }
  | { ok: false; error: string; status?: number };

/**
 * Accepts **v2** `{ title, message, broadcast_mode, event_id?, audience_filters }` or a legacy {@link BroadcastPayload}.
 */
export function normalizeBroadcastIncomingRequest(raw: unknown): NormalizeBroadcastIncomingResult {
  if (!isRecord(raw)) return { ok: false, error: 'Invalid JSON body', status: 400 };

  if (isV2BroadcastRequest(raw)) {
    const step = v2ToBroadcastPayload(raw);
    if (!step.ok) return { ok: false, error: step.error, status: 400 };
    return { ok: true, payload: step.payload };
  }

  return { ok: true, payload: raw as BroadcastPayload };
}

/** True if body matches v2 broadcast send contract (for docs / clients). */
export function isBroadcastApiRequestV2(raw: unknown): raw is BroadcastApiRequestV2 {
  return isRecord(raw) && isV2BroadcastRequest(raw);
}
