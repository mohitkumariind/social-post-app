'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Eye, Pencil, Plus, Save, Send, Share2, Trash2, ImageIcon } from 'lucide-react';
import { getPartyLabel, PARTIES_DATA } from '@/lib/constants';

const ACCENT = '#25D366';
const TWEET_CHAR_LIMIT = 280;

const selectClass =
  'w-full rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm font-semibold text-slate-800 shadow-sm outline-none focus:border-[#25D366] focus:ring-2 focus:ring-[#25D366]/25 disabled:cursor-not-allowed disabled:bg-slate-100 disabled:opacity-60';

const inputClass =
  'w-full rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm font-semibold text-slate-800 shadow-sm outline-none focus:border-[#25D366] focus:ring-2 focus:ring-[#25D366]/25 placeholder:text-slate-400';

const textareaClass =
  'w-full min-h-[120px] rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm font-medium text-slate-800 shadow-sm outline-none focus:border-[#25D366] focus:ring-2 focus:ring-[#25D366]/25 placeholder:text-slate-400';

type CampaignType = 'tweet' | 'retweet';

type TweetVariantRow = { id: string; text: string };
type RetweetVariantRow = { id: string; url: string; note: string };

type MockCampaignRow = {
  id: string;
  name: string;
  type: CampaignType;
  waves: number;
  gapMinutes: number;
  variantsCount: number;
  status: 'draft' | 'published' | 'scheduled';
  targetPartyId: string;
  createdAt: string;
};

function newId(prefix: string) {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
}

function formatMockDate(iso: string) {
  try {
    return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(iso));
  } catch {
    return iso;
  }
}

