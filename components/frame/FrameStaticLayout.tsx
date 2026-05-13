import { Ionicons } from '@expo/vector-icons';
import { Image as ExpoImage } from 'expo-image';
import React, { memo, useMemo } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import type { FrameAvatarSlotMode } from '../../hooks/useFrameCutout';
import { getFrameFonts } from '../../lib/frameFonts';
import { FRAME_TEXT_BAND_MIN_HEIGHT, buildFrameSocialStripItems, getFramePartyStripPalette } from './frameTheme';
import { framePostStyles } from './framePostStyles';

const TEXT_SAFE_MARGIN = 125;

export type FrameStaticLayoutProps = {
  side: 'left' | 'right';
  displayName: string;
  filledDesignations: string[];
  /** `UserInfo.language` from profile only — not app UI / device locale. */
  profileLanguage: string | undefined;
  partyName?: string;
  userForSocial: Parameters<typeof buildFrameSocialStripItems>[0];
  avatarUrl: string;
  frameCutoutUri: string | null;
  frameAvatarSlotMode: FrameAvatarSlotMode;
  onCutoutDisplayed: () => void;
  onCutoutFailed: () => void;
  isMounted: () => boolean;
  nameSize: number;
  designationSize: number;
  stripHeight: number;
  contentSize: number;
};

function FrameStaticLayoutInner(props: FrameStaticLayoutProps) {
  const {
    side,
    displayName,
    filledDesignations,
    profileLanguage,
    partyName,
    userForSocial,
    avatarUrl,
    frameCutoutUri,
    frameAvatarSlotMode,
    onCutoutDisplayed,
    onCutoutFailed,
    isMounted,
    nameSize,
    designationSize,
    stripHeight,
    contentSize,
  } = props;

  const isAvatarRight = side === 'right';
  const partySocialStripPalette = getFramePartyStripPalette(partyName);
  const socialStripItems = buildFrameSocialStripItems(userForSocial);
  const { nameTypography, infoTypography } = useMemo(() => {
    const f = getFrameFonts(profileLanguage);
    const base = { fontWeight: 'normal' as const };
    return {
      nameTypography: { ...base, fontFamily: f.nameFont },
      infoTypography: { ...base, fontFamily: f.infoFont },
    };
  }, [profileLanguage]);
  const socialStripJustifyContent =
    socialStripItems.length <= 2 ? ('center' as const) : isAvatarRight ? ('flex-start' as const) : ('flex-end' as const);

  return (
    <View style={framePostStyles.frameOverlay}>
      <View
        style={[
          framePostStyles.frameTextBand,
          { minHeight: FRAME_TEXT_BAND_MIN_HEIGHT },
          !avatarUrl ? framePostStyles.frameTextBandFullBleed : null,
        ]}
      >
        <View
          style={[
            framePostStyles.frameTextBandInner,
            avatarUrl ? (isAvatarRight ? { marginRight: TEXT_SAFE_MARGIN } : { marginLeft: TEXT_SAFE_MARGIN }) : null,
          ]}
        >
          <Text
            style={[
              framePostStyles.userName,
              nameTypography,
              { fontSize: nameSize, lineHeight: Math.round(nameSize * 1.2) },
            ]}
          >
            {displayName}
          </Text>
          {filledDesignations.map((line, idx) => (
            <Text
              key={`d-${idx}-${line.slice(0, 32)}`}
              style={[
                framePostStyles.userDesignation,
                infoTypography,
                idx > 0 ? framePostStyles.userDesignationStacked : null,
                { fontSize: designationSize, lineHeight: Math.round(designationSize * 1.2) },
              ]}
            >
              {line}
            </Text>
          ))}
        </View>
      </View>

      <View style={[framePostStyles.framePartySocialStrip, { height: stripHeight, backgroundColor: partySocialStripPalette.bg }]}>
        <View style={[framePostStyles.framePartySocialRow, { justifyContent: socialStripJustifyContent }]}>
          {socialStripItems.map((it) => (
            <View key={it.key} style={framePostStyles.framePartySocialItem}>
              <Ionicons name={it.icon as never} size={contentSize} color={partySocialStripPalette.fg} />
              <Text
                style={[
                  framePostStyles.framePartySocialText,
                  infoTypography,
                  { color: partySocialStripPalette.fg, fontSize: contentSize },
                ]}
                numberOfLines={1}
              >
                {it.value}
              </Text>
            </View>
          ))}
        </View>
      </View>

      <View
        style={[
          framePostStyles.avatarDock,
          isAvatarRight ? framePostStyles.avatarDockRight : framePostStyles.avatarDockLeft,
          { bottom: stripHeight },
        ]}
      >
        {avatarUrl ? (
          <View style={framePostStyles.userPhotoActual}>
            {frameAvatarSlotMode === 'original' ? (
              <ExpoImage
                source={{ uri: avatarUrl }}
                style={[StyleSheet.absoluteFillObject, framePostStyles.frameAvatarImage]}
                contentFit="cover"
                cachePolicy="disk"
                recyclingKey={avatarUrl}
              />
            ) : frameCutoutUri ? (
              <ExpoImage
                key={frameCutoutUri}
                source={{ uri: frameCutoutUri }}
                style={[
                  StyleSheet.absoluteFillObject,
                  framePostStyles.frameAvatarImage,
                  frameAvatarSlotMode === 'loading' ? { opacity: 0 } : null,
                ]}
                contentFit="contain"
                cachePolicy="disk"
                recyclingKey={frameCutoutUri}
                onLoad={() => {
                  if (isMounted()) onCutoutDisplayed();
                }}
                onLoadEnd={() => {
                  if (isMounted()) onCutoutDisplayed();
                }}
                onError={() => {
                  if (isMounted()) onCutoutFailed();
                }}
              />
            ) : null}
          </View>
        ) : null}
      </View>
    </View>
  );
}

export const FrameStaticLayout = memo(FrameStaticLayoutInner);

export const FrameStaticRight = memo(function FrameStaticRight(props: Omit<FrameStaticLayoutProps, 'side'>) {
  return <FrameStaticLayout {...props} side="right" />;
});
export const FrameStaticLeft = memo(function FrameStaticLeft(props: Omit<FrameStaticLayoutProps, 'side'>) {
  return <FrameStaticLayout {...props} side="left" />;
});
