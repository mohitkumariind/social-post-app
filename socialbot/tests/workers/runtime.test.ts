import { describe, expect, it } from 'vitest';
import {
  computeExponentialBackoffMs,
  createLockToken,
  isPermanentWorkerFailure,
  resolveWorkerRuntime,
} from '@/lib/workers/runtime';

describe('worker runtime helpers', () => {
  it('uses safe defaults when env is missing', () => {
    const runtime = resolveWorkerRuntime('worker-x', {
      leaseMs: 300000,
      maxAttempts: 5,
      batchSize: 20,
    });
    expect(runtime.workerId).toBe('worker-x');
    expect(runtime.leaseMs).toBe(300000);
    expect(runtime.maxAttempts).toBe(5);
    expect(runtime.batchSize).toBe(20);
  });

  it('computes bounded exponential backoff', () => {
    expect(computeExponentialBackoffMs(1)).toBe(60_000);
    expect(computeExponentialBackoffMs(2)).toBe(120_000);
    expect(computeExponentialBackoffMs(6)).toBe(960_000);
    expect(computeExponentialBackoffMs(20)).toBe(960_000);
  });

  it('creates unique lock tokens per claim', () => {
    const t1 = createLockToken('worker-a', 'job-1');
    const t2 = createLockToken('worker-a', 'job-1');
    expect(t1).not.toBe(t2);
    expect(t1.startsWith('worker-a:job-1:')).toBe(true);
  });

  it('classifies permanent worker failures conservatively', () => {
    expect(isPermanentWorkerFailure('Missing payload')).toBe(true);
    expect(isPermanentWorkerFailure('Forbidden: payload target outside creator scope')).toBe(true);
    expect(isPermanentWorkerFailure('network timeout')).toBe(false);
  });
});
