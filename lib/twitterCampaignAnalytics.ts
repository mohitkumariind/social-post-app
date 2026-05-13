import { supabase } from './supabase';

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function isTwitterCampaignAssignmentUuid(value: string | null | undefined): boolean {
  if (!value || typeof value !== 'string') return false;
  return UUID_RE.test(value.trim());
}

export type TwitterCampaignClientEventType = 'notification_opened' | 'share_clicked' | 'retweet_clicked';

/**
 * Records a row in `campaign_events` via `twitter_campaign_track_event` (assignment must belong to the signed-in user).
 */
export async function trackTwitterCampaignEvent(
  assignmentId: string,
  eventType: TwitterCampaignClientEventType,
  metadata: Record<string, unknown> = {}
): Promise<{ ok: boolean; error?: string }> {
  if (!isTwitterCampaignAssignmentUuid(assignmentId)) {
    return { ok: false, error: 'invalid_assignment_id' };
  }
  const { data: sessionData } = await supabase.auth.getSession();
  if (!sessionData?.session?.user) {
    return { ok: false, error: 'not_authenticated' };
  }

  const { error } = await supabase.rpc('twitter_campaign_track_event', {
    p_assignment_id: assignmentId.trim(),
    p_event_type: eventType,
    p_metadata: metadata,
  });

  if (error) {
    if (__DEV__) console.warn('[twitterCampaignAnalytics] rpc failed:', error.message);
    return { ok: false, error: error.message };
  }

  return { ok: true };
}
