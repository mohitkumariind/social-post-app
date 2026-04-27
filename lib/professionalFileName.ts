function safeSlug(input: string): string {
  const base = String(input ?? '').trim();
  if (!base) return '';
  return base
    .replace(/[^\p{L}\p{N}]+/gu, '_')
    .replace(/_+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 60);
}

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

function timestampYYYYMMDD_HHMM(d: Date): string {
  const yyyy = d.getFullYear();
  const mm = pad2(d.getMonth() + 1);
  const dd = pad2(d.getDate());
  const hh = pad2(d.getHours());
  const mi = pad2(d.getMinutes());
  return `${yyyy}${mm}${dd}_${hh}${mi}`;
}

/**
 * Global professional filename convention.
 * - Always prefixes: Socialpost_
 * - Includes optional category
 * - Includes a timestamp for uniqueness
 * - Returns filename with extension (default: jpg)
 */
export function getProfessionalFileName(opts: {
  originalName?: string | null;
  category?: string | null;
  ext?: string | null;
  now?: Date;
}): string {
  const now = opts.now ?? new Date();
  const ext = String(opts.ext ?? 'jpg').replace(/^\./, '').trim() || 'jpg';

  const category = safeSlug(opts.category ?? '');
  const original = safeSlug(opts.originalName ?? '');
  const ts = timestampYYYYMMDD_HHMM(now);

  const parts = ['Socialpost', category || undefined, original || undefined, ts].filter(
    (p): p is string => typeof p === 'string' && p.length > 0
  );

  return `${parts.join('_')}.${ext}`;
}

