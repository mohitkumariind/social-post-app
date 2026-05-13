import type { Href } from 'expo-router';

import { isNavigableTwitterCampaignAssignmentId } from './twitterCampaignDeepLink';

export function navigateToTwitterCampaign(router: { push: (href: Href) => void }, assignmentId: string): void {
  const id = (assignmentId ?? '').trim();
  if (!isNavigableTwitterCampaignAssignmentId(id)) return;
  router.push(`/twitter-campaign?assignmentId=${encodeURIComponent(id)}` as Href);
}
