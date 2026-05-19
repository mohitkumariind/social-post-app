import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase } from './supabase';
import { type Party, PARTIES_DATA } from '../constants/Parties';
import { isNumeric, normalizePartyList } from './party-mapper';

type PartyDbRow = { id: string | number; name: string; logo_url: string | null };

const PARTIES_CACHE_KEY = '@parties_cache_v1';

/** Merge numeric ids from a fresh Supabase fetch into an in-memory party list (e.g. static fallback). */
export function mergePartyNumericIds(target: Party[], fresh: Party[]): Party[] {
  if (fresh.length === 0) return target;
  const bySlug = new Map(fresh.map((p) => [p.id.toLowerCase(), p]));
  return target.map((p) => {
    const hit = bySlug.get(p.id.toLowerCase());
    if (!hit?.numericId) return p;
    return { ...p, numericId: hit.numericId };
  });
}

export async function loadCachedParties(): Promise<Party[] | null> {
  try {
    const raw = await AsyncStorage.getItem(PARTIES_CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return null;
    const list = parsed
      .map((p: Party) => ({
        id: String(p?.id ?? '').trim(),
        shortName: String(p?.shortName ?? '').trim(),
        fullName: String(p?.fullName ?? '').trim(),
        numericId:
          typeof p?.numericId === 'number' && Number.isFinite(p.numericId) ? p.numericId : null,
      }))
      .filter((p: Party) => p.id && p.fullName && !isNumeric(p.id));
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
    const mapped = normalizePartyList(rows) as Party[];
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
    void fetchPartiesFromSupabase();
    return cached;
  }
  const fresh = await fetchPartiesFromSupabase();
  if (fresh && fresh.length > 0) return fresh;
  return PARTIES_DATA.map((p) => ({ ...p, numericId: null }));
}
