import { describe, expect, it } from 'vitest';
import { PARTIES_DATA } from '@/lib/constants';
import { partiesVisibleToEditor } from '@/lib/admin/editor-party-scope';

describe('partiesVisibleToEditor', () => {
  it('returns all parties when assigned_party_ids is empty', () => {
    expect(partiesVisibleToEditor(PARTIES_DATA, [])).toEqual(PARTIES_DATA);
  });

  it('returns only assigned party slugs when populated', () => {
    const visible = partiesVisibleToEditor(PARTIES_DATA, ['bjp', 'inc']);
    expect(visible.map((p) => p.id)).toEqual(['bjp', 'inc']);
  });

  it('normalizes assigned ids case-insensitively', () => {
    const visible = partiesVisibleToEditor(PARTIES_DATA, ['BJP']);
    expect(visible.map((p) => p.id)).toEqual(['bjp']);
  });
});
