/**
 * Phase 3: local mock “assignment” payloads for Twitter campaign UI (no backend).
 * Push / deep links should reference `assignmentId` matching these keys.
 */

export const MOCK_TWITTER_ASSIGNMENT_IDS = {
  TWEET_DEMO: 'mock_assignment_tweet',
  RETWEET_DEMO: 'mock_assignment_retweet',
} as const;

export type MockTwitterCampaignKind = 'tweet' | 'retweet';

export type MockTweetAssignment = {
  kind: 'tweet';
  id: string;
  campaignTitle: string;
  tweetText: string;
  imageUrl: string | null;
  hashtags: string[];
};

export type MockRetweetAssignment = {
  kind: 'retweet';
  id: string;
  campaignTitle: string;
  tweetUrl: string;
};

export type MockTwitterCampaignAssignment = MockTweetAssignment | MockRetweetAssignment;

const MOCK_ASSIGNMENTS: Record<string, MockTwitterCampaignAssignment> = {
  [MOCK_TWITTER_ASSIGNMENT_IDS.TWEET_DEMO]: {
    kind: 'tweet',
    id: MOCK_TWITTER_ASSIGNMENT_IDS.TWEET_DEMO,
    campaignTitle: 'Sample: Morning outreach',
    tweetText:
      'Your voice matters. Share this message with your network and help spread awareness about local initiatives.',
    imageUrl: 'https://picsum.photos/seed/socialpost-twitter/800/420',
    hashtags: ['India', 'CommunityFirst', 'VoteReady'],
  },
  [MOCK_TWITTER_ASSIGNMENT_IDS.RETWEET_DEMO]: {
    kind: 'retweet',
    id: MOCK_TWITTER_ASSIGNMENT_IDS.RETWEET_DEMO,
    campaignTitle: 'Sample: Amplify official update',
    tweetUrl: 'https://twitter.com/X/status/1862563070467436544',
  },
};

export function getMockTwitterCampaignAssignment(assignmentId: string): MockTwitterCampaignAssignment | null {
  const key = (assignmentId ?? '').trim();
  if (!key) return null;
  return MOCK_ASSIGNMENTS[key] ?? null;
}

export { buildTwitterWebIntentTweetUrl } from '../lib/twitterCampaignAssignment';
