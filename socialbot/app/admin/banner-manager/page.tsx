'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Image as ImageIcon, Plus, Save, Trash2, X, ArrowUp, ArrowDown, Link as LinkIcon } from 'lucide-react';
import { adminStorageUpload } from '@/lib/admin-storage-client';

type LinkType = 'none' | 'event' | 'post' | 'external_url';

type BannerRow = {
  id: string;
  image_url: string;
  title: string | null;
  subtitle: string | null;
  cta_text: string | null;
  link_type: LinkType;
  link_value: string | null;
  priority: number;
  is_active: boolean;
  start_at: string | null;
  end_at: string | null;
  created_at: string;
  updated_at: string;
};

const __DEV__ = process.env.NODE_ENV !== 'production';

function toDatetimeLocalValue(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function toIsoFromDatetimeLocal(local: string): string | null {
  const s = String(local ?? '').trim();
  if (!s) return null;
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString();
}

async function readImageSize(file: File): Promise<{ w: number; h: number } | null> {
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    const out = await new Promise<{ w: number; h: number } | null>((resolve) => {
      img.onload = () => resolve({ w: (img as any).naturalWidth ?? img.width, h: (img as any).naturalHeight ?? img.height });
      img.onerror = () => resolve(null);
      img.src = url;
    });
    return out;
  } finally {
    URL.revokeObjectURL(url);
  }
}

async function encodeWebpIfPossible(file: File): Promise<File> {
  // Best-effort: resize down to 1280px wide and export WebP (if supported).
  // Fallback to original file without failing.
  try {
    const url = URL.createObjectURL(file);
    try {
      const img = new Image();
      await new Promise<void>((resolve, reject) => {
        img.onload = () => resolve();
        img.onerror = () => reject(new Error('load failed'));
        img.src = url;
      });
      const w = (img as any).naturalWidth ?? img.width;
      const h = (img as any).naturalHeight ?? img.height;
      if (!w || !h) return file;
      const targetW = Math.min(1280, w);
      const targetH = Math.round((targetW / w) * h);
      const canvas = document.createElement('canvas');
      canvas.width = targetW;
      canvas.height = targetH;
      const ctx = canvas.getContext('2d');
      if (!ctx) return file;
      ctx.drawImage(img, 0, 0, targetW, targetH);
      const blob: Blob | null = await new Promise((resolve) =>
        canvas.toBlob((b) => resolve(b), 'image/webp', 0.85)
      );
      if (!blob) return file;
      return new File([blob], file.name.replace(/\.[a-z0-9]+$/i, '') + '.webp', { type: 'image/webp' });
    } finally {
      URL.revokeObjectURL(url);
    }
  } catch {
    return file;
  }
}

