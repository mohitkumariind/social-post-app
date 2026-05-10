import { useEffect, useRef, useState } from 'react';
import { getCutoutPublicUrl, getTransparentCutoutObjectPath, postImagesObjectExists } from '../lib/cutoutCache';
import { supabase } from '../lib/supabase';

export type FrameAvatarSlotMode = 'loading' | 'cutout' | 'original';

/**
 * Resolves transparent avatar for static/PNG frames from Supabase Storage cache only.
 * Client never holds third-party erase-bg API secrets; regenerate cutouts via a secure worker if needed.
 */
export function useFrameCutout(avatarUrl: string | undefined) {
  const [frameCutoutUri, setFrameCutoutUri] = useState<string | null>(null);
  const [frameAvatarSlotMode, setFrameAvatarSlotMode] = useState<FrameAvatarSlotMode>('loading');
  const isMountedRef = useRef(true);

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    setFrameCutoutUri(null);
    setFrameAvatarSlotMode('loading');

    (async () => {
      try {
        const src = String(avatarUrl ?? '').trim();
        if (!src) {
          if (!cancelled && isMountedRef.current) setFrameAvatarSlotMode('original');
          return;
        }

        let uid: string | undefined;
        for (let i = 0; i < 5; i++) {
          const { data: sess } = await supabase.auth.getSession();
          uid = sess?.session?.user?.id;
          if (uid) break;
          const { data: authUser } = await supabase.auth.getUser();
          uid = authUser?.user?.id;
          if (uid) break;
          await new Promise((r) => setTimeout(r, 400));
          if (cancelled) return;
        }

        if (!uid) {
          if (!cancelled && isMountedRef.current) setFrameAvatarSlotMode('original');
          return;
        }

        const objectPath = getTransparentCutoutObjectPath(uid);
        const cached = await postImagesObjectExists(objectPath);
        if (cancelled || !isMountedRef.current) return;

        if (cached) {
          const publicUrl = getCutoutPublicUrl(objectPath);
          if (!cancelled && isMountedRef.current) {
            setFrameCutoutUri(publicUrl);
            return;
          }
        }

        if (!cancelled && isMountedRef.current) setFrameAvatarSlotMode('original');
      } catch {
        if (!cancelled && isMountedRef.current) setFrameAvatarSlotMode('original');
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [avatarUrl]);

  return { frameCutoutUri, frameAvatarSlotMode, setFrameAvatarSlotMode, setFrameCutoutUri };
}
