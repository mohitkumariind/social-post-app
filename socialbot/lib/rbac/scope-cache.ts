import { normalizeScope } from '@/lib/rbac/normalize-scope';
import type { CanonicalScope } from '@/lib/rbac/scope-types';
import type { RbacActor } from '@/lib/rbac/permission-engine';

type CacheEntry = { scope: CanonicalScope; at: number };

const CACHE_TTL_MS = 60_000;
const cache = new Map<string, CacheEntry>();

function stableSortedNums(ids: number[]): number[] {
  return [...ids].sort((a, b) => a - b);
}

function stableSortedStrs(ids: string[]): string[] {
  return [...ids].map(String).sort();
}

/** Deterministic cache key from actor identity + assignments. */
export function normalizedScopeCacheKey(
  actor: Pick<
    RbacActor,
    | 'id'
    | 'role'
    | 'assigned_state_ids'
    | 'assigned_group_ids'
    | 'assigned_party_ids'
    | 'assigned_loksabha_ids'
    | 'assigned_assembly_ids'
    | 'effective_group_ids'
  >
): string {
  return JSON.stringify({
    id: String(actor.id ?? '').trim(),
    role: String(actor.role ?? '').trim(),
    states: stableSortedNums(actor.assigned_state_ids ?? []),
    groups: stableSortedStrs(actor.assigned_group_ids ?? []),
    effGroups: stableSortedStrs(actor.effective_group_ids ?? []),
    parties: stableSortedStrs(actor.assigned_party_ids ?? []),
    lok: stableSortedNums(actor.assigned_loksabha_ids ?? []),
    asm: stableSortedNums(actor.assigned_assembly_ids ?? []),
  });
}

/**
 * Memoized {@link normalizeScope} for hot paths (visibility, analytics, uploads).
 */
export function getCachedNormalizedScope(
  actor: Pick<
    RbacActor,
    | 'id'
    | 'role'
    | 'assigned_state_ids'
    | 'assigned_group_ids'
    | 'assigned_party_ids'
    | 'assigned_loksabha_ids'
    | 'assigned_assembly_ids'
    | 'effective_group_ids'
  >
): CanonicalScope {
  const key = normalizedScopeCacheKey(actor);
  const now = Date.now();
  const hit = cache.get(key);
  if (hit && now - hit.at < CACHE_TTL_MS) return hit.scope;

  const scope = normalizeScope(actor);
  cache.set(key, { scope, at: now });

  if (cache.size > 500) {
    const cutoff = now - CACHE_TTL_MS;
    for (const [k, v] of cache) {
      if (v.at < cutoff) cache.delete(k);
    }
  }

  return scope;
}

export function invalidateNormalizedScopeCache(actorId?: string): void {
  if (!actorId) {
    cache.clear();
    return;
  }
  const prefix = `"id":"${String(actorId).trim()}"`;
  for (const k of cache.keys()) {
    if (k.includes(prefix)) cache.delete(k);
  }
}
