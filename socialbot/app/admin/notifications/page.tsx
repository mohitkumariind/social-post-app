'use client';
/* eslint-disable react-hooks/set-state-in-effect -- Supabase fetch on mount and geo dropdown cascades */

import { Bell, ImageIcon, Loader2, Send, Upload, X } from 'lucide-react';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { adminStorageUpload } from '@/lib/admin-storage-client';
import { supabase } from '@/lib/supabase';
import { getPartyLabel, normalizePartyId, PARTIES_DATA } from '@/lib/constants';

const __DEV__ = process.env.NODE_ENV !== 'production';

const ACCENT = '#25D366';
const BODY_MAX = 2000;

type GeoRow = { id: string; name: string; state_id?: string; loksabha_id?: string };

type GalleryPost = {
  id: string;
  image_url: string;
  title: string | null;
  created_at: string | null;
};

type BroadcastRow = {
  id: string;
  created_at: string;
  title: string;
  body: string;
  image_url: string | null;
  filters: Record<string, unknown>;
  target_user_count: number;
  sent_count: number;
  delivered_count: number;
  failed_count: number;
  opened_count: number;
};

function formatSentTo(filters: unknown): string {
  if (!filters || typeof filters !== 'object') return '—';
  const f = filters as Record<string, unknown>;
  if (f.all_workers === true) return 'All workers';
  const labels = (f.labels ?? {}) as Record<string, string>;
  const parts: string[] = [];
  if (labels.party) parts.push(`Party: ${labels.party}`);
  else if (f.party) parts.push(`Party: ${String(f.party)}`);
  if (labels.state) parts.push(`State: ${labels.state}`);
  else if (f.state) parts.push(`State: ${String(f.state)}`);
  if (f.loksabha_id != null) {
    parts.push(labels.loksabha ?? `Loksabha: ${String(f.loksabha_id)}`);
  }
  if (f.assembly_id != null) {
    parts.push(labels.assembly ?? `Assembly: ${String(f.assembly_id)}`);
  }
  return parts.length ? parts.join(' · ') : 'Filtered segment';
}

