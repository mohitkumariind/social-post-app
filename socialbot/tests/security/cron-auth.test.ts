import { afterEach, describe, expect, it } from 'vitest';
import { validateCronRequest } from '@/lib/cron-auth';

function req(headers: Record<string, string>) {
  return new Request('http://localhost/api/jobs/x', { method: 'POST', headers });
}

describe('cron auth', () => {
  const prev = process.env.CRON_SECRET;
  const prevBearer = process.env.CRON_DISABLE_BEARER_AUTH;
  afterEach(() => {
    if (prev == null) delete process.env.CRON_SECRET;
    else process.env.CRON_SECRET = prev;
    if (prevBearer == null) delete process.env.CRON_DISABLE_BEARER_AUTH;
    else process.env.CRON_DISABLE_BEARER_AUTH = prevBearer;
  });

  it('rejects when secret is not configured', () => {
    delete process.env.CRON_SECRET;
    const result = validateCronRequest(req({}));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.status).toBe(503);
  });

  it('accepts x-cron-secret header', () => {
    process.env.CRON_SECRET = 'abc123';
    const result = validateCronRequest(req({ 'x-cron-secret': 'abc123' }));
    expect(result.ok).toBe(true);
  });

  it('rejects invalid bearer secret', () => {
    process.env.CRON_SECRET = 'abc123';
    const result = validateCronRequest(req({ authorization: 'Bearer wrong' }));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.status).toBe(401);
  });

  it('accepts valid bearer when bearer auth is enabled', () => {
    process.env.CRON_SECRET = 'abc123';
    delete process.env.CRON_DISABLE_BEARER_AUTH;
    const result = validateCronRequest(req({ authorization: 'Bearer abc123' }));
    expect(result.ok).toBe(true);
  });

  it('rejects bearer but accepts x-cron-secret when bearer auth is disabled', () => {
    process.env.CRON_SECRET = 'abc123';
    process.env.CRON_DISABLE_BEARER_AUTH = '1';
    expect(validateCronRequest(req({ authorization: 'Bearer abc123' })).ok).toBe(false);
    expect(validateCronRequest(req({ 'x-cron-secret': 'abc123' })).ok).toBe(true);
  });
});
