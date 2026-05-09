import { describe, expect, it } from 'vitest';
import { API_DEFAULT_LIMIT, API_MAX_LIMIT, clampLimit } from '@/lib/perf-defaults';

describe('clampLimit', () => {
  it('uses fallback when limit query param is missing (null)', () => {
    expect(clampLimit(null, API_DEFAULT_LIMIT, API_MAX_LIMIT)).toBe(API_DEFAULT_LIMIT);
  });

  it('uses fallback for empty string', () => {
    expect(clampLimit('', API_DEFAULT_LIMIT, API_MAX_LIMIT)).toBe(API_DEFAULT_LIMIT);
    expect(clampLimit('   ', API_DEFAULT_LIMIT, API_MAX_LIMIT)).toBe(API_DEFAULT_LIMIT);
  });

  it('clamps numeric strings', () => {
    expect(clampLimit('10', API_DEFAULT_LIMIT, API_MAX_LIMIT)).toBe(10);
    expect(clampLimit('999', API_DEFAULT_LIMIT, API_MAX_LIMIT)).toBe(API_MAX_LIMIT);
    expect(clampLimit('0', API_DEFAULT_LIMIT, API_MAX_LIMIT)).toBe(1);
  });
});
