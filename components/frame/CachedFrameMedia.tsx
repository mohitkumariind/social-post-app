import { downloadMediaToCache } from '../../lib/mediaCache';
import { savePerfStep } from '../../utils/savePipelinePerf';
import { Image as ExpoImage } from 'expo-image';
import React, { useEffect, useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';

export const IMAGE_SKELETON_BG = '#E8E8E8';

type MediaKind = 'daily' | 'frame';

function useCachedMediaUri(opts: { kind: MediaKind; url: string | null | undefined; ext?: string }) {
  const url = typeof opts.url === 'string' ? opts.url.trim() : '';
  const [localUri, setLocalUri] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const cacheMarkRef = useRef<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    if (!url) {
      setLocalUri(null);
      setLoading(false);
      return;
    }

    setLoading(true);
    const mark = `${opts.kind}:${url.slice(-24)}`;
    cacheMarkRef.current = mark;
    const t0 = performance.now();
    savePerfStep(`media.cache.start.${opts.kind}`, { urlTail: url.slice(-48) });
    (async () => {
      try {
        const uri = await downloadMediaToCache({ kind: opts.kind, url, ext: opts.ext });
        if (!cancelled && cacheMarkRef.current === mark) {
          setLocalUri(uri);
          savePerfStep(`media.cache.done.${opts.kind}`, {
            ms: Math.round(performance.now() - t0),
            hit: uri?.startsWith('file://'),
          });
        }
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
        onLoad={() => {
          savePerfStep(`media.expoImage.onLoad.${kind}`, { urlTail: String(url).slice(-48) });
        }}
        onError={() => {
          savePerfStep(`media.expoImage.onError.${kind}`, { urlTail: String(url).slice(-48) });
        }}
      />
    </View>
  );
}
