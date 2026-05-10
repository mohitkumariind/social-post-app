import React, { memo } from 'react';
import { Text, TouchableOpacity, View } from 'react-native';
import { Colors } from '../../constants/Colors';
import { CachedFrameMedia } from './CachedFrameMedia';

export type FrameSelectorItem = { id: number; color: string; url: string | null };

export type FrameSelectorProps = {
  items: FrameSelectorItem[];
  selectedFrame: number;
  onSelectFrame: (id: number) => void;
  sectionTitle: string;
  styles: {
    sectionTitle: object;
    framesGrid: object;
    frameCard: object;
    miniFrameUI: object;
    variantPreviewOuter: object;
    variantPreviewTextBand: object;
    variantPreviewStrip: object;
    variantPreviewAvatar: object;
    variantPreviewAvatarRight: object;
    variantPreviewAvatarLeft: object;
  };
};

function FrameSelectorInner({ items, selectedFrame, onSelectFrame, sectionTitle, styles: S }: FrameSelectorProps) {
  return (
    <>
      <Text style={S.sectionTitle}>{sectionTitle}</Text>
      <View style={S.framesGrid}>
        {items.map((f) => (
          <TouchableOpacity key={f.id} onPress={() => onSelectFrame(Number(f.id))} style={S.frameCard}>
            {f.id === 1 || f.id === 2 ? (
              <View style={[S.miniFrameUI, selectedFrame === f.id && { borderColor: Colors.accent, borderWidth: 3 }]}>
                <View style={S.variantPreviewOuter}>
                  <View style={S.variantPreviewTextBand} />
                  <View style={[S.variantPreviewAvatar, f.id === 1 ? S.variantPreviewAvatarRight : S.variantPreviewAvatarLeft]} />
                  <View style={S.variantPreviewStrip} />
                </View>
              </View>
            ) : (
              <View style={[S.miniFrameUI, selectedFrame === f.id && { borderColor: f.color, borderWidth: 3 }, { overflow: 'hidden' }]}>
                {f.url ? (
                  <CachedFrameMedia kind="frame" url={String(f.url)} style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }} contentFit="contain" />
                ) : null}
              </View>
            )}
          </TouchableOpacity>
        ))}
      </View>
    </>
  );
}

export const FrameSelector = memo(FrameSelectorInner);
