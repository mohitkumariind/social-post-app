export const API_DEFAULT_LIMIT = 50;
export const API_MAX_LIMIT = 200;
export const API_DEFAULT_FRAMES_LIMIT = 100;
/** Admin user-frames can paginate up to this chunk size (see `/api/admin/user-frames`). */
export const API_MAX_FRAMES_LIMIT = 2000;

export function clampLimit(raw: string | null | undefined, fallback = API_DEFAULT_LIMIT, max = API_MAX_LIMIT) {
  // `Number(null) === 0` is finite — without this guard, a missing `?limit=` becomes 1 (max(1, min(max, 0))).
  if (raw == null || String(raw).trim() === '') return fallback;
  const n = Number(raw);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(1, Math.min(max, Math.trunc(n)));
}
