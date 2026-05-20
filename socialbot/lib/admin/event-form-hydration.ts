import { fromPartyDB, type PartyLike } from '@/lib/party-mapper';

export type StateOption = { id: string | number; name: string };

/** Normalize party/state from DB: string | string[] -> string[] */
export function toStrArr(v: string | string[] | null | undefined): string[] {
  if (!v) return [];
  return Array.isArray(v) ? v : [v].filter(Boolean);
}

export function toNumArr(val: unknown): number[] {
  if (val == null || val === '' || (Array.isArray(val) && val.length === 0)) return [];
  if (val === 'ALL' || (Array.isArray(val) && (val as unknown[]).includes('ALL'))) return [0];
  const arr = Array.isArray(val) ? val : [val];
  return arr.map((id) => Number(id)).filter((n) => Number.isFinite(n));
}

export function resolveStateSelectionsFromEvent(
  row: Record<string, unknown>,
  states: StateOption[]
): string[] {
  const fromIds = toNumArr(row.state_id);
  if (fromIds.includes(0)) return ['ALL'];
  if (fromIds.length > 0) {
    return fromIds
      .map((n) => {
        const sid = String(n);
        const byId = states.find((s) => String(s.id) === sid);
        if (byId) return String(byId.id);
        return sid;
      })
      .filter(Boolean);
  }
  const legacy = toStrArr(row.state as string | string[] | undefined);
  if (legacy.length === 0) return [];
  if (legacy.length === 1 && legacy[0] === 'ALL') return ['ALL'];
  return legacy
    .map((v) => {
      const byId = states.find((s) => s.id === v || String(s.id) === v);
      if (byId) return String(byId.id);
      const byName = states.find((s) => s.name === v);
      return byName?.id != null ? String(byName.id) : v;
    })
    .filter(Boolean);
}

/**
 * @param forEditor — editors cannot use ALL/global party wildcard; empty DB party → no selection.
 */
export function resolvePartySelectionsFromEvent(
  row: Record<string, unknown>,
  parties: PartyLike[] = [],
  opts?: { forEditor?: boolean }
): string[] {
  const forEditor = opts?.forEditor === true;
  const fromIds = toNumArr(row.party_id);
  if (fromIds.includes(0)) return forEditor ? [] : ['ALL'];
  if (fromIds.length > 0) {
    const out: string[] = [];
    for (const n of fromIds) {
      const parsed = fromPartyDB({ party_id: n }, parties);
      if (parsed.selection) out.push(parsed.selection);
    }
    if (out.length > 0) return out;
  }
  const legacy = toStrArr(row.party as string | string[] | undefined);
  if (legacy.length === 0) return forEditor ? [] : ['ALL'];
  if (legacy.length === 1 && legacy[0] === 'ALL') return forEditor ? [] : ['ALL'];
  return legacy.map((v) => {
    const parsed = fromPartyDB({ party: v, party_id: null }, parties);
    return parsed.selection || String(v).trim();
  }).filter(Boolean);
}

export function resolveLoksabhaSelectionsFromEvent(
  row: Record<string, unknown>,
  opts?: { forEditor?: boolean }
): string[] {
  const forEditor = opts?.forEditor === true;
  const fromIds = toNumArr(row.loksabha_id);
  if (fromIds.includes(0)) return forEditor ? [] : ['ALL'];
  if (fromIds.length > 0) return fromIds.map((n) => String(n));
  const legacy = toStrArr(row.loksabha as string | string[] | undefined);
  if (legacy.length === 0) return [];
  if (legacy.length === 1 && legacy[0] === 'ALL') return forEditor ? [] : ['ALL'];
  return legacy;
}

export function resolveAssemblySelectionsFromEvent(
  row: Record<string, unknown>,
  opts?: { forEditor?: boolean }
): string[] {
  const forEditor = opts?.forEditor === true;
  const fromIds = toNumArr(row.assembly_id);
  if (fromIds.includes(0)) return forEditor ? [] : ['ALL'];
  if (fromIds.length > 0) return fromIds.map((n) => String(n));
  const legacy = toStrArr(row.assembly as string | string[] | undefined);
  if (legacy.length === 0) return [];
  if (legacy.length === 1 && legacy[0] === 'ALL') return forEditor ? [] : ['ALL'];
  return legacy;
}

/** Editor UI/save: strip ALL wildcard; empty = optional filter inside state scope, not global targeting. */
export function editorPartySelectionForForm(selected: string[]): string[] {
  return selected.filter((p) => String(p).trim().toUpperCase() !== 'ALL');
}

export function editorGeoSelectionForForm(selected: string[]): string[] {
  return selected.filter((p) => String(p).trim().toUpperCase() !== 'ALL');
}

export function logEventFormHydration(phase: string, detail: Record<string, unknown>) {
  if (process.env.NODE_ENV === 'production') return;
  console.log('[event-form-hydration]', phase, detail);
}

export function mergeStateOptionsForEdit(
  visibleStates: StateOption[],
  allStates: StateOption[],
  selectedStateIds: string[]
): StateOption[] {
  const byId = new Map<string, StateOption>();
  for (const s of visibleStates) byId.set(String(s.id), s);
  for (const id of selectedStateIds) {
    if (id === 'ALL') continue;
    const sid = String(id);
    if (byId.has(sid)) continue;
    const row = allStates.find((s) => String(s.id) === sid);
    if (row) byId.set(sid, row);
  }
  return Array.from(byId.values());
}

export function stateLabelsForIds(ids: string[], allStates: StateOption[]): string {
  const names = ids
    .filter((id) => id !== 'ALL')
    .map((id) => allStates.find((s) => String(s.id) === String(id))?.name ?? id);
  return names.length > 0 ? names.join(', ') : '—';
}
