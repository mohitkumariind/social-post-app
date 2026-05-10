import { downloadMediaToCache } from '../../lib/mediaCache';
import { Image as ExpoImage } from 'expo-image';
import React, { useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';

export const IMAGE_SKELETON_BG = '#E8E8E8';

type MediaKind = 'daily' | 'frame';

function useCachedMediaUri(opts: { kind: MediaKind; url: string | null | undefined; ext?: string }) {
  const url = typeof opts.url === 'string' ? opts.url.trim() : '';
  const [localUri, setLocalUri] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    let cancelled = false;
    if (!url) {
      setLocalUri(null);
      setLoading(false);
      return;
    }

    setLoading(true);
    (async () => {
      try {
        const uri = await downloadMediaToCache({ kind: opts.kind, url, ext: opts.ext });
        if (!cancelled) setLocalUri(uri);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [opts.kind, url, opts.ext]);

  return { uri: localUri || url || null, loading };
}

export function CachedFrameMedia({
  kind,
  url,
  style,
  contentFit,
}: {
  kind: MediaKind;
  url: string;
  style?: object;
  contentFit?: 'cover' | 'contain';
}) {
  const { uri, loading } = useCachedMediaUri({ kind, url });
  const showSkeleton = kind !== 'frame';
  return (
    <View style={[style, { backgroundColor: showSkeleton ? IMAGE_SKELETON_BG : 'transparent' }]}>
      {loading && showSkeleton ? (
        <View style={[StyleSheet.absoluteFillObject, { backgroundColor: IMAGE_SKELETON_BG }]} />
      ) : null}
      <ExpoImage
        source={{ uri: String(uri || url) }}
        style={StyleSheet.absoluteFillObject}
        contentFit={contentFit ?? 'contain'}
        cachePolicy="disk"
      />
    </View>
  );
}
