import { describe, expect, it } from 'vitest';
import {
  isBroadcastSelectableEventRow,
  isBroadcastSelectableEventStatus,
} from '@/lib/broadcast-event-eligibility';

describe('broadcast event eligibility', () => {
  it('accepts workflow-active statuses', () => {
    expect(isBroadcastSelectableEventStatus('published')).toBe(true);
    expect(isBroadcastSelectableEventStatus('scheduled_publish')).toBe(true);
    expect(isBroadcastSelectableEventStatus('processing_publish')).toBe(true);
  });

  it('rejects inactive statuses', () => {
    expect(isBroadcastSelectableEventStatus('archived')).toBe(false);
    expect(isBroadcastSelectableEventStatus('scheduled_publish_failed')).toBe(false);
  });

  it('skips soft-deleted rows', () => {
    expect(isBroadcastSelectableEventRow({ status: 'published', deleted_at: '2026-01-01' })).toBe(false);
    expect(isBroadcastSelectableEventRow({ status: 'published', deleted_at: null })).toBe(true);
  });
});
