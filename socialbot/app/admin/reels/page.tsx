"use client";

import {
  AlertTriangle,
  ArrowLeft,
  Calendar,
  CheckCircle2,
  ChevronRight,
  FileText,
  Folder,
  MessageSquare,
  Pencil,
  Plus,
  PlusCircle,
  Trash2,
  Video
} from 'lucide-react';
import React, { useEffect, useRef, useState } from 'react';
import { captionsJsonForPostColumn, normalizeCaptionsFromDb } from '@/lib/captions';
import { supabase } from "../../../lib/supabase";

interface ReelPost {
  id: string;
  url: string;
  type: 'video';
  name: string;
}

interface ReelEvent {
  id: string | number;
  name: string;
  start: string;
  end: string;
  posts: ReelPost[];
  captions: string[];
}

export default function ReelUploaderPage() {
  const [currentTime, setCurrentTime] = useState(new Date());
  const [view, setView] = useState<'list' | 'gallery'>('list');
  const [selectedEvent, setSelectedEvent] = useState<ReelEvent | null>(null);
  const [postToDelete, setPostToDelete] = useState<ReelPost | null>(null);
  const [captionToDelete, setCaptionToDelete] = useState<number | null>(null);
  const [newCaptionText, setNewCaptionText] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const timer = setInterval(() => setCurrentTime(new Date()), 10000);
    return () => clearInterval(timer);
  }, []);

  const [events, setEvents] = useState<ReelEvent[]>([]);
  const [eventsLoading, setEventsLoading] = useState(true);

  useEffect(() => {
    const fetchEvents = async () => {
      const { data, error } = await supabase.from('events').select('*').order('name');
      if (error) {
        console.error('fetchEvents error:', error);
        setEvents([]);
        return;
      }
      const mapped: ReelEvent[] = (data || []).map((row: { id?: string; name: string; start?: string; end?: string; captions?: unknown }) => ({
        id: row.id ?? row.name,
        name: row.name,
        start: row.start ?? '',
        end: row.end ?? '',
        posts: [],
        captions: normalizeCaptionsFromDb(row.captions),
      }));
      setEvents(mapped);
    };
    fetchEvents().finally(() => setEventsLoading(false));
  }, []);

  const [newName, setNewName] = useState('');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [isDeleting, setIsDeleting] = useState<ReelEvent | null>(null);
  const [editingEvent, setEditingEvent] = useState<ReelEvent | null>(null);
  const [uploading, setUploading] = useState(false);
  const [toast, setToast] = useState<{ type: 'success' | 'error'; msg: string } | null>(null);

  const getStatus = (sDate: string, eDate: string) => {
    const now = currentTime.getTime();
    const s = new Date(sDate).getTime();
    const e = new Date(eDate).getTime();
    if (now < s) return { id: 'soon', label: 'Upcoming', color: 'bg-blue-50 text-blue-600' };
    if (now >= s && now <= e) return { id: 'live', label: 'Live Now', color: 'bg-green-50 text-green-600', pulse: true };
    return { id: 'done', label: 'Expired', color: 'bg-slate-100 text-slate-400' };
  };

  const createEvent = async () => {
    if (!newName || !startDate || !endDate) return;
    const startVal = `${startDate}T00:00:00`;
    const endVal = `${endDate}T23:59:59`;
    const { data, error } = await supabase
      .from('events')
      .insert({ name: newName, start: startVal, end: endVal, captions: [] })
      .select()
      .single();
    if (error) {
      if (error.code === '23505' || /duplicate|unique/i.test(error.message ?? '')) {
        setToast({ type: 'error', msg: 'An event with this name already exists.' });
        setTimeout(() => setToast(null), 3000);
      }
      return;
    }
    const ev: ReelEvent = {
      id: data.id ?? data.name,
      name: data.name,
      start: data.start ?? startVal,
      end: data.end ?? endVal,
      posts: [],
      captions: normalizeCaptionsFromDb(data.captions),
    };
    setEvents((prev) => [ev, ...prev]);
    setNewName('');
    setStartDate('');
    setEndDate('');
  };

  const openEvent = async (ev: ReelEvent) => {
    const [eventsRes, postsRes] = await Promise.all([
      supabase.from('events').select('captions').eq('name', ev.name).single(),
      supabase.from('posts').select('id, image_url, video_url, title, is_video').eq('category', ev.name).order('created_at', { ascending: false }),
    ]);
    const dbCaptions = normalizeCaptionsFromDb(eventsRes.data?.captions ?? ev.captions);
    const postsFromDb: ReelPost[] = (postsRes.data || [])
      .filter((p: { is_video?: boolean; video_url?: string }) => p.is_video === true || (p as { video_url?: string }).video_url)
      .map((p: { id: string; image_url?: string; video_url?: string; title?: string }) => ({
        id: p.id,
        url: (p as { video_url?: string }).video_url || p.image_url || '',
        type: 'video' as const,
        name: (p as { title?: string }).title || '',
      }));
    const evWithData = { ...ev, captions: dbCaptions, posts: postsFromDb };
    setEvents((prev) => prev.map((e) => (e.id === ev.id ? { ...e, captions: dbCaptions, posts: postsFromDb } : e)));
    setSelectedEvent(evWithData);
    setView('gallery');
  };

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || !selectedEvent) return;

    const videoFiles = Array.from(files).filter((f) => f.type.startsWith('video/'));
    if (videoFiles.length === 0) return;

    setUploading(true);
    const newPosts: ReelPost[] = [];

    for (const file of videoFiles) {
      const storagePath = `reels/${Date.now()}-${file.name.replace(/[^a-zA-Z0-9.-]/g, '_')}`;

      const { error: uploadErr } = await supabase.storage.from('post-images').upload(storagePath, file, { upsert: true });
      if (uploadErr) {
        setToast({ type: 'error', msg: uploadErr.message || 'Upload failed' });
        setTimeout(() => setToast(null), 3000);
        continue;
      }

      const { data: urlData } = supabase.storage.from('post-images').getPublicUrl(storagePath);
      const publicUrl = urlData.publicUrl;

      const { data: insertData, error: insertErr } = await supabase
        .from('posts')
        .insert({
          video_url: publicUrl,
          image_url: publicUrl,
          category: selectedEvent.name,
          is_video: true,
          aspect_ratio: '9:16',
          title: file.name.replace(/\.[^/.]+$/, '') || 'New Reel',
          captions: captionsJsonForPostColumn(normalizeCaptionsFromDb(selectedEvent.captions)),
        })
        .select('id')
        .single();

      if (insertErr) {
        setToast({ type: 'error', msg: insertErr.message || 'DB insert failed' });
        setTimeout(() => setToast(null), 3000);
        continue;
      }

      newPosts.push({
        id: insertData.id,
        url: publicUrl,
        type: 'video',
        name: file.name,
      });
    }

    if (newPosts.length > 0) {
      const updated = events.map((ev) =>
        ev.id === selectedEvent.id ? { ...ev, posts: [...newPosts, ...ev.posts] } : ev
      );
      setEvents(updated);
      setSelectedEvent({ ...selectedEvent, posts: [...newPosts, ...selectedEvent.posts] });
      setToast({ type: 'success', msg: `${newPosts.length} reel(s) uploaded successfully.` });
      setTimeout(() => setToast(null), 3000);
    }
    if (fileInputRef.current) fileInputRef.current.value = '';
    setUploading(false);
  };

  const addCaptionToList = async () => {
    if (!selectedEvent || !newCaptionText.trim()) return;
    const updatedCaptions = [...selectedEvent.captions, newCaptionText.trim()];
    await supabase.from('events').upsert({ name: selectedEvent.name, start: selectedEvent.start, end: selectedEvent.end, captions: updatedCaptions }, { onConflict: 'name' });
    const updatedEvents = events.map((ev) =>
      ev.id === selectedEvent.id ? { ...ev, captions: updatedCaptions } : ev
    );
    setEvents(updatedEvents);
    setSelectedEvent({ ...selectedEvent, captions: updatedCaptions });
    setNewCaptionText('');
  };

  const confirmDeleteCaption = async () => {
    if (!selectedEvent || captionToDelete === null) return;
    const updatedCaptions = selectedEvent.captions.filter((_, i) => i !== captionToDelete);
    await supabase.from('events').upsert({ name: selectedEvent.name, start: selectedEvent.start, end: selectedEvent.end, captions: updatedCaptions }, { onConflict: 'name' });
    const updatedEvents = events.map((ev) =>
      ev.id === selectedEvent.id ? { ...ev, captions: updatedCaptions } : ev
    );
    setEvents(updatedEvents);
    setSelectedEvent({ ...selectedEvent, captions: updatedCaptions });
    setCaptionToDelete(null);
  };

  const getStoragePathFromUrl = (url: string): string | null => {
    const match = url.match(/\/post-images\/(.+)$/);
    return match ? decodeURIComponent(match[1]) : null;
  };

  const deleteEvent = async (ev: ReelEvent) => {
    try {
      const { data: postsData } = await supabase.from('posts').select('id, image_url, video_url').eq('category', ev.name);
      const postsToClean = postsData || [];

      const filePaths: string[] = [];
      for (const p of postsToClean) {
        const url = (p as { video_url?: string }).video_url || p.image_url;
        const path = getStoragePathFromUrl(url);
        if (path) filePaths.push(path);
      }

      if (filePaths.length > 0) {
        await supabase.storage.from('post-images').remove(filePaths);
      }
      await supabase.from('posts').delete().eq('category', ev.name);
      await supabase.from('events').delete().eq('name', ev.name);

      setEvents((prev) => prev.filter((e) => e.id !== ev.id));
      if (selectedEvent?.id === ev.id) {
        setView('list');
        setSelectedEvent(null);
      }
    } catch (err) {
      console.error('deleteEvent exception:', err);
    } finally {
      setIsDeleting(null);
    }
  };

  const removePost = async () => {
    if (!selectedEvent || !postToDelete) return;

    const postId = postToDelete.id;
    const postUrl = postToDelete.url;
    const ev = selectedEvent;

    await supabase.from('posts').delete().eq('id', postId);

    const filePath = getStoragePathFromUrl(postUrl);
    if (filePath) {
      await supabase.storage.from('post-images').remove([filePath]);
    }

    const filtered = ev.posts.filter((p) => p.id !== postId);
    const updated = events.map((e) => (e.id === ev.id ? { ...e, posts: filtered } : e));
    setEvents(updated);
    setSelectedEvent({ ...ev, posts: filtered });
    setPostToDelete(null);
  };

  const formatDate = (d: string) => new Date(d).toLocaleDateString('en-US', { day: '2-digit', month: 'short' });

  const toDateInputValue = (iso: string) => {
    if (!iso) return '';
    const d = new Date(iso);
    return d.toISOString().slice(0, 10);
  };

  const openEditModal = (ev: ReelEvent) => {
    setEditingEvent(ev);
    setNewName(ev.name);
    setStartDate(toDateInputValue(ev.start));
    setEndDate(toDateInputValue(ev.end));
  };

  const updateEvent = async () => {
    if (!newName || !startDate || !endDate || !editingEvent) return;

    const originalName = editingEvent.name;

    await supabase
      .from('events')
      .update({
        name: newName.trim(),
        start: `${startDate}T00:00:00`,
        end: `${endDate}T23:59:59`,
        captions: editingEvent.captions,
      })
      .eq('name', originalName);

    if (newName.trim() !== originalName) {
      await supabase.from('posts').update({ category: newName.trim() }).eq('category', originalName);
    }

    const newStart = `${startDate}T00:00:00`;
    const newEnd = `${endDate}T23:59:59`;
    const updated: ReelEvent = { ...editingEvent, name: newName.trim(), start: newStart, end: newEnd };
    setEvents((prev) => prev.map((ev) => (ev.name === originalName ? updated : ev)));
    if (selectedEvent?.name === originalName) {
      setSelectedEvent(updated);
    }

    setEditingEvent(null);
    setNewName('');
    setStartDate('');
    setEndDate('');
    setToast({ type: 'success', msg: 'Event updated successfully.' });
    setTimeout(() => setToast(null), 3000);
  };

  // --- VIEW 1: EVENT LIST ---
  if (view === 'list') {
    return (
      <div className="max-w-6xl mx-auto p-4 space-y-8 animate-in fade-in duration-500 text-slate-700">
        {toast && (
          <div className={`fixed top-6 left-1/2 -translate-x-1/2 z-[200] px-6 py-4 rounded-2xl shadow-2xl flex items-center gap-3 ${toast.type === 'success' ? 'bg-emerald-50 border border-emerald-200' : 'bg-rose-50 border border-rose-200'}`}>
            {toast.type === 'success' ? (
              <div className="w-10 h-10 bg-emerald-500 text-white rounded-xl flex items-center justify-center"><CheckCircle2 size={22} /></div>
            ) : (
              <div className="w-10 h-10 bg-rose-500 text-white rounded-xl flex items-center justify-center font-black">!</div>
            )}
            <p className={`font-bold text-sm ${toast.type === 'success' ? 'text-emerald-800' : 'text-rose-800'}`}>{toast.msg}</p>
          </div>
        )}

        {isDeleting && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/40 backdrop-blur-sm p-4">
            <div className="bg-white rounded-[40px] p-10 max-w-sm w-full text-center space-y-6 shadow-2xl animate-in zoom-in-95">
              <div className="w-20 h-20 bg-red-50 text-red-500 rounded-full flex items-center justify-center mx-auto shadow-inner"><AlertTriangle size={40} /></div>
              <p className="font-black text-xl text-slate-900">Delete Event?</p>
              <div className="flex gap-4">
                <button onClick={() => setIsDeleting(null)} className="flex-1 py-4 bg-slate-100 rounded-2xl font-bold">Cancel</button>
                <button onClick={() => deleteEvent(isDeleting)} className="flex-1 py-4 bg-red-600 text-white rounded-2xl font-bold">Delete</button>
              </div>
            </div>
          </div>
        )}

        {editingEvent && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/40 backdrop-blur-sm p-4">
            <div className="bg-white rounded-[40px] p-8 max-w-md w-full shadow-2xl animate-in zoom-in-95 border border-slate-100">
              <div className="w-14 h-14 bg-blue-50 text-blue-600 rounded-2xl flex items-center justify-center mx-auto mb-6"><Pencil size={28} /></div>
              <p className="font-black text-xl text-slate-900 mb-6">Edit Event</p>
              <div className="space-y-4 text-left">
                <div className="flex flex-col">
                  <label className="text-[9px] font-black text-slate-400 uppercase tracking-widest mb-1">Event Name</label>
                  <input type="text" value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="e.g. Independence Day" className="w-full bg-slate-50 border border-slate-100 rounded-2xl px-4 py-3 font-bold text-slate-800 outline-none focus:ring-2 focus:ring-blue-500/30" />
                </div>
                <div className="flex gap-3">
                  <div className="flex flex-col flex-1">
                    <label className="text-[9px] font-black text-slate-400 uppercase tracking-widest mb-1">Activation</label>
                    <input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} className="w-full bg-slate-50 border border-slate-100 rounded-2xl px-4 py-3 font-bold text-slate-800 outline-none focus:ring-2 focus:ring-blue-500/30" />
                  </div>
                  <div className="flex flex-col flex-1">
                    <label className="text-[9px] font-black text-rose-400 uppercase tracking-widest mb-1">Expiry</label>
                    <input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} className="w-full bg-slate-50 border border-slate-100 rounded-2xl px-4 py-3 font-bold text-slate-800 outline-none focus:ring-2 focus:ring-blue-500/30" />
                  </div>
                </div>
              </div>
              <div className="flex gap-4 mt-8">
                <button onClick={() => { setEditingEvent(null); setNewName(''); setStartDate(''); setEndDate(''); }} className="flex-1 py-4 bg-slate-100 rounded-2xl font-bold text-slate-700">Cancel</button>
                <button onClick={updateEvent} disabled={!newName.trim() || !startDate || !endDate} className="flex-1 py-4 bg-blue-600 text-white rounded-2xl font-bold disabled:opacity-30">Save</button>
              </div>
            </div>
          </div>
        )}

        {/* Professional Header Card */}
        <div className="bg-white p-8 rounded-[40px] border border-slate-100 shadow-sm flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div className="flex items-center gap-4">
            <div className="w-14 h-14 bg-blue-600 rounded-2xl flex items-center justify-center text-white shadow-xl">
              <Video size={28} />
            </div>
            <div>
              <h1 className="text-3xl font-black text-slate-900 tracking-tight leading-none">Reel Hub</h1>
              <p className="text-xs font-bold text-slate-400 uppercase tracking-[0.2em] mt-2">Manage events, Reels & Captions</p>
            </div>
          </div>
        </div>

        {/* Create Event Strip */}
        <div className="bg-white p-3 rounded-[35px] border border-slate-200 shadow-lg flex flex-col lg:flex-row items-stretch gap-4">
          <div className="flex items-center gap-4 flex-[1.5] bg-slate-50 p-3 rounded-2xl border border-slate-100">
            <div className="w-10 h-10 bg-slate-900 text-white rounded-xl flex items-center justify-center shrink-0"><Plus size={20} /></div>
            <div className="flex-1">
              <span className="text-[9px] font-black text-slate-400 uppercase tracking-widest block mb-0.5">Event Name</span>
              <input type="text" value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="e.g. Independence Day" className="w-full bg-transparent outline-none font-bold text-slate-800" />
            </div>
          </div>
          <div className="flex flex-[2] items-center gap-3">
            <div className="flex flex-col flex-1 bg-slate-50 p-3 rounded-2xl border border-slate-100">
              <span className="text-[9px] font-black text-slate-400 uppercase tracking-widest mb-0.5">Activation</span>
              <input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} className="bg-transparent outline-none font-bold text-xs" />
            </div>
            <div className="flex flex-col flex-1 bg-slate-50 p-3 rounded-2xl border border-slate-100">
              <span className="text-[9px] font-black text-rose-400 uppercase tracking-widest mb-0.5">Expiry</span>
              <input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} className="bg-transparent outline-none font-bold text-xs" />
            </div>
          </div>
          <button onClick={createEvent} disabled={!newName || !startDate || !endDate} className="bg-blue-600 text-white px-12 rounded-2xl font-black text-xs hover:bg-slate-900 disabled:opacity-30 transition-all uppercase tracking-widest">Add</button>
        </div>

        <div className="space-y-12 pb-20">
          {eventsLoading ? (
            <div className="py-20 text-center text-slate-400 font-bold text-sm">Loading events…</div>
          ) : (
            <>
              {['live', 'soon', 'done'].map((st) => {
                const items = events.filter((e) => getStatus(e.start, e.end).id === st);
                if (items.length === 0) return null;
                return (
                  <div key={st} className="space-y-6">
                    <h3 className="text-[11px] font-black text-slate-400 uppercase tracking-[0.3em] flex items-center gap-3 px-2">
                      <div className={`w-2 h-2 rounded-full ${st === 'live' ? 'bg-green-500 animate-ping' : st === 'soon' ? 'bg-blue-500' : 'bg-slate-300'}`} />
                      {st === 'live' ? 'Active Now' : st === 'soon' ? 'Upcoming' : 'Historical'} ({items.length})
                    </h3>
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
                      {items.map((ev) => {
                        const status = getStatus(ev.start, ev.end);
                        return (
                          <div key={ev.id} className="bg-white p-7 rounded-[40px] border border-slate-100 shadow-sm hover:shadow-2xl transition-all group flex flex-col">
                            <div className="flex justify-between items-start mb-6">
                              <span className={`px-3 py-1 rounded-lg text-[9px] font-black uppercase tracking-widest border ${status.color}`}>
                                {status.label}
                              </span>
                              <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-all">
                                <button onClick={() => openEditModal(ev)} className="p-2 text-slate-200 hover:text-blue-600"><Pencil size={16} /></button>
                                <button onClick={() => setIsDeleting(ev)} className="p-2 text-slate-200 hover:text-red-500"><Trash2 size={16} /></button>
                              </div>
                            </div>
                            <h4 className="font-black text-slate-900 text-xl mb-1">{ev.name}</h4>
                            <p className="text-[10px] text-slate-400 font-bold uppercase tracking-widest mb-8 flex items-center gap-1.5"><Folder size={12} className="text-blue-500" /> {ev.posts.length} Reels • {ev.captions.length} Captions</p>
                            <button
                              onClick={() => openEvent(ev)}
                              className="w-full py-4 bg-slate-900 text-white rounded-2xl text-[11px] font-black uppercase tracking-[0.2em] hover:bg-blue-600 transition-all flex items-center justify-center gap-2 shadow-lg"
                            >
                              Manage <ChevronRight size={16} />
                            </button>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </>
          )}
        </div>
      </div>
    );
  }

  // --- VIEW 2: GALLERY (Reel Video + Caption Manager) ---
  return (
    <div className="max-w-6xl mx-auto p-4 space-y-8 animate-in slide-in-from-bottom-4 text-slate-700 pb-20">
      {toast && (
        <div className={`fixed top-6 left-1/2 -translate-x-1/2 z-[200] px-6 py-4 rounded-2xl shadow-2xl flex items-center gap-3 ${toast.type === 'success' ? 'bg-emerald-50 border border-emerald-200' : 'bg-rose-50 border border-rose-200'}`}>
          {toast.type === 'success' ? (
            <div className="w-10 h-10 bg-emerald-500 text-white rounded-xl flex items-center justify-center"><CheckCircle2 size={22} /></div>
          ) : (
            <div className="w-10 h-10 bg-rose-500 text-white rounded-xl flex items-center justify-center font-black">!</div>
          )}
          <p className={`font-bold text-sm ${toast.type === 'success' ? 'text-emerald-800' : 'text-rose-800'}`}>{toast.msg}</p>
        </div>
      )}

      <input type="file" ref={fileInputRef} onChange={handleUpload} multiple accept="video/*" className="hidden" />

      {postToDelete && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50 backdrop-blur-md p-4">
          <div className="bg-white rounded-[40px] p-10 max-w-sm w-full text-center space-y-6 shadow-2xl animate-in zoom-in-95">
            <div className="w-20 h-20 bg-rose-50 text-rose-500 rounded-full flex items-center justify-center mx-auto shadow-inner"><Trash2 size={40} /></div>
            <p className="font-black text-2xl text-slate-900">Remove Reel?</p>
            <div className="flex gap-4">
              <button onClick={() => setPostToDelete(null)} className="flex-1 py-4 bg-slate-100 rounded-2xl font-bold">Cancel</button>
              <button onClick={removePost} className="flex-1 py-4 bg-red-600 text-white rounded-2xl font-bold shadow-xl">Yes, Remove</button>
            </div>
          </div>
        </div>
      )}

      {captionToDelete !== null && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50 backdrop-blur-md p-4">
          <div className="bg-white rounded-[40px] p-10 max-w-sm w-full text-center space-y-6 shadow-2xl animate-in zoom-in-95">
            <div className="w-20 h-20 bg-amber-50 text-amber-500 rounded-full flex items-center justify-center mx-auto shadow-inner"><AlertTriangle size={40} /></div>
            <p className="font-black text-xl text-slate-900">Delete Caption?</p>
            <p className="text-slate-400 text-sm font-medium italic">This caption will be removed from the app.</p>
            <div className="flex gap-4 pt-2">
              <button onClick={() => setCaptionToDelete(null)} className="flex-1 py-4 bg-slate-100 rounded-2xl font-bold">Cancel</button>
              <button onClick={confirmDeleteCaption} className="flex-1 py-4 bg-red-600 text-white rounded-2xl font-bold shadow-xl shadow-red-200">Delete</button>
            </div>
          </div>
        </div>
      )}

      <div className="bg-white p-8 rounded-[40px] border border-slate-100 shadow-sm flex flex-col md:flex-row md:items-center justify-between gap-4">
        <button onClick={() => setView('list')} className="flex items-center gap-2 text-slate-400 hover:text-blue-600 font-black uppercase text-[10px] tracking-[0.2em] transition-all">
          <ArrowLeft size={20} /> Back
        </button>
        <div className="md:text-right">
          <h2 className="text-3xl font-black text-slate-900 tracking-tight leading-none">{selectedEvent?.name}</h2>
          <p className="text-[10px] font-bold text-blue-600 uppercase mt-3 flex md:justify-end items-center gap-2">
            <Calendar size={14} /> {selectedEvent && formatDate(selectedEvent.start)} — {selectedEvent && formatDate(selectedEvent.end)}
          </p>
        </div>
      </div>

      {/* Reel Video Section */}
      <div className="space-y-6">
        <h3 className="text-[11px] font-black text-slate-400 uppercase tracking-[0.3em] px-2 flex items-center gap-2">
          <Video size={14} className="text-blue-500" /> Reels ({selectedEvent?.posts.length})
        </h3>
        <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-5 gap-6">
          <div
            onClick={() => !uploading && fileInputRef.current?.click()}
            className="aspect-[9/16] bg-white border-4 border-dashed border-slate-200 rounded-[45px] flex flex-col items-center justify-center text-slate-300 cursor-pointer hover:border-blue-500 hover:bg-blue-50/30 transition-all group active:scale-95"
          >
            <div className="w-16 h-16 bg-slate-50 text-slate-300 rounded-full flex items-center justify-center group-hover:bg-blue-600 group-hover:text-white transition-all mb-4 shadow-inner">
              <Plus size={32} strokeWidth={3} />
            </div>
            <p className="font-black uppercase text-[10px] tracking-widest group-hover:text-blue-600">Reel Upload</p>
          </div>

          {selectedEvent?.posts.map((post) => (
            <div key={post.id} className="group animate-in zoom-in-95 relative aspect-[9/16] bg-slate-900 rounded-[45px] overflow-hidden shadow-lg hover:shadow-2xl transition-all duration-500">
              <video src={post.url} className="w-full h-full object-contain" />
              <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-transparent to-transparent opacity-60" />
              <div className="absolute top-6 right-6 opacity-0 group-hover:opacity-100 transition-all transform translate-y-2 group-hover:translate-y-0">
                <button onClick={() => setPostToDelete(post)} className="w-10 h-10 bg-rose-500 text-white rounded-2xl flex items-center justify-center shadow-2xl hover:bg-rose-600 active:scale-90 transition-all"><Trash2 size={18} /></button>
              </div>
              <div className="absolute bottom-6 left-6 w-8 h-8 bg-blue-600 rounded-xl flex items-center justify-center text-white shadow-xl ring-4 ring-blue-600/20">
                <Video size={14} />
              </div>
            </div>
          ))}
        </div>
        {uploading && (
          <div className="bg-blue-50 border border-blue-100 rounded-[30px] p-4 flex items-center justify-center gap-3">
            <div className="w-6 h-6 border-2 border-blue-600 border-t-transparent rounded-full animate-spin" />
            <p className="font-bold text-blue-600 text-sm">Uploading reel…</p>
          </div>
        )}
      </div>

      {/* Caption Manager */}
      <div className="bg-white p-8 rounded-[40px] border border-slate-100 shadow-sm space-y-8">
        <h3 className="text-[11px] font-black text-slate-400 uppercase tracking-[0.3em] flex items-center gap-2">
          <MessageSquare size={14} className="text-blue-500" /> Captions
        </h3>

        <div className="flex flex-col md:flex-row gap-4">
          <div className="flex-1 flex items-center gap-4 bg-slate-50 p-4 rounded-[25px] border border-slate-100">
            <FileText size={20} className="text-slate-400" />
            <input
              type="text"
              value={newCaptionText}
              onChange={(e) => setNewCaptionText(e.target.value)}
              placeholder="Type a new slogan or greeting..."
              className="w-full bg-transparent outline-none font-bold text-slate-800 placeholder:text-slate-300"
            />
          </div>
          <button
            onClick={addCaptionToList}
            disabled={!newCaptionText.trim()}
            className="bg-slate-900 text-white px-12 rounded-[25px] font-black text-xs hover:bg-blue-600 transition-all uppercase tracking-widest flex items-center justify-center gap-2 disabled:opacity-20 h-[56px]"
          >
            <PlusCircle size={18} /> Add
          </button>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {selectedEvent?.captions.map((cap, idx) => (
            <div key={idx} className="flex items-center justify-between bg-white border border-slate-100 p-5 rounded-[25px] group hover:border-blue-200 transition-all shadow-sm">
              <div className="flex items-start gap-4">
                <span className="w-6 h-6 bg-slate-100 rounded-full flex items-center justify-center text-[10px] font-bold text-slate-400 shrink-0">{idx + 1}</span>
                <p className="font-bold text-slate-700 text-sm leading-relaxed">{cap}</p>
              </div>
              <button onClick={() => setCaptionToDelete(idx)} className="p-2.5 text-slate-200 hover:text-rose-500 hover:bg-rose-50 rounded-xl transition-all opacity-0 group-hover:opacity-100">
                <Trash2 size={16} />
              </button>
            </div>
          ))}
          {selectedEvent?.captions.length === 0 && (
            <div className="col-span-full py-10 text-center bg-slate-50/50 rounded-[30px] border border-dashed border-slate-200">
              <p className="text-slate-300 font-bold text-xs uppercase tracking-widest">No captions added</p>
            </div>
          )}
        </div>
      </div>

      <div className="flex items-center gap-3 justify-center py-10 text-slate-300 font-bold text-[11px] uppercase tracking-[0.4em]">
        <CheckCircle2 size={14} className="text-emerald-500" /> Active & Synced
      </div>
    </div>
  );
}
