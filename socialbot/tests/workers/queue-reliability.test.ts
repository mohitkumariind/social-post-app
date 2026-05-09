import { describe, expect, it } from 'vitest';
import { filterRetryRecipientIds } from '@/lib/workers/notification-retry';

type FakeJob = {
  id: string;
  status: 'pending' | 'processing' | 'sent';
  attempt_count: number;
  locked_by: string | null;
  lock_token: string | null;
  locked_at_ms: number | null;
};

function tryClaim(
  job: FakeJob,
  nowMs: number,
  workerId: string,
  lockToken: string,
  leaseMs: number,
  maxAttempts: number
) {
  const stale = job.locked_at_ms != null && nowMs - job.locked_at_ms > leaseMs;
  const canClaim =
    job.attempt_count < maxAttempts &&
    (job.status === 'pending' || (job.status === 'processing' && stale));
  if (!canClaim) return false;
  job.status = 'processing';
  job.locked_by = workerId;
  job.lock_token = lockToken;
  job.locked_at_ms = nowMs;
  return true;
}

function tryComplete(job: FakeJob, workerId: string, lockToken: string) {
  if (job.status !== 'processing') return false;
  if (job.locked_by !== workerId) return false;
  if (job.lock_token !== lockToken) return false;
  job.status = 'sent';
  job.locked_by = null;
  job.lock_token = null;
  job.locked_at_ms = null;
  return true;
}

describe('worker queue reliability primitives', () => {
  it('prevents stale worker overwrite after reclaim', () => {
    const job: FakeJob = {
      id: 'j1',
      status: 'pending',
      attempt_count: 0,
      locked_by: null,
      lock_token: null,
      locked_at_ms: null,
    };
    const leaseMs = 60_000;
    const now = 1_000_000;

    const w1Claimed = tryClaim(job, now, 'w1', 'tok-1', leaseMs, 5);
    expect(w1Claimed).toBe(true);

    const w2ClaimTooEarly = tryClaim(job, now + 10_000, 'w2', 'tok-2', leaseMs, 5);
    expect(w2ClaimTooEarly).toBe(false);

    const w2ClaimAfterStale = tryClaim(job, now + 61_000, 'w2', 'tok-2', leaseMs, 5);
    expect(w2ClaimAfterStale).toBe(true);

    const w1Complete = tryComplete(job, 'w1', 'tok-1');
    expect(w1Complete).toBe(false);

    const w2Complete = tryComplete(job, 'w2', 'tok-2');
    expect(w2Complete).toBe(true);
  });

  it('keeps retries bounded by max attempts', () => {
    const job: FakeJob = {
      id: 'j2',
      status: 'pending',
      attempt_count: 5,
      locked_by: null,
      lock_token: null,
      locked_at_ms: null,
    };
    const claimed = tryClaim(job, 1000, 'w1', 'tok', 60_000, 5);
    expect(claimed).toBe(false);
  });

  it('resumes only pending/retryable recipients on retry', () => {
    const recipients = ['u1', 'u2', 'u3', 'u4'];
    const pendingRows = [{ user_id: 'u2' }, { user_id: 'u4' }, { user_id: null }];
    const resumed = filterRetryRecipientIds(recipients, pendingRows);
    expect(resumed).toEqual(['u2', 'u4']);
  });
});
