import { Ionicons } from '@expo/vector-icons';
import { Image as ExpoImage } from 'expo-image';
import { useLocalSearchParams, useRouter } from 'expo-router';
import React, { useEffect, useMemo } from 'react';
import {
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
import {
  buildTwitterWebIntentTweetUrl,
  getMockTwitterCampaignAssignment,
  MOCK_TWITTER_ASSIGNMENT_IDS,
} from '../constants/twitterCampaignMock';
import { useUser } from '../context/UserContext';
import { isTwitterCampaignAssignmentUuid, trackTwitterCampaignEvent } from '../lib/twitterCampaignAnalytics';

export default function TwitterCampaignScreen() {
  const router = useRouter();
  const { isLoggedIn } = useUser();
  const params = useLocalSearchParams<{ assignmentId?: string | string[] }>();
  const assignmentId = useMemo(() => {
    const raw = params.assignmentId;
    if (Array.isArray(raw)) return String(raw[0] ?? '').trim();
    return String(raw ?? '').trim();
  }, [params.assignmentId]);

  useEffect(() => {
    if (!isLoggedIn) {
      router.replace('/login');
    }
  }, [isLoggedIn, router]);

  const assignment = useMemo(() => {
    if (!assignmentId) return null;
    return getMockTwitterCampaignAssignment(assignmentId);
  }, [assignmentId]);

  const openShareTweet = () => {
    if (!assignment || assignment.kind !== 'tweet') return;
    if (isTwitterCampaignAssignmentUuid(assignmentId)) {
      void trackTwitterCampaignEvent(assignmentId, 'share_clicked', { surface: 'twitter_campaign_screen' });
    }
    const url = buildTwitterWebIntentTweetUrl({
      text: assignment.tweetText,
      hashtags: assignment.hashtags,
    });
    void Linking.openURL(url).catch(() => undefined);
  };

  const openTweetUrl = () => {
    if (!assignment || assignment.kind !== 'retweet') return;
    if (isTwitterCampaignAssignmentUuid(assignmentId)) {
      void trackTwitterCampaignEvent(assignmentId, 'retweet_clicked', { surface: 'twitter_campaign_screen' });
    }
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
          <Text style={styles.muted}>Open this screen with assignmentId (mock).</Text>
          {__DEV__ ? (
            <Text style={styles.devHint}>
              Try: {MOCK_TWITTER_ASSIGNMENT_IDS.TWEET_DEMO} or {MOCK_TWITTER_ASSIGNMENT_IDS.RETWEET_DEMO}
            </Text>
          ) : null}
        </View>
      </SafeAreaView>
    );
  }

  if (!assignment) {
    return (
      <SafeAreaView style={styles.safe}>
        <Header onClose={() => router.back()} title="Campaign" />
        <View style={styles.centerPad}>
          <Text style={styles.errorTitle}>Assignment not found</Text>
          <Text style={styles.muted}>No mock data for “{assignmentId}”.</Text>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'left', 'right', 'bottom']}>
      <Header onClose={() => router.back()} title="Twitter campaign" />

      <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
        <View style={styles.card}>
          <Text style={styles.campaignTitle}>{assignment.campaignTitle}</Text>

          {assignment.kind === 'tweet' ? (
            <>
              <Text style={styles.sectionLabel}>Your post</Text>
              <Text style={styles.bodyText}>{assignment.tweetText}</Text>

              {assignment.imageUrl ? (
                <View style={styles.imageWrap}>
                  <ExpoImage source={{ uri: assignment.imageUrl }} style={styles.image} contentFit="cover" />
                </View>
              ) : null}

              {assignment.hashtags.length > 0 ? (
                <View style={styles.tagBlock}>
                  <Text style={styles.sectionLabel}>Hashtags</Text>
                  <View style={styles.tagRow}>
                    {assignment.hashtags.map((h) => (
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
                {assignment.tweetUrl}
              </Text>

              <TouchableOpacity style={styles.primaryBtn} onPress={openTweetUrl} activeOpacity={0.85}>
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
  centerPad: { flex: 1, paddingHorizontal: 24, justifyContent: 'center' },
  muted: { fontSize: 14, color: Colors.textMuted, marginTop: 8, textAlign: 'center' },
  errorTitle: { fontSize: 18, fontWeight: '800', color: Colors.text, textAlign: 'center' },
  devHint: { marginTop: 16, fontSize: 12, color: Colors.textMuted, textAlign: 'center' },
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
  btnIcon: { marginRight: 8 },
  primaryBtnText: { color: Colors.textOnPrimary, fontSize: 16, fontWeight: '800' },
});
