import * as Crypto from 'expo-crypto';
import { supabase } from './supabase';

export type PostDownloadAction = 'save' | 'whatsapp_share';

/**
 * Stable fingerprint for "same render" dedup on server (frame + overlay + layout + slide).
 */
export async function hashRenderedPostVariant(parts: {
  postId: string;
  selectedFrame: number;
  overlayUrl: string;
  frameLayoutVariant: number;
  imageUrl: string;
}): Promise<string> {
  const payload = [
    parts.postId,
    String(parts.selectedFrame),
    parts.overlayUrl,
    String(parts.frameLayoutVariant),
    parts.imageUrl,
  ].join('\u001e');
  return Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, payload);
}

/**
 * Server-side unified counter (never throws; failures are dev-logged only).
 * Dedupe and cooldown are enforced only in `increment_post_download` (same user+post+variant within 1h;
 * save vs whatsapp_share both count once per window; `action` is still sent for audit rows).
 */
export async function incrementPostDownloadEngagement(opts: {
  postId: string;
  action: PostDownloadAction;
  renderedVariantHash: string;
}): Promise<void> {
  const pid = String(opts.postId ?? '').trim();
  if (!pid) return;
  try {
    const { data, error } = await supabase.rpc('increment_post_download', {
      p_post_id: pid,
      p_action_type: opts.action,
      p_rendered_variant_hash: opts.renderedVariantHash,
    });
    if (error) {
      if (__DEV__) console.warn('[postDownloadEngagement] RPC error:', error.message);
      return;
    }
    if (__DEV__ && data && typeof data === 'object' && (data as { ok?: boolean }).ok === false) {
      console.warn('[postDownloadEngagement] RPC declined:', data);
    }
  } catch (e) {
    if (__DEV__) console.warn('[postDownloadEngagement] exception:', e);
  }
}
