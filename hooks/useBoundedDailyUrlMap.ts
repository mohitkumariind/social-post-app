import { useCallback, useEffect, useRef, useState } from 'react';
import { downloadMediaToCache } from '../lib/mediaCache';

const DEFAULT_MAX_ENTRIES = 64;

/**
 * Bounded local URI map for daily graphics URLs (LRU-style eviction by insertion order).
 */
export function useBoundedDailyUrlMap(maxEntries = DEFAULT_MAX_ENTRIES) {
  const [dailyLocalByUrl, setDailyLocalByUrl] = useState<Record<string, string>>({});
  const dailyLocalRef = useRef<Record<string, string>>({});
  const dailyInFlightRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    dailyLocalRef.current = dailyLocalByUrl;
  }, [dailyLocalByUrl]);

  const ensureDailyCached = useCallback(
    async (url: string) => {
      const u = String(url ?? '').trim();
      if (!u) return;
      if (dailyLocalRef.current[u]) return;
      if (dailyInFlightRef.current.has(u)) return;

      dailyInFlightRef.current.add(u);
      try {
        const local = await downloadMediaToCache({ kind: 'daily', url: u });
        if (!local) return;
        setDailyLocalByUrl((prev) => {
          if (prev[u]) return prev;
          const next = { ...prev, [u]: local };
          const keys = Object.keys(next);
          if (keys.length <= maxEntries) return next;
          const overflow = keys.length - maxEntries;
          const trimmed = { ...next };
          for (let i = 0; i < overflow; i++) {
            delete trimmed[keys[i]];
          }
          return trimmed;
        });
      } finally {
        dailyInFlightRef.current.delete(u);
      }
    },
    [maxEntries]
  );

  return { dailyLocalByUrl, ensureDailyCached };
}
