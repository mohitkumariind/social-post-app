import { Ionicons } from '@expo/vector-icons';
import { Image as ExpoImage } from 'expo-image';
import { useLocalSearchParams, useRouter } from 'expo-router';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Linking,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Colors } from '../constants/Colors';
import { MOCK_TWITTER_ASSIGNMENT_IDS } from '../constants/twitterCampaignMock';
import { useUser } from '../context/UserContext';
import { isTwitterCampaignAssignmentUuid, trackTwitterCampaignEvent } from '../lib/twitterCampaignAnalytics';
import {
  buildTwitterWebIntentTweetUrl,
  fetchTwitterCampaignAssignment,
  type TwitterCampaignAssignmentView,
} from '../lib/twitterCampaignAssignment';

type LoadState =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'ready'; assignment: TwitterCampaignAssignmentView }
  | { status: 'error'; kind: 'missing_id' | 'invalid_id' | 'not_found' | 'forbidden' | 'expired' | 'network' | 'unknown'; message?: string };

export default function TwitterCampaignScreen() {
  const router = useRouter();
  const { isLoggedIn } = useUser();
  const params = useLocalSearchParams<{ assignmentId?: string | string[] }>();
  const assignmentId = useMemo(() => {
    const raw = params.assignmentId;
    if (Array.isArray(raw)) return String(raw[0] ?? '').trim();
    return String(raw ?? '').trim();
  }, [params.assignmentId]);

  const [loadState, setLoadState] = useState<LoadState>({ status: 'idle' });
  const openedTrackedRef = useRef(false);

  useEffect(() => {
    if (!isLoggedIn) {
      router.replace('/login');
    }
  }, [isLoggedIn, router]);

  const loadAssignment = useCallback(async () => {
    if (!assignmentId) {
      setLoadState({ status: 'error', kind: 'missing_id' });
      return;
    }
    if (!isTwitterCampaignAssignmentUuid(assignmentId)) {
      setLoadState({ status: 'error', kind: 'invalid_id' });
      return;
    }

    setLoadState({ status: 'loading' });
    const result = await fetchTwitterCampaignAssignment(assignmentId);
    if (!result.ok) {
      setLoadState({ status: 'error', kind: result.error, message: result.message });
      return;
    }

    if (!result.assignment.actionable) {
      setLoadState({
        status: 'error',
        kind: 'expired',
        message: result.assignment.unavailableReason ?? undefined,
      });
      return;
    }

    setLoadState({ status: 'ready', assignment: result.assignment });
  }, [assignmentId]);

  useEffect(() => {
    if (!isLoggedIn || !assignmentId) return;
    void loadAssignment();
  }, [isLoggedIn, assignmentId, loadAssignment]);

  useEffect(() => {
    if (loadState.status !== 'ready' || openedTrackedRef.current) return;
    if (!isTwitterCampaignAssignmentUuid(assignmentId)) return;
    openedTrackedRef.current = true;
    void trackTwitterCampaignEvent(assignmentId, 'notification_opened', {
      surface: 'twitter_campaign_screen',
    });
  }, [loadState.status, assignmentId]);

  const assignment = loadState.status === 'ready' ? loadState.assignment : null;

  const openShareTweet = () => {
    if (!assignment || assignment.kind !== 'tweet' || !assignment.actionable) return;
    void trackTwitterCampaignEvent(assignmentId, 'share_clicked', { surface: 'twitter_campaign_screen' });
    const url = buildTwitterWebIntentTweetUrl({
      text: assignment.tweetText,
      hashtags: assignment.hashtags,
    });
    void Linking.openURL(url).catch(() => undefined);
  };

  const openTweetUrl = () => {
    if (!assignment || assignment.kind !== 'retweet' || !assignment.actionable) return;
    if (!assignment.tweetUrl) return;
    void trackTwitterCampaignEvent(assignmentId, 'retweet_clicked', { surface: 'twitter_campaign_screen' });
    void Linking.openURL(assignment.tweetUrl).catch(() => undefined);
  };

  if (!isLoggedIn) {
    return (
      <SafeAreaView style={styles.safe}>
        <View style={styles.center}>
          <Text style={styles.muted}>Redirecting…</Text>
        </View>
      </SafeAreaView>
    );
  }

  if (!assignmentId) {
    return (
      <SafeAreaView style={styles.safe}>
        <Header onClose={() => router.back()} title="Campaign" />
        <View style={styles.centerPad}>
          <Text style={styles.errorTitle}>Missing assignment</Text>
          <Text style={styles.muted}>Open this screen from a campaign notification.</Text>
          {__DEV__ ? (
            <Text style={styles.devHint}>
              Dev mock IDs: {MOCK_TWITTER_ASSIGNMENT_IDS.TWEET_DEMO} / {MOCK_TWITTER_ASSIGNMENT_IDS.RETWEET_DEMO}
            </Text>
          ) : null}
        </View>
      </SafeAreaView>
    );
  }

  if (loadState.status === 'loading' || loadState.status === 'idle') {
    return (
      <SafeAreaView style={styles.safe}>
        <Header onClose={() => router.back()} title="Twitter campaign" />
        <View style={styles.centerPad}>
          <ActivityIndicator size="large" color={Colors.primary} />
          <Text style={styles.muted}>Loading campaign…</Text>
        </View>
      </SafeAreaView>
    );
  }

  if (loadState.status === 'error') {
    const { kind, message } = loadState;
    const title =
      kind === 'expired'
        ? 'Campaign ended'
        : kind === 'forbidden'
          ? 'Not available'
          : kind === 'not_found' || kind === 'invalid_id'
            ? 'Assignment not found'
            : kind === 'network'
              ? 'Connection problem'
              : 'Something went wrong';
    const body =
      kind === 'expired'
        ? 'This campaign is no longer active. You can close this screen.'
        : kind === 'forbidden'
          ? 'This assignment belongs to another account.'
          : kind === 'not_found' || kind === 'invalid_id'
            ? 'We could not find this campaign assignment. It may have expired or been removed.'
            : message || 'Please try again.';

    return (
      <SafeAreaView style={styles.safe}>
        <Header onClose={() => router.back()} title="Twitter campaign" />
        <View style={styles.centerPad}>
          <Text style={styles.errorTitle}>{title}</Text>
          <Text style={styles.muted}>{body}</Text>
          {kind === 'network' || kind === 'unknown' ? (
            <TouchableOpacity style={styles.retryBtn} onPress={() => void loadAssignment()} activeOpacity={0.85}>
              <Text style={styles.retryBtnText}>Try again</Text>
            </TouchableOpacity>
          ) : null}
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'left', 'right', 'bottom']}>
      <Header onClose={() => router.back()} title="Twitter campaign" />

      <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
        <View style={styles.card}>
          <Text style={styles.campaignTitle}>{assignment!.campaignTitle}</Text>

          {assignment!.kind === 'tweet' ? (
            <>
              <Text style={styles.sectionLabel}>Your post</Text>
              <Text style={styles.bodyText}>{assignment!.tweetText || '—'}</Text>

              {assignment!.imageUrl ? (
                <View style={styles.imageWrap}>
                  <ExpoImage source={{ uri: assignment!.imageUrl }} style={styles.image} contentFit="cover" />
                </View>
              ) : null}

              {assignment!.hashtags.length > 0 ? (
                <View style={styles.tagBlock}>
                  <Text style={styles.sectionLabel}>Hashtags</Text>
                  <View style={styles.tagRow}>
                    {assignment!.hashtags.map((h) => (
                      <View key={h} style={styles.tagChip}>
                        <Text style={styles.tagText}>{h.startsWith('#') ? h : `#${h}`}</Text>
                      </View>
                    ))}
                  </View>
                </View>
              ) : null}

              <TouchableOpacity style={styles.primaryBtn} onPress={openShareTweet} activeOpacity={0.85}>
                <Ionicons name="logo-twitter" size={20} color={Colors.textOnPrimary} style={styles.btnIcon} />
                <Text style={styles.primaryBtnText}>Share on X</Text>
              </TouchableOpacity>
            </>
          ) : (
            <>
              <Text style={styles.sectionLabel}>Original post</Text>
              <Text style={styles.linkText} numberOfLines={3} selectable>
                {assignment!.tweetUrl || '—'}
              </Text>

              <TouchableOpacity
                style={[styles.primaryBtn, !assignment!.tweetUrl && styles.primaryBtnDisabled]}
                onPress={openTweetUrl}
                activeOpacity={0.85}
                disabled={!assignment!.tweetUrl}
              >
                <Ionicons name="repeat" size={20} color={Colors.textOnPrimary} style={styles.btnIcon} />
                <Text style={styles.primaryBtnText}>Retweet</Text>
              </TouchableOpacity>
            </>
          )}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

function Header({ title, onClose }: { title: string; onClose: () => void }) {
  return (
    <View style={styles.header}>
      <Pressable onPress={onClose} style={styles.headerBtn} hitSlop={10}>
        <Ionicons name="close" size={26} color={Colors.text} />
      </Pressable>
      <Text style={styles.headerTitle} numberOfLines={1}>
        {title}
      </Text>
      <View style={styles.headerBtn} />
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  centerPad: { flex: 1, paddingHorizontal: 24, justifyContent: 'center', alignItems: 'center' },
  muted: { fontSize: 14, color: Colors.textMuted, marginTop: 12, textAlign: 'center' },
  errorTitle: { fontSize: 18, fontWeight: '800', color: Colors.text, textAlign: 'center' },
  devHint: { marginTop: 16, fontSize: 12, color: Colors.textMuted, textAlign: 'center' },
  retryBtn: {
    marginTop: 20,
    paddingHorizontal: 22,
    paddingVertical: 12,
    borderRadius: Colors.borderRadius,
    backgroundColor: Colors.primary,
  },
  retryBtnText: { color: Colors.textOnPrimary, fontSize: 15, fontWeight: '800' },
  scroll: { paddingBottom: 28, paddingHorizontal: 16 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 8,
    paddingVertical: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: Colors.border,
    backgroundColor: Colors.white,
    marginTop: Platform.OS === 'android' ? 4 : 0,
  },
  headerBtn: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  headerTitle: { flex: 1, textAlign: 'center', fontSize: 17, fontWeight: '800', color: Colors.text },
  card: {
    marginTop: 16,
    backgroundColor: Colors.cardBg,
    borderRadius: Colors.borderRadius,
    padding: 18,
    ...Colors.cardShadow,
    elevation: Colors.cardElevation,
  },
  campaignTitle: { fontSize: 20, fontWeight: '800', color: Colors.text, marginBottom: 14 },
  sectionLabel: {
    fontSize: 12,
    fontWeight: '700',
    color: Colors.textMuted,
    textTransform: 'uppercase',
    letterSpacing: 0.6,
    marginBottom: 6,
  },
  bodyText: { fontSize: 16, lineHeight: 24, color: Colors.text, marginBottom: 14 },
  imageWrap: { borderRadius: Colors.borderRadiusSm, overflow: 'hidden', marginBottom: 14 },
  image: { width: '100%', aspectRatio: 16 / 9, backgroundColor: '#E8E8E8' },
  tagBlock: { marginBottom: 18 },
  tagRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  tagChip: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 20,
    backgroundColor: Colors.successBg,
  },
  tagText: { fontSize: 13, fontWeight: '700', color: Colors.text },
  linkText: { fontSize: 14, color: Colors.primary, marginBottom: 18 },
  primaryBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Colors.primary,
    paddingVertical: 14,
    borderRadius: Colors.borderRadius,
  },
  primaryBtnDisabled: { opacity: 0.5 },
  btnIcon: { marginRight: 8 },
  primaryBtnText: { color: Colors.textOnPrimary, fontSize: 16, fontWeight: '800' },
});
