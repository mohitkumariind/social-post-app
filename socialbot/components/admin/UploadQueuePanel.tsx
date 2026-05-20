'use client';

import { AlertCircle, CheckCircle2, Loader2, RotateCcw, X } from 'lucide-react';
import type { UploadQueueItem } from '@/lib/admin-upload-queue';
import { uploadQueueBatchStats } from '@/lib/admin-upload-queue';

type UploadQueuePanelProps = {
  items: UploadQueueItem[];
  onRetry: (id: string) => void;
  onCancel: (id: string) => void;
  onDismissCompleted?: () => void;
  title?: string;
  className?: string;
};

export default function UploadQueuePanel({
  items,
  onRetry,
  onCancel,
  onDismissCompleted,
  title = 'Uploads',
  className = '',
}: UploadQueuePanelProps) {
  const { completed, failed, total, isActive } = uploadQueueBatchStats(items);
  if (total === 0) return null;

  const inProgress = items.filter((i) => i.status === 'queued' || i.status === 'uploading').length;
  const doneCount = completed + failed + items.filter((i) => i.status === 'cancelled').length;

  return (
    <div className={`space-y-4 ${className}`}>
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
        <div>
          <p className="text-[10px] font-black uppercase tracking-widest text-slate-500">{title}</p>
          {isActive ? (
            <p className="mt-1 text-sm font-bold text-blue-700">
              Batch uploading: {doneCount}/{total} completed
              {inProgress > 0 ? ` · ${inProgress} in progress` : ''}
            </p>
          ) : (
            <p className="mt-1 text-sm font-bold text-slate-700">
              {completed}/{total} succeeded
              {failed > 0 ? ` · ${failed} failed` : ''}
            </p>
          )}
        </div>
        {!isActive && completed > 0 && onDismissCompleted ? (
          <button
            type="button"
            onClick={onDismissCompleted}
            className="text-[10px] font-black uppercase tracking-widest text-slate-500 hover:text-slate-800"
          >
            Clear completed
          </button>
        ) : null}
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {items.map((item) => (
          <UploadQueueCard key={item.id} item={item} onRetry={onRetry} onCancel={onCancel} />
        ))}
      </div>
    </div>
  );
}

function UploadQueueCard({
  item,
  onRetry,
  onCancel,
}: {
  item: UploadQueueItem;
  onRetry: (id: string) => void;
  onCancel: (id: string) => void;
}) {
  const border =
    item.status === 'success'
      ? 'border-emerald-400'
      : item.status === 'error'
        ? 'border-rose-400'
        : item.status === 'cancelled'
          ? 'border-slate-300'
          : item.status === 'uploading'
            ? 'border-blue-400'
            : 'border-slate-200';

  return (
    <div
      className={`rounded-2xl border-2 bg-white p-3 shadow-sm transition-colors duration-300 ${border}`}
    >
      <div className="flex gap-3">
        <div className="relative h-16 w-14 shrink-0 overflow-hidden rounded-xl bg-slate-100">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={item.previewUrl} alt="" className="h-full w-full object-cover" />
          {item.status === 'success' ? (
            <span className="absolute inset-0 flex items-center justify-center bg-emerald-600/80">
              <CheckCircle2 size={22} className="text-white" />
            </span>
          ) : null}
        </div>
        <div className="min-w-0 flex-1">
          <p className="truncate text-[11px] font-bold text-slate-800" title={item.file.name}>
            {item.file.name}
          </p>
          <p className="mt-0.5 text-[9px] font-black uppercase tracking-widest text-slate-400">
            {statusLabel(item.status)}
          </p>

          {(item.status === 'uploading' || item.status === 'queued') && (
            <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-slate-100">
              <div
                className={`h-full rounded-full transition-all duration-300 ease-out ${
                  item.status === 'uploading' ? 'bg-blue-500' : 'bg-slate-300'
                }`}
                style={{ width: `${item.status === 'uploading' ? item.progress : 0}%` }}
              />
            </div>
          )}

          {item.status === 'uploading' ? (
            <p className="mt-1 text-[9px] font-bold text-blue-600">{item.progress}%</p>
          ) : null}

          {item.status === 'error' && item.error ? (
            <p className="mt-1 line-clamp-2 text-[9px] font-medium text-rose-600" title={item.error}>
              {item.error}
            </p>
          ) : null}
        </div>
      </div>

      <div className="mt-2 flex justify-end gap-2">
        {item.status === 'error' ? (
          <button
            type="button"
            onClick={() => onRetry(item.id)}
            className="inline-flex items-center gap-1 rounded-lg bg-rose-50 px-2.5 py-1.5 text-[9px] font-black uppercase tracking-widest text-rose-700 hover:bg-rose-100"
          >
            <RotateCcw size={12} /> Retry
          </button>
        ) : null}
        {(item.status === 'queued' || item.status === 'uploading') && (
          <button
            type="button"
            onClick={() => onCancel(item.id)}
            className="inline-flex items-center gap-1 rounded-lg bg-slate-100 px-2.5 py-1.5 text-[9px] font-black uppercase tracking-widest text-slate-600 hover:bg-slate-200"
          >
            <X size={12} /> Cancel
          </button>
        )}
        {item.status === 'uploading' ? (
          <Loader2 size={14} className="animate-spin text-blue-500 self-center" aria-hidden />
        ) : null}
        {item.status === 'error' ? (
          <AlertCircle size={14} className="text-rose-500 self-center" aria-hidden />
        ) : null}
      </div>
    </div>
  );
}

function statusLabel(status: UploadQueueItem['status']): string {
  switch (status) {
    case 'queued':
      return 'Queued';
    case 'uploading':
      return 'Uploading';
    case 'success':
      return 'Complete';
    case 'error':
      return 'Failed';
    case 'cancelled':
      return 'Cancelled';
    default:
      return status;
  }
}
