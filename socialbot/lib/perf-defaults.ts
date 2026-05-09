export const API_DEFAULT_LIMIT = 50;
export const API_MAX_LIMIT = 200;
export const API_DEFAULT_FRAMES_LIMIT = 100;
export const API_MAX_FRAMES_LIMIT = 500;

export function clampLimit(raw: string | null | undefined, fallback = API_DEFAULT_LIMIT, max = API_MAX_LIMIT) {
  const n = Number(raw);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(1, Math.min(max, Math.trunc(n)));
}
