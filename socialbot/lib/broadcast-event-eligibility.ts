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
  const status = row.status;
  if (status === undefined || status === null || String(status).trim() === '') {
    // Legacy DB without `events.status`: already-published if not future-scheduled.
    const sched = row.scheduled_at != null ? String(row.scheduled_at).trim() : '';
    if (sched) {
      const t = new Date(sched).getTime();
      if (Number.isFinite(t) && t > Date.now()) return false;
    }
    return true;
  }
  return isBroadcastSelectableEventStatus(status);
}
