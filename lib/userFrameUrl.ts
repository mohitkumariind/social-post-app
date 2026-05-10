/** Resolve public PNG URL for a `user_frames` row (supports legacy `url` / `frame_url`). */
export function resolveUserFrameOverlayUrl(row: {
  overlay_url?: unknown;
  url?: unknown;
  frame_url?: unknown;
}): string {
  const o = String(row?.overlay_url ?? '').trim();
  if (o) return o;
  const u = String(row?.url ?? '').trim();
  if (u) return u;
  return String(row?.frame_url ?? '').trim();
}
