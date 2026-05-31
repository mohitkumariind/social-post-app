import type { PartyItem } from '@/lib/constants';
import { toNumArr } from '@/lib/admin/event-form-hydration';

export function normalizeAssignedPartyIds(raw: unknown): string[] {
  if (raw == null) return [];
  const arr = Array.isArray(raw) ? raw : [raw];
  return arr
    .map((x) => String(x ?? '').trim().toLowerCase())
    .filter((s) => s.length > 0 && s !== 'all');
}

/**
 * Scope party options for non-admin event forms (editor, moderator, campaign_manager).
 * Empty assigned_party_ids → all parties; populated → only assigned slugs.
 */
export function partiesVisibleToEditor(allParties: PartyItem[], assignedPartyIds: string[]): PartyItem[] {
  const allowed = normalizeAssignedPartyIds(assignedPartyIds);
  if (allowed.length === 0) return allParties;
  const set = new Set(allowed);
  return allParties.filter((p) => set.has(String(p.id).trim().toLowerCase()));
}

/** Strip ALL from UI selection when non-admin roles cannot use global party targeting. */
export function partySelectionWithoutAllOption(
  selected: string[],
  visibleParties: PartyItem[],
  allowAllPartiesOption: boolean
): string[] {
  if (allowAllPartiesOption) return selected;
  const withoutAll = selected.filter((x) => String(x).trim().toUpperCase() !== 'ALL');
  if (withoutAll.length > 0) return withoutAll;
  return visibleParties.map((p) => p.id);
}

export function mergePartiesForEdit(
  visibleParties: PartyItem[],
  allParties: PartyItem[],
  selectedPartyIds: string[]
): PartyItem[] {
  const byId = new Map<string, PartyItem>();
  for (const p of visibleParties) byId.set(String(p.id).trim().toLowerCase(), p);
  for (const id of selectedPartyIds) {
    if (id === 'ALL') continue;
    const key = String(id).trim().toLowerCase();
    if (byId.has(key)) continue;
    const row = allParties.find((p) => String(p.id).trim().toLowerCase() === key);
    if (row) byId.set(key, row);
  }
  return Array.from(byId.values());
}

export function validateEditorPartyScope(
  payload: Record<string, unknown>,
  assignedPartyIds: string[]
): string | null {
  const allowed = normalizeAssignedPartyIds(assignedPartyIds);
  if (allowed.length === 0) return null;

  const allowedSet = new Set(allowed);
  const partySlugs: string[] = [];
  if (Object.prototype.hasOwnProperty.call(payload, 'party')) {
    const raw = payload.party;
    const arr = Array.isArray(raw) ? raw : raw != null ? [raw] : [];
    for (const x of arr) {
      const s = String(x ?? '').trim().toLowerCase();
      if (!s || s === 'all') continue;
      partySlugs.push(s);
    }
  }

  const numericIds = toNumArr(payload.party_id);
  if (partySlugs.length === 0 && numericIds.length === 0) return null;

  for (const slug of partySlugs) {
    if (!allowedSet.has(slug)) {
      return 'Forbidden: party outside editor assigned parties';
    }
  }
  return null;
}

export function logEditorPartyDebug(phase: string, detail: Record<string, unknown>) {
  if (process.env.NODE_ENV === 'production') return;
  console.log('[editor-party]', phase, detail);
}
