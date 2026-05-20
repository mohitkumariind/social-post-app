export type PostUploadTraceStep = {
  step: string;
  ok: boolean;
  detail?: Record<string, unknown>;
};

export function formatSupabaseError(err: { message?: string; code?: string; details?: string; hint?: string } | null | undefined) {
  if (!err) return null;
  return {
    message: String(err.message ?? ''),
    code: err.code != null ? String(err.code) : undefined,
    details: err.details != null ? String(err.details) : undefined,
    hint: err.hint != null ? String(err.hint) : undefined,
  };
}

export function logPostUploadTrace(prefix: string, steps: PostUploadTraceStep[]) {
  for (const s of steps) {
    console.log(`[post-upload] ${prefix} ${s.step}`, s.ok ? 'OK' : 'FAIL', s.detail ?? '');
  }
}

export function failPostUpload(
  steps: PostUploadTraceStep[],
  step: string,
  status: number,
  message: string,
  extra?: Record<string, unknown>
) {
  steps.push({ step, ok: false, detail: { message, ...extra } });
  logPostUploadTrace('error', steps);
  return {
    error: message,
    step,
    supabase: extra?.supabase ?? undefined,
    debug: { trace: steps },
  };
}

/** Redact image_url for logs; keep structure. */
export function sanitizePayloadForDebug(payload: Record<string, unknown>): Record<string, unknown> {
  const out = { ...payload };
  if (typeof out.image_url === 'string' && out.image_url.length > 120) {
    out.image_url = `${out.image_url.slice(0, 80)}…(${out.image_url.length} chars)`;
  }
  return out;
}
