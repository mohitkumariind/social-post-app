/**
 * Supabase may return `events.captions` as a string[] (json/jsonb) or as a JSON string.
 * Admin code used `Array.isArray` only, so string values became [] and new posts saved captions as '[]'.
 */
export function normalizeCaptionsFromDb(raw: unknown): string[] {
  if (raw == null) return [];
  if (Array.isArray(raw)) {
    return raw
      .map((x) => (typeof x === 'string' ? x.trim() : x != null ? String(x).trim() : ''))
      .filter((s) => s.length > 0);
  }
  if (typeof raw === 'string') {
    const s = raw.trim();
    if (!s) return [];
    try {
      const parsed = JSON.parse(s) as unknown;
      if (Array.isArray(parsed)) return normalizeCaptionsFromDb(parsed);
      if (typeof parsed === 'string' && parsed.trim()) return [parsed.trim()];
      return [];
    } catch {
      return [s];
    }
  }
  return [];
}

/** JSON text form (legacy TEXT columns or clients that expect a string). */
export function captionsJsonForPostColumn(captions: string[]): string {
  return JSON.stringify(captions);
}

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function isLikelyEventUuid(id: unknown): boolean {
  const s = String(id ?? '').trim();
  return s.length > 0 && UUID_RE.test(s);
}
