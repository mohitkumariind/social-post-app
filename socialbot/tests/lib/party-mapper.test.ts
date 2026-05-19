import { describe, expect, it } from 'vitest';
import { fromPartyDB, isNumeric, normalizeParty, toPartyDB } from '@/lib/party-mapper';
import { PARTIES_DATA } from '@/lib/constants';

describe('party-mapper', () => {
  it('isNumeric detects numeric tokens only', () => {
    expect(isNumeric('7')).toBe(true);
    expect(isNumeric('bjp')).toBe(false);
    expect(isNumeric('')).toBe(false);
  });

  it('normalizeParty maps numeric DB id to slug + numericId', () => {
    const row = normalizeParty({ id: 7, name: 'Bahujan Samaj Party' }, PARTIES_DATA);
    expect(row?.id).toBe('bsp');
    expect(row?.numericId).toBe(7);
  });

  it('toPartyDB maps slug selection to party slug without numeric party column', () => {
    const out = toPartyDB('bjp', PARTIES_DATA);
    expect(out.party).toBe('bjp');
    expect(out.party_id).toBeNull();
  });

  it('toPartyDB maps numeric selection via parties list', () => {
    const parties = [{ id: 'bsp', shortName: 'BSP', fullName: 'Bahujan Samaj Party', numericId: 7 }];
    const out = toPartyDB('7', parties);
    expect(out.party_id).toBe(7);
    expect(out.party).toBe('bsp');
    expect(isNumeric(out.party)).toBe(false);
  });

  it('toPartyDB returns nulls when mapping fails', () => {
    expect(toPartyDB('999', PARTIES_DATA)).toEqual({ party: null, party_id: null });
  });

  it('fromPartyDB repairs legacy numeric party column on read', () => {
    const parsed = fromPartyDB({ party: '7', party_id: null }, [
      { id: 'bsp', shortName: 'BSP', fullName: 'Bahujan Samaj Party', numericId: 7 },
    ]);
    expect(parsed.party).toBe('bsp');
    expect(parsed.party_id).toBe(7);
    expect(parsed.selection).toBe('bsp');
  });

  it('fromPartyDB does not expose numeric string as selection when unmapped', () => {
    const parsed = fromPartyDB({ party: '7', party_id: null }, PARTIES_DATA);
    expect(parsed.party).toBeNull();
    expect(parsed.selection).toBe('');
  });
});
