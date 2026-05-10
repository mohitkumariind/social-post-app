/** UTC-safe parsing for event/post lifecycle bounds (same semantics as legacy dashboard). */

export function parseUtcMs(input: unknown): number | null {
  const s = String(input ?? '').trim();
  if (!s) return null;
  const ms = Date.parse(s);
  return Number.isFinite(ms) ? ms : null;
}

/** Event is "active" when now is inside [start, end] inclusive (ms). Malformed bounds → not active. */
export function isEventActiveNow(ev: { start?: unknown; end?: unknown }, nowUtcMs: number = Date.now()): boolean {
  const startMs = parseUtcMs(ev.start);
  const endMs = parseUtcMs(ev.end);
  if (startMs == null || endMs == null) return false;
  return nowUtcMs >= startMs && nowUtcMs <= endMs;
}
