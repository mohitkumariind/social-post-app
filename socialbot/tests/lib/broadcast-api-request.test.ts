import { describe, expect, it } from 'vitest';
import { BROADCAST_EVENT_CAMPAIGN_REQUIRES_EVENT_MSG } from '@/lib/broadcast-send';
import { normalizeBroadcastIncomingRequest } from '@/lib/broadcast-api-request';

describe('normalizeBroadcastIncomingRequest', () => {
  it('maps v2 event mode with UUID to event_campaign payload', () => {
    const eid = '11111111-1111-4111-8111-111111111111';
    const r = normalizeBroadcastIncomingRequest({
      title: 'T',
      message: 'M',
      broadcast_mode: 'event',
      event_id: eid,
      audience_filters: { all_workers: false, party: null, state: 'Punjab', loksabha_id: null, assembly_id: null },
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.payload.body).toBe('M');
    expect(r.payload.event_id).toBe(eid);
    expect((r.payload.data as { type: string }).type).toBe('event_campaign');
  });

  it('rejects v2 event mode without event_id', () => {
    const r = normalizeBroadcastIncomingRequest({
      title: 'T',
      message: 'M',
      broadcast_mode: 'event',
      audience_filters: { all_workers: true },
    });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).toBe(BROADCAST_EVENT_CAMPAIGN_REQUIRES_EVENT_MSG);
  });

  it('rejects v2 global with non-null event_id', () => {
    const r = normalizeBroadcastIncomingRequest({
      title: 'T',
      message: 'M',
      broadcast_mode: 'global',
      event_id: '11111111-1111-4111-8111-111111111111',
      audience_filters: { all_workers: true },
    });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).toContain('global');
  });

  it('accepts legacy BroadcastPayload', () => {
    const r = normalizeBroadcastIncomingRequest({
      title: 'T',
      body: 'B',
      all_workers: true,
      data: { type: 'broadcast' },
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.payload.body).toBe('B');
  });
});
