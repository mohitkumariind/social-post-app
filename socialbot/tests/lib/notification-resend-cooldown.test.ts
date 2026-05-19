import { describe, expect, it } from 'vitest';
import { ANALYTICS_RESEND_COOLDOWN_SECONDS } from '@/lib/admin/notification-resend-cooldown';

describe('notification-resend-cooldown', () => {
  it('defaults to one hour', () => {
    expect(ANALYTICS_RESEND_COOLDOWN_SECONDS).toBe(3600);
  });
});
