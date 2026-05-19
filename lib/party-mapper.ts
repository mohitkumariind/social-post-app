import { normalizePartyId, PARTIES_DATA, type Party } from '../constants/Parties';

/** Minimal party row shape used across mobile + admin. */
export type PartyLike = Pick<Party, 'id' | 'shortName' | 'fullName'> & { numericId?: number | null };

export type PartyDBPayload = {
  party: string | null;
  party_id: number | null;
};

export type PartyUIPayload = PartyDBPayload & {
  /** Slug preferred for UI selection (`party.id`); never a numeric string when avoidable. */
  selection: string;
};

type PartyDbRow = { id: string | number; name?: string; logo_url?: string | null };

/** True when value looks like a numeric id (e.g. "7"), not a slug. */
export function isNumeric(value: unknown): boolean {
  const s = String(value ?? '').trim();
  return !!s && /^\d+$/.test(s);
}

function matchStaticByName(name: string): Party | undefined {
  const n = name.trim().toLowerCase();
  if (!n) return undefined;
  return PARTIES_DATA.find(
    (p) =>
      p.id.toLowerCase() === n ||
      p.shortName.toLowerCase() === n ||
      p.fullName.toLowerCase() === n
  );
}

function slugFromRow(row: PartyLike, parties: PartyLike[]): string {
  if (!isNumeric(row.id)) {
    const byId = normalizePartyId(row.id, parties as Party[]);
    if (byId && !isNumeric(byId)) return byId;
  }
  const byShort = normalizePartyId(row.shortName ?? '', parties as Party[]);
  if (byShort && !isNumeric(byShort)) return byShort;
  const byFull = normalizePartyId(row.fullName ?? '', parties as Party[]);
  if (byFull && !isNumeric(byFull)) return byFull;
  return '';
}

function findPartyRow(selection: string, parties: PartyLike[]): PartyLike | undefined {
  const sel = selection.trim();
  if (!sel) return undefined;
  const lower = sel.toLowerCase();
  return parties.find((p) => {
    if (String(p.id).trim().toLowerCase() === lower) return true;
    if (String(p.id).trim() === sel) return true;
    if (p.numericId != null && String(p.numericId) === sel) return true;
    if (p.shortName?.trim().toLowerCase() === lower) return true;
    if (p.fullName?.trim().toLowerCase() === lower) return true;
    return false;
  });
}

