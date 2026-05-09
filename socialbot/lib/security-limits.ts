export const SECURITY_LIMITS = {
  bulkProfileIds: 500,
  bulkGroupTags: 50,
  groupAddMembers: 500,
  groupPatchOps: 100,
  storageRemovePaths: 200,
  storageUploadMaxBytes: 10 * 1024 * 1024, // 10MB default
};

export function envLimit(name: string, fallback: number, min: number, max: number) {
  const raw = process.env[name];
  const n = Number(raw);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, Math.trunc(n)));
}
