import { describe, expect, it } from 'vitest';
import { PARTIES_DATA } from '@/lib/constants';
import {
  partiesVisibleToEditor,
  partySelectionWithoutAllOption,
} from '@/lib/admin/editor-party-scope';

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

describe('partySelectionWithoutAllOption', () => {
  it('keeps ALL when admin global option is allowed', () => {
    expect(partySelectionWithoutAllOption(['ALL'], PARTIES_DATA, true)).toEqual(['ALL']);
  });

  it('removes ALL and falls back to visible parties for scoped roles', () => {
    const visible = partiesVisibleToEditor(PARTIES_DATA, ['aap']);
    expect(partySelectionWithoutAllOption(['ALL'], visible, false)).toEqual(['aap']);
  });

  it('preserves specific party selections for scoped roles', () => {
    const visible = partiesVisibleToEditor(PARTIES_DATA, ['aap', 'bjp']);
    expect(partySelectionWithoutAllOption(['aap'], visible, false)).toEqual(['aap']);
  });
});