function resolveNumericId(row: PartyLike | undefined, selection: string): number | null {
  if (row?.numericId != null && Number.isFinite(row.numericId)) {
    return row.numericId;
  }
  if (isNumeric(selection)) {
    const n = Number(selection);
    return Number.isFinite(n) ? n : null;
  }
  if (row && isNumeric(row.id)) {
    const n = Number(row.id);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

/**
 * Normalize any party object from Supabase `parties` rows or in-app static list.
 * Always returns slug `id` + optional `numericId`; never a numeric string in `id`.
 */
export function normalizeParty(raw: unknown, parties: PartyLike[] = PARTIES_DATA): PartyLike | null {
  if (raw == null) return null;

  const list = parties.length > 0 ? parties : PARTIES_DATA;

  if (typeof raw === 'object') {
    const o = raw as Record<string, unknown>;
    const rawId = o.id != null ? String(o.id).trim() : '';
    const name = String(o.name ?? o.fullName ?? '').trim();
    const shortName = String(o.shortName ?? '').trim();
    const fullName = name || String(o.fullName ?? '').trim();
    const existingNumeric =
      typeof o.numericId === 'number' && Number.isFinite(o.numericId) ? o.numericId : null;

    if (rawId && fullName && !o.name && !o.shortName && (o.fullName == null || o.fullName === '')) {
      const dbRow: PartyDbRow = { id: o.id as string | number, name: fullName };
      return normalizeParty(dbRow, list);
    }

    if (rawId) {
      if (isNumeric(rawId)) {
        const numericId = Number(rawId);
        const staticMatch = matchStaticByName(fullName) ?? matchStaticByName(rawId);
        const slug =
          staticMatch?.id ??
          (normalizePartyId(fullName, list as Party[]) &&
          !isNumeric(normalizePartyId(fullName, list as Party[]))
            ? normalizePartyId(fullName, list as Party[])
            : '');
        if (!slug || isNumeric(slug)) return null;
        return {
          id: slug,
          numericId: Number.isFinite(numericId) ? numericId : existingNumeric,
          shortName: shortName || staticMatch?.shortName || slug.toUpperCase(),
          fullName: fullName || staticMatch?.fullName || slug,
        };
      }

      const slug = normalizePartyId(rawId, list as Party[]) || rawId.toLowerCase();
      if (!slug || isNumeric(slug)) return null;
      const staticMatch = matchStaticByName(slug) ?? matchStaticByName(fullName);
      return {
        id: slug,
        numericId: existingNumeric,
        shortName: shortName || staticMatch?.shortName || slug.toUpperCase(),
        fullName: fullName || staticMatch?.fullName || slug,
      };
    }
  }

  return null;
}

/** Normalize a list of Supabase `parties` rows into canonical in-app party objects. */
export function normalizePartyList(rows: PartyDbRow[]): PartyLike[] {
  const out: PartyLike[] = [];
  for (const r of rows) {
    const n = normalizeParty(r, PARTIES_DATA);
    if (n) out.push(n);
  }
  return out;
}

function payloadFromRow(row: PartyLike, parties: PartyLike[]): PartyDBPayload {
  const party_id = resolveNumericId(row, String(row.numericId ?? row.id));
  let party: string | null = null;
  if (!isNumeric(row.id)) {
    party = normalizePartyId(row.id, parties as Party[]) || row.id.toLowerCase();
  } else {
    party = slugFromRow(row, parties) || null;
  }
  if (!party || isNumeric(party)) return { party: null, party_id: null };
  return { party, party_id };
}

/**
 * Convert UI selection into `profiles` party columns.
 * On mapping failure returns `{ party: null, party_id: null }` (never writes bad data).
 */
export function toPartyDB(selectedId: string, parties: PartyLike[] = PARTIES_DATA): PartyDBPayload {
  const sel = String(selectedId ?? '').trim();
  if (!sel) return { party: null, party_id: null };

  const list = parties.length > 0 ? parties : PARTIES_DATA;
  let row = findPartyRow(sel, list);

  if (!row && !isNumeric(sel)) {
    const slug = normalizePartyId(sel, list as Party[]);
    if (slug && !isNumeric(slug)) row = findPartyRow(slug, list);
  }

  if (!row) return { party: null, party_id: null };

  return payloadFromRow(row, list);
}

/**
 * Parse stored profile row into canonical DB fields + UI selection id (slug preferred).
 */
export function fromPartyDB(
  row: { party?: unknown; party_id?: unknown },
  parties: PartyLike[] = PARTIES_DATA
): PartyUIPayload {
  const list = parties.length > 0 ? parties : PARTIES_DATA;

  let party_id: number | null = null;
  const partyIdRaw = row.party_id;
  if (typeof partyIdRaw === 'number' && Number.isFinite(partyIdRaw)) {
    party_id = partyIdRaw;
  } else if (partyIdRaw != null && String(partyIdRaw).trim() !== '') {
    const n = Number(partyIdRaw);
    if (Number.isFinite(n)) party_id = n;
  }

  const partyRaw = String(row.party ?? '').trim();
  let party: string | null = null;
  let selection = '';

  if (partyRaw && !isNumeric(partyRaw)) {
    party = normalizePartyId(partyRaw, list as Party[]) || partyRaw.toLowerCase();
    if (isNumeric(party)) {
      return { party: null, party_id: null, selection: '' };
    }
    selection = party;
  } else if (partyRaw && isNumeric(partyRaw)) {
    if (party_id == null) party_id = Number(partyRaw);
    const rowById = findPartyRow(partyRaw, list);
    if (!rowById) return { party: null, party_id: null, selection: '' };
    const mapped = payloadFromRow(rowById, list);
    party = mapped.party;
    if (party_id == null) party_id = mapped.party_id;
    selection = party ?? '';
  } else if (party_id != null) {
    const rowByNum = list.find(
      (p) => p.numericId === party_id || (isNumeric(p.id) && Number(p.id) === party_id)
    );
    if (!rowByNum) return { party: null, party_id: null, selection: '' };
    const mapped = payloadFromRow(rowByNum, list);
    party = mapped.party;
    selection = party ?? '';
  }

  if (party && isNumeric(party)) {
    return { party: null, party_id: null, selection: '' };
  }

  return { party, party_id, selection };
}