export default function BannerManagerPage() {
  const [role, setRole] = useState<string | null>(null);
  const [loadingRole, setLoadingRole] = useState(true);

  const [rows, setRows] = useState<BannerRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [toast, setToast] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [editing, setEditing] = useState<BannerRow | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [draft, setDraft] = useState({
    id: '' as string,
    image_url: '' as string,
    title: '' as string,
    subtitle: '' as string,
    cta_text: '' as string,
    link_type: 'none' as LinkType,
    link_value: '' as string,
    priority: 100 as number,
    is_active: true as boolean,
    start_at_local: '' as string,
    end_at_local: '' as string,
  });
  const [saving, setSaving] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch('/api/admin/viewer', { credentials: 'same-origin' });
        const d = (await res.json().catch(() => ({}))) as { role?: string | null };
        if (!cancelled) setRole(typeof d.role === 'string' ? d.role : null);
      } finally {
        if (!cancelled) setLoadingRole(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const isAdmin = useMemo(() => (role ?? '').toLowerCase() === 'admin', [role]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/admin/banners', { credentials: 'same-origin' });
      const json = (await res.json().catch(() => ({}))) as { banners?: BannerRow[]; error?: string };
      if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`);
      setRows(Array.isArray(json.banners) ? json.banners : []);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load banners');
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!isAdmin) return;
    void load();
  }, [isAdmin, load]);

  useEffect(() => {
    if (!toast) return;
    const t = window.setTimeout(() => setToast(null), 2600);
    return () => window.clearTimeout(t);
  }, [toast]);

  const openCreate = () => {
    setEditing(null);
    setDraft({
      id: '',
      image_url: '',
      title: '',
      subtitle: '',
      cta_text: '',
      link_type: 'none',
      link_value: '',
      priority: (rows[rows.length - 1]?.priority ?? 100) + 10,
      is_active: true,
      start_at_local: '',
      end_at_local: '',
    });
    setModalOpen(true);
  };

  const openEdit = (b: BannerRow) => {
    setEditing(b);
    setDraft({
      id: b.id,
      image_url: b.image_url,
      title: b.title ?? '',
      subtitle: b.subtitle ?? '',
      cta_text: b.cta_text ?? '',
      link_type: b.link_type,
      link_value: b.link_value ?? '',
      priority: b.priority ?? 100,
      is_active: Boolean(b.is_active),
      start_at_local: toDatetimeLocalValue(b.start_at),
      end_at_local: toDatetimeLocalValue(b.end_at),
    });
    setModalOpen(true);
  };

  const saveDraft = async () => {
    if (!draft.image_url.trim()) {
      setToast('Please upload/select an image first.');
      return;
    }
    if (draft.link_type !== 'none' && !draft.link_value.trim()) {
      setToast('link_value is required for this link type.');
      return;
    }
    if (draft.link_type === 'none' && draft.link_value.trim()) {
      setToast('Remove link_value when link_type is none.');
      return;
    }
    const startIso = toIsoFromDatetimeLocal(draft.start_at_local);
    const endIso = toIsoFromDatetimeLocal(draft.end_at_local);
    if (startIso && endIso && new Date(startIso).getTime() >= new Date(endIso).getTime()) {
      setToast('End date must be after start date.');
      return;
    }

    setSaving(true);
    try {
      const body = {
        id: draft.id || undefined,
        image_url: draft.image_url.trim(),
        title: draft.title.trim() || null,
        subtitle: draft.subtitle.trim() || null,
        cta_text: draft.cta_text.trim() || null,
        link_type: draft.link_type,
        link_value: draft.link_type === 'none' ? null : draft.link_value.trim(),
        priority: Number(draft.priority),
        is_active: Boolean(draft.is_active),
        start_at: startIso,
        end_at: endIso,
      };
      const res = await fetch('/api/admin/banners', {
        method: draft.id ? 'PUT' : 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const json = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`);
      setToast(editing ? 'Banner updated' : 'Banner created');
      setEditing(null);
      setModalOpen(false);
      await load();
    } catch (e) {
      setToast(e instanceof Error ? e.message : 'Save failed');
    } finally {
      setSaving(false);
    }
  };

  const onDelete = async (id: string) => {
    if (!id) return;
    if (!confirm('Delete this banner?')) return;
    setSaving(true);
    try {
      const res = await fetch(`/api/admin/banners?id=${encodeURIComponent(id)}`, { method: 'DELETE', credentials: 'same-origin' });
      const json = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`);
      setToast('Banner deleted');
      if (editing?.id === id) setEditing(null);
      await load();
    } catch (e) {
      setToast(e instanceof Error ? e.message : 'Delete failed');
    } finally {
      setSaving(false);
    }
  };

  const move = async (id: string, dir: -1 | 1) => {
    const idx = rows.findIndex((r) => r.id === id);
    if (idx < 0) return;
    const swapIdx = idx + dir;
    if (swapIdx < 0 || swapIdx >= rows.length) return;
    const a = rows[idx]!;
    const b = rows[swapIdx]!;
    const patch = [
      { id: a.id, priority: b.priority },
      { id: b.id, priority: a.priority },
    ];
    setRows((prev) => {
      const next = [...prev];
      next[idx] = { ...a, priority: b.priority };
      next[swapIdx] = { ...b, priority: a.priority };
      return next.sort((x, y) => x.priority - y.priority || (x.created_at < y.created_at ? 1 : -1));
    });
    try {
      const res = await fetch('/api/admin/banners', {
        method: 'PATCH',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reorder: patch }),
      });
      const json = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`);
      setToast('Order updated');
      await load();
    } catch (e) {
      setToast(e instanceof Error ? e.message : 'Reorder failed');
      await load();
    }
  };

  const onPickFile = async (file: File) => {
    const okType =
      /^image\/(jpeg|png|webp|jpg)$/i.test(file.type) ||
      /\.(jpe?g|png|webp)$/i.test(file.name);
    if (!okType) {
      setToast('Please choose a JPG, PNG, or WebP image.');
      return;
    }

    // Prevent tall / invalid aspect ratios (recommended 16:7).
    const size = await readImageSize(file);
    if (!size) {
      setToast('Could not read image.');
      return;
    }
    const ratio = size.w / Math.max(1, size.h);
    if (ratio < 1.7) {
      setToast(`Image is too tall (ratio ${ratio.toFixed(2)}). Use ~16:7 (recommended 1280×560).`);
      return;
    }

    setSaving(true);
    try {
      const optimized = await encodeWebpIfPossible(file);
      const storagePath = `public/dashboard-banners/${Date.now()}-${optimized.name.replace(/[^a-zA-Z0-9.-]/g, '_')}`;
      const { publicUrl } = await adminStorageUpload('post-images', storagePath, optimized);
      setDraft((p) => ({ ...p, image_url: publicUrl }));
      setToast('Uploaded');
    } catch (e) {
      setToast(e instanceof Error ? e.message : 'Upload failed');
    } finally {
      setSaving(false);
    }
  };

  if (loadingRole) {
    return <div className="text-sm text-zinc-400">Checking access…</div>;
  }

  if (!isAdmin) {
    return <div className="text-sm text-zinc-400">Forbidden</div>;
  }

  const sorted = [...rows].sort((a, b) => a.priority - b.priority || (a.created_at < b.created_at ? 1 : -1));

  return (
    <div className="mx-auto max-w-7xl space-y-6 text-zinc-100">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-white">Banner Manager</h1>
          <p className="mt-1 text-sm text-zinc-500">Controls the mobile dashboard banner carousel (active + scheduled).</p>
        </div>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => {
              openCreate();
            }}
            className="inline-flex items-center gap-2 rounded-md bg-zinc-100 px-3 py-2 text-sm font-medium text-zinc-900 hover:bg-white"
          >
            <Plus className="h-4 w-4" /> New banner
          </button>
          <button
            type="button"
            onClick={() => void load()}
            className="rounded-md border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm font-medium text-zinc-200 hover:bg-zinc-800"
          >
            Refresh
          </button>
        </div>
      </div>

      {error ? <div className="rounded-md border border-red-900/40 bg-red-950/20 px-3 py-2 text-sm text-red-200">{error}</div> : null}

      <div className="overflow-hidden rounded-lg border border-zinc-800">
        <table className="w-full text-left text-sm">
          <thead className="border-b border-zinc-800 bg-zinc-900/80 text-xs uppercase text-zinc-500">
            <tr>
              <th className="px-3 py-2 font-medium">Order</th>
              <th className="px-3 py-2 font-medium">Preview</th>
              <th className="px-3 py-2 font-medium">Title</th>
              <th className="px-3 py-2 font-medium">Status</th>
              <th className="px-3 py-2 font-medium">Schedule</th>
              <th className="px-3 py-2 font-medium">Action</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-800/80">
            {loading ? (
              <tr>
                <td className="px-3 py-3 text-zinc-400" colSpan={6}>
                  Loading…
                </td>
              </tr>
            ) : sorted.length === 0 ? (
              <tr>
                <td className="px-3 py-3 text-zinc-400" colSpan={6}>
                  No banners yet.
                </td>
              </tr>
            ) : (
              sorted.map((b) => (
                <tr key={b.id} className="hover:bg-zinc-900/40">
                  <td className="px-3 py-2 align-middle">
                    <div className="flex items-center gap-2">
                      <span className="tabular-nums text-zinc-300">{b.priority}</span>
                      <button
                        type="button"
                        onClick={() => void move(b.id, -1)}
                        className="rounded-md border border-zinc-800 bg-zinc-950 p-1 text-zinc-300 hover:bg-zinc-900"
                        title="Move up"
                      >
                        <ArrowUp className="h-3.5 w-3.5" />
                      </button>
                      <button
                        type="button"
                        onClick={() => void move(b.id, +1)}
                        className="rounded-md border border-zinc-800 bg-zinc-950 p-1 text-zinc-300 hover:bg-zinc-900"
                        title="Move down"
                      >
                        <ArrowDown className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </td>
                  <td className="px-3 py-2 align-middle">
                    <div className="h-10 w-[92px] overflow-hidden rounded-md border border-zinc-800 bg-zinc-950">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={b.image_url} alt={b.title ?? 'banner'} className="h-full w-full object-cover" />
                    </div>
                  </td>
                  <td className="px-3 py-2 align-middle">
                    <div className="min-w-0">
                      <div className="truncate font-medium text-white">{b.title || '—'}</div>
                      <div className="truncate text-xs text-zinc-500">{b.subtitle || b.cta_text || '—'}</div>
                      <div className="mt-1 inline-flex items-center gap-1 text-[11px] text-zinc-500">
                        <LinkIcon className="h-3.5 w-3.5" /> {b.link_type}
                      </div>
                    </div>
                  </td>
                  <td className="px-3 py-2 align-middle">
                    <div className="flex flex-col gap-1">
                      <span className={`inline-flex w-fit rounded-full px-2 py-0.5 text-xs font-medium ${b.is_active ? 'bg-emerald-950/40 text-emerald-200 ring-1 ring-emerald-900/40' : 'bg-zinc-900 text-zinc-300 ring-1 ring-zinc-800'}`}>
                        {b.is_active ? 'Enabled' : 'Disabled'}
                      </span>
                    </div>
                  </td>
                  <td className="px-3 py-2 align-middle text-xs text-zinc-400">
                    <div>{b.start_at ? new Date(b.start_at).toLocaleString() : '—'} → {b.end_at ? new Date(b.end_at).toLocaleString() : '—'}</div>
                  </td>
                  <td className="px-3 py-2 align-middle">
                    <div className="flex gap-2">
                      <button
                        type="button"
                        onClick={() => openEdit(b)}
                        className="rounded-md border border-zinc-700 bg-zinc-900 px-3 py-1.5 text-xs font-medium text-zinc-200 hover:bg-zinc-800"
                      >
                        Edit
                      </button>
                      <button
                        type="button"
                        onClick={() => void onDelete(b.id)}
                        className="inline-flex items-center gap-1 rounded-md border border-red-900/40 bg-red-950/20 px-3 py-1.5 text-xs font-medium text-red-200 hover:bg-red-950/30"
                      >
                        <Trash2 className="h-3.5 w-3.5" /> Delete
                      </button>
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {modalOpen && (
        <div className="fixed inset-0 z-[120] flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm">
          <div className="w-full max-w-2xl overflow-hidden rounded-xl border border-zinc-800 bg-zinc-950 shadow-2xl">
            <div className="flex items-center justify-between border-b border-zinc-800 px-5 py-4">
              <div className="text-sm font-semibold text-white">{draft.id ? 'Edit banner' : 'New banner'}</div>
              <button
                type="button"
                onClick={() => {
                  setModalOpen(false);
                  setEditing(null);
                }}
                className="rounded-md p-2 text-zinc-400 hover:bg-zinc-900 hover:text-white"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="grid grid-cols-1 gap-4 p-5 sm:grid-cols-2">
              <div className="space-y-2">
                <div className="text-xs font-medium text-zinc-400">Image (recommended 16:7, 1280×560)</div>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    disabled={saving}
                    className="inline-flex items-center gap-2 rounded-md border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm font-medium text-zinc-200 hover:bg-zinc-800 disabled:opacity-50"
                  >
                    <ImageIcon className="h-4 w-4" /> Upload
                  </button>
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept="image/*"
                    className="hidden"
                    onChange={(e) => {
                      const f = e.target.files?.[0];
                      e.target.value = '';
                      if (f) void onPickFile(f);
                    }}
                  />
                </div>
                <div className="overflow-hidden rounded-lg border border-zinc-800 bg-zinc-950">
                  {draft.image_url ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={draft.image_url} alt="preview" className="h-28 w-full object-cover" />
                  ) : (
                    <div className="flex h-28 items-center justify-center text-xs text-zinc-500">No image</div>
                  )}
                </div>
                <div className="text-[11px] text-zinc-500">
                  Upload will attempt WebP optimization when possible.
                </div>
              </div>

              <div className="space-y-3">
                <label className="block">
                  <div className="text-xs font-medium text-zinc-400">Title (optional)</div>
                  <input
                    value={draft.title}
                    onChange={(e) => setDraft((p) => ({ ...p, title: e.target.value }))}
                    className="mt-1 w-full rounded-md border border-zinc-800 bg-zinc-900 px-3 py-2 text-sm text-white outline-none"
                  />
                </label>
                <label className="block">
                  <div className="text-xs font-medium text-zinc-400">Subtitle (optional)</div>
                  <input
                    value={draft.subtitle}
                    onChange={(e) => setDraft((p) => ({ ...p, subtitle: e.target.value }))}
                    className="mt-1 w-full rounded-md border border-zinc-800 bg-zinc-900 px-3 py-2 text-sm text-white outline-none"
                  />
                </label>
                <label className="block">
                  <div className="text-xs font-medium text-zinc-400">CTA text (optional)</div>
                  <input
                    value={draft.cta_text}
                    onChange={(e) => setDraft((p) => ({ ...p, cta_text: e.target.value }))}
                    className="mt-1 w-full rounded-md border border-zinc-800 bg-zinc-900 px-3 py-2 text-sm text-white outline-none"
                  />
                </label>
              </div>

              <div className="space-y-3">
                <div className="grid grid-cols-2 gap-3">
                  <label className="block">
                    <div className="text-xs font-medium text-zinc-400">Priority</div>
                    <input
                      value={String(draft.priority)}
                      onChange={(e) => setDraft((p) => ({ ...p, priority: Number(e.target.value) }))}
                      inputMode="numeric"
                      className="mt-1 w-full rounded-md border border-zinc-800 bg-zinc-900 px-3 py-2 text-sm text-white outline-none"
                    />
                  </label>
                  <label className="block">
                    <div className="text-xs font-medium text-zinc-400">Enabled</div>
                    <select
                      value={draft.is_active ? '1' : '0'}
                      onChange={(e) => setDraft((p) => ({ ...p, is_active: e.target.value === '1' }))}
                      className="mt-1 w-full rounded-md border border-zinc-800 bg-zinc-900 px-3 py-2 text-sm text-white outline-none"
                    >
                      <option value="1">Enabled</option>
                      <option value="0">Disabled</option>
                    </select>
                  </label>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <label className="block">
                    <div className="text-xs font-medium text-zinc-400">Start (optional)</div>
                    <input
                      type="datetime-local"
                      value={draft.start_at_local}
                      onChange={(e) => setDraft((p) => ({ ...p, start_at_local: e.target.value }))}
                      className="mt-1 w-full rounded-md border border-zinc-800 bg-zinc-900 px-3 py-2 text-sm text-white outline-none"
                    />
                  </label>
                  <label className="block">
                    <div className="text-xs font-medium text-zinc-400">End (optional)</div>
                    <input
                      type="datetime-local"
                      value={draft.end_at_local}
                      onChange={(e) => setDraft((p) => ({ ...p, end_at_local: e.target.value }))}
                      className="mt-1 w-full rounded-md border border-zinc-800 bg-zinc-900 px-3 py-2 text-sm text-white outline-none"
                    />
                  </label>
                </div>
              </div>

              <div className="space-y-3">
                <label className="block">
                  <div className="text-xs font-medium text-zinc-400">Link type</div>
                  <select
                    value={draft.link_type}
                    onChange={(e) => setDraft((p) => ({ ...p, link_type: e.target.value as LinkType }))}
                    className="mt-1 w-full rounded-md border border-zinc-800 bg-zinc-900 px-3 py-2 text-sm text-white outline-none"
                  >
                    <option value="none">none</option>
                    <option value="event">event</option>
                    <option value="post">post</option>
                    <option value="external_url">external_url</option>
                  </select>
                </label>
                <label className="block">
                  <div className="text-xs font-medium text-zinc-400">Link value</div>
                  <input
                    value={draft.link_value}
                    onChange={(e) => setDraft((p) => ({ ...p, link_value: e.target.value }))}
                    placeholder={draft.link_type === 'none' ? '—' : draft.link_type === 'external_url' ? 'https://…' : 'ID / value'}
                    disabled={draft.link_type === 'none'}
                    className="mt-1 w-full rounded-md border border-zinc-800 bg-zinc-900 px-3 py-2 text-sm text-white outline-none disabled:opacity-60"
                  />
                  {draft.link_type === 'event' ? (
                    <div className="mt-1 text-[11px] text-zinc-500">
                      Current mobile app navigation supports event by name (banner `link_value` should match event name).
                    </div>
                  ) : null}
                </label>
              </div>
            </div>

            <div className="flex items-center justify-end gap-2 border-t border-zinc-800 px-5 py-4">
              <button
                type="button"
                onClick={() => {
                  setModalOpen(false);
                  setEditing(null);
                }}
                className="rounded-md border border-zinc-800 bg-zinc-900 px-3 py-2 text-sm font-medium text-zinc-200 hover:bg-zinc-800"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={saving}
                onClick={() => void saveDraft()}
                className="inline-flex items-center gap-2 rounded-md bg-zinc-100 px-3 py-2 text-sm font-medium text-zinc-900 hover:bg-white disabled:opacity-60"
              >
                <Save className="h-4 w-4" /> {saving ? 'Saving…' : 'Save'}
              </button>
            </div>
          </div>
        </div>
      )}

      {toast ? (
        <div className="fixed left-1/2 top-6 z-[200] -translate-x-1/2 rounded-md bg-zinc-100 px-4 py-2 text-sm font-medium text-zinc-900 shadow-xl">
          {toast}
        </div>
      ) : null}
    </div>
  );
}

