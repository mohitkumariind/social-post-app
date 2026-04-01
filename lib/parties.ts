import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase } from './supabase';
import { type Party, PARTIES_DATA } from '../constants/Parties';

type PartyDbRow = { id: string; name: string; logo_url: string | null };

const PARTIES_CACHE_KEY = '@parties_cache_v1';

function normalizePartyList(rows: PartyDbRow[]): Party[] {
  const fallbackById = new Map(PARTIES_DATA.map((p) => [p.id, p]));
  return rows
    .map((r) => {
      const id = String(r.id ?? '').trim().toLowerCase();
      const name = String(r.name ?? '').trim();
      if (!id || !name) return null;
      const fb = fallbackById.get(id);
      return {
        id,
        shortName: fb?.shortName || id.toUpperCase(),
        fullName: name,
      } satisfies Party;
    })
    .filter((x): x is Party => !!x);
}

export async function loadCachedParties(): Promise<Party[] | null> {
  try {
    const raw = await AsyncStorage.getItem(PARTIES_CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return null;
    const list = parsed
      .map((p: any) => ({
        id: String(p?.id ?? '').trim(),
        shortName: String(p?.shortName ?? '').trim(),
        fullName: String(p?.fullName ?? '').trim(),
      }))
      .filter((p: Party) => p.id && p.fullName);
    return list.length > 0 ? list : null;
  } catch {
    return null;
  }
}

export async function saveCachedParties(list: Party[]): Promise<void> {
  try {
    await AsyncStorage.setItem(PARTIES_CACHE_KEY, JSON.stringify(list));
  } catch {
    // ignore
  }
}

export async function fetchPartiesFromSupabase(): Promise<Party[] | null> {
  try {
    const { data, error } = await supabase.from('parties').select('id,name,logo_url').order('name', { ascending: true });
    if (error) return null;
    const rows = (data || []) as PartyDbRow[];
    const mapped = normalizePartyList(rows);
    if (mapped.length === 0) return null;
    await saveCachedParties(mapped);
    return mapped;
  } catch {
    return null;
  }
}

/**
 * Best-effort parties getter:
 * - returns cached list if present (fast, offline)
 * - otherwise returns fallback static list
 * - triggers a background refresh if possible
 */
export async function getPartiesSafe(): Promise<Party[]> {
  const cached = await loadCachedParties();
  if (cached && cached.length > 0) {
    // refresh in background (do not block UI)
    void fetchPartiesFromSupabase();
    return cached;
  }
  const fresh = await fetchPartiesFromSupabase();
  return fresh && fresh.length > 0 ? fresh : PARTIES_DATA;
}

