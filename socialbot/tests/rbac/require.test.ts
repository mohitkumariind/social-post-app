import { describe, expect, it } from 'vitest';
import {
  normalizeGroupId,
  parseGroupIds,
  parseStateIds,
  requireCampaignManagerHasAssignedGroups,
  requireScopeState,
  RbacError,
} from '@/lib/rbac/require';

describe('rbac require helpers', () => {
  it('normalizes group IDs to canonical numeric strings', () => {
    expect(normalizeGroupId('01')).toBe('1');
    expect(normalizeGroupId(10)).toBe('10');
    expect(normalizeGroupId('abc')).toBeNull();
  });

  it('marks malformed group arrays while preserving valid canonical IDs', () => {
    const parsed = parseGroupIds(['01', '2', 'bad']);
    expect(parsed.ids).toEqual(['1', '2']);
    expect(parsed.malformed).toBe(true);
  });

  it('enforces subset-only state scope semantics', () => {
    expect(() => requireScopeState([1, 2], [1, 2, 3], 'subset')).not.toThrow();
    expect(() => requireScopeState([1, 5], [1, 2, 3], 'subset')).toThrow(RbacError);
  });

  it('requires campaign manager group assignments', () => {
    expect(() =>
      requireCampaignManagerHasAssignedGroups({
        role: 'campaign_manager',
        assigned_group_ids: ['1', '2'],
      })
    ).not.toThrow();

    expect(() =>
      requireCampaignManagerHasAssignedGroups({
        role: 'campaign_manager',
        assigned_group_ids: [],
      })
    ).toThrow(RbacError);
  });

  it('normalizes and validates state ID arrays', () => {
    const parsed = parseStateIds(['01', 2, 'x']);
    expect(parsed.ids).toEqual([1, 2]);
    expect(parsed.malformed).toBe(true);
  });
});
