/**
 * Single source of truth for political parties.
 * Order and list as specified.
 */
export interface Party {
  id: string;
  shortName: string;
  fullName: string;
}

/**
 * Fallback list (offline-safe).
 * The app now prefers Supabase `parties` table (cached in AsyncStorage),
 * but this remains as a safe default to prevent crashes without internet.
 */
export const PARTIES_DATA: Party[] = [
  { id: 'bjp', shortName: 'BJP', fullName: 'Bharatiya Janata Party' },
  { id: 'inc', shortName: 'INC', fullName: 'Indian National Congress' },
  { id: 'aap', shortName: 'AAP', fullName: 'Aam Aadmi Party' },
  { id: 'bsp', shortName: 'BSP', fullName: 'Bahujan Samaj Party' },
  { id: 'sp', shortName: 'SP', fullName: 'Samajwadi Party' },
  { id: 'sad', shortName: 'SAD', fullName: 'Shiromani Akali Dal' },
  { id: 'aimim', shortName: 'AIMIM', fullName: 'All India Majlis-e-Ittehadul Muslimeen' },
  { id: 'asp', shortName: 'ASP', fullName: 'Azad Samaj Party - Kanshi Ram' },
  { id: 'sad-wpd', shortName: 'SAD-WPD', fullName: 'Shiromani Akali Dal - Waris Punjab De' },
  { id: 'shs-e', shortName: 'SHS-E', fullName: 'Shiv Sena - Eknath Shinde' },
  { id: 'shs-u', shortName: 'SHS-U', fullName: 'Shiv Sena - Uddhav Balasaheb Thackeray' },
  { id: 'ncp-a', shortName: 'NCP-A', fullName: 'Nationalist Congress Party - Ajit Pawar' },
  { id: 'ncp-s', shortName: 'NCP-S', fullName: 'Nationalist Congress Party - Sharadchandra Pawar' },
  { id: 'jdu', shortName: 'JD(U)', fullName: 'Janata Dal - United' },
  { id: 'rjd', shortName: 'RJD', fullName: 'Rashtriya Janata Dal' },
  { id: 'jmm', shortName: 'JMM', fullName: 'Jharkhand Mukti Morcha' },
  { id: 'rld', shortName: 'RLD', fullName: 'Rashtriya Lok Dal' },
  { id: 'ljp', shortName: 'LJP', fullName: 'Lok Janshakti Party - Ram Vilas' },
  { id: 'sbsp', shortName: 'SBSP', fullName: 'Suheldev Bharatiya Samaj Party' },
  { id: 'ad-s', shortName: 'AD(S)', fullName: 'Apna Dal - Sonelal' },
  { id: 'nishad_party', shortName: 'Nishad Party', fullName: 'Nirbal Indian Shoshit Hamara Aam Dal' },
  { id: 'jdl', shortName: 'JDL', fullName: 'Jansatta Dal Loktantrik' },
  { id: 'rlm', shortName: 'RLM', fullName: 'Rashtriya Lok Morcha' },
  { id: 'ham', shortName: 'HAM', fullName: 'Hindustani Awam Morcha - Secular' },
  { id: 'vip', shortName: 'VIP', fullName: 'Vikassheel Insaan Party' },
  { id: 'mns', shortName: 'MNS', fullName: 'Maharashtra Navnirman Sena' },
  { id: 'vba', shortName: 'VBA', fullName: 'Vanchit Bahujan Aghadi' },
  { id: 'rlp', shortName: 'RLP', fullName: 'Rashtriya Loktantrik Party' },
  { id: 'bap', shortName: 'BAP', fullName: 'Bharat Adivasi Party' },
  { id: 'inld', shortName: 'INLD', fullName: 'Indian National Lok Dal' },
  { id: 'jjp', shortName: 'JJP', fullName: 'Jannayak Janta Party' },
  { id: 'ajsu', shortName: 'AJSU', fullName: 'All Jharkhand Students Union' },
  { id: 'other', shortName: 'Other', fullName: 'Other' },
];

/** Canonical id for the catch-all / unspecified party option */
export const PARTY_OTHER_ID = 'other';

export const PARTIES_FIRST_8 = PARTIES_DATA.slice(0, 8);
export const PARTIES_MORE = PARTIES_DATA.slice(8);

/** Canonical party id for DB / filters (handles legacy shortName / fullName / casing). */
export function normalizePartyId(raw: string, parties?: Party[]): string {
  const s = (raw ?? '').trim();
  if (!s) return '';
  const lower = s.toLowerCase();
  const list = parties && parties.length > 0 ? parties : PARTIES_DATA;
  const p = list.find(
    (x) =>
      x.id === s ||
      x.id === lower ||
      x.shortName.toLowerCase() === lower ||
      x.fullName.toLowerCase() === lower
  );
  return p ? p.id : s;
}

/** Short label for UI (e.g. "Other", "BJP"). Unknown ids returned as-is. */
export function getPartyLabel(partyId: string, parties?: Party[]): string {
  const id = normalizePartyId(partyId, parties);
  if (!id) return '';
  const list = parties && parties.length > 0 ? parties : PARTIES_DATA;
  const p = list.find((x) => x.id === id);
  return p ? p.shortName : partyId.trim();
}

export function isPartyOtherId(partyId: string, parties?: Party[]): boolean {
  return normalizePartyId(partyId, parties) === PARTY_OTHER_ID;
}
