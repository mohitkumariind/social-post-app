import * as Crypto from 'expo-crypto';
import { savePerfEnd, savePerfStart, savePerfStep } from '../utils/savePipelinePerf';
import { supabase, supabaseUrl } from './supabase';

let engagementSupabaseUrlLogged = false;

export type PostDownloadAction = 'save' | 'whatsapp_share';

type IncrementPostDownloadResult = {
  ok?: boolean;
  deduped?: boolean;
  reason?: string;
};

const LOG_PREFIX = '[postDownloadEngagement]';

function logEngagementDebug(message: string, meta?: Record<string, unknown>): void {
  if (meta && Object.keys(meta).length > 0) {
    console.log(`${LOG_PREFIX} ${message}`, meta);
  } else {
    console.log(`${LOG_PREFIX} ${message}`);
  }
}

function logEngagementError(message: string, meta?: Record<string, unknown>): void {
  console.error(`${LOG_PREFIX} ${message}`, meta ?? {});
}

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
  savePerfStep('engagement.hashVariant.start');
  const t0 = performance.now();
  const payload = [
    parts.postId,
    String(parts.selectedFrame),
    parts.overlayUrl,
    String(parts.frameLayoutVariant),
    parts.imageUrl,
  ].join('\u001e');
  const hash = await Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, payload);
  savePerfStep('engagement.hashVariant.done', { ms: Math.round(performance.now() - t0) });
  return hash;
}

/**
 * Server-side unified counter (does not throw — save/share must not fail if tracking fails).
 * Dedupe and cooldown are enforced only in `increment_post_download` (same user+post+variant within 1h;
 * save vs whatsapp_share both count once per window; `action` is still sent for audit rows).
 */
export async function incrementPostDownloadEngagement(opts: {
  postId: string;
  action: PostDownloadAction;
  renderedVariantHash: string;
}): Promise<void> {
  const pid = String(opts.postId ?? '').trim();
  if (!pid) {
    logEngagementError('skipped: missing postId', { action: opts.action });
    return;
  }

  if (!engagementSupabaseUrlLogged) {
    engagementSupabaseUrlLogged = true;
    console.log('[ENGAGEMENT_DEBUG] SUPABASE_URL', process.env.EXPO_PUBLIC_SUPABASE_URL);
    console.log('[ENGAGEMENT_DEBUG] SUPABASE_URL bundled', supabaseUrl);
  }

  logEngagementDebug('engagement start', {
    action: opts.action,
    postId: pid,
    variantHashPrefix: opts.renderedVariantHash.slice(0, 12),
  });

  savePerfStart('engagement', { action: opts.action });
  try {
    savePerfStep('engagement.rpc.start');
    logEngagementDebug('RPC start', { rpc: 'increment_post_download', action: opts.action, postId: pid });

    const rpcStart = performance.now();
    const { data, error } = await supabase.rpc('increment_post_download', {
      p_post_id: pid,
      p_action_type: opts.action,
      p_rendered_variant_hash: opts.renderedVariantHash,
    });
    console.log('[ENGAGEMENT_DEBUG] rpc response', { data, error });
    savePerfStep('engagement.rpc.done', { ms: Math.round(performance.now() - rpcStart) });

    if (error) {
      logEngagementError('RPC failure', {
        action: opts.action,
        postId: pid,
        message: error.message,
        code: (error as { code?: string }).code,
        details: (error as { details?: string }).details,
      });
      return;
    }

    const result =
      data != null && typeof data === 'object' && !Array.isArray(data)
        ? (data as IncrementPostDownloadResult)
        : null;

    if (result?.ok === false) {
      logEngagementError('RPC declined', {
        action: opts.action,
        postId: pid,
        reason: result.reason ?? 'unknown',
        result,
      });
      return;
    }

    logEngagementDebug('RPC success', {
      action: opts.action,
      postId: pid,
      ok: result?.ok ?? true,
      deduped: result?.deduped ?? false,
      inserted: result?.deduped === false,
      result,
    });
  } catch (e) {
    logEngagementError('exception', {
      action: opts.action,
      postId: pid,
      message: e instanceof Error ? e.message : String(e ?? 'unknown'),
    });
  } finally {
    savePerfEnd();
  }
}
