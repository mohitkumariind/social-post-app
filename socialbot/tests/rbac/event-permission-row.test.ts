import { describe, expect, it } from 'vitest';
import { eventRowForPermissions } from '@/lib/admin/event-permission-row';

describe('eventRowForPermissions', () => {
  it('maps party_id separately from party slugs', () => {
    const row = eventRowForPermissions({
      id: '1',
      party: ['bjp'],
      party_id: [42],
    });
    expect(row.party).toEqual(['bjp']);
    expect(row.party_id).toEqual([42]);
  });
});
