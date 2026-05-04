"use client";
import { Flag, Info, Users } from 'lucide-react';
import React, { useEffect, useMemo, useState } from 'react';
import { supabase } from '@/lib/supabase';

/** Accent tiles for party cards (cycles); "Other" uses neutral icon tile instead */
const CARD_ACCENT_CLASSES = [
  'bg-orange-500',
  'bg-blue-500',
  'bg-red-600',
  'bg-sky-600',
  'bg-blue-800',
  'bg-green-600',
  'bg-emerald-500',
  'bg-violet-600',
  'bg-rose-600',
  'bg-amber-600',
] as const;

type PartyRow = {
  id: string;
  name: string;
  logo_url: string | null;
};

function isOtherPartyId(id: string) {
  return String(id || '').trim().toLowerCase() === 'other';
}

export default function PartyManager() {
  const [loading, setLoading] = useState(true);
  const [rows, setRows] = useState<Array<PartyRow & { accentClass: string }>>([]);
  const [error, setError] = useState<string | null>(null);

  const [formId, setFormId] = useState('');
  const [formName, setFormName] = useState('');
  const [formLogoPublicUrl, setFormLogoPublicUrl] = useState('');
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    setError(null);
    const { data, error: err } = await supabase
      .from('parties')
      .select('id,name,logo_url')
      .order('name', { ascending: true });
    if (err) {
      setError(err.message || 'Could not load parties');
      setRows([]);
      setLoading(false);
      return;
    }
    const normalized = (data || [])
      .map((r: any) => ({
        id: String(r.id ?? '').trim(),
        name: String(r.name ?? '').trim(),
        logo_url: r.logo_url == null ? null : String(r.logo_url).trim() || null,
      }))
      .filter((r) => r.id && r.name);

    setRows(
      normalized.map((p, i) => ({
        ...p,
        accentClass: CARD_ACCENT_CLASSES[i % CARD_ACCENT_CLASSES.length],
      }))
    );
    setLoading(false);
  };

  useEffect(() => {
    void load();
  }, []);

  const resetForm = () => {
    setFormId('');
    setFormName('');
    setFormLogoPublicUrl('');
    setEditingId(null);
  };

  const handleImageUpload = async (file: File | null) => {
    if (!file) return;
    const baseId = (editingId || formId).trim();
    if (!baseId) {
      setError('Please enter an id before uploading a logo.');
      return;
    }

    setUploading(true);
    setError(null);
    try {
      const safeName = String(file.name || '').trim();
      const ext = (safeName.split('.').pop() || 'png').toLowerCase();
      const safeExt = /^[a-z0-9]+$/i.test(ext) && ext.length <= 5 ? ext : 'png';
      const path = `${baseId}_${Date.now()}.${safeExt}`;

      const { error: upErr } = await supabase.storage
        .from('post-images')
        .upload(path, file, { upsert: true, contentType: file.type || `image/${safeExt}` });
      if (upErr) throw upErr;

      const { data } = supabase.storage.from('post-images').getPublicUrl(path);
      const publicUrl = data?.publicUrl ? String(data.publicUrl) : '';
      if (!publicUrl) throw new Error('Upload succeeded but public URL is missing.');

      setFormLogoPublicUrl(publicUrl);
    } catch (e: any) {
      setError(e?.message || 'Logo upload failed');
    } finally {
      setUploading(false);
    }
  };

  const onSubmit = async () => {
    const id = formId.trim();
    const name = formName.trim();
    const logo_url = formLogoPublicUrl.trim() || null;
    if (!id || !name) return;

    setSaving(true);
    setError(null);
    try {
      if (editingId) {
        const { error: upErr } = await supabase
          .from('parties')
          .update({ name, logo_url })
          .eq('id', editingId);
        if (upErr) throw upErr;
      } else {
        const { error: insErr } = await supabase
          .from('parties')
          .insert({ id, name, logo_url });
        if (insErr) throw insErr;
      }
      resetForm();
      await load();
    } catch (e: any) {
      setError(e?.message || 'Save failed');
    } finally {
      setSaving(false);
    }
  };

  const startEdit = (p: PartyRow) => {
    setEditingId(p.id);
    setFormId(p.id);
    setFormName(p.name);
    setFormLogoPublicUrl(p.logo_url || '');
  };

  const removeParty = async (id: string) => {
    if (!id) return;
    const ok = confirm('Delete this party?');
    if (!ok) return;
    setSaving(true);
    setError(null);
    try {
      const { error: delErr } = await supabase.from('parties').delete().eq('id', id);
      if (delErr) throw delErr;
      if (editingId === id) resetForm();
      await load();
    } catch (e: any) {
      setError(e?.message || 'Delete failed');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="max-w-6xl mx-auto space-y-8 animate-in fade-in duration-500 text-slate-700 pb-20">
      {/* HEADER CARD */}
      <div className="bg-white p-8 rounded-[40px] border border-slate-100 shadow-sm flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div className="flex items-center gap-4">
          <div className="w-14 h-14 bg-blue-600 rounded-2xl flex items-center justify-center text-white shadow-xl shadow-blue-100">
            <Flag size={28} />
          </div>
          <div>
            <h1 className="text-3xl font-black text-slate-900 tracking-tight leading-none">Parties</h1>
            <p className="text-xs font-bold text-slate-400 uppercase tracking-[0.2em] mt-2">
              Live party list from Supabase ({rows.length} parties)
            </p>
          </div>
        </div>
      </div>

      {/* MANAGER FORM */}
      <div className="bg-slate-50 border border-slate-200 rounded-[28px] p-6 space-y-4">
        <div className="flex gap-4 items-start">
          <div className="w-11 h-11 rounded-2xl bg-white border border-slate-100 flex items-center justify-center text-blue-600 shrink-0 shadow-sm">
            <Info size={22} />
          </div>
          <div className="flex-1">
            <p className="font-black text-slate-900 text-sm uppercase tracking-widest mb-1">
              Manage parties
            </p>
            <p className="text-sm font-medium text-slate-600 leading-relaxed">
              Add, edit, or delete parties in real-time. Data is stored in the Supabase table{' '}
              <code className="text-xs font-mono bg-white px-1.5 py-0.5 rounded border border-slate-200">parties</code>.
            </p>
          </div>
        </div>

        {error ? (
          <div className="bg-white border border-red-200 text-red-700 rounded-2xl px-4 py-3 font-bold text-sm">
            {error}
          </div>
        ) : null}

        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <input
            value={formId}
            onChange={(e) => {
              const v = e.target.value;
              if (editingId) return;
              setFormId(v);
            }}
            placeholder="id (e.g. bjp)"
            className="w-full bg-white border border-slate-200 rounded-2xl px-4 py-3 font-bold text-slate-800 outline-none focus:ring-2 focus:ring-blue-500/30"
            disabled={!!editingId}
          />
          <input
            value={formName}
            onChange={(e) => setFormName(e.target.value)}
            placeholder="name (e.g. Bharatiya Janata Party)"
            className="w-full bg-white border border-slate-200 rounded-2xl px-4 py-3 font-bold text-slate-800 outline-none focus:ring-2 focus:ring-blue-500/30"
          />
          <div className="w-full bg-white border border-slate-200 rounded-2xl px-4 py-3 font-bold text-slate-800 outline-none focus-within:ring-2 focus-within:ring-blue-500/30">
            <div className="flex items-center justify-between gap-3">
              <label className="text-[11px] font-black uppercase tracking-widest text-slate-500">
                {uploading ? 'Uploading…' : 'Party logo'}
              </label>
              {formLogoPublicUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={formLogoPublicUrl}
                  alt="Logo preview"
                  className="h-8 w-8 rounded-lg object-contain bg-slate-50 border border-slate-200"
                />
              ) : null}
            </div>
            <input
              type="file"
              accept="image/*"
              disabled={uploading || saving}
              onChange={(e) => {
                const file = e.target.files?.[0] ?? null;
                void handleImageUpload(file);
              }}
              className="mt-2 w-full text-xs font-bold text-slate-700 file:mr-3 file:rounded-xl file:border-0 file:bg-slate-900 file:px-4 file:py-2 file:text-xs file:font-black file:uppercase file:tracking-widest file:text-white hover:file:bg-blue-600 disabled:opacity-60"
            />
            {formLogoPublicUrl ? (
              <p className="mt-2 text-[10px] font-mono text-slate-400 truncate" title={formLogoPublicUrl}>
                {formLogoPublicUrl}
              </p>
            ) : (
              <p className="mt-2 text-[10px] font-bold text-slate-400">
                Upload an image; we’ll save the public URL into <code className="font-mono">parties.logo_url</code>.
              </p>
            )}
          </div>
        </div>

        <div className="flex flex-wrap gap-3">
          <button
            onClick={() => void onSubmit()}
            disabled={saving || !formId.trim() || !formName.trim()}
            className="bg-slate-900 text-white px-6 py-3 rounded-2xl font-black text-xs uppercase tracking-widest hover:bg-blue-600 transition-all disabled:opacity-50"
          >
            {editingId ? 'Update' : 'Add'}
          </button>
          {editingId ? (
            <button
              onClick={resetForm}
              disabled={saving}
              className="bg-white border border-slate-200 px-6 py-3 rounded-2xl font-black text-xs uppercase tracking-widest hover:bg-slate-50 transition-all disabled:opacity-50"
            >
              Cancel
            </button>
          ) : null}
          <button
            onClick={() => void load()}
            disabled={saving}
            className="bg-white border border-slate-200 px-6 py-3 rounded-2xl font-black text-xs uppercase tracking-widest hover:bg-slate-50 transition-all disabled:opacity-50"
          >
            Refresh
          </button>
        </div>
      </div>

      {/* PARTY GRID — mirrors mobile PARTIES_DATA */}
      <div className="space-y-6">
        <h3 className="text-[11px] font-black text-slate-400 uppercase tracking-[0.3em] flex items-center gap-2 px-2">
          <Flag size={14} className="text-blue-500" /> Registered parties ({rows.length})
        </h3>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
          {loading ? null : null}
          {rows.map((party) => (
            <div
              key={party.id}
              className="bg-white p-7 rounded-[40px] border border-slate-100 shadow-sm hover:shadow-md transition-all duration-300 flex flex-col"
            >
              <div className="flex justify-between items-start mb-6">
                {isOtherPartyId(party.id) ? (
                  <div
                    className="w-16 h-16 rounded-2xl bg-slate-100 flex items-center justify-center text-slate-600 shadow-inner ring-4 ring-white"
                    title="Other"
                  >
                    <Users size={28} strokeWidth={2} aria-hidden />
                  </div>
                ) : (
                  <div
                    className={`w-16 h-16 rounded-2xl ${party.accentClass} flex items-center justify-center text-white font-black text-xs shadow-lg ring-4 ring-white text-center leading-tight px-1`}
                  >
                    {party.logo_url ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={party.logo_url}
                        alt={party.name}
                        className="w-full h-full object-contain p-2"
                      />
                    ) : (
                      party.id.toUpperCase()
                    )}
                  </div>
                )}
              </div>

              <h4 className="font-black text-slate-900 text-lg leading-tight tracking-tight mb-1">{party.name}</h4>
              <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-2">{party.id}</p>
              <p className="mt-auto text-[9px] font-mono text-slate-300 truncate" title={party.id}>
                id: {party.id}
              </p>

              <div className="mt-4 flex gap-2">
                <button
                  onClick={() => startEdit(party)}
                  disabled={saving}
                  className="flex-1 bg-slate-50 border border-slate-200 px-3 py-2 rounded-2xl font-black text-[10px] uppercase tracking-widest hover:bg-slate-100 transition-all disabled:opacity-50"
                >
                  Edit
                </button>
                <button
                  onClick={() => void removeParty(party.id)}
                  disabled={saving}
                  className="flex-1 bg-white border border-red-200 text-red-700 px-3 py-2 rounded-2xl font-black text-[10px] uppercase tracking-widest hover:bg-red-50 transition-all disabled:opacity-50"
                >
                  Delete
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
