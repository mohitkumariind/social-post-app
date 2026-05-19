import { supabase, supabaseUrl } from './supabase';

export type PostDownloadAction = 'save' | 'whatsapp_share';

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const LOG_PREFIX = '[postDownloadEngagement]';

type RecordPostDownloadResult = {
  ok?: boolean;
  reason?: string;
  id?: string;
  post_id?: string;
  user_id?: string;
  event_id?: string | null;
  created_at?: string;
};

/**
 * Phase 0 ingestion: one row per save/share via record_post_download_simple.
 * No hash, dedupe, visibility gate, or posts.download_count update.
 */
export async function recordPostDownload(opts: {
  postId: string;
  action: PostDownloadAction;
}): Promise<void> {
  const postId = String(opts.postId ?? '').trim();
  if (!UUID_RE.test(postId)) {
    console.error(`${LOG_PREFIX} skipped: invalid postId`, { postId: opts.postId, action: opts.action });
    return;
  }

  console.log(`${LOG_PREFIX} ingest start`, {
    postId,
    action: opts.action,
    supabaseUrl,
  });

  try {
    const { data, error } = await supabase.rpc('record_post_download_simple', {
      p_post_id: postId,
      p_action_type: opts.action,
    });

    console.log(`${LOG_PREFIX} ingest response`, { data, error });

    if (error) {
      console.error(`${LOG_PREFIX} RPC error`, {
        message: error.message,
        code: (error as { code?: string }).code,
        details: (error as { details?: string }).details,
      });
      return;
    }

    const result =
      data != null && typeof data === 'object' && !Array.isArray(data)
        ? (data as RecordPostDownloadResult)
        : null;

    if (result?.ok === false) {
      console.error(`${LOG_PREFIX} RPC declined`, { reason: result.reason ?? 'unknown', result });
      return;
    }

    console.log(`${LOG_PREFIX} ingest ok`, {
      id: result?.id,
      post_id: result?.post_id,
      user_id: result?.user_id,
      event_id: result?.event_id,
      created_at: result?.created_at,
    });
  } catch (e) {
    console.error(`${LOG_PREFIX} exception`, {
      message: e instanceof Error ? e.message : String(e ?? 'unknown'),
    });
  }
}

/** @deprecated Use recordPostDownload — kept for call-site compatibility during phase 0. */
export async function incrementPostDownloadEngagement(opts: {
  postId: string;
  action: PostDownloadAction;
  renderedVariantHash?: string;
}): Promise<void> {
  await recordPostDownload({ postId: opts.postId, action: opts.action });
}
