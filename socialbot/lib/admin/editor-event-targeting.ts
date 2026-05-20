/**
 * Editor event targeting: state scope is required; party/lok/asm are optional filters.
 * Empty party_id means "all parties within selected state(s)" — not global India targeting.
 * Never persist party_id/state_id wildcard 0 or legacy party/state "ALL" for editors.
 */

import { toNumArr } from '@/lib/admin/event-form-hydration';

export function scopeIdsWithoutGlobalWildcard(ids: number[]): number[] {
  return ids.filter((n) => Number.isFinite(n) && n > 0);
}

/** Post/event scope arrays for dashboard matching (empty party = all parties in scoped state). */
export function scopeIdsForPostFromRow(
  row: Record<string, unknown>,
  key: 'party_id' | 'state_id' | 'loksabha_id' | 'assembly_id'
): number[] {
  const raw = row[key] ?? row[key.replace('_id', '') as keyof typeof row];
  return scopeIdsWithoutGlobalWildcard(toNumArr(raw));
}

export function editorPartySlugsFromForm(selected: string[]): string[] {
  return selected
    .map((p) => String(p).trim().toLowerCase())
    .filter((s) => s.length > 0 && s !== 'all');
}

export function editorPartyIdsFromForm(selected: string[]): number[] {
  if (isEditorAllPartiesUiSelection(selected)) return [];
  return selected.map((x) => Number(x)).filter((n) => Number.isFinite(n) && n > 0);
}

export const EDITOR_PARTY_ALL_UI = 'ALL';

export type EditorPartyTargetingMode = 'specific_parties' | 'all_parties_state_scoped' | 'none';

export function isEditorAllPartiesUiSelection(selected: string[]): boolean {
  return selected.some((x) => String(x).trim().toUpperCase() === EDITOR_PARTY_ALL_UI);
}

/**
 * Editor "All Parties" in UI → empty party_id/party in DB (all parties within state_id scope).
 * Never maps to party_id [0] or party ['ALL'] (global wildcard).
 */
export function buildEditorPartyTargetingFromForm(selected: string[]): {
  party: string[];
  party_id: number[];
  mode: EditorPartyTargetingMode;
  allPartiesStateScoped: boolean;
} {
  if (isEditorAllPartiesUiSelection(selected)) {
    return {
      party: [],
      party_id: [],
      mode: 'all_parties_state_scoped',
      allPartiesStateScoped: true,
    };
  }
  const party = editorPartySlugsFromForm(selected);
  const party_id = editorPartyIdsFromForm(selected);
  if (party.length === 0 && party_id.length === 0) {
    return {
      party: [],
      party_id: [],
      mode: 'none',
      allPartiesStateScoped: false,
    };
  }
  return {
    party,
    party_id,
    mode: 'specific_parties',
    allPartiesStateScoped: false,
  };
}

export function logEditorTargetingDebug(phase: string, detail: Record<string, unknown>) {
  if (process.env.NODE_ENV === 'production') return;
  console.log('[editor-targeting]', phase, detail);
}

/**
 * Normalize editor create/patch payload after validation.
 * Ensures empty party is [] (state-scoped all parties), never [0] or ['ALL'].
 */
export function finalizeEditorEventTargetingPayload(payload: Record<string, unknown>): void {
  delete (payload as { state?: unknown }).state;
  delete (payload as { loksabha?: unknown }).loksabha;
  delete (payload as { assembly?: unknown }).assembly;

  if (Object.prototype.hasOwnProperty.call(payload, 'state_id')) {
    const stateIds = scopeIdsWithoutGlobalWildcard(
      (Array.isArray(payload.state_id) ? payload.state_id : [payload.state_id]).map((x) => Number(x))
    );
    (payload as { state_id: number[] }).state_id = stateIds;
  }

  if (Object.prototype.hasOwnProperty.call(payload, 'party_id')) {
    const partyIds = scopeIdsWithoutGlobalWildcard(
      (Array.isArray(payload.party_id) ? payload.party_id : [payload.party_id]).map((x) => Number(x))
    );
    (payload as { party_id: number[] }).party_id = partyIds;
  }

  if (Object.prototype.hasOwnProperty.call(payload, 'party')) {
    const raw = payload.party;
    const arr = Array.isArray(raw) ? raw : raw != null ? [raw] : [];
    const slugs = arr
      .map((x) => String(x ?? '').trim().toLowerCase())
      .filter((s) => s.length > 0 && s !== 'all');
    (payload as { party: string[] }).party = slugs;
  }

  if (Object.prototype.hasOwnProperty.call(payload, 'loksabha_id')) {
    const ids = scopeIdsWithoutGlobalWildcard(
      (Array.isArray(payload.loksabha_id) ? payload.loksabha_id : [payload.loksabha_id]).map((x) => Number(x))
    );
    (payload as { loksabha_id: number[] }).loksabha_id = ids;
  }

  if (Object.prototype.hasOwnProperty.call(payload, 'assembly_id')) {
    const ids = scopeIdsWithoutGlobalWildcard(
      (Array.isArray(payload.assembly_id) ? payload.assembly_id : [payload.assembly_id]).map((x) => Number(x))
    );
    (payload as { assembly_id: number[] }).assembly_id = ids;
  }

  const hasPartySlug =
    Object.prototype.hasOwnProperty.call(payload, 'party') &&
    Array.isArray(payload.party) &&
    (payload.party as string[]).length > 0;
  const hasPartyId =
    Object.prototype.hasOwnProperty.call(payload, 'party_id') &&
    Array.isArray(payload.party_id) &&
    (payload.party_id as number[]).length > 0;

  if (Object.prototype.hasOwnProperty.call(payload, 'party_id') || Object.prototype.hasOwnProperty.call(payload, 'party')) {
    if (!hasPartySlug && !hasPartyId) {
      (payload as { party: string[] }).party = [];
      (payload as { party_id: number[] }).party_id = [];
    }
  }
}
