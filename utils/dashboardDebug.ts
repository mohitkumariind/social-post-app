/** Capped debug logs for dashboard pipeline (same behavior as legacy inline helper). */

export function gfxLogCapped(key: string, payload: unknown, cap = 8) {
  const g: any = globalThis as any;
  const k = `__gfx_${key}`;
  g[k] = typeof g[k] === 'number' ? g[k] : 0;
  if (g[k] >= cap) return;
  try {
    console.log(`[gfx] ${key}`, JSON.stringify(payload));
  } catch {
    console.log(`[gfx] ${key}`, String(payload));
  }
  g[k] += 1;
}
