import type { Href } from 'expo-router';

export function navigateToTwitterCampaign(router: { push: (href: Href) => void }, assignmentId: string): void {
  const id = (assignmentId ?? '').trim();
  if (!id) return;
  router.push(`/twitter-campaign?assignmentId=${encodeURIComponent(id)}` as Href);
}
