'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  createUploadQueueItems,
  DEFAULT_UPLOAD_CONCURRENCY,
  revokeUploadPreviewUrls,
  uploadQueueBatchStats,
  type UploadProcessor,
  type UploadQueueItem,
} from '@/lib/admin-upload-queue';

async function runWithConcurrency<T>(
  items: T[],
  limit: number,
  worker: (item: T) => Promise<void>
): Promise<void> {
  if (items.length === 0) return;
  const queue = [...items];
  const poolSize = Math.min(Math.max(1, limit), queue.length);

  await Promise.all(
    Array.from({ length: poolSize }, async () => {
      for (;;) {
        const next = queue.shift();
        if (!next) break;
        await worker(next);
      }
    })
  );
}

export function useAdminUploadQueue(concurrency = DEFAULT_UPLOAD_CONCURRENCY) {
  const [items, setItems] = useState<UploadQueueItem[]>([]);
  const [isRunning, setIsRunning] = useState(false);
  const abortById = useRef(new Map<string, AbortController>());
  const processorRef = useRef<UploadProcessor | null>(null);
  const itemsRef = useRef<UploadQueueItem[]>([]);

  useEffect(() => {
    itemsRef.current = items;
  }, [items]);

  const patchItem = useCallback((id: string, patch: Partial<UploadQueueItem>) => {
    setItems((prev) => prev.map((i) => (i.id === id ? { ...i, ...patch } : i)));
  }, []);

  const runOne = useCallback(
    async (item: UploadQueueItem, processor: UploadProcessor) => {
      const controller = new AbortController();
      abortById.current.set(item.id, controller);

      patchItem(item.id, { status: 'uploading', progress: 0, error: undefined });

      try {
        const result = await processor(item, {
          setProgress: (percent) => patchItem(item.id, { progress: percent }),
          signal: controller.signal,
        });
        if (controller.signal.aborted) {
          patchItem(item.id, { status: 'cancelled', progress: 0 });
          return;
        }
        patchItem(item.id, {
          status: 'success',
          progress: 100,
          url: result?.url,
          error: undefined,
        });
      } catch (e) {
        if (controller.signal.aborted || (e instanceof DOMException && e.name === 'AbortError')) {
          patchItem(item.id, { status: 'cancelled', progress: 0 });
          return;
        }
        const msg = e instanceof Error ? e.message : 'Upload failed';
        patchItem(item.id, { status: 'error', progress: 0, error: msg });
      } finally {
        abortById.current.delete(item.id);
      }
    },
    [patchItem]
  );

  const runBatch = useCallback(
    async (batch: UploadQueueItem[]) => {
      const processor = processorRef.current;
      if (!processor || batch.length === 0) return;
      setIsRunning(true);
      try {
        await runWithConcurrency(batch, concurrency, (item) => runOne(item, processor));
      } finally {
        setIsRunning(false);
      }
    },
    [concurrency, runOne]
  );

  const enqueueAndRun = useCallback(
    async (files: File[], processor: UploadProcessor) => {
      if (files.length === 0) return [];
      processorRef.current = processor;
      const created = createUploadQueueItems(files);
      setItems((prev) => [...created, ...prev]);
      await runBatch(created);
      return created.map((i) => i.id);
    },
    [runBatch]
  );

  const retryItem = useCallback(
    async (id: string) => {
      const processor = processorRef.current;
      const item = itemsRef.current.find((i) => i.id === id);
      if (!processor || !item) return;
      const next: UploadQueueItem = { ...item, status: 'queued', progress: 0, error: undefined };
      patchItem(id, { status: 'queued', progress: 0, error: undefined });
      await runOne(next, processor);
    },
    [patchItem, runOne]
  );

  const cancelItem = useCallback(
    (id: string) => {
      abortById.current.get(id)?.abort();
      patchItem(id, { status: 'cancelled', progress: 0 });
    },
    [patchItem]
  );

  const dismissCompleted = useCallback(() => {
    setItems((prev) => {
      const removed = prev.filter((i) => i.status === 'success' || i.status === 'cancelled');
      revokeUploadPreviewUrls(removed);
      return prev.filter((i) => i.status !== 'success' && i.status !== 'cancelled');
    });
  }, []);

  const clearAll = useCallback(() => {
    for (const [, ctrl] of abortById.current) ctrl.abort();
    abortById.current.clear();
    setItems((prev) => {
      revokeUploadPreviewUrls(prev);
      return [];
    });
  }, []);

  useEffect(() => {
    return () => {
      for (const [, ctrl] of abortById.current) ctrl.abort();
      abortById.current.clear();
      revokeUploadPreviewUrls(itemsRef.current);
    };
  }, []);

  const stats = useMemo(() => uploadQueueBatchStats(items), [items]);

  return {
    items,
    stats,
    isRunning: isRunning || stats.isActive,
    enqueueAndRun,
    retryItem,
    cancelItem,
    dismissCompleted,
    clearAll,
  };
}
