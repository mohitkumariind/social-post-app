/**
 * Events eligible for Notification Broadcast Center → Event Campaign picker.
 * Aligns with workflow-active rows (same as GET /api/admin/events?active=1).
 */
export function isBroadcastSelectableEventStatus(status: unknown): boolean {
  const s = String(status ?? 'published').trim().toLowerCase();
  if (s === 'published' || s === 'scheduled_publish') return true;
  // Worker may still be finishing publish; allow selection so admins are not blocked.
  if (s === 'processing_publish') return true;
  return false;
}

export function isBroadcastSelectableEventRow(row: Record<string, unknown>): boolean {
  if (row.deleted_at != null && String(row.deleted_at).trim() !== '') return false;
  return isBroadcastSelectableEventStatus(row.status);
}
