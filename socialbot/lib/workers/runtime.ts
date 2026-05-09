export type WorkerRuntimeConfig = {
  workerId: string;
  leaseMs: number;
  maxAttempts: number;
  batchSize: number;
  maxRunMs: number;
};

function intFromEnv(name: string, fallback: number, min: number, max: number) {
  const raw = process.env[name];
  const n = Number(raw);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, Math.trunc(n)));
}

/**
 * Standard worker runtime defaults with env overrides.
 * Keeps lease/retry/batch semantics consistent across all jobs.
 */
export function resolveWorkerRuntime(
  workerId: string,
  defaults: { leaseMs: number; maxAttempts: number; batchSize: number; maxRunMs?: number }
): WorkerRuntimeConfig {
  return {
    workerId,
    leaseMs: intFromEnv('WORKER_LEASE_MS', defaults.leaseMs, 30_000, 60 * 60 * 1000),
    maxAttempts: intFromEnv('WORKER_MAX_ATTEMPTS', defaults.maxAttempts, 1, 50),
    batchSize: intFromEnv('WORKER_BATCH_SIZE', defaults.batchSize, 1, 500),
    maxRunMs: intFromEnv('WORKER_MAX_RUN_MS', defaults.maxRunMs ?? 45_000, 5_000, 10 * 60 * 1000),
  };
}

export function computeExponentialBackoffMs(attempt: number) {
  const safeAttempt = Math.max(1, attempt);
  // 1m, 2m, 4m, 8m, 16m max
  return Math.min(16 * 60 * 1000, 60 * 1000 * Math.pow(2, safeAttempt - 1));
}

export function nowIso() {
  return new Date().toISOString();
}

export function staleIso(leaseMs: number) {
  return new Date(Date.now() - leaseMs).toISOString();
}

export function createLockToken(workerId: string, entityId: string) {
  const rand = Math.random().toString(36).slice(2, 10);
  const now = Date.now().toString(36);
  return `${workerId}:${entityId}:${now}:${rand}`;
}

export function isPermanentWorkerFailure(message: string) {
  const m = String(message ?? '').toLowerCase();
  return (
    m.includes('forbidden') ||
    m.includes('missing payload') ||
    m.includes('malformed') ||
    m.includes('invalid') ||
    m.includes('outside creator scope')
  );
}
