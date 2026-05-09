export function filterRetryRecipientIds(
  allRecipientIds: string[],
  pendingRows: Array<{ user_id: string | null }>
): string[] {
  const pendingSet = new Set(
    pendingRows
      .map((r) => String(r.user_id ?? '').trim())
      .filter(Boolean)
  );
  return allRecipientIds.filter((id) => pendingSet.has(String(id)));
}