export default function NotificationBroadcastCenterPage() {
  const [allWorkers, setAllWorkers] = useState(true);
  const [partyId, setPartyId] = useState('');
  const [stateId, setStateId] = useState('');
  const [loksabhaId, setLoksabhaId] = useState('');
  const [assemblyId, setAssemblyId] = useState('');

  const [viewer, setViewer] = useState<{ role: 'admin' | 'moderator'; assigned_state_ids: number[] } | null>(null);
  const isModerator = viewer?.role === 'moderator';

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch('/api/admin/viewer', { credentials: 'same-origin' });
        if (!res.ok) return;
        const d = (await res.json().catch(() => ({}))) as { role?: string; assigned_state_ids?: unknown };
        if (cancelled) return;
        const role = d.role === 'moderator' ? 'moderator' : d.role === 'admin' ? 'admin' : null;
        const ids = Array.isArray(d.assigned_state_ids)
          ? d.assigned_state_ids.map((x: any) => Number(x)).filter((n: any) => Number.isFinite(n))
          : [];
        if (role) setViewer({ role, assigned_state_ids: ids });
      } catch {
        /* ignore */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const [states, setStates] = useState<GeoRow[]>([]);
  const [loksabhas, setLoksabhas] = useState<GeoRow[]>([]);
  const [assemblies, setAssemblies] = useState<GeoRow[]>([]);
  const [geoLoading, setGeoLoading] = useState(true);
  const [lokLoading, setLokLoading] = useState(false);
  const [asmLoading, setAsmLoading] = useState(false);

  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [imageUrl, setImageUrl] = useState('');
  const [imagePreviewBroken, setImagePreviewBroken] = useState(false);

  const [galleryOpen, setGalleryOpen] = useState(false);
  const [galleryLoading, setGalleryLoading] = useState(false);
  const [galleryPosts, setGalleryPosts] = useState<GalleryPost[]>([]);
  const [uploadLoading, setUploadLoading] = useState(false);
  const uploadInputRef = useRef<HTMLInputElement>(null);

  const [confirmOpen, setConfirmOpen] = useState(false);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewCount, setPreviewCount] = useState<number | null>(null);
  const [previewTokens, setPreviewTokens] = useState<number | null>(null);
  const [sendLoading, setSendLoading] = useState(false);

  const [broadcasts, setBroadcasts] = useState<BroadcastRow[]>([]);
  const [historyLoading, setHistoryLoading] = useState(true);
  const [historyError, setHistoryError] = useState<string | null>(null);

  const [toast, setToast] = useState<string | null>(null);

  const selectedState = useMemo(
    () => states.find((s) => String(s.id) === String(stateId)),
    [states, stateId]
  );
  const selectedLoksabha = useMemo(
    () => loksabhas.find((l) => String(l.id) === String(loksabhaId)),
    [loksabhas, loksabhaId]
  );
  const selectedAssembly = useMemo(
    () => assemblies.find((a) => String(a.id) === String(assemblyId)),
    [assemblies, assemblyId]
  );

  const trimmedImageUrl = imageUrl.trim();

  useEffect(() => {
    if (!isModerator) return;
    const ids = viewer?.assigned_state_ids ?? [];
    if (ids.length === 0) return;
    // Force moderator to one of their assigned states (keep current if allowed).
    const allowed = ids.map(String);
    const next = allowed.includes(stateId) ? stateId : allowed[0];
    if (stateId !== next) setStateId(next);
    if (allWorkers) setAllWorkers(false);
  }, [isModerator, viewer?.assigned_state_ids, stateId, allWorkers]);

  useEffect(() => {
    setImagePreviewBroken(false);
  }, [trimmedImageUrl]);

  const loadGalleryPosts = useCallback(async () => {
    setGalleryLoading(true);
    const { data, error } = await supabase
      .from('posts')
      .select('id, image_url, title, created_at')
      .order('created_at', { ascending: false })
      .limit(400);
    setGalleryLoading(false);
    if (error) {
      if (__DEV__) console.error('gallery posts:', error.message);
      setGalleryPosts([]);
      return;
    }
    const rows = (data ?? []).filter(
      (r: Record<string, unknown>) => typeof r.image_url === 'string' && String(r.image_url).trim().length > 0
    ) as GalleryPost[];
    setGalleryPosts(rows);
  }, []);

  useEffect(() => {
    if (!galleryOpen) return;
    void loadGalleryPosts();
  }, [galleryOpen, loadGalleryPosts]);

  const handlePickFromGallery = (url: string) => {
    setImageUrl(url.trim());
    setGalleryOpen(false);
  };

  const handleUploadImage = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    const okType =
      /^image\/(jpeg|png|webp|jpg)$/i.test(file.type) ||
      /\.(jpe?g|png|webp)$/i.test(file.name);
    if (!okType) {
      alert('Please choose a JPG, PNG, or WebP image.');
      return;
    }
    setUploadLoading(true);
    const storagePath = `public/broadcast/${Date.now()}-${file.name.replace(/[^a-zA-Z0-9.-]/g, '_')}`;
    try {
      const { publicUrl } = await adminStorageUpload('post-images', storagePath, file);
      setImageUrl(publicUrl);
    } catch (e) {
      alert(e instanceof Error ? e.message : 'Upload failed');
    } finally {
      setUploadLoading(false);
    }
  };

  const loadBroadcasts = useCallback(async () => {
    setHistoryLoading(true);
    setHistoryError(null);
    const { data, error } = await supabase
      .from('notification_broadcasts')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(100);
    if (error) {
      setHistoryError(error.message);
      setBroadcasts([]);
    } else {
      setBroadcasts((data ?? []) as BroadcastRow[]);
    }
    setHistoryLoading(false);
  }, []);

  useEffect(() => {
    void loadBroadcasts();
  }, [loadBroadcasts]);

  useEffect(() => {
    const run = async () => {
      setGeoLoading(true);
      const { data, error } = await supabase.from('states').select('*');
      if (error) {
        if (__DEV__) console.error('states:', error.message);
        setStates([]);
      } else {
        const mapped = (data ?? []).map((r: Record<string, unknown>) => ({
          id: String(r.id ?? ''),
          name: String(r.name ?? r.state_name ?? r.state ?? ''),
        })).filter((s) => s.id && s.name);
        setStates(mapped);
      }
      setGeoLoading(false);
    };
    void run();
  }, []);

  useEffect(() => {
    if (!stateId) {
      setLoksabhas([]);
      setLoksabhaId('');
      return;
    }
    const run = async () => {
      setLokLoading(true);
      const { data, error } = await supabase.from('loksabha').select('*').eq('state_id', stateId);
      if (error) {
        if (__DEV__) console.error('loksabha:', error.message);
        setLoksabhas([]);
      } else {
        const mapped = (data ?? []).map((r: Record<string, unknown>) => ({
          id: String(r.id ?? ''),
          name: String(r.name ?? ''),
          state_id: String(r.state_id ?? ''),
        })).filter((x) => x.id && x.name);
        setLoksabhas(mapped);
      }
      setLokLoading(false);
    };
    void run();
  }, [stateId]);

  useEffect(() => {
    if (!loksabhaId) {
      setAssemblies([]);
      setAssemblyId('');
      return;
    }
    const run = async () => {
      setAsmLoading(true);
      const { data, error } = await supabase.from('assembly').select('*').eq('loksabha_id', loksabhaId);
      if (error) {
        if (__DEV__) console.error('assembly:', error.message);
        setAssemblies([]);
      } else {
        const mapped = (data ?? []).map((r: Record<string, unknown>) => ({
          id: String(r.id ?? ''),
          name: String(r.name ?? ''),
          loksabha_id: String(r.loksabha_id ?? ''),
        })).filter((x) => x.id && x.name);
        setAssemblies(mapped);
      }
      setAsmLoading(false);
    };
    void run();
  }, [loksabhaId]);

  const runPreview = useCallback(async () => {
    setPreviewLoading(true);
    setPreviewCount(null);
    setPreviewTokens(null);
    const stateName = selectedState?.name?.trim() || '';
    const filters = {
      party: partyId ? normalizePartyId(partyId) : null,
      state: stateName || null,
      loksabha_id: loksabhaId ? Number(loksabhaId) : null,
      assembly_id: assemblyId ? Number(assemblyId) : null,
    };
    try {
      const res = await fetch('/api/notifications/send', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          preview_only: true,
          all_workers: allWorkers,
          filters,
        }),
      });
      const d = (await res.json()) as {
        profile_count?: number;
        token_count?: number;
        worker_count?: number;
        error?: string;
      };
      if (!res.ok) {
        if (__DEV__) console.error('preview:', d.error ?? res.status);
        setPreviewCount(0);
        setPreviewTokens(0);
        return;
      }
      setPreviewCount(typeof d.profile_count === 'number' ? d.profile_count : 0);
      setPreviewTokens(typeof d.token_count === 'number' ? d.token_count : 0);
    } catch (e) {
      if (__DEV__) console.error('preview:', e);
      setPreviewCount(0);
      setPreviewTokens(0);
    } finally {
      setPreviewLoading(false);
    }
  }, [allWorkers, partyId, selectedState?.name, loksabhaId, assemblyId]);

  useEffect(() => {
    if (!confirmOpen) return;
    void runPreview();
  }, [confirmOpen, runPreview]);

  const openConfirm = () => {
    const t = title.trim();
    const b = body.trim();
    if (!t || !b) {
      alert('Please enter a title and message body.');
      return;
    }
    if (b.length > BODY_MAX) {
      alert(`Message body must be at most ${BODY_MAX} characters.`);
      return;
    }
    setConfirmOpen(true);
  };

  const confirmSend = async () => {
    setSendLoading(true);
    const stateName = selectedState?.name?.trim() || '';
    const filters = {
      party: partyId ? normalizePartyId(partyId) : null,
      state: stateName || null,
      loksabha_id: loksabhaId ? Number(loksabhaId) : null,
      assembly_id: assemblyId ? Number(assemblyId) : null,
    };
    const filter_labels = {
      party: partyId ? getPartyLabel(partyId) : null,
      state: stateName || null,
      loksabha: selectedLoksabha?.name ?? null,
      assembly: selectedAssembly?.name ?? null,
    };
    let sendOk = false;
    try {
      const res = await fetch('/api/notifications/send', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: title.trim(),
          body: body.trim(),
          image_url: imageUrl.trim() || null,
          all_workers: allWorkers,
          filters,
          filter_labels,
          data: { type: 'broadcast' },
        }),
      });
      const data = (await res.json()) as { error?: string; ok?: boolean };
      if (!res.ok) {
        alert('Send failed: ' + (data.error || `HTTP ${res.status}`));
        return;
      }
      if (data.error) {
        alert('Send failed: ' + data.error);
        return;
      }
      sendOk = true;
    } catch (e) {
      alert('Send failed: ' + (e instanceof Error ? e.message : String(e)));
      return;
    } finally {
      setSendLoading(false);
    }
    if (!sendOk) return;
    setConfirmOpen(false);
    setTitle('');
    setBody('');
    setImageUrl('');
    setToast('Broadcast sent successfully.');
    window.setTimeout(() => setToast(null), 4000);
    void loadBroadcasts();
  };

  const selectClass =
    'w-full rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm font-semibold text-slate-800 shadow-sm outline-none focus:border-[#25D366] focus:ring-2 focus:ring-[#25D366]/25 disabled:cursor-not-allowed disabled:bg-slate-100 disabled:opacity-60';

  return (
    <div className="max-w-6xl mx-auto pb-24 text-slate-800">
      <div className="mb-10 flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <div className="mb-1 inline-flex items-center gap-2 rounded-full bg-emerald-50 px-3 py-1 text-xs font-bold uppercase tracking-wider text-emerald-800">
            <Bell className="h-3.5 w-3.5" style={{ color: ACCENT }} />
            Admin
          </div>
          <h1 className="text-3xl font-black tracking-tight text-white">Notification Broadcast Center</h1>
          <p className="mt-2 max-w-xl text-sm font-medium text-zinc-400">
            Target workers, compose your message, and send push notifications with full delivery analytics.
          </p>
        </div>
      </div>

      {toast ? (
        <div
          className="fixed bottom-8 left-1/2 z-[200] max-w-md -translate-x-1/2 rounded-xl px-5 py-3 text-center text-sm font-bold text-white shadow-lg"
          style={{ backgroundColor: ACCENT }}
          role="status"
        >
          {toast}
        </div>
      ) : null}

      {/* Section 1 — Targeting */}
      <section className="mb-8 rounded-2xl border border-slate-100 bg-white p-6 shadow-md shadow-slate-200/50">
        <h2 className="mb-1 text-xs font-black uppercase tracking-[0.2em] text-slate-400">Section 1 · Targeting</h2>
        <p className="mb-6 text-sm font-semibold text-slate-600">To</p>

        <label className="mb-6 flex cursor-pointer items-center gap-3 rounded-xl border border-slate-100 bg-slate-50/80 px-4 py-3">
          <input
            type="checkbox"
            checked={allWorkers}
            onChange={(e) => setAllWorkers(e.target.checked)}
            className="h-4 w-4 rounded border-slate-300"
            style={{ accentColor: ACCENT }}
            disabled={isModerator}
          />
          <span className="text-sm font-bold text-slate-800">All workers (bypass filters)</span>
        </label>

        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <div>
            <span className="mb-1.5 block text-[10px] font-black uppercase tracking-widest text-slate-400">Party</span>
            <select
              className={selectClass}
              value={partyId}
              onChange={(e) => setPartyId(e.target.value)}
              disabled={allWorkers || geoLoading}
            >
              <option value="">Any party</option>
              {PARTIES_DATA.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.shortName} — {p.fullName}
                </option>
              ))}
            </select>
          </div>
          <div>
            <span className="mb-1.5 block text-[10px] font-black uppercase tracking-widest text-slate-400">State</span>
            <select
              className={selectClass}
              value={stateId}
              onChange={(e) => setStateId(e.target.value)}
              disabled={isModerator || allWorkers || geoLoading}
            >
              <option value="">Any state</option>
              {states.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </div>
          <div>
            <span className="mb-1.5 block text-[10px] font-black uppercase tracking-widest text-slate-400">Loksabha</span>
            <select
              className={selectClass}
              value={loksabhaId}
              onChange={(e) => setLoksabhaId(e.target.value)}
              disabled={allWorkers || !stateId || lokLoading}
            >
              <option value="">Any loksabha</option>
              {loksabhas.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.name}
                </option>
              ))}
            </select>
          </div>
          <div>
            <span className="mb-1.5 block text-[10px] font-black uppercase tracking-widest text-slate-400">Assembly</span>
            <select
              className={selectClass}
              value={assemblyId}
              onChange={(e) => setAssemblyId(e.target.value)}
              disabled={allWorkers || !loksabhaId || asmLoading}
            >
              <option value="">Any assembly</option>
              {assemblies.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
            </select>
          </div>
        </div>
      </section>

      {/* Section 2 — Composer */}
      <section className="mb-8 rounded-2xl border border-slate-100 bg-white p-6 shadow-md shadow-slate-200/50">
        <h2 className="mb-1 text-xs font-black uppercase tracking-[0.2em] text-slate-400">Section 2 · Message composer</h2>
        <div className="mt-6 space-y-5">
          <div>
            <label className="mb-1.5 block text-[10px] font-black uppercase tracking-widest text-slate-400">
              Notification title
            </label>
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Short headline"
              className="w-full rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm font-semibold text-slate-800 shadow-sm outline-none focus:border-[#25D366] focus:ring-2 focus:ring-[#25D366]/25"
            />
          </div>
          <div>
            <div className="mb-1.5 flex items-center justify-between">
              <label className="text-[10px] font-black uppercase tracking-widest text-slate-400">Message body</label>
              <span className={`text-xs font-bold ${body.length > BODY_MAX ? 'text-red-600' : 'text-slate-400'}`}>
                {body.length} / {BODY_MAX}
              </span>
            </div>
            <textarea
              value={body}
              onChange={(e) => setBody(e.target.value)}
              placeholder="Write your notification message…"
              rows={6}
              className="w-full resize-y rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm font-medium leading-relaxed text-slate-800 shadow-sm outline-none focus:border-[#25D366] focus:ring-2 focus:ring-[#25D366]/25"
            />
          </div>
          <div>
            <label className="mb-1.5 block text-[10px] font-black uppercase tracking-widest text-slate-400">
              Notification image (optional)
            </label>
            <p className="mb-2 text-xs font-medium text-slate-500">
              Paste a public image URL, pick from the app gallery, or upload to storage.
            </p>
            <div className="flex flex-col gap-3 sm:flex-row sm:items-stretch">
              <input
                type="text"
                value={imageUrl}
                onChange={(e) => setImageUrl(e.target.value)}
                placeholder="https://…"
                className="min-w-0 flex-1 rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm font-semibold text-slate-800 shadow-sm outline-none focus:border-[#25D366] focus:ring-2 focus:ring-[#25D366]/25"
              />
              <div className="flex flex-wrap gap-2 sm:shrink-0">
                <button
                  type="button"
                  onClick={() => setGalleryOpen(true)}
                  className="inline-flex items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-3 text-xs font-black uppercase tracking-wide text-slate-700 shadow-sm transition hover:bg-slate-50"
                >
                  <ImageIcon className="h-4 w-4" />
                  Browse app gallery
                </button>
                <button
                  type="button"
                  disabled={uploadLoading}
                  onClick={() => uploadInputRef.current?.click()}
                  className="inline-flex items-center justify-center gap-2 rounded-xl px-4 py-3 text-xs font-black uppercase tracking-wide text-white shadow-md transition hover:opacity-95 disabled:opacity-50"
                  style={{ backgroundColor: ACCENT }}
                >
                  {uploadLoading ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Upload className="h-4 w-4" />
                  )}
                  Upload
                </button>
                <input
                  ref={uploadInputRef}
                  type="file"
                  accept="image/jpeg,image/png,image/webp,.jpg,.jpeg,.png,.webp"
                  className="hidden"
                  onChange={(ev) => void handleUploadImage(ev)}
                />
              </div>
            </div>

            {trimmedImageUrl ? (
              <div className="mt-4 rounded-xl border border-slate-100 bg-slate-50/80 p-4 shadow-inner">
                <p className="mb-2 text-[10px] font-black uppercase tracking-widest text-slate-400">Preview</p>
                <div className="flex justify-center rounded-lg border border-slate-200 bg-white p-2">
                  {imagePreviewBroken ? (
                    <p className="py-8 text-center text-sm font-semibold text-slate-400">
                      Could not load image. Check the URL or try another source.
                    </p>
                  ) : (
                    // eslint-disable-next-line @next/next/no-img-element -- arbitrary admin URLs / storage
                    <img
                      src={trimmedImageUrl}
                      alt="Notification attachment preview"
                      className="max-h-48 max-w-full rounded-md object-contain"
                      onError={() => setImagePreviewBroken(true)}
                    />
                  )}
                </div>
              </div>
            ) : null}
          </div>
        </div>
      </section>

      {/* Section 3 — Send */}
      <section className="mb-10 rounded-2xl border border-slate-100 bg-white p-6 shadow-md shadow-slate-200/50">
        <h2 className="mb-6 text-xs font-black uppercase tracking-[0.2em] text-slate-400">Section 3 · Action</h2>
        <button
          type="button"
          onClick={openConfirm}
          className="flex w-full items-center justify-center gap-2 rounded-2xl py-4 text-base font-black text-white shadow-lg transition hover:opacity-95 sm:w-auto sm:min-w-[220px] sm:px-10"
          style={{ backgroundColor: ACCENT }}
        >
          <Send className="h-5 w-5" />
          Send notification
        </button>
      </section>

      {/* Section 4 — History */}
      <section className="rounded-2xl border border-slate-100 bg-white p-6 shadow-md shadow-slate-200/50">
        <h2 className="mb-1 text-xs font-black uppercase tracking-[0.2em] text-slate-400">Section 4 · History &amp; analytics</h2>
        <p className="mb-6 text-sm font-semibold text-slate-600">Past broadcasts</p>

        {historyError ? (
          <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-semibold text-amber-900">
            Could not load history: {historyError}. Run the SQL migration if <code className="rounded bg-white px-1">notification_broadcasts</code> is missing.
          </div>
        ) : null}

        <div className="overflow-x-auto rounded-xl border border-slate-100">
          <table className="w-full min-w-[720px] text-left text-sm">
            <thead>
              <tr className="border-b border-slate-100 bg-slate-50/80">
                <th className="px-4 py-3 font-black text-slate-500 uppercase tracking-wider">Title &amp; date</th>
                <th className="px-4 py-3 font-black text-slate-500 uppercase tracking-wider">Sent to</th>
                <th className="px-4 py-3 font-black text-slate-500 uppercase tracking-wider text-center">Sent</th>
                <th className="px-4 py-3 font-black text-slate-500 uppercase tracking-wider text-center">Delivered</th>
                <th className="px-4 py-3 font-black text-slate-500 uppercase tracking-wider text-center">Opened</th>
                <th className="px-4 py-3 font-black text-slate-500 uppercase tracking-wider text-center">Failed</th>
              </tr>
            </thead>
            <tbody>
              {historyLoading ? (
                <tr>
                  <td colSpan={6} className="px-4 py-12 text-center text-slate-400">
                    <Loader2 className="mx-auto h-8 w-8 animate-spin" style={{ color: ACCENT }} />
                  </td>
                </tr>
              ) : broadcasts.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-4 py-10 text-center font-semibold text-slate-400">
                    No broadcasts yet.
                  </td>
                </tr>
              ) : (
                broadcasts.map((row) => (
                  <tr key={row.id} className="border-b border-slate-50 hover:bg-slate-50/50">
                    <td className="max-w-[220px] px-4 py-4">
                      <div className="font-bold text-slate-900">{row.title}</div>
                      <div className="mt-1 text-xs font-medium text-slate-400">
                        {new Date(row.created_at).toLocaleString('en-IN', {
                          dateStyle: 'medium',
                          timeStyle: 'short',
                        })}
                      </div>
                    </td>
                    <td className="max-w-xs px-4 py-4 text-xs font-medium leading-snug text-slate-600">
                      {formatSentTo(row.filters)}
                    </td>
                    <td className="px-4 py-4 text-center font-bold text-slate-800">{row.sent_count}</td>
                    <td className="px-4 py-4 text-center font-bold text-slate-800">{row.delivered_count}</td>
                    <td className="px-4 py-4 text-center font-bold text-slate-800">{row.opened_count}</td>
                    <td className="px-4 py-4 text-center font-bold text-red-600">{row.failed_count}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>

      {/* App gallery modal */}
      {galleryOpen ? (
        <div className="fixed inset-0 z-[350] flex items-center justify-center bg-black/50 p-4 backdrop-blur-[2px]">
          <div
            className="flex max-h-[85vh] w-full max-w-3xl flex-col rounded-2xl border border-slate-100 bg-white shadow-2xl"
            role="dialog"
            aria-modal="true"
            aria-labelledby="gallery-modal-title"
          >
            <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4">
              <h3 id="gallery-modal-title" className="text-lg font-black text-slate-900">
                Browse app gallery
              </h3>
              <button
                type="button"
                onClick={() => setGalleryOpen(false)}
                className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
                aria-label="Close gallery"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
            <p className="border-b border-slate-50 px-5 py-2 text-xs font-medium text-slate-500">
              Images from <code className="rounded bg-slate-100 px-1">posts</code>, newest first. Select one to use its public URL.
            </p>
            <div className="min-h-0 flex-1 overflow-y-auto p-4">
              {galleryLoading ? (
                <div className="flex justify-center py-16">
                  <Loader2 className="h-10 w-10 animate-spin" style={{ color: ACCENT }} />
                </div>
              ) : galleryPosts.length === 0 ? (
                <p className="py-12 text-center text-sm font-semibold text-slate-400">No images found in posts.</p>
              ) : (
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4">
                  {galleryPosts.map((p) => (
                    <button
                      key={p.id}
                      type="button"
                      onClick={() => handlePickFromGallery(p.image_url)}
                      className="group flex flex-col overflow-hidden rounded-xl border border-slate-100 bg-slate-50 text-left shadow-sm transition hover:border-[#25D366] hover:shadow-md"
                    >
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={p.image_url}
                        alt={p.title ?? 'Post image'}
                        className="aspect-square w-full object-cover"
                      />
                      <span className="line-clamp-2 p-2 text-[10px] font-bold text-slate-600 group-hover:text-slate-900">
                        {p.title || 'Untitled'}
                      </span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      ) : null}

      {/* Confirmation modal */}
      {confirmOpen ? (
        <div className="fixed inset-0 z-[300] flex items-center justify-center bg-black/45 p-4 backdrop-blur-[2px]">
          <div
            className="relative w-full max-w-md rounded-2xl border border-slate-100 bg-white p-6 shadow-2xl"
            role="dialog"
            aria-modal="true"
            aria-labelledby="confirm-broadcast-title"
          >
            <button
              type="button"
              onClick={() => !sendLoading && setConfirmOpen(false)}
              className="absolute right-4 top-4 rounded-lg p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
              aria-label="Close"
            >
              <X className="h-5 w-5" />
            </button>
            <h3 id="confirm-broadcast-title" className="pr-10 text-lg font-black text-slate-900">
              Confirm broadcast
            </h3>
            <p className="mt-4 text-sm font-medium leading-relaxed text-slate-600">
              {previewLoading ? (
                <span className="inline-flex items-center gap-2">
                  <Loader2 className="h-4 w-4 animate-spin" style={{ color: ACCENT }} />
                  Calculating audience…
                </span>
              ) : (
                <>
                  Are you sure you want to send this to{' '}
                  <strong className="text-slate-900">{previewCount ?? 0}</strong> workers
                  {previewTokens != null ? (
                    <>
                      {' '}
                      (<strong>{previewTokens}</strong> devices with push tokens)
                    </>
                  ) : null}
                  ? This action cannot be undone.
                </>
              )}
            </p>
            <div className="mt-6 flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
              <button
                type="button"
                disabled={sendLoading}
                onClick={() => setConfirmOpen(false)}
                className="rounded-xl border border-slate-200 px-5 py-3 text-sm font-bold text-slate-700 hover:bg-slate-50 disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={sendLoading || previewLoading}
                onClick={() => void confirmSend()}
                className="rounded-xl px-5 py-3 text-sm font-black text-white shadow-md disabled:opacity-50"
                style={{ backgroundColor: ACCENT }}
              >
                {sendLoading ? (
                  <span className="inline-flex items-center gap-2">
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Sending…
                  </span>
                ) : (
                  'Yes, send now'
                )}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
