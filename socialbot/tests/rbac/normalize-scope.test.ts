import { describe, expect, it } from 'vitest';
import {
  hasConstituencyAnchor,
  isGlobalTargeting,
  normalizeResourceScope,
  scopeDimensionWildcard,
} from '@/lib/rbac/normalize-scope';

describe('normalize-scope constituency wildcards', () => {
  it('treats all-loksabha as constituency anchor but not global targeting', () => {
    const scope = normalizeResourceScope({ loksabha_id: [0] });
    expect(hasConstituencyAnchor(scope)).toBe(true);
    expect(scopeDimensionWildcard(scope, 'loksabha')).toBe(true);
    expect(isGlobalTargeting(scope)).toBe(false);
  });

  it('still treats state wildcard as global targeting', () => {
    const scope = normalizeResourceScope({ state_id: [0] });
    expect(isGlobalTargeting(scope)).toBe(true);
  });
});