function StatusChip({ kind }: { kind: 'draft' | 'published' | 'scheduled' }) {
  const styles: Record<typeof kind, string> = {
    draft: 'bg-slate-100 text-slate-700 ring-slate-200',
    published: 'bg-emerald-50 text-emerald-800 ring-emerald-200',
    scheduled: 'bg-amber-50 text-amber-900 ring-amber-200',
  };
  const labels: Record<typeof kind, string> = {
    draft: 'Draft',
    published: 'Published',
    scheduled: 'Scheduled',
  };
  return (
    <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-[10px] font-black uppercase tracking-wider ring-1 ring-inset ${styles[kind]}`}>
      {labels[kind]}
    </span>
  );
}

const INITIAL_MOCK_CAMPAIGNS: MockCampaignRow[] = [
  {
    id: 'mock_1',
    name: 'Sample: GOTV morning push',
    type: 'tweet',
    waves: 3,
    gapMinutes: 20,
    variantsCount: 6,
    status: 'published',
    targetPartyId: 'bjp',
    createdAt: new Date(Date.now() - 86400000 * 4).toISOString(),
  },
  {
    id: 'mock_2',
    name: 'Sample: Leader quote retweet chain',
    type: 'retweet',
    waves: 5,
    gapMinutes: 15,
    variantsCount: 5,
    status: 'scheduled',
    targetPartyId: 'inc',
    createdAt: new Date(Date.now() - 86400000 * 1).toISOString(),
  },
  {
    id: 'mock_3',
    name: 'Draft: festival hashtag pack',
    type: 'tweet',
    waves: 2,
    gapMinutes: 45,
    variantsCount: 0,
    status: 'draft',
    targetPartyId: 'aap',
    createdAt: new Date(Date.now() - 3600000 * 6).toISOString(),
  },
];

export default function TwitterCampaignPage() {
  const [role, setRole] = useState<string | null>(null);
  const [viewerLoading, setViewerLoading] = useState(true);
  const [toast, setToast] = useState<string | null>(null);

  const [campaignName, setCampaignName] = useState('');
  const [campaignType, setCampaignType] = useState<CampaignType>('tweet');
  const [totalWaves, setTotalWaves] = useState(3);
  const [gapMinutes, setGapMinutes] = useState(15);
  const [scheduleAt, setScheduleAt] = useState('');
  const [targetPartyId, setTargetPartyId] = useState('');
  const [targetedUsersInput, setTargetedUsersInput] = useState('');
  const [description, setDescription] = useState('');

  const [tweetVariants, setTweetVariants] = useState<TweetVariantRow[]>([{ id: newId('tw'), text: '' }]);
  const [retweetVariants, setRetweetVariants] = useState<RetweetVariantRow[]>([{ id: newId('rt'), url: '', note: '' }]);

  const [mockCampaigns, setMockCampaigns] = useState<MockCampaignRow[]>(INITIAL_MOCK_CAMPAIGNS);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch('/api/admin/viewer', { credentials: 'same-origin' });
        if (!res.ok) return;
        const d = (await res.json().catch(() => ({}))) as { role?: string | null };
        if (!cancelled) setRole(typeof d.role === 'string' ? d.role : null);
      } catch {
        /* ignore */
      } finally {
        if (!cancelled) setViewerLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!toast) return;
    const t = window.setTimeout(() => setToast(null), 3200);
    return () => window.clearTimeout(t);
  }, [toast]);

  const canAccess = useMemo(() => {
    const r = (role ?? '').toLowerCase();
    return r === 'admin' || r === 'super_admin' || r === 'moderator';
  }, [role]);

  const variants = campaignType === 'tweet' ? tweetVariants : retweetVariants;
  const variantCount = variants.length;

  const estimatedDurationMinutes = useMemo(() => {
    const w = Math.max(1, Math.floor(totalWaves) || 1);
    const g = Math.max(0, Math.floor(gapMinutes) || 0);
    if (w <= 1) return 0;
    return (w - 1) * g;
  }, [totalWaves, gapMinutes]);

  const scheduleLabel = useMemo(() => {
    const s = scheduleAt.trim();
    if (!s) return '—';
    const d = new Date(s);
    if (Number.isNaN(d.getTime())) return '—';
    return formatMockDate(d.toISOString());
  }, [scheduleAt]);

  const targetedUsersSummary = useMemo(() => {
    const raw = targetedUsersInput.trim();
    if (!raw) return '—';
    const n = Number(raw);
    if (!Number.isFinite(n) || n < 0) return '—';
    return new Intl.NumberFormat().format(Math.floor(n));
  }, [targetedUsersInput]);

  const resetForm = useCallback(() => {
    setCampaignName('');
    setCampaignType('tweet');
    setTotalWaves(3);
    setGapMinutes(15);
    setScheduleAt('');
    setTargetPartyId('');
    setTargetedUsersInput('');
    setDescription('');
    setTweetVariants([{ id: newId('tw'), text: '' }]);
    setRetweetVariants([{ id: newId('rt'), url: '', note: '' }]);
  }, []);

  const onCampaignTypeChange = (next: CampaignType) => {
    setCampaignType(next);
  };

  const addVariant = () => {
    if (campaignType === 'tweet') {
      setTweetVariants((prev) => [...prev, { id: newId('tw'), text: '' }]);
    } else {
      setRetweetVariants((prev) => [...prev, { id: newId('rt'), url: '', note: '' }]);
    }
  };

  const removeVariant = (id: string) => {
    if (campaignType === 'tweet') {
      setTweetVariants((prev) => (prev.length <= 1 ? prev : prev.filter((v) => v.id !== id)));
    } else {
      setRetweetVariants((prev) => (prev.length <= 1 ? prev : prev.filter((v) => v.id !== id)));
    }
  };

  const saveDraftScaffold = () => {
    setToast('Save Draft: UI scaffolding only — no data was persisted.');
  };

  const publishScaffold = () => {
    setToast('Publish Campaign: UI scaffolding only — scheduling and notifications are not wired yet.');
  };

  const deleteMockRow = (id: string) => {
    if (!confirm('Remove this row from the mock table? (Scaffolding only.)')) return;
    setMockCampaigns((prev) => prev.filter((r) => r.id !== id));
    setToast('Mock row removed.');
  };

  const editMockRow = (row: MockCampaignRow) => {
    setCampaignName(row.name);
    setCampaignType(row.type);
    setTotalWaves(row.waves);
    setGapMinutes(row.gapMinutes);
    setTargetPartyId(row.targetPartyId);
    setToast(`Loaded “${row.name}” into the form (local only). Add variants manually to match the row.`);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  if (viewerLoading) {
    return <div className="text-sm font-medium text-zinc-400">Checking access…</div>;
  }

  if (!canAccess) {
    return (
      <div className="mx-auto max-w-lg rounded-2xl border border-zinc-800 bg-zinc-900/60 p-8 text-center">
        <h1 className="text-lg font-bold text-white">Access restricted</h1>
        <p className="mt-2 text-sm text-zinc-400">Twitter Campaign is available to Admins and Moderators only.</p>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-6xl pb-24 text-slate-800">
      {toast ? (
        <div
          className="fixed bottom-6 right-6 z-50 max-w-sm rounded-xl border border-emerald-800/40 bg-emerald-950/90 px-4 py-3 text-sm font-semibold text-emerald-100 shadow-lg"
          role="status"
        >
          {toast}
        </div>
      ) : null}

      <div className="mb-10 flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <div className="mb-1 inline-flex items-center gap-2 rounded-full bg-emerald-50 px-3 py-1 text-xs font-bold uppercase tracking-wider text-emerald-800">
            <Share2 className="h-3.5 w-3.5" style={{ color: ACCENT }} />
            Admin
          </div>
          <h1 className="text-3xl font-black tracking-tight text-white">Twitter Campaign</h1>
        </div>
      </div>

      <div className="space-y-8">
          {/* Create campaign */}
          <section className="rounded-2xl border border-slate-100 bg-white p-6 shadow-md shadow-slate-200/50">
            <h2 className="mb-6 text-xs font-black uppercase tracking-[0.2em] text-slate-400">Create Twitter Campaign</h2>

            <div className="grid gap-5 sm:grid-cols-2">
              <div className="sm:col-span-2">
                <label className="mb-1.5 block text-[10px] font-black uppercase tracking-widest text-slate-400">Campaign name</label>
                <input className={inputClass} value={campaignName} onChange={(e) => setCampaignName(e.target.value)} placeholder="e.g. State launch wave pack" />
              </div>

              <div>
                <label className="mb-1.5 block text-[10px] font-black uppercase tracking-widest text-slate-400">Campaign type</label>
                <select
                  className={selectClass}
                  value={campaignType}
                  onChange={(e) => onCampaignTypeChange(e.target.value as CampaignType)}
                >
                  <option value="tweet">Tweet Campaign</option>
                  <option value="retweet">Retweet Campaign</option>
                </select>
              </div>

              <div>
                <label className="mb-1.5 block text-[10px] font-black uppercase tracking-widest text-slate-400">Total waves</label>
                <input
                  className={inputClass}
                  type="number"
                  min={1}
                  value={totalWaves}
                  onChange={(e) => setTotalWaves(Math.max(1, Number(e.target.value) || 1))}
                />
              </div>

              <div>
                <label className="mb-1.5 block text-[10px] font-black uppercase tracking-widest text-slate-400">Gap between waves (minutes)</label>
                <input
                  className={inputClass}
                  type="number"
                  min={0}
                  value={gapMinutes}
                  onChange={(e) => setGapMinutes(Math.max(0, Number(e.target.value) || 0))}
                />
              </div>

              <div>
                <label className="mb-1.5 block text-[10px] font-black uppercase tracking-widest text-slate-400">Schedule time (optional)</label>
                <input className={inputClass} type="datetime-local" value={scheduleAt} onChange={(e) => setScheduleAt(e.target.value)} />
              </div>

              <div>
                <label className="mb-1.5 block text-[10px] font-black uppercase tracking-widest text-slate-400">Target party</label>
                <select className={selectClass} value={targetPartyId} onChange={(e) => setTargetPartyId(e.target.value)}>
                  <option value="">Select party…</option>
                  {PARTIES_DATA.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.shortName} — {p.fullName}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="mb-1.5 block text-[10px] font-black uppercase tracking-widest text-slate-400">Targeted user (optional)</label>
                <input
                  className={inputClass}
                  type="number"
                  min={0}
                  inputMode="numeric"
                  value={targetedUsersInput}
                  onChange={(e) => setTargetedUsersInput(e.target.value)}
                  placeholder="e.g. audience size estimate"
                />
              </div>

              <div className="sm:col-span-2">
                <label className="mb-1.5 block text-[10px] font-black uppercase tracking-widest text-slate-400">Description</label>
                <textarea className={textareaClass} value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Internal notes, goals, compliance reminders…" rows={4} />
              </div>

              <div className="sm:col-span-2 rounded-xl border border-slate-100 bg-slate-50/80 p-4">
                <span className="mb-2 block text-[10px] font-black uppercase tracking-widest text-slate-400">Alert badge Preview</span>
                <div className="flex flex-wrap items-center gap-2">
                  <StatusChip kind="draft" />
                  <StatusChip kind="published" />
                  <StatusChip kind="scheduled" />
                </div>
              </div>
            </div>
          </section>

          {/* Variants */}
          <section className="rounded-2xl border border-slate-100 bg-white p-6 shadow-md shadow-slate-200/50">
            <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 className="text-xs font-black uppercase tracking-[0.2em] text-slate-400">Tweet variants</h2>
                <p className="mt-1 text-sm font-semibold text-slate-600">
                  {campaignType === 'tweet' ? 'Compose tweet copy per variant.' : 'One URL per variant.'}
                </p>
              </div>
              <button
                type="button"
                onClick={addVariant}
                className="inline-flex items-center gap-2 rounded-xl bg-slate-900 px-4 py-2.5 text-sm font-bold text-white shadow-sm hover:bg-slate-800"
              >
                <Plus className="h-4 w-4" />
                Add variant
              </button>
            </div>

            <div className="space-y-4">
              {campaignType === 'tweet'
                ? tweetVariants.map((v, idx) => (
                    <div key={v.id} className="rounded-2xl border border-slate-100 bg-slate-50/60 p-4 shadow-sm">
                      <div className="mb-3 flex items-center justify-between gap-2">
                        <span className="text-[10px] font-black uppercase tracking-widest text-slate-500">Variant {idx + 1}</span>
                        <button
                          type="button"
                          onClick={() => removeVariant(v.id)}
                          className="inline-flex items-center gap-1 rounded-lg border border-red-200 bg-white px-2 py-1 text-[11px] font-bold text-red-700 hover:bg-red-50"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                          Remove
                        </button>
                      </div>
                      <label className="mb-1.5 block text-[10px] font-black uppercase tracking-widest text-slate-400">Tweet text</label>
                      <textarea
                        className={textareaClass}
                        value={v.text}
                        maxLength={TWEET_CHAR_LIMIT}
                        onChange={(e) =>
                          setTweetVariants((prev) => prev.map((row) => (row.id === v.id ? { ...row, text: e.target.value } : row)))
                        }
                        placeholder="Post copy for X compose…"
                        rows={5}
                      />
                      <div className="mt-1 flex justify-end text-xs font-bold text-slate-500">
                        {v.text.length}/{TWEET_CHAR_LIMIT}
                      </div>
                      <div className="mt-3">
                        <span className="mb-1.5 block text-[10px] font-black uppercase tracking-widest text-slate-400">Image (placeholder)</span>
                        <div className="flex min-h-[100px] cursor-not-allowed flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed border-slate-200 bg-white text-slate-400">
                          <ImageIcon className="h-8 w-8 opacity-50" />
                          <span className="text-xs font-bold">Upload coming in a later phase</span>
                        </div>
                      </div>
                    </div>
                  ))
                : retweetVariants.map((v, idx) => (
                    <div key={v.id} className="rounded-2xl border border-slate-100 bg-slate-50/60 p-4 shadow-sm">
                      <div className="mb-3 flex items-center justify-between gap-2">
                        <span className="text-[10px] font-black uppercase tracking-widest text-slate-500">Variant {idx + 1}</span>
                        <button
                          type="button"
                          onClick={() => removeVariant(v.id)}
                          className="inline-flex items-center gap-1 rounded-lg border border-red-200 bg-white px-2 py-1 text-[11px] font-bold text-red-700 hover:bg-red-50"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                          Remove
                        </button>
                      </div>
                      <label className="mb-1.5 block text-[10px] font-black uppercase tracking-widest text-slate-400">Tweet URL</label>
                      <input
                        className={inputClass}
                        value={v.url}
                        onChange={(e) =>
                          setRetweetVariants((prev) => prev.map((row) => (row.id === v.id ? { ...row, url: e.target.value } : row)))
                        }
                        placeholder="https://x.com/…/status/…"
                      />
                      <label className="mb-1.5 mt-3 block text-[10px] font-black uppercase tracking-widest text-slate-400">Note (optional)</label>
                      <textarea
                        className={textareaClass}
                        rows={3}
                        value={v.note}
                        onChange={(e) =>
                          setRetweetVariants((prev) => prev.map((row) => (row.id === v.id ? { ...row, note: e.target.value } : row)))
                        }
                        placeholder="Moderator context, not sent to users…"
                      />
                    </div>
                  ))}
            </div>
          </section>

          {/* Actions */}
          <div className="flex flex-wrap gap-3">
            <button
              type="button"
              onClick={saveDraftScaffold}
              className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-5 py-3 text-sm font-bold text-slate-800 shadow-sm hover:bg-slate-50"
            >
              <Save className="h-4 w-4" />
              Save draft
            </button>
            <button
              type="button"
              onClick={publishScaffold}
              className="inline-flex items-center gap-2 rounded-xl px-5 py-3 text-sm font-bold text-white shadow-sm"
              style={{ backgroundColor: ACCENT }}
            >
              <Send className="h-4 w-4" />
              Publish campaign
            </button>
            <button
              type="button"
              onClick={resetForm}
              className="rounded-xl border border-zinc-700 bg-zinc-900 px-5 py-3 text-sm font-bold text-zinc-200 hover:bg-zinc-800"
            >
              Reset form
            </button>
          </div>

          {/* Campaign summary — full-width row above table */}
          <section className="rounded-2xl border border-slate-100 bg-white p-5 shadow-md shadow-slate-200/50">
            <h3 className="mb-4 text-xs font-black uppercase tracking-[0.2em] text-slate-400">Campaign summary</h3>
            <div className="grid gap-4 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-7">
              <div className="rounded-xl border border-slate-100 bg-slate-50/80 px-4 py-3">
                <div className="text-[10px] font-black uppercase tracking-wider text-slate-500">Variants</div>
                <div className="mt-1 text-lg font-black text-slate-900">{variantCount}</div>
              </div>
              <div className="rounded-xl border border-slate-100 bg-slate-50/80 px-4 py-3">
                <div className="text-[10px] font-black uppercase tracking-wider text-slate-500">Waves</div>
                <div className="mt-1 text-lg font-black text-slate-900">{Math.max(1, totalWaves)}</div>
              </div>
              <div className="rounded-xl border border-slate-100 bg-slate-50/80 px-4 py-3">
                <div className="text-[10px] font-black uppercase tracking-wider text-slate-500">Est. span</div>
                <div className="mt-1 text-sm font-black leading-snug text-slate-900">
                  {estimatedDurationMinutes === 0 ? 'Single wave' : `~${estimatedDurationMinutes} min`}
                </div>
              </div>
              <div className="rounded-xl border border-slate-100 bg-slate-50/80 px-4 py-3">
                <div className="text-[10px] font-black uppercase tracking-wider text-slate-500">Type</div>
                <div className="mt-1 text-sm font-black text-slate-900">{campaignType === 'tweet' ? 'Tweet' : 'Retweet'}</div>
              </div>
              <div className="rounded-xl border border-slate-100 bg-slate-50/80 px-4 py-3">
                <div className="text-[10px] font-black uppercase tracking-wider text-slate-500">Target party</div>
                <div className="mt-1 text-sm font-black text-slate-900">{targetPartyId ? getPartyLabel(targetPartyId) : '—'}</div>
              </div>
              <div className="rounded-xl border border-slate-100 bg-slate-50/80 px-4 py-3">
                <div className="text-[10px] font-black uppercase tracking-wider text-slate-500">Targeted user</div>
                <div className="mt-1 text-sm font-black leading-snug text-slate-900">{targetedUsersSummary}</div>
              </div>
              <div className="rounded-xl border border-slate-100 bg-slate-50/80 px-4 py-3">
                <div className="text-[10px] font-black uppercase tracking-wider text-slate-500">Schedule</div>
                <div className="mt-1 text-xs font-bold leading-snug text-slate-900">{scheduleLabel}</div>
              </div>
            </div>
          </section>

          {/* Mock table */}
          <section className="rounded-2xl border border-slate-100 bg-white p-6 shadow-md shadow-slate-200/50">
            <h2 className="mb-1 text-xs font-black uppercase tracking-[0.2em] text-slate-400">Campaigns</h2>
            <p className="mb-4 text-sm font-semibold text-slate-600">Mock data for layout only.</p>

            <div className="overflow-x-auto rounded-xl border border-slate-100">
              <table className="w-full min-w-[760px] text-left text-sm">
                <thead className="border-b border-slate-100 bg-slate-50 text-[10px] font-black uppercase tracking-wider text-slate-500">
                  <tr>
                    <th className="px-3 py-3">Campaign name</th>
                    <th className="px-3 py-3">Type</th>
                    <th className="px-3 py-3">Waves</th>
                    <th className="px-3 py-3">Gap</th>
                    <th className="px-3 py-3">Variants</th>
                    <th className="px-3 py-3">Status</th>
                    <th className="px-3 py-3">Party</th>
                    <th className="px-3 py-3">Created at</th>
                    <th className="px-3 py-3 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {mockCampaigns.length === 0 ? (
                    <tr>
                      <td colSpan={9} className="px-3 py-8 text-center text-sm font-semibold text-slate-500">
                        No mock rows. Refresh the page to restore samples.
                      </td>
                    </tr>
                  ) : (
                    mockCampaigns.map((row) => (
                      <tr key={row.id} className="bg-white font-medium text-slate-800 hover:bg-slate-50/80">
                        <td className="max-w-[200px] truncate px-3 py-3 font-bold">{row.name}</td>
                        <td className="px-3 py-3">{row.type === 'tweet' ? 'Tweet' : 'Retweet'}</td>
                        <td className="px-3 py-3">{row.waves}</td>
                        <td className="px-3 py-3">{row.gapMinutes} min</td>
                        <td className="px-3 py-3">{row.variantsCount}</td>
                        <td className="px-3 py-3">
                          <StatusChip kind={row.status} />
                        </td>
                        <td className="px-3 py-3">{getPartyLabel(row.targetPartyId) || '—'}</td>
                        <td className="whitespace-nowrap px-3 py-3 text-slate-600">{formatMockDate(row.createdAt)}</td>
                        <td className="px-3 py-3 text-right">
                          <div className="flex flex-wrap justify-end gap-1">
                            <button
                              type="button"
                              className="rounded-lg border border-slate-200 bg-white px-2 py-1 text-[11px] font-bold text-slate-700 hover:bg-slate-50"
                              onClick={() => setToast(`View: “${row.name}” (scaffolding).`)}
                            >
                              <Eye className="mr-0.5 inline h-3.5 w-3.5 align-text-bottom" />
                              View
                            </button>
                            <button
                              type="button"
                              className="rounded-lg border border-slate-200 bg-white px-2 py-1 text-[11px] font-bold text-slate-700 hover:bg-slate-50"
                              onClick={() => editMockRow(row)}
                            >
                              <Pencil className="mr-0.5 inline h-3.5 w-3.5 align-text-bottom" />
                              Edit
                            </button>
                            <button
                              type="button"
                              className="rounded-lg border border-red-200 bg-white px-2 py-1 text-[11px] font-bold text-red-700 hover:bg-red-50"
                              onClick={() => deleteMockRow(row.id)}
                            >
                              <Trash2 className="mr-0.5 inline h-3.5 w-3.5 align-text-bottom" />
                              Delete
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </section>
      </div>
    </div>
  );
}
