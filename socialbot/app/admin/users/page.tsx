"use client";
import {
  AlertTriangle,
  Calendar,
  ChevronLeft,
  ChevronRight,
  ExternalLink,
  Filter,
  Flag,
  Globe,
  History,
  Info,
  Mail,
  MapPin,
  MessageCircle,
  Phone,
  Plus,
  Search,
  Trash2,
  User,
  Users,
  X
} from 'lucide-react';
import React, { useEffect, useRef, useState } from 'react';
import { adminStorageRemove, adminStorageUpload } from '@/lib/admin-storage-client';
import { supabase } from '@/lib/supabase';
import { getPartyLabel, normalizePartyId, PARTIES_DATA } from '@/lib/constants';

// --- TYPES ---
interface UserFrame {
  id: string | number;
  url: string;
  uploadDate: string;
}

interface AppUser {
  id: string | number;
  avatar_url: string;
  name: string;
  phone: string;
  email: string;
  party: string;
  designation: string;
  state: string;
  district: string;
  constituency: string;
  loksabha: string;
  loksabha_id: number | null;
  assembly_id: number | null;
  joinDate: string;
  dob: string;
  gender: string;
  address: string;
  personalFrames: UserFrame[];
}

export default function UserManagement() {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const ITEMS_PER_PAGE = 10;
  const [currentPage, setCurrentPage] = useState(1);

  const [users, setUsers] = useState<AppUser[]>([]);
  const [usersLoading, setUsersLoading] = useState(true);
  const [framesSearchQuery, setFramesSearchQuery] = useState('');
  const [framesSearchDebounced, setFramesSearchDebounced] = useState('');

  const mapProfileToAppUser = (row: Record<string, unknown>): AppUser => ({
    id: typeof row.id === 'string' || typeof row.id === 'number' ? row.id : String(row.id ?? row.user_id ?? ''),
    avatar_url: String(row.avatar_url ?? ''),
    name: String(row.name ?? ''),
    phone: String(row.phone ?? row.phone_number ?? ''),
    email: String(row.email ?? ''),
    party: normalizePartyId(String(row.party ?? '')),
    designation: String(row.designation ?? ''),
    state: String(row.state ?? ''),
    district: String(row.district ?? ''),
    constituency: String(row.constituency ?? row.assembly ?? ''),
    loksabha: String(row.loksabha ?? ''),
    loksabha_id:
      typeof row.loksabha_id === 'number'
        ? row.loksabha_id
        : row.loksabha_id != null && String(row.loksabha_id).trim()
          ? Number(row.loksabha_id)
          : null,
    assembly_id:
      typeof row.assembly_id === 'number'
        ? row.assembly_id
        : row.assembly_id != null && String(row.assembly_id).trim()
          ? Number(row.assembly_id)
          : null,
    joinDate: (row.join_date ?? row.created_at) ? new Date(String(row.join_date ?? row.created_at)).toLocaleDateString('en-US', { day: '2-digit', month: 'short', year: 'numeric' }) : '',
    dob: row.dob ? new Date(String(row.dob)).toLocaleDateString('en-IN', { day: '2-digit', month: '2-digit', year: 'numeric' }) : '',
    gender: String(row.gender ?? ''),
    address: String(row.address ?? ''),
    personalFrames: [],
  });

  const fmt = (v: unknown): string => {
    const s = String(v ?? '').trim();
    return s ? s : 'N/A';
  };

  const waDigits = (v: unknown): string => String(v ?? '').replace(/[^\d]/g, '');

  const [searchQuery, setSearchQuery] = useState('');
  const [filterParty, setFilterParty] = useState('All');
  const [filterState, setFilterState] = useState('All');
  const [filterLoksabhaId, setFilterLoksabhaId] = useState('All');
  const [filterAssemblyId, setFilterAssemblyId] = useState('All');
  const [filterNewUsers, setFilterNewUsers] = useState('All');

  const buildProfilesUrl = (params: {
    party?: string;
    state?: string;
    loksabha_id?: string;
    assembly_id?: string;
    search_query?: string;
  }) => {
    const usp = new URLSearchParams();
    if (params.party && params.party !== 'All') usp.set('party', params.party);
    if (params.state && params.state !== 'All') usp.set('state', params.state);
    if (params.loksabha_id && params.loksabha_id !== 'All') usp.set('loksabha_id', params.loksabha_id);
    if (params.assembly_id && params.assembly_id !== 'All') usp.set('assembly_id', params.assembly_id);
    if (params.search_query && params.search_query.trim()) usp.set('search_query', params.search_query.trim());
    const qs = usp.toString();
    return `/api/admin/profiles${qs ? `?${qs}` : ''}`;
  };

  const fetchProfiles = async (signal?: AbortSignal) => {
    try {
      const url = buildProfilesUrl({
        party: filterParty,
        state: filterState,
        loksabha_id: filterLoksabhaId,
        assembly_id: filterAssemblyId,
        search_query: searchQuery,
      });
      const res = await fetch(url, { credentials: 'same-origin', signal });
        if (!res.ok) {
          if (process.env.NODE_ENV === 'development') {
            console.error('[users] /api/admin/profiles', res.status, await res.text());
          }
          setUsers([]);
          return;
        }
        const json = (await res.json()) as { profiles?: Record<string, unknown>[] };
        const rows = json.profiles || [];
        const mapped = rows.map((row) => mapProfileToAppUser(row));
        setUsers(mapped);
    } catch (err) {
      if ((err as any)?.name === 'AbortError') return;
      console.error('fetchProfiles exception:', err);
      setUsers([]);
    } finally {
      setUsersLoading(false);
    }
  };

  // Initial + filter-driven refetch (debounced for search).
  useEffect(() => {
    const ac = new AbortController();
    setUsersLoading(true);
    const t = window.setTimeout(() => {
      void fetchProfiles(ac.signal);
    }, 250);
    return () => {
      ac.abort();
      window.clearTimeout(t);
    };
  }, [filterParty, filterState, filterLoksabhaId, filterAssemblyId, searchQuery]);

  // Realtime: refetch with current filters.
  useEffect(() => {
    const channel = supabase
      .channel('profiles-realtime')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'profiles' }, () => {
        void fetchProfiles();
      })
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [filterParty, filterState, filterLoksabhaId, filterAssemblyId, searchQuery]);

  const [selectedUser, setSelectedUser] = useState<AppUser | null>(null);
  const [isDeleting, setIsDeleting] = useState<AppUser | null>(null);

  // --- FILTER OPTIONS (derived from current dataset) ---
  const states = Array.from(new Set(users.map((u) => u.state).filter(Boolean)));
  const loksabhaOptions = Array.from(
    new Map(
      users
        .filter((u) => u.loksabha_id != null && !Number.isNaN(u.loksabha_id))
        .map((u) => [String(u.loksabha_id), u.loksabha || `Lok Sabha #${u.loksabha_id}`])
    ).entries()
  ).map(([id, label]) => ({ id, label }));
  const assemblyOptions = Array.from(
    new Map(
      users
        .filter((u) => u.assembly_id != null && !Number.isNaN(u.assembly_id))
        .map((u) => [String(u.assembly_id), u.constituency?.trim() ? u.constituency : `Assembly #${u.assembly_id}`])
    ).entries()
  ).map(([id, label]) => ({ id, label }));

  // --- FILTER LOGIC ---
  // Most filters now run on the API query. Keep only "New users" locally (date label logic).
  const filteredUsers = users.filter((u) => {
    const todayStr = new Date().toLocaleDateString('en-US', { day: '2-digit', month: 'short', year: 'numeric' });
    const matchesNewUsers = filterNewUsers === 'All' || u.joinDate === todayStr;
    return matchesNewUsers;
  });

  const totalPages = Math.ceil(filteredUsers.length / ITEMS_PER_PAGE);
  const startIndex = (currentPage - 1) * ITEMS_PER_PAGE;
  const paginatedUsers = filteredUsers.slice(startIndex, startIndex + ITEMS_PER_PAGE);

  useEffect(() => { setCurrentPage(1); }, [searchQuery, filterParty, filterState, filterLoksabhaId, filterAssemblyId, filterNewUsers]);

  useEffect(() => {
    const t = window.setTimeout(() => setFramesSearchDebounced(framesSearchQuery.trim()), 300);
    return () => window.clearTimeout(t);
  }, [framesSearchQuery]);

  const openUserProfile = async (user: AppUser) => {
    setSelectedUser(user);
    setFramesSearchQuery('');
    setFramesSearchDebounced('');
    try {
      const id = encodeURIComponent(String(user.id));
      const res = await fetch(`/api/admin/user-frames?user_id=${id}`, { credentials: 'same-origin' });
      if (!res.ok) {
        if (process.env.NODE_ENV === 'development') {
          console.warn('[users] /api/admin/user-frames failed', res.status);
        }
        return;
      }
      const json = (await res.json().catch(() => ({}))) as { frames?: Array<{ id: string | number; url: string; created_at: string | null }> };
      const frames: UserFrame[] = (json.frames || []).map((row) => ({
        id: row.id,
        url: row.url,
        uploadDate: row.created_at ? new Date(String(row.created_at)).toLocaleDateString('en-US', { day: '2-digit', month: 'short', year: 'numeric' }) : '',
      }));
      setSelectedUser((prev) => (prev ? { ...prev, personalFrames: frames } : null));
      setUsers((prev) => prev.map((u) => (u.id === user.id ? { ...u, personalFrames: frames } : u)));
    } catch (e) {
      console.error('[users] fetch user-frames failed', e);
    }
  };

  useEffect(() => {
    if (!selectedUser) return;
    let cancelled = false;
    (async () => {
      try {
        const id = encodeURIComponent(String(selectedUser.id));
        const q = encodeURIComponent(framesSearchDebounced);
        const url = framesSearchDebounced
          ? `/api/admin/user-frames?user_id=${id}&search_query=${q}`
          : `/api/admin/user-frames?user_id=${id}`;
        const res = await fetch(url, { credentials: 'same-origin' });
        if (!res.ok) return;
        const json = (await res.json().catch(() => ({}))) as { frames?: Array<{ id: string | number; url: string; created_at: string | null }> };
        if (cancelled) return;
        const frames: UserFrame[] = (json.frames || []).map((row) => ({
          id: row.id,
          url: row.url,
          uploadDate: row.created_at ? new Date(String(row.created_at)).toLocaleDateString('en-US', { day: '2-digit', month: 'short', year: 'numeric' }) : '',
        }));
        setSelectedUser((prev) => (prev ? { ...prev, personalFrames: frames } : null));
        setUsers((prev) => prev.map((u) => (u.id === selectedUser.id ? { ...u, personalFrames: frames } : u)));
      } catch (e) {
        if (process.env.NODE_ENV === 'development') console.warn('[users] frames search fetch failed');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [selectedUser?.id, framesSearchDebounced]);

  const handleBulkUploadFrames = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || !selectedUser) return;

    const pngFiles = Array.from(files).filter((f) => f.type === 'image/png' || f.name.toLowerCase().endsWith('.png'));
    if (pngFiles.length === 0) return;

    const newFrames: UserFrame[] = [];
    for (const file of pngFiles) {
      const storagePath = `public/${selectedUser.id}/${Date.now()}-${file.name.replace(/[^a-zA-Z0-9.-]/g, '_')}`;
      let imageUrl: string;
      try {
        const up = await adminStorageUpload('user-frames', storagePath, file);
        imageUrl = up.publicUrl;
      } catch (uploadErr) {
        console.error('Frame upload error:', uploadErr);
        continue;
      }

      const { data: insertData, error: insertErr } = await supabase
        .from('user_frames')
        .insert({ user_id: selectedUser.id, url: imageUrl })
        .select('id, url, created_at')
        .single();

      if (insertErr) {
        console.error('user_frames insert error:', insertErr);
        continue;
      }

      const frame: UserFrame = {
        id: insertData.id,
        url: insertData.url,
        uploadDate: insertData.created_at ? new Date(insertData.created_at).toLocaleDateString('en-US', { day: '2-digit', month: 'short', year: 'numeric' }) : '',
      };
      newFrames.push(frame);
    }

    if (newFrames.length > 0) {
      const updatedFrames = [...newFrames, ...selectedUser.personalFrames];
      setUsers((prev) => prev.map((u) => (u.id === selectedUser.id ? { ...u, personalFrames: updatedFrames } : u)));
      setSelectedUser({ ...selectedUser, personalFrames: updatedFrames });
    }
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const getStoragePathFromFrameUrl = (url: string): string | null => {
    const match = url.match(/\/user-frames\/(.+)$/);
    return match ? decodeURIComponent(match[1]) : null;
  };

  const removePersonalFrame = async (frameId: string | number) => {
    if (!selectedUser) return;
    const frame = selectedUser.personalFrames.find((f) => f.id === frameId);
    if (frame) {
      const filePath = getStoragePathFromFrameUrl(frame.url);
      if (filePath) {
        try {
          await adminStorageRemove('user-frames', [filePath]);
        } catch (e) {
          console.error('Frame storage remove:', e);
        }
      }
      await supabase.from('user_frames').delete().eq('id', frameId);
    }
    const updatedFrames = selectedUser.personalFrames.filter((f) => f.id !== frameId);
    setUsers((prev) => prev.map((u) => (u.id === selectedUser.id ? { ...u, personalFrames: updatedFrames } : u)));
    setSelectedUser({ ...selectedUser, personalFrames: updatedFrames });
  };

  return (
    <div className="max-w-7xl mx-auto space-y-8 animate-in fade-in duration-500 text-slate-700 pb-20">
      
      <input type="file" ref={fileInputRef} onChange={handleBulkUploadFrames} className="hidden" multiple accept="image/png" />

      {/* DELETE MODAL */}
      {isDeleting && (
        <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/40 backdrop-blur-sm p-4">
          <div className="bg-white rounded-[40px] p-10 max-w-sm w-full space-y-6 shadow-2xl text-center">
            <div className="w-20 h-20 bg-red-50 text-red-500 rounded-full flex items-center justify-center mx-auto"><AlertTriangle size={40} /></div>
            <p className="font-black text-xl text-slate-900">Delete User?</p>
            <div className="flex gap-4">
              <button onClick={() => setIsDeleting(null)} className="flex-1 py-4 bg-slate-100 rounded-2xl font-bold">Cancel</button>
              <button onClick={async () => {
                const id = encodeURIComponent(String(isDeleting.id));
                const res = await fetch(`/api/admin/profiles?id=${id}`, { method: 'DELETE', credentials: 'same-origin' });
                if (res.ok) {
                  setUsers((prev) => prev.filter((u) => u.id !== isDeleting.id));
                  if (selectedUser?.id === isDeleting.id) setSelectedUser(null);
                }
                setIsDeleting(null);
              }} className="flex-1 py-4 bg-red-600 text-white rounded-2xl font-bold shadow-lg shadow-red-200 transition-all active:scale-95">Delete</button>
            </div>
          </div>
        </div>
      )}

      {/* USER PROFILE MODAL */}
      {selectedUser && (
        <div className="fixed inset-0 z-[110] flex items-center justify-center bg-black/60 backdrop-blur-md p-4 overflow-y-auto">
          <div className="bg-white rounded-[45px] w-full max-w-5xl shadow-2xl overflow-hidden relative">
            <button onClick={() => setSelectedUser(null)} className="absolute top-8 right-8 z-[130] w-12 h-12 bg-slate-900 text-white rounded-2xl flex items-center justify-center hover:bg-blue-600 transition-all shadow-xl"><X size={24} /></button>
            <div className="bg-slate-900 p-10 text-white flex items-center gap-6">
                <div className="w-24 h-24 bg-blue-600 rounded-[30px] flex items-center justify-center text-white shadow-xl shadow-blue-500/20"><User size={48} /></div>
                <div>
                    <h2 className="text-4xl font-black tracking-tight leading-none">{selectedUser.name}</h2>
                    <div className="flex items-center gap-4 mt-3">
                        <span className="bg-blue-600 text-[11px] font-black uppercase px-3 py-1 rounded-lg tracking-widest">{getPartyLabel(selectedUser.party)} Member</span>
                        <span className="text-slate-500 font-bold text-xs uppercase tracking-widest italic">Since {selectedUser.joinDate}</span>
                    </div>
                </div>
            </div>
            <div className="p-10 grid grid-cols-1 lg:grid-cols-12 gap-10 max-h-[60vh] overflow-y-auto bg-white">
                <div className="lg:col-span-4 space-y-8 border-r border-slate-100 pr-6">
                    <div className="space-y-6">
                        <h3 className="text-[10px] font-black text-slate-400 uppercase tracking-widest flex items-center gap-2 font-mono"><Info size={14} className="text-blue-500" /> Member Info</h3>
                        <div className="space-y-4">
                            <div className="flex items-center gap-4"><div className="w-10 h-10 bg-slate-50 rounded-xl flex items-center justify-center text-slate-400"><Phone size={18} /></div><p className="font-bold text-slate-800 tracking-tight">{selectedUser.phone}</p></div>
                            <div className="flex items-center gap-4"><div className="w-10 h-10 bg-slate-50 rounded-xl flex items-center justify-center text-slate-400"><Mail size={18} /></div><p className="font-bold text-slate-800 truncate tracking-tight">{selectedUser.email}</p></div>
                            <div className="flex items-center gap-4"><div className="w-10 h-10 bg-slate-50 rounded-xl flex items-center justify-center text-slate-400"><MapPin size={18} /></div><p className="font-bold text-slate-800 tracking-tight">{selectedUser.constituency}</p></div>
                        </div>
                    </div>
                    <div className="p-6 bg-slate-50 rounded-[30px] border border-slate-100 shadow-inner"><p className="text-[9px] font-black text-slate-400 uppercase tracking-widest mb-2">Address</p><p className="text-sm font-bold text-slate-600 leading-relaxed italic">"{selectedUser.address}"</p></div>
                </div>

                {/* UPDATED: USER FRAMES SECTION */}
                <div className="lg:col-span-8 space-y-6">
                    <div className="flex items-center justify-between px-2">
                        <h3 className="text-[10px] font-black text-slate-400 uppercase tracking-widest flex items-center gap-2 font-mono"><History size={14} className="text-blue-500" /> User Frames</h3>
                        <p className="text-[10px] font-black text-slate-300 uppercase tracking-widest">{selectedUser.personalFrames.length} Frames</p>
                    </div>

                    <div className="px-2">
                      <div className="flex items-center gap-3 bg-white border border-slate-200 rounded-2xl px-4 py-3 shadow-sm">
                        <Search size={16} className="text-slate-400" />
                        <input
                          value={framesSearchQuery}
                          onChange={(e) => setFramesSearchQuery(e.target.value)}
                          placeholder="Search Frames..."
                          className="w-full bg-transparent outline-none font-bold text-slate-800 text-sm placeholder:text-slate-300"
                        />
                        {framesSearchQuery ? (
                          <button
                            type="button"
                            onClick={() => setFramesSearchQuery('')}
                            className="text-slate-400 hover:text-slate-700"
                            aria-label="Clear frames search"
                          >
                            <X size={16} />
                          </button>
                        ) : null}
                      </div>
                    </div>

                    <div className="grid grid-cols-2 sm:grid-cols-3 gap-6 pb-4">
                        {/* UPLOAD FRAME BOX */}
                        <div onClick={() => fileInputRef.current?.click()} className="aspect-[4/5] bg-white border-4 border-dashed border-slate-200 rounded-[40px] flex flex-col items-center justify-center cursor-pointer hover:border-blue-500 hover:bg-blue-50 transition-all active:scale-95 group shadow-sm">
                            <div className="w-12 h-12 bg-slate-50 text-slate-300 rounded-full flex items-center justify-center group-hover:bg-blue-600 group-hover:text-white transition-all mb-3 shadow-inner"><Plus size={24} strokeWidth={3} /></div>
                            <p className="font-black uppercase text-[10px] tracking-widest group-hover:text-blue-600">Upload Frames</p>
                            <p className="text-[8px] text-slate-300 font-bold uppercase mt-1">Select PNG Assets</p>
                        </div>
                        {selectedUser.personalFrames.map((frame) => (
                            <div key={frame.id} className="group relative aspect-[4/5] bg-slate-100 rounded-[40px] overflow-hidden border border-slate-100 shadow-sm transition-all hover:shadow-xl">
                                <img src={frame.url} className="w-full h-full object-contain p-4 relative z-10" alt="frame" />
                                <div className="absolute inset-0 bg-black/60 opacity-0 group-hover:opacity-100 transition-all flex flex-col justify-end p-6 z-20">
                                    <button onClick={() => removePersonalFrame(frame.id)} className="w-full py-3 bg-rose-600 text-white rounded-2xl text-[10px] font-black uppercase tracking-widest flex items-center justify-center gap-2 shadow-xl hover:bg-rose-700 active:scale-95"><Trash2 size={14} /> Remove Frame</button>
                                </div>
                            </div>
                        ))}
                    </div>
                </div>
            </div>
            <div className="p-8 bg-slate-50 border-t border-slate-100 flex justify-end"><button onClick={() => setSelectedUser(null)} className="px-10 py-4 bg-slate-900 text-white rounded-2xl font-black text-xs uppercase tracking-widest shadow-2xl active:scale-95 transition-all">Close Profile</button></div>
          </div>
        </div>
      )}

      {/* HEADER */}
      <div className="bg-white p-8 rounded-[40px] border border-slate-100 shadow-sm flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div className="flex items-center gap-4">
          <div className="w-14 h-14 bg-blue-600 rounded-2xl flex items-center justify-center text-white shadow-xl shadow-blue-100"><Users size={28} /></div>
          <div>
            <h1 className="text-3xl font-black text-slate-900 tracking-tight leading-none">User Management</h1>
            <p className="text-xs font-bold text-slate-400 uppercase tracking-widest mt-2">Current View: {filteredUsers.length} Filtered Members</p>
          </div>
        </div>
      </div>

      {/* ADVANCED FILTERS */}
      <div className="bg-white p-5 rounded-[40px] border border-slate-200 shadow-lg space-y-4">
        <div className="flex flex-col md:flex-row gap-4">
          <div className="flex items-center gap-4 flex-[2] bg-slate-50 p-4 rounded-2xl border border-slate-100 focus-within:border-blue-300 transition-all">
            <Search size={20} className="text-slate-400" />
            <div className="flex-1">
               <span className="text-[9px] font-black text-slate-400 uppercase tracking-widest block mb-0.5">Global Search</span>
               <input type="text" value={searchQuery} onChange={e => setSearchQuery(e.target.value)} placeholder="Name or phone..." className="w-full bg-transparent outline-none font-bold text-slate-800" />
            </div>
          </div>
          <div className="flex items-center gap-4 flex-1 bg-slate-50 p-4 rounded-2xl border border-slate-100">
            <Calendar size={20} className="text-emerald-500" />
            <div className="flex-1">
               <span className="text-[9px] font-black text-slate-400 uppercase tracking-widest block mb-0.5">Registration Status</span>
               <select value={filterNewUsers} onChange={e => setFilterNewUsers(e.target.value)} className="w-full bg-transparent outline-none font-bold text-slate-800 text-sm">
                 <option value="All">All Time</option>
                 <option value="Today">Joined Today</option>
               </select>
            </div>
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-4">
          <div className="bg-slate-50 p-3 rounded-2xl border border-slate-100 flex items-center gap-3">
            <Flag size={18} className="text-blue-600" />
            <div className="flex-1 text-xs">
              <span className="text-[9px] font-black text-slate-400 uppercase block">Political Party</span>
              <select value={filterParty} onChange={e => setFilterParty(e.target.value)} className="w-full bg-transparent outline-none font-bold text-slate-800">
                <option value="All">All Parties</option>
                {PARTIES_DATA.map((p) => (
                  <option key={p.id} value={p.id}>{p.shortName}</option>
                ))}
              </select>
            </div>
          </div>
          <div className="bg-slate-50 p-3 rounded-2xl border border-slate-100 flex items-center gap-3">
            <Globe size={18} className="text-purple-600" />
            <div className="flex-1 text-xs">
              <span className="text-[9px] font-black text-slate-400 uppercase block">State Jurisdiction</span>
              <select value={filterState} onChange={e => setFilterState(e.target.value)} className="w-full bg-transparent outline-none font-bold text-slate-800">
                <option value="All">All States</option>
                {states.map(s => <option key={s} value={s}>{s}</option>)}
              </select>
            </div>
          </div>
          <div className="bg-slate-50 p-3 rounded-2xl border border-slate-100 flex items-center gap-3">
            <MapPin size={18} className="text-orange-500" />
            <div className="flex-1 text-xs">
              <span className="text-[9px] font-black text-slate-400 uppercase block">Lok Sabha</span>
              <select value={filterLoksabhaId} onChange={e => setFilterLoksabhaId(e.target.value)} className="w-full bg-transparent outline-none font-bold text-slate-800">
                <option value="All">All Lok Sabha</option>
                {loksabhaOptions.map((l) => (
                  <option key={l.id} value={l.id}>{l.label}</option>
                ))}
              </select>
            </div>
          </div>
          <div className="bg-slate-50 p-3 rounded-2xl border border-slate-100 flex items-center gap-3">
            <Filter size={18} className="text-slate-600" />
            <div className="flex-1 text-xs">
              <span className="text-[9px] font-black text-slate-400 uppercase block">Assembly</span>
              <select value={filterAssemblyId} onChange={e => setFilterAssemblyId(e.target.value)} className="w-full bg-transparent outline-none font-bold text-slate-800">
                <option value="All">All Assembly</option>
                {assemblyOptions.map((a) => (
                  <option key={a.id} value={a.id}>{a.label}</option>
                ))}
              </select>
            </div>
          </div>
        </div>
      </div>

      {/* USER LIST GRID */}
      {usersLoading ? (
        <div className="py-20 text-center text-slate-400 font-bold text-sm">Loading users…</div>
      ) : (
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5 gap-6">
        {paginatedUsers.map((user) => (
          <div
            key={user.id}
            className="bg-white p-6 rounded-[32px] border border-slate-100 shadow-sm hover:shadow-md transition-all duration-300 group flex flex-col relative overflow-hidden"
          >
            <div className="absolute top-6 right-6">
              <button onClick={() => setIsDeleting(user)} className="p-2 text-slate-200 hover:text-red-500 transition-all"><Trash2 size={18} /></button>
            </div>

            <div className="flex flex-col items-center text-center pt-3">
              {String(user.avatar_url ?? '').trim() ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={String(user.avatar_url).trim()}
                  alt={fmt(user.name)}
                  className="h-16 w-16 rounded-full object-cover border border-slate-200 shadow-sm"
                />
              ) : (
                <div className="h-16 w-16 rounded-full bg-slate-100 flex items-center justify-center text-slate-400 border border-slate-200">
                  <User size={26} />
                </div>
              )}

              <h4 className="mt-3 text-sm font-semibold text-slate-900 leading-tight">{fmt(user.name)}</h4>
              <p className="mt-1 text-[9px] font-black text-slate-500 uppercase tracking-widest">
                {fmt(getPartyLabel(user.party))}
              </p>
            </div>

            <div className="mt-5 space-y-2 text-xs font-semibold text-slate-700">
              <div className="flex items-center justify-between gap-3">
                <span className="text-slate-400 font-bold uppercase tracking-widest text-[9px]">Mobile</span>
                <span className="flex items-center gap-2">
                  <span className="font-bold text-slate-800">{fmt(user.phone)}</span>
                  {waDigits(user.phone) ? (
                    <a
                      href={`https://wa.me/${waDigits(user.phone)}`}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex items-center justify-center text-emerald-600 hover:text-emerald-700"
                      aria-label="WhatsApp"
                      title="WhatsApp"
                    >
                      <MessageCircle size={16} />
                    </a>
                  ) : (
                    <span className="inline-flex items-center justify-center text-slate-300" aria-label="WhatsApp unavailable" title="WhatsApp unavailable">
                      <MessageCircle size={16} />
                    </span>
                  )}
                </span>
              </div>

              <div className="flex items-center justify-between gap-3">
                <span className="text-slate-400 font-bold uppercase tracking-widest text-[9px]">State</span>
                <span className="font-bold text-slate-800">{fmt(user.state)}</span>
              </div>

              <div className="flex items-center justify-between gap-3">
                <span className="text-slate-400 font-bold uppercase tracking-widest text-[9px]">Lok Sabha</span>
                <span className="font-bold text-slate-800">{fmt(user.loksabha)}</span>
              </div>
            </div>

            <button onClick={() => openUserProfile(user)} className="mt-6 w-full py-3 bg-slate-50 rounded-2xl text-[9px] font-black uppercase tracking-widest text-slate-700 hover:bg-slate-100 transition-all flex items-center justify-center gap-2 active:scale-95">
              Profile & Frames <ExternalLink size={14} />
            </button>
          </div>
        ))}
      </div>
      )}

      {/* PAGINATION UI */}
      {totalPages > 1 && (
        <div className="flex flex-col sm:flex-row items-center justify-between gap-4 bg-white p-6 rounded-[35px] border border-slate-100 shadow-sm">
          <div className="text-[10px] font-black text-slate-400 uppercase tracking-widest italic">Showing Page {currentPage} of {totalPages}</div>
          <div className="flex items-center gap-2">
            <button onClick={() => setCurrentPage(p => Math.max(p - 1, 1))} disabled={currentPage === 1} className="w-10 h-10 bg-slate-50 rounded-xl flex items-center justify-center hover:bg-blue-600 hover:text-white transition-all disabled:opacity-20"><ChevronLeft size={18} /></button>
            <button onClick={() => setCurrentPage(p => Math.min(p + 1, totalPages))} disabled={currentPage === totalPages} className="w-10 h-10 bg-slate-50 rounded-xl flex items-center justify-center hover:bg-blue-600 hover:text-white transition-all disabled:opacity-20"><ChevronRight size={18} /></button>
          </div>
        </div>
      )}

      {filteredUsers.length === 0 && (
        <div className="py-20 text-center bg-slate-50 rounded-[40px] border-2 border-dashed border-slate-100">
          <p className="text-slate-400 font-black uppercase tracking-widest text-sm italic">No users match the selected criteria.</p>
        </div>
      )}
    </div>
  );
}