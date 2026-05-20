'use client';

import { Calendar, CheckCircle2 } from 'lucide-react';
import React, { useState } from 'react';

export default function EventCreateClient() {
  const [name, setName] = useState('');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [success, setSuccess] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const createDraftEvent = async () => {
    if (!name.trim() || !startDate || !endDate) return;
    setSubmitting(true);
    setError(null);
    setSuccess(null);
    const startVal = `${startDate}T00:00:00Z`;
    const endVal = `${endDate}T23:59:59Z`;
    try {
      const res = await fetch('/api/admin/events', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: name.trim(), start: startVal, end: endVal, captions: [] }),
      });
      const data = (await res.json().catch(() => ({}))) as { event?: { name?: string }; error?: string };
      if (!res.ok) {
        setError(data.error || `Request failed (${res.status})`);
        return;
      }
      setSuccess(`Draft event "${data.event?.name ?? name.trim()}" submitted for admin review.`);
      setName('');
      setStartDate('');
      setEndDate('');
    } catch {
      setError('Network error. Please try again.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="max-w-3xl space-y-6">
      <div className="flex items-center gap-3 text-white">
        <Calendar className="h-8 w-8 text-blue-400" />
        <div>
          <h1 className="text-2xl font-bold">Create Event</h1>
          <p className="text-sm text-zinc-400">
            Editors can submit draft events only. Publishing and edits require an admin.
          </p>
        </div>
      </div>

      {success ? (
        <div className="flex items-start gap-3 rounded-2xl border border-emerald-800/50 bg-emerald-950/40 p-4 text-emerald-200">
          <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0" />
          <p className="text-sm font-medium">{success}</p>
        </div>
      ) : null}

      {error ? (
        <div className="rounded-2xl border border-rose-800/50 bg-rose-950/40 p-4 text-sm font-medium text-rose-200">
          {error}
        </div>
      ) : null}

      <div className="rounded-[35px] border border-slate-200 bg-white p-6 shadow-lg">
        <div className="grid gap-4">
          <div className="rounded-2xl border border-slate-200 bg-white p-3">
            <span className="mb-1 block text-[9px] font-black uppercase tracking-widest text-slate-400">
              Event Name
            </span>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Independence Day"
              className="w-full rounded-xl border border-slate-100 bg-slate-50 p-2.5 text-sm font-bold text-slate-800 outline-none focus:ring-2 focus:ring-blue-500/30"
            />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="rounded-2xl border border-slate-200 bg-white p-3">
              <span className="mb-1 block text-[9px] font-black uppercase tracking-widest text-slate-400">
                Activation
              </span>
              <input
                type="date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
                className="w-full rounded-xl border border-slate-100 bg-slate-50 p-2.5 text-xs font-bold outline-none"
              />
            </div>
            <div className="rounded-2xl border border-slate-200 bg-white p-3">
              <span className="mb-1 block text-[9px] font-black uppercase tracking-widest text-rose-400">
                Expiry
              </span>
              <input
                type="date"
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
                className="w-full rounded-xl border border-slate-100 bg-slate-50 p-2.5 text-xs font-bold outline-none"
              />
            </div>
          </div>
          <div className="flex justify-end">
            <button
              type="button"
              onClick={createDraftEvent}
              disabled={submitting || !name.trim() || !startDate || !endDate}
              className="rounded-2xl bg-blue-600 px-8 py-2.5 text-xs font-black uppercase tracking-widest text-white transition-all hover:bg-slate-900 disabled:opacity-30"
            >
              {submitting ? 'Saving…' : 'Save Draft'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
