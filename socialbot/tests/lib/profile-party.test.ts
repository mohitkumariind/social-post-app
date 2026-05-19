import { describe, expect, it } from 'vitest';
import { buildProfilePartyFields, isNumericPartyToken, parseProfilePartyFromRow } from '@/lib/profile-party';
import { PARTIES_DATA } from '@/lib/constants';

describe('profile-party mapping', () => {
  it('maps slug selection to party slug without numeric party column', () => {
    const out = buildProfilePartyFields('bjp', PARTIES_DATA);
    expect(out.party).toBe('bjp');
    expect(out.party_id).toBeNull();
  });

  it('maps numeric parties-table id to party_id and slug party', () => {
    const parties = [{ id: 'bsp', shortName: 'BSP', fullName: 'Bahujan Samaj Party', numericId: 7 }];
    const out = buildProfilePartyFields('bsp', parties);
    expect(out.party_id).toBe(7);
    expect(out.party).toBe('bsp');
    expect(isNumericPartyToken(out.party)).toBe(false);
  });

  it('maps legacy numeric selection string using party row numericId', () => {
    const parties = [{ id: 'bsp', shortName: 'BSP', fullName: 'Bahujan Samaj Party', numericId: 7 }];
    const out = buildProfilePartyFields('7', parties);
    expect(out.party_id).toBe(7);
    expect(out.party).toBe('bsp');
  });

  it('does not read party_id as party slug on load', () => {
    const parsed = parseProfilePartyFromRow({ party: null, party_id: 7 }, [
      { id: 'bsp', shortName: 'BSP', fullName: 'Bahujan Samaj Party', numericId: 7 },
    ]);
    expect(parsed.party).toBe('bsp');
    expect(parsed.party_id).toBe(7);
  });

  it('repairs legacy numeric party column on read', () => {
    const parsed = parseProfilePartyFromRow({ party: '7', party_id: null }, [
      { id: 'bsp', shortName: 'BSP', fullName: 'Bahujan Samaj Party', numericId: 7 },
    ]);
    expect(parsed.party).toBe('bsp');
    expect(parsed.party_id).toBe(7);
  });
});
