/**
 * Temporary save/share pipeline timings (__DEV__ only).
 * Search logcat / Metro for `[save-perf]`.
 */

type Step = { name: string; deltaMs: number; totalMs: number };

type Trace = {
  label: string;
  t0: number;
  last: number;
  steps: Step[];
};

let active: Trace | null = null;

function enabled(): boolean {
  return typeof __DEV__ !== 'undefined' && __DEV__;
}

export function savePerfStart(label: string, meta?: Record<string, unknown>): string {
  if (!enabled()) return '';
  const now = performance.now();
  active = { label, t0: now, last: now, steps: [] };
  console.log(`[save-perf] ▶ ${label}`, meta ? JSON.stringify(meta) : '');
  return label;
}

export function savePerfStep(name: string, meta?: Record<string, unknown>): void {
  if (!enabled() || !active) return;
  const now = performance.now();
  const deltaMs = now - active.last;
  const totalMs = now - active.t0;
  active.steps.push({ name, deltaMs, totalMs });
  active.last = now;
  const extra = meta ? ` ${JSON.stringify(meta)}` : '';
  console.log(`[save-perf]   ${name} +${deltaMs.toFixed(0)}ms (Σ ${totalMs.toFixed(0)}ms)${extra}`);
}

export function savePerfEnd(extra?: Record<string, unknown>): void {
  if (!enabled() || !active) return;
  const trace = active;
  active = null;
  const totalMs = trace.steps.length ? trace.steps[trace.steps.length - 1].totalMs : 0;
  const ranked = [...trace.steps].sort((a, b) => b.deltaMs - a.deltaMs);
  console.log(`[save-perf] ■ ${trace.label} done Σ=${totalMs.toFixed(0)}ms`, extra ? JSON.stringify(extra) : '');
  console.log(
    `[save-perf] top steps: ${ranked
      .slice(0, 5)
      .map((s) => `${s.name}=${s.deltaMs.toFixed(0)}ms`)
      .join(', ')}`
  );
}
