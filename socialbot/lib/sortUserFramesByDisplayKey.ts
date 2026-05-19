/** Locale-safe A→Z order for user-uploaded PNG frames (picker, gallery, admin lists). */

const COLLATOR = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });

export type UserFrameSortable = {
  file_name?: unknown;
  title?: unknown;
  name?: unknown;
  url?: unknown;
  frame_url?: unknown;
  id?: unknown;
};

export function userFrameDisplaySortKey(r: UserFrameSortable): string {
  const fn = String(r?.file_name ?? '').trim();
  if (fn !== '') return fn;
  const titled = String(r.title ?? r.name ?? '').trim();
  if (titled !== '') return titled;
  const urlCandidate = String(r?.url ?? '').trim() || String(r.frame_url ?? '').trim();
  const base = urlCandidate.split('?')[0];
  const last = base ? (base.split('/').pop() ?? '') : '';
  return last.trim();
}

export function sortUserFramesByDisplayKey<T extends UserFrameSortable>(rows: T[]): T[] {
  return [...rows].sort((a, b) => {
    const cmp = COLLATOR.compare(userFrameDisplaySortKey(a), userFrameDisplaySortKey(b));
    if (cmp !== 0) return cmp;
    const idCmp = COLLATOR.compare(String(a.id ?? ''), String(b.id ?? ''));
    if (idCmp !== 0) return idCmp;
    return COLLATOR.compare(String(a.url ?? ''), String(b.url ?? ''));
  });
}
