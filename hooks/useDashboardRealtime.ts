import { useEffect, useRef, useState } from 'react';
import { supabase } from '../lib/supabase';

const REALTIME_DEBOUNCE_MS = 450;

/**
 * Subscribes to posts/events changes with debounced invalidation to avoid refetch storms.
 * Returns a monotonic version — bump after debounce; use as an effect dependency to refetch feeds.
 */
export function useDashboardRealtime(opts: { enabled: boolean }) {
  const { enabled } = opts;
  const channelRef = useRef<ReturnType<typeof supabase.channel> | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [version, setVersion] = useState(0);

  useEffect(() => {
    if (!enabled) return;

    const scheduleBump = () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(() => {
        debounceRef.current = null;
        setVersion((v) => v + 1);
      }, REALTIME_DEBOUNCE_MS);
    };

    if (channelRef.current) {
      try {
        supabase.removeChannel(channelRef.current);
      } catch {
        /* ignore */
      }
      channelRef.current = null;
    }

    const channelName = `realtime-dash-${Date.now()}-${Math.random().toString(16).slice(2)}`;
    const channel = supabase
      .channel(channelName)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'events' }, scheduleBump)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'posts' }, scheduleBump)
      .subscribe();
    channelRef.current = channel;

    return () => {
      if (debounceRef.current) {
        clearTimeout(debounceRef.current);
        debounceRef.current = null;
      }
      const ch = channelRef.current;
      channelRef.current = null;
      if (ch) {
        try {
          supabase.removeChannel(ch);
        } catch {
          /* ignore */
        }
      }
    };
  }, [enabled]);

  return version;
}
