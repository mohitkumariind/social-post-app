import React, { memo } from 'react';
import { View } from 'react-native';
import { CachedFrameMedia } from './CachedFrameMedia';
import { framePostStyles } from './framePostStyles';

export type FramePNGOverlayProps = {
  overlayUrl: string;
};

function FramePNGOverlayInner({ overlayUrl }: FramePNGOverlayProps) {
  if (!overlayUrl) return null;
  return (
    <View style={framePostStyles.frameOverlayImageWrap}>
      <CachedFrameMedia kind="frame" url={overlayUrl} style={framePostStyles.frameOverlayImage} contentFit="contain" />
    </View>
  );
}

export const FramePNGOverlay = memo(FramePNGOverlayInner);
