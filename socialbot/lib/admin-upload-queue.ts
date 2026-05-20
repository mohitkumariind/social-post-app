export type UploadQueueStatus = 'queued' | 'uploading' | 'success' | 'error' | 'cancelled';

export type UploadQueueItem = {
  id: string;
  file: File;
  status: UploadQueueStatus;
  progress: number;
  url?: string;
  error?: string;
  previewUrl: string;
};

export type UploadProcessHelpers = {
  setProgress: (percent: number) => void;
  signal: AbortSignal;
};

export type UploadProcessor = (
  item: UploadQueueItem,
  helpers: UploadProcessHelpers
) => Promise<{ url?: string } | void>;

export const DEFAULT_UPLOAD_CONCURRENCY = 4;

export function createUploadQueueItems(files: File[]): UploadQueueItem[] {
  return files.map((file) => ({
    id: typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`,
    file,
    status: 'queued' as const,
    progress: 0,
    previewUrl: URL.createObjectURL(file),
  }));
}

export function revokeUploadPreviewUrls(items: UploadQueueItem[]): void {
  for (const item of items) {
    try {
      URL.revokeObjectURL(item.previewUrl);
    } catch {
      /* ignore */
    }
  }
}

export function uploadQueueBatchStats(items: UploadQueueItem[]) {
  const active = items.filter((i) => i.status === 'queued' || i.status === 'uploading');
  const completed = items.filter((i) => i.status === 'success').length;
  const failed = items.filter((i) => i.status === 'error').length;
  const total = items.length;
  const isActive = active.length > 0;
  return { active, completed, failed, total, isActive };
}
