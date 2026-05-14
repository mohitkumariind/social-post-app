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
import { API_MAX_FRAMES_LIMIT } from '@/lib/perf-defaults';
import { sortUserFramesByDisplayKey } from '../../../../lib/sortUserFramesByDisplayKey';

const __DEV__ = process.env.NODE_ENV !== 'production';

// --- TYPES ---
interface UserFrame {
  id: string | number;
  url: string;
  uploadDate: string;
  /** For stable alphabetical gallery order (matches mobile picker). */
  file_name?: string;
}

interface AppUser {
  id: string | number;
  avatar_url: string;
  language?: string;
  name: string;
  phone?: string;
  email?: string;
  role?: string;
  assigned_state_ids?: number[];
  assigned_group_ids?: string[];
  party: string;
  party_label: string;
  designation1?: string;
  designation2?: string;
  designation3?: string;
  designation4?: string;
  state?: string;
  state_id?: number | null;
  district?: string;
  constituency?: string;
  loksabha?: string;
  loksabha_id?: number | null;
  assembly_id?: number | null;
  assembly?: string;
  joinDate?: string;
  dob?: string;
  gender?: string;
  group_tags: string[];
  group_id?: number | null;
  whatsapp?: string;
  facebook?: string;
  twitter?: string;
  instagram?: string;
  personalFrames: UserFrame[];
}

type StateRow = { id: string; name: string };
type GroupRow = { id: string; name: string };

type UserFrameRow = { id: string | number; url: string; created_at: string | null; file_name?: unknown };

/** Loads every chunk from `/api/admin/user-frames` (server caps each chunk at `API_MAX_FRAMES_LIMIT`). */
async function fetchAllUserFramesForAdmin(userId: string, searchQuery: string): Promise<UserFrame[]> {
  const aggregated: UserFrameRow[] = [];
  let offset = 0;
  const chunk = API_MAX_FRAMES_LIMIT;
  for (;;) {
    const usp = new URLSearchParams({ user_id: userId, limit: String(chunk), offset: String(offset) });
    if (searchQuery) usp.set('search_query', searchQuery);
    const res = await fetch(`/api/admin/user-frames?${usp.toString()}`, { credentials: 'same-origin' });
    if (!res.ok) {
      let errText = '';
      try {
        errText = await res.text();
      } catch {
        errText = '';
      }
      console.error('[admin/user-frames] request failed', { status: res.status, userId, body: errText.slice(0, 800) });
      return [];
    }
    const json = (await res.json().catch(() => ({}))) as { frames?: UserFrameRow[]; has_more?: boolean };
    const batch = (json.frames ?? []).map((row) => ({
      ...row,
      url: String(row.url ?? (row as { frame_url?: string }).frame_url ?? '').trim(),
    }));
    aggregated.push(...batch);
    if (batch.length < chunk || !json.has_more) break;
    offset += chunk;
    if (offset > 500_000) break;
  }
  const sorted = sortUserFramesByDisplayKey(aggregated);
  return sorted.map((row) => ({
    id: row.id,
    url: row.url,
    uploadDate: row.created_at
      ? new Date(String(row.created_at)).toLocaleDateString('en-US', { day: '2-digit', month: 'short', year: 'numeric' })
      : '',
    file_name: String(row.file_name ?? '').trim() || undefined,
  }));
}

export default function UserManagement() {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const ITEMS_PER_PAGE = 10;
  const [currentPage, setCurrentPage] = useState(1);

  const [users, setUsers] = useState<AppUser[]>([]);
  const [usersLoading, setUsersLoading] = useState(true);
  const [framesSearchQuery, setFramesSearchQuery] = useState('');
  const [framesSearchDebounced, setFramesSearchDebounced] = useState('');

  const toStrArr = (v: unknown): string[] => {
    if (!v) return [];
    if (Array.isArray(v)) return v.map((x) => String(x).trim()).filter(Boolean);
    const s = String(v).trim();
    return s ? [s] : [];
  };

  // party id -> display label (prefer short form)
  const [partyLabelMap, setPartyLabelMap] = useState<Record<string, string>>({});

  const acronym = (s: string): string => {
    const words = s
      .trim()
      .split(/[\s\-_/]+/)
      .map((w) => w.trim())
      .filter(Boolean);
    const a = words.map((w) => w[0]?.toUpperCase()).join('');
    return a.length >= 2 && a.length <= 10 ? a : '';
  };

  const shortFromPartyName = (name: string): string => {
    const n = String(name ?? '').trim();
    if (!n) return '';
    // If name itself is already short (e.g. BJP), keep it.
    if (n.length <= 12 && !n.includes(' ')) return n.toUpperCase();
    // Try mapping via shared constants (handles full names too).
    const id = normalizePartyId(n);
    const short = getPartyLabel(id || n);
    if (short && short !== n) return short;
    // Last resort: acronym from words.
    return acronym(n);
  };

  const isLikelyNumericId = (v: unknown): boolean => {
    const s = String(v ?? '').trim();
    return !!s && /^[0-9]+$/.test(s);
  };

  const displayPartyLabel = (partyId: string, partyLabel: string): string => {
    const fromDb = partyLabelMap[partyId];
    if (fromDb) return fromDb;
    // If the stored label is just an id like "7", don't show it.
    if (isLikelyNumericId(partyLabel)) return '';
    return partyLabel;
  };

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { data, error } = await supabase
          .from('parties')
          .select('id,name')
          .order('name', { ascending: true });
        if (cancelled) return;
        if (error) throw error;
        const map: Record<string, string> = {};
        for (const r of (data ?? []) as any[]) {
          const id = String(r?.id ?? '').trim();
          const name = String(r?.name ?? '').trim();
          if (!id || !name) continue;
          const short = shortFromPartyName(name);
          map[id] = short || name;
        }
        setPartyLabelMap(map);
      } catch (e) {
        // Best-effort: fall back to static `getPartyLabel`.
        setPartyLabelMap({});
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const partyShortLabel = (idOrRaw: string): string => {
    const raw = String(idOrRaw ?? '').trim();
    if (!raw) return '';
    const id = normalizePartyId(raw);
    const short = getPartyLabel(id || raw); // from constants: shortName for known parties
    if (short && short !== id && short !== raw) return short;
    return '';
  };

  const resolvePartyText = (rawParty: unknown): { id: string; label: string } => {
    const raw = String(rawParty ?? '').trim();
    if (!raw) return { id: '', label: '' };
    const id = normalizePartyId(raw);
    const fromDb = partyLabelMap[id];
    if (fromDb) return { id, label: fromDb };
    const short = partyShortLabel(id || raw);
    if (short) return { id, label: short };

    // Final fallback: use raw.
    return { id, label: raw };
  };

  // When party labels arrive, retrofit already-loaded users (avoids showing numeric ids like "7").
  useEffect(() => {
    const keys = Object.keys(partyLabelMap);
    if (keys.length === 0) return;
    setUsers((prev) =>
      prev.map((u) => {
        const short = partyShortLabel(u.party);
        if (short) {
          if (u.party_label === short) return u;
          return { ...u, party_label: short };
        }

        const fromDb = partyLabelMap[u.party];
        if (!fromDb) return u;
        if (u.party_label === fromDb) return u;
        return { ...u, party_label: fromDb };
      })
    );
  }, [partyLabelMap]);

  const mapProfileToAppUser = (row: Record<string, unknown>): AppUser => ({
    ...(() => {
      const p = resolvePartyText((row as any).party ?? (row as any).party_id ?? (row as any).partyName);
      return { party: p.id, party_label: p.label };
    })(),
    id: typeof row.id === 'string' || typeof row.id === 'number' ? row.id : String(row.id ?? row.user_id ?? ''),
    avatar_url: String(row.avatar_url ?? ''),
    language: String(row.language ?? ''),
    name: String(row.name ?? ''),
    phone: String(row.phone ?? row.phone_number ?? ''),
    email: String(row.email ?? ''),
    role: typeof (row as any).role === 'string' ? String((row as any).role) : (row as any).role != null ? String((row as any).role) : undefined,
    assigned_state_ids: Array.isArray((row as any).assigned_state_ids)
      ? (row as any).assigned_state_ids.map((x: any) => Number(x)).filter((n: any) => Number.isFinite(n))
      : [],
    assigned_group_ids: Array.isArray((row as any).assigned_group_ids)
      ? (row as any).assigned_group_ids.map((x: any) => String(x ?? '').trim()).filter(Boolean)
      : [],
    designation1: String(row.designation1 ?? row.designation ?? ''),
    designation2: String(row.designation2 ?? row.designation_2 ?? ''),
    designation3: String(row.designation3 ?? row.designation_3 ?? ''),
    designation4: String(row.designation4 ?? row.designation_4 ?? ''),
    state: String(row.state ?? ''),
    state_id:
      typeof row.state_id === 'number'
        ? row.state_id
        : row.state_id != null && String(row.state_id).trim()
          ? Number(row.state_id)
          : null,
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
    assembly: String(row.assembly ?? ''),
    joinDate: (row.join_date ?? row.created_at) ? new Date(String(row.join_date ?? row.created_at)).toLocaleDateString('en-US', { day: '2-digit', month: 'short', year: 'numeric' }) : '',
    dob: row.dob ? new Date(String(row.dob)).toLocaleDateString('en-IN', { day: '2-digit', month: '2-digit', year: 'numeric' }) : '',
    gender: String(row.gender ?? ''),
    group_tags: toStrArr(row.group_tags),
    group_id:
      typeof row.group_id === 'number'
        ? row.group_id
        : row.group_id != null && String(row.group_id).trim()
          ? Number(row.group_id)
          : null,
    whatsapp: String(row.whatsapp ?? ''),
    facebook: String(row.facebook ?? ''),
    twitter: String(row.twitter ?? ''),
    instagram: String(row.instagram ?? ''),
    personalFrames: [],
  });

  const fmt = (v: unknown): string => {
    const s = String(v ?? '').trim();
    return s ? s : 'N/A';
  };

  const waDigits = (v: unknown): string => String(v ?? '').replace(/[^\d]/g, '');

  const [viewer, setViewer] = useState<{
    role: 'admin' | 'moderator' | 'campaign_manager';
    assigned_state_ids: number[];
    assigned_group_ids: string[];
  } | null>(null);
  const isModerator = viewer?.role === 'moderator';
  const isCampaignManager = viewer?.role === 'campaign_manager';
  const isAdmin = viewer?.role === 'admin';
  const isRestrictedViewer = isModerator || isCampaignManager;

  const [statesList, setStatesList] = useState<StateRow[]>([]);
  const [statesLoading, setStatesLoading] = useState(false);
  const [groupsList, setGroupsList] = useState<GroupRow[]>([]);
  const [groupsLoading, setGroupsLoading] = useState(false);

  useEffect(() => {
    if (!isAdmin) return;
    let cancelled = false;
    (async () => {
      setStatesLoading(true);
      try {
        const { data, error } = await supabase.from('states').select('id,name').order('name', { ascending: true });
        if (cancelled) return;
        if (error) throw error;
        const mapped = (data ?? [])
          .map((r: any) => ({ id: String(r.id ?? ''), name: String(r.name ?? '').trim() }))
          .filter((r: any) => r.id && r.name);
        setStatesList(mapped);
      } catch {
        if (!cancelled) setStatesList([]);
      } finally {
        if (!cancelled) setStatesLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [isAdmin]);

  useEffect(() => {
    if (!isAdmin) return;
    let cancelled = false;
    (async () => {
      setGroupsLoading(true);
      try {
        const res = await fetch('/api/admin/groups', { credentials: 'same-origin' });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const d = (await res.json().catch(() => ({}))) as { groups?: Array<{ tag?: unknown; name?: unknown }> };
        if (cancelled) return;
        const mapped = (d.groups ?? [])
          .map((g) => ({ id: String(g.tag ?? '').trim(), name: String(g.name ?? '').trim() }))
          .filter((g) => g.id && g.name);
        setGroupsList(mapped);
      } catch {
        if (!cancelled) setGroupsList([]);
      } finally {
        if (!cancelled) setGroupsLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [isAdmin]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch('/api/admin/viewer', { credentials: 'same-origin' });
        if (!res.ok) return;
        const d = (await res.json().catch(() => ({}))) as { role?: string; assigned_state_ids?: unknown; assigned_group_ids?: unknown };
        if (cancelled) return;
        const role =
          d.role === 'moderator'
            ? 'moderator'
            : d.role === 'admin'
              ? 'admin'
              : d.role === 'campaign_manager'
                ? 'campaign_manager'
                : null;
        const ids = Array.isArray(d.assigned_state_ids)
          ? d.assigned_state_ids.map((x: any) => Number(x)).filter((n: any) => Number.isFinite(n))
          : [];
        const gids = Array.isArray(d.assigned_group_ids) ? d.assigned_group_ids.map((x: any) => String(x ?? '').trim()).filter(Boolean) : [];
        if (role) setViewer({ role, assigned_state_ids: ids, assigned_group_ids: gids });
      } catch {
        /* ignore */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

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
          if (__DEV__) {
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
      if (__DEV__) console.error('fetchProfiles exception:', err);
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
    let t: number | null = null;
    const channel = supabase
      .channel('profiles-realtime')
      // PERF (P0): avoid refetching on every event type; debounce rapid updates.
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'profiles' }, () => {
        if (t) window.clearTimeout(t);
        t = window.setTimeout(() => void fetchProfiles(), 400);
      })
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'profiles' }, () => {
        if (t) window.clearTimeout(t);
        t = window.setTimeout(() => void fetchProfiles(), 400);
      })
      .subscribe();
    return () => {
      if (t) window.clearTimeout(t);
      supabase.removeChannel(channel);
    };
  }, [filterParty, filterState, filterLoksabhaId, filterAssemblyId, searchQuery]);

  const [selectedUser, setSelectedUser] = useState<AppUser | null>(null);
  const [isDeleting, setIsDeleting] = useState<AppUser | null>(null);

  const [toast, setToast] = useState<{ message: string; tone: 'success' | 'error' } | null>(null);

  useEffect(() => {
    if (!toast) return;
    const t = window.setTimeout(() => setToast(null), 2800);
    return () => window.clearTimeout(t);
  }, [toast]);

  const [roleUser, setRoleUser] = useState<AppUser | null>(null);
  const [roleSaving, setRoleSaving] = useState(false);
  const [roleValue, setRoleValue] = useState<'user' | 'moderator' | 'admin' | 'campaign_manager'>('user');
  const [roleStateIds, setRoleStateIds] = useState<string[]>([]);
  const [roleGroupIds, setRoleGroupIds] = useState<string[]>([]);

  useEffect(() => {
    if (!roleUser) return;
    const r = String(roleUser.role ?? 'user').trim().toLowerCase();
    const role = (r === 'admin' || r === 'moderator' || r === 'campaign_manager' || r === 'user') ? (r as any) : 'user';
    setRoleValue(role);
    const sids = Array.isArray(roleUser.assigned_state_ids) ? roleUser.assigned_state_ids : [];
    setRoleStateIds(sids.map((n) => String(n)));
    const gids = Array.isArray(roleUser.assigned_group_ids) ? roleUser.assigned_group_ids : [];
    setRoleGroupIds(gids.map((x) => String(x).trim()).filter(Boolean));
  }, [roleUser?.id]);

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

  const openUserProfile = (user: AppUser) => {
    setSelectedUser(user);
    setFramesSearchQuery('');
    setFramesSearchDebounced('');
    // Frames load only in the effect below (single in-flight path; avoids racing duplicate fetches).
  };

  useEffect(() => {
    if (!selectedUser) return;
    let cancelled = false;
    (async () => {
      try {
        if (cancelled) return;
        const frames = await fetchAllUserFramesForAdmin(String(selectedUser.id), framesSearchDebounced);
        if (cancelled) return;
        setSelectedUser((prev) => (prev ? { ...prev, personalFrames: frames } : null));
        setUsers((prev) => prev.map((u) => (u.id === selectedUser.id ? { ...u, personalFrames: frames } : u)));
      } catch (e) {
        if (__DEV__) console.warn('[users] frames search fetch failed');
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
        if (__DEV__) console.error('Frame upload error:', uploadErr);
        continue;
      }

      const res = await fetch('/api/admin/user-frames', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          user_id: String(selectedUser.id),
          url: imageUrl,
          overlay_url: imageUrl,
          file_name: file.name,
        }),
      });
      if (!res.ok) {
        let errText = '';
        try {
          errText = await res.text();
        } catch {
          errText = '';
        }
        console.error('[users] user_frames POST failed', res.status, errText.slice(0, 600));
        if (__DEV__) console.error('user_frames insert error:', res.status, errText);
        continue;
      }
      const insertJson = (await res.json().catch(() => ({}))) as {
        frame?: { id: unknown; url?: string; created_at?: string | null };
      };
      const fr = insertJson.frame;
      if (fr?.id == null || fr.id === '') continue;

      const frameId: string | number =
        typeof fr.id === 'string' || typeof fr.id === 'number' ? fr.id : String(fr.id);

      const frame: UserFrame = {
        id: frameId,
        url: String(fr.url ?? imageUrl),
        uploadDate: fr.created_at
          ? new Date(String(fr.created_at)).toLocaleDateString('en-US', { day: '2-digit', month: 'short', year: 'numeric' })
          : '',
        file_name: file.name,
      };
      newFrames.push(frame);
    }

    if (newFrames.length > 0) {
      const updatedFrames = sortUserFramesByDisplayKey([...newFrames, ...selectedUser.personalFrames]);
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
          if (__DEV__) console.error('Frame storage remove:', e);
        }
      }
      const delRes = await fetch(`/api/admin/user-frames?id=${encodeURIComponent(String(frameId))}`, {
        method: 'DELETE',
        credentials: 'same-origin',
      });
      if (!delRes.ok) {
        let errText = '';
        try {
          errText = await delRes.text();
        } catch {
          errText = '';
        }
        console.error('[users] user_frames DELETE failed', delRes.status, errText.slice(0, 600));
        setToast({ message: `Remove frame failed (HTTP ${delRes.status})`, tone: 'error' });
        return;
      }
    }
    const updatedFrames = selectedUser.personalFrames.filter((f) => f.id !== frameId);
    setUsers((prev) => prev.map((u) => (u.id === selectedUser.id ? { ...u, personalFrames: updatedFrames } : u)));
    setSelectedUser({ ...selectedUser, personalFrames: updatedFrames });
  };

  return (
    <div className="max-w-7xl mx-auto space-y-8 animate-in fade-in duration-500 text-slate-700 pb-20">
      
      <input type="file" ref={fileInputRef} onChange={handleBulkUploadFrames} className="hidden" multiple accept="image/png" />

      {toast ? (
        <div
          className={`fixed bottom-8 left-1/2 z-[210] max-w-md -translate-x-1/2 rounded-xl px-5 py-3 text-center text-sm font-bold text-white shadow-lg ${
            toast.tone === 'success' ? 'bg-emerald-600' : 'bg-rose-600'
          }`}
          role="status"
        >
          {toast.message}
        </div>
      ) : null}

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

      {/* ROLE MANAGEMENT MODAL (admin-only) */}
      {isAdmin && roleUser ? (
        <div className="fixed inset-0 z-[205] flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
          <div className="bg-white rounded-[40px] p-8 max-w-lg w-full space-y-6 shadow-2xl relative">
            <button
              onClick={() => setRoleUser(null)}
              className="absolute top-6 right-6 w-10 h-10 bg-slate-900 text-white rounded-2xl flex items-center justify-center hover:bg-blue-600 transition-all shadow-xl"
              aria-label="Close role management"
            >
              <X size={18} />
            </button>

            <div className="space-y-1">
              <p className="text-xs font-black text-slate-400 uppercase tracking-widest">Role Management</p>
              <h3 className="text-xl font-black text-slate-900 leading-tight">{fmt(roleUser.name)}</h3>
            </div>

            <div className="grid grid-cols-1 gap-4">
              <div>
                <label className="mb-1.5 block text-[10px] font-black uppercase tracking-widest text-slate-400">Role</label>
                <select
                  className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm font-bold text-slate-800 shadow-sm outline-none focus:border-blue-400"
                  value={roleValue}
                  onChange={(e) => setRoleValue(e.target.value as any)}
                  disabled={roleSaving}
                >
                  <option value="user">User</option>
                  <option value="moderator">Moderator</option>
                  <option value="admin">Admin</option>
                  <option value="campaign_manager">Campaign Manager</option>
                </select>
              </div>

              {roleValue === 'moderator' ? (
                <div>
                  <label className="mb-1.5 block text-[10px] font-black uppercase tracking-widest text-slate-400">
                    Assigned States
                  </label>
                  <div className="rounded-2xl border border-slate-200 bg-white p-3 shadow-sm">
                    <div className="flex flex-wrap gap-2 mb-3">
                      {roleStateIds.length === 0 ? (
                        <span className="text-xs font-bold text-slate-400">No states selected</span>
                      ) : (
                        roleStateIds.map((id) => {
                          const name = statesList.find((s) => s.id === id)?.name ?? id;
                          return (
                            <button
                              key={id}
                              type="button"
                              onClick={() => setRoleStateIds((prev) => prev.filter((x) => x !== id))}
                              className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-slate-50 px-3 py-1 text-[11px] font-black text-slate-700"
                              disabled={roleSaving}
                              title="Remove state"
                            >
                              {name}
                              <X size={14} />
                            </button>
                          );
                        })
                      )}
                    </div>
                    <div className="max-h-48 overflow-y-auto rounded-xl border border-slate-100">
                      {statesLoading ? (
                        <div className="p-3 text-xs font-bold text-slate-400">Loading states…</div>
                      ) : (
                        statesList.map((s) => {
                          const checked = roleStateIds.includes(s.id);
                          return (
                            <label key={s.id} className="flex items-center gap-3 px-3 py-2 border-b border-slate-50 last:border-b-0 cursor-pointer">
                              <input
                                type="checkbox"
                                checked={checked}
                                onChange={(e) => {
                                  const on = e.target.checked;
                                  setRoleStateIds((prev) => (on ? Array.from(new Set([...prev, s.id])) : prev.filter((x) => x !== s.id)));
                                }}
                                disabled={roleSaving}
                              />
                              <span className="text-sm font-bold text-slate-800">{s.name}</span>
                            </label>
                          );
                        })
                      )}
                    </div>
                  </div>
                </div>
              ) : null}

              {roleValue === 'campaign_manager' ? (
                <div>
                  <label className="mb-1.5 block text-[10px] font-black uppercase tracking-widest text-slate-400">
                    Assigned Groups
                  </label>
                  <div className="rounded-2xl border border-slate-200 bg-white p-3 shadow-sm">
                    <div className="flex flex-wrap gap-2 mb-3">
                      {roleGroupIds.length === 0 ? (
                        <span className="text-xs font-bold text-slate-400">No groups selected</span>
                      ) : (
                        roleGroupIds.map((id) => {
                          const name = groupsList.find((g) => g.id === id)?.name ?? id;
                          return (
                            <button
                              key={id}
                              type="button"
                              onClick={() => setRoleGroupIds((prev) => prev.filter((x) => x !== id))}
                              className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-slate-50 px-3 py-1 text-[11px] font-black text-slate-700"
                              disabled={roleSaving}
                              title="Remove group"
                            >
                              {name}
                              <X size={14} />
                            </button>
                          );
                        })
                      )}
                    </div>
                    <div className="max-h-48 overflow-y-auto rounded-xl border border-slate-100">
                      {groupsLoading ? (
                        <div className="p-3 text-xs font-bold text-slate-400">Loading groups…</div>
                      ) : (
                        groupsList.map((g) => {
                          const checked = roleGroupIds.includes(g.id);
                          return (
                            <label key={g.id} className="flex items-center gap-3 px-3 py-2 border-b border-slate-50 last:border-b-0 cursor-pointer">
                              <input
                                type="checkbox"
                                checked={checked}
                                onChange={(e) => {
                                  const on = e.target.checked;
                                  setRoleGroupIds((prev) => (on ? Array.from(new Set([...prev, g.id])) : prev.filter((x) => x !== g.id)));
                                }}
                                disabled={roleSaving}
                              />
                              <span className="text-sm font-bold text-slate-800">{g.name}</span>
                            </label>
                          );
                        })
                      )}
                    </div>
                  </div>
                </div>
              ) : null}
            </div>

            <div className="flex gap-3 pt-2">
              <button
                type="button"
                onClick={() => setRoleUser(null)}
                disabled={roleSaving}
                className="flex-1 py-3 bg-slate-100 rounded-2xl font-black text-xs uppercase tracking-widest text-slate-700 disabled:opacity-60"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={roleSaving}
                onClick={async () => {
                  if (roleValue === 'moderator' && roleStateIds.length === 0) {
                    setToast({ message: 'Select at least one state for moderator', tone: 'error' });
                    return;
                  }
                  if (roleValue === 'campaign_manager' && roleGroupIds.length === 0) {
                    setToast({ message: 'Select at least one group for campaign manager', tone: 'error' });
                    return;
                  }

                  const prevRole = String(roleUser.role ?? 'user').trim().toLowerCase();
                  const nextRole = roleValue;
                  const needsConfirm = nextRole === 'admin' || nextRole === 'moderator' || prevRole === 'admin' || prevRole === 'moderator';
                  if (needsConfirm) {
                    const ok = window.confirm(`Confirm role change: ${prevRole || 'user'} → ${nextRole}?`);
                    if (!ok) return;
                  }

                  setRoleSaving(true);
                  try {
                    const res = await fetch('/api/admin/profiles', {
                      method: 'PATCH',
                      credentials: 'same-origin',
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify({
                        id: String(roleUser.id),
                        role: nextRole,
                        assigned_state_ids: nextRole === 'moderator' ? roleStateIds.map((x) => Number(x)).filter((n) => Number.isFinite(n)) : [],
                        assigned_group_ids: nextRole === 'campaign_manager' ? roleGroupIds : [],
                      }),
                    });
                    const d = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string; profile?: any };
                    if (!res.ok) throw new Error(d.error || `HTTP ${res.status}`);

                    const updatedRole = String(d.profile?.role ?? nextRole);
                    const updatedAssignedIds =
                      Array.isArray(d.profile?.assigned_state_ids)
                        ? d.profile.assigned_state_ids.map((x: any) => Number(x)).filter((n: any) => Number.isFinite(n))
                        : [];
                    const updatedAssignedGroupIds =
                      Array.isArray(d.profile?.assigned_group_ids)
                        ? d.profile.assigned_group_ids.map((x: any) => String(x ?? '').trim()).filter(Boolean)
                        : [];

                    setUsers((prev) =>
                      prev.map((u) =>
                        String(u.id) === String(roleUser.id)
                          ? { ...u, role: updatedRole, assigned_state_ids: updatedAssignedIds, assigned_group_ids: updatedAssignedGroupIds }
                          : u
                      )
                    );
                    setSelectedUser((prev) =>
                      prev && String(prev.id) === String(roleUser.id)
                        ? { ...prev, role: updatedRole, assigned_state_ids: updatedAssignedIds, assigned_group_ids: updatedAssignedGroupIds }
                        : prev
                    );
                    setRoleUser((prev) =>
                      prev ? { ...prev, role: updatedRole, assigned_state_ids: updatedAssignedIds, assigned_group_ids: updatedAssignedGroupIds } : null
                    );
                    setToast({ message: 'Role updated', tone: 'success' });
                    setRoleUser(null);
                  } catch (e) {
                    setToast({ message: e instanceof Error ? e.message : 'Save failed', tone: 'error' });
                  } finally {
                    setRoleSaving(false);
                  }
                }}
                className="flex-1 py-3 bg-slate-900 text-white rounded-2xl font-black text-xs uppercase tracking-widest shadow-lg active:scale-95 transition-all disabled:opacity-60"
              >
                {roleSaving ? 'Saving…' : 'Save'}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {/* USER PROFILE MODAL */}
      {selectedUser && (
        <div className="fixed inset-0 z-[110] flex items-center justify-center bg-black/60 backdrop-blur-md p-4 overflow-y-auto">
          <div className="bg-white rounded-[45px] w-full max-w-5xl shadow-2xl overflow-hidden relative">
            <button onClick={() => setSelectedUser(null)} className="absolute top-8 right-8 z-[130] w-12 h-12 bg-slate-900 text-white rounded-2xl flex items-center justify-center hover:bg-blue-600 transition-all shadow-xl"><X size={24} /></button>
            <div className="bg-slate-900 p-10 text-white flex items-center gap-6">
                <div className="w-24 h-24 bg-blue-600 rounded-[30px] flex items-center justify-center text-white shadow-xl shadow-blue-500/20"><User size={48} /></div>
                <div>
                    <h2 className="text-4xl font-black tracking-tight leading-none">{selectedUser.name}</h2>
                    {!isRestrictedViewer ? (
                      <div className="flex items-center gap-4 mt-3">
                          <span className="bg-blue-600 text-[11px] font-black uppercase px-3 py-1 rounded-lg tracking-widest">
                            {fmt(displayPartyLabel(selectedUser.party, selectedUser.party_label) || getPartyLabel(selectedUser.party))}
                          </span>
                      </div>
                    ) : null}
                </div>
            </div>
            <div className="p-10 grid grid-cols-1 lg:grid-cols-12 gap-10 max-h-[60vh] overflow-y-auto bg-white">
                {!isRestrictedViewer ? (
                <div className="lg:col-span-4 space-y-8 border-r border-slate-100 pr-6">
                    <div className="space-y-6">
                        <h3 className="text-[10px] font-black text-slate-400 uppercase tracking-widest flex items-center gap-2 font-mono"><Info size={14} className="text-blue-500" /> Personal Info</h3>
                        <div className="space-y-4">
                            <div className="flex items-center gap-4"><div className="w-10 h-10 bg-slate-50 rounded-xl flex items-center justify-center text-slate-400"><Phone size={18} /></div><p className="font-bold text-slate-800 tracking-tight">{selectedUser.phone}</p></div>
                            <div className="flex items-center gap-4"><div className="w-10 h-10 bg-slate-50 rounded-xl flex items-center justify-center text-slate-400"><Mail size={18} /></div><p className="font-bold text-slate-800 truncate tracking-tight">{selectedUser.email}</p></div>
                        </div>
                    </div>

                    <div className="space-y-6">
                        <h3 className="text-[10px] font-black text-slate-400 uppercase tracking-widest flex items-center gap-2 font-mono"><Info size={14} className="text-blue-500" /> Profile</h3>
                        <div className="space-y-3 text-xs font-bold text-slate-800">
                          <div className="flex items-center justify-between gap-3"><span className="text-slate-400 font-black uppercase tracking-widest text-[9px]">Party</span><span className="font-bold text-slate-800">{fmt(displayPartyLabel(selectedUser.party, selectedUser.party_label) || getPartyLabel(selectedUser.party))}</span></div>
                          <div className="flex items-center justify-between gap-3"><span className="text-slate-400 font-black uppercase tracking-widest text-[9px]">State</span><span className="font-bold text-slate-800">{fmt(selectedUser.state)}</span></div>
                          <div className="flex items-center justify-between gap-3"><span className="text-slate-400 font-black uppercase tracking-widest text-[9px]">Lok Sabha</span><span className="font-bold text-slate-800">{fmt(selectedUser.loksabha)}</span></div>
                          <div className="flex items-center justify-between gap-3"><span className="text-slate-400 font-black uppercase tracking-widest text-[9px]">Assembly</span><span className="font-bold text-slate-800">{fmt(selectedUser.assembly || selectedUser.constituency)}</span></div>
                          <div className="flex items-center justify-between gap-3"><span className="text-slate-400 font-black uppercase tracking-widest text-[9px]">Language</span><span className="font-bold text-slate-800">{fmt(selectedUser.language)}</span></div>
                          <div className="flex items-center justify-between gap-3"><span className="text-slate-400 font-black uppercase tracking-widest text-[9px]">Designation 1</span><span className="font-bold text-slate-800">{fmt(selectedUser.designation1)}</span></div>
                          <div className="flex items-center justify-between gap-3"><span className="text-slate-400 font-black uppercase tracking-widest text-[9px]">Designation 2</span><span className="font-bold text-slate-800">{fmt(selectedUser.designation2)}</span></div>
                          <div className="flex items-center justify-between gap-3"><span className="text-slate-400 font-black uppercase tracking-widest text-[9px]">Designation 3</span><span className="font-bold text-slate-800">{fmt(selectedUser.designation3)}</span></div>
                          <div className="flex items-center justify-between gap-3"><span className="text-slate-400 font-black uppercase tracking-widest text-[9px]">Designation 4</span><span className="font-bold text-slate-800">{fmt(selectedUser.designation4)}</span></div>
                        </div>
                    </div>

                    <div className="space-y-6">
                        <h3 className="text-[10px] font-black text-slate-400 uppercase tracking-widest flex items-center gap-2 font-mono"><Info size={14} className="text-blue-500" /> Social Links</h3>
                        <div className="space-y-3 text-xs font-bold text-slate-800">
                          <div className="flex items-center justify-between gap-3"><span className="text-slate-400 font-black uppercase tracking-widest text-[9px]">WhatsApp</span><span className="font-bold text-slate-800">{fmt(selectedUser.whatsapp || selectedUser.phone)}</span></div>
                          <div className="flex items-center justify-between gap-3"><span className="text-slate-400 font-black uppercase tracking-widest text-[9px]">Facebook</span><span className="font-bold text-slate-800">{fmt(selectedUser.facebook)}</span></div>
                          <div className="flex items-center justify-between gap-3"><span className="text-slate-400 font-black uppercase tracking-widest text-[9px]">Twitter</span><span className="font-bold text-slate-800">{fmt(selectedUser.twitter)}</span></div>
                          <div className="flex items-center justify-between gap-3"><span className="text-slate-400 font-black uppercase tracking-widest text-[9px]">Instagram</span><span className="font-bold text-slate-800">{fmt(selectedUser.instagram)}</span></div>
                        </div>
                    </div>

                    {selectedUser.group_tags.length > 0 ? (
                      <div className="space-y-4">
                        <h3 className="text-[10px] font-black text-slate-400 uppercase tracking-widest flex items-center gap-2 font-mono"><Info size={14} className="text-blue-500" /> Group Tags</h3>
                        <div className="flex flex-wrap gap-2">
                          {selectedUser.group_tags.slice(0, 20).map((t) => (
                            <span key={t} className="inline-flex items-center bg-indigo-50 text-indigo-700 border border-indigo-100 px-2 py-1 rounded-lg text-[10px] font-black uppercase tracking-widest">
                              {t}
                            </span>
                          ))}
                        </div>
                      </div>
                    ) : null}
                </div>
                ) : null}

                {/* UPDATED: USER FRAMES SECTION */}
                <div className={`${isRestrictedViewer ? 'lg:col-span-12' : 'lg:col-span-8'} space-y-6`}>
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
      {!isRestrictedViewer ? (
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
      ) : null}

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
            {isAdmin ? (
              <div className="absolute top-6 right-6">
                <button onClick={() => setIsDeleting(user)} className="p-2 text-slate-200 hover:text-red-500 transition-all"><Trash2 size={18} /></button>
              </div>
            ) : null}

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

              <div className="mt-3 w-full space-y-2 text-xs">
                <div className="flex items-center justify-between gap-3">
                  <span className="text-slate-400 font-bold uppercase tracking-widest text-[9px]">Name</span>
                  <span className="font-bold text-slate-900 text-right">{fmt(user.name)}</span>
                </div>
                {!isRestrictedViewer ? (
                  <>
                    <div className="flex items-center justify-between gap-3">
                      <span className="text-slate-400 font-bold uppercase tracking-widest text-[9px]">Party Name</span>
                      <span className="font-bold text-slate-800 text-right">
                        {fmt(displayPartyLabel(user.party, user.party_label) || getPartyLabel(user.party))}
                      </span>
                    </div>
                    <div className="flex items-center justify-between gap-3">
                      <span className="text-slate-400 font-bold uppercase tracking-widest text-[9px]">Mobile</span>
                      <span className="flex items-center gap-2 justify-end">
                        <span className="font-bold text-slate-800 text-right">{fmt(user.phone)}</span>
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
                          <span
                            className="inline-flex items-center justify-center text-slate-300"
                            aria-label="WhatsApp unavailable"
                            title="WhatsApp unavailable"
                          >
                            <MessageCircle size={16} />
                          </span>
                        )}
                      </span>
                    </div>
                    <div className="flex items-center justify-between gap-3">
                      <span className="text-slate-400 font-bold uppercase tracking-widest text-[9px]">State</span>
                      <span className="font-bold text-slate-800 text-right">{fmt(user.state)}</span>
                    </div>
                    <div className="flex items-center justify-between gap-3">
                      <span className="text-slate-400 font-bold uppercase tracking-widest text-[9px]">Lok Sabha</span>
                      <span className="font-bold text-slate-800 text-right">{fmt(user.loksabha)}</span>
                    </div>
                    <div className="flex items-center justify-between gap-3">
                      <span className="text-slate-400 font-bold uppercase tracking-widest text-[9px]">Assembly</span>
                      <span className="font-bold text-slate-800 text-right">{fmt(user.assembly || user.constituency)}</span>
                    </div>
                  </>
                ) : null}
              </div>
            </div>

            {!isRestrictedViewer && user.group_tags.length > 0 && (
              <div className="mt-4 flex flex-wrap gap-1.5 justify-center">
                {user.group_tags.slice(0, 6).map((t) => (
                  <span
                    key={t}
                    className="inline-flex items-center bg-indigo-50 text-indigo-700 border border-indigo-100 px-2 py-0.5 rounded-lg text-[10px] font-black uppercase tracking-widest"
                    title={t}
                  >
                    {t}
                  </span>
                ))}
                {user.group_tags.length > 6 && (
                  <span className="inline-flex items-center bg-slate-50 text-slate-500 border border-slate-100 px-2 py-0.5 rounded-lg text-[10px] font-black uppercase tracking-widest">
                    +{user.group_tags.length - 6}
                  </span>
                )}
              </div>
            )}

            <button onClick={() => openUserProfile(user)} className="mt-6 w-full py-3 bg-slate-50 rounded-2xl text-[9px] font-black uppercase tracking-widest text-slate-700 hover:bg-slate-100 transition-all flex items-center justify-center gap-2 active:scale-95">
              {isRestrictedViewer ? 'Frames' : 'Profile & Frames'} <ExternalLink size={14} />
            </button>

            {isAdmin ? (
              <button
                type="button"
                onClick={() => setRoleUser(user)}
                className="mt-2 w-full py-3 bg-white border border-slate-200 rounded-2xl text-[9px] font-black uppercase tracking-widest text-slate-700 hover:bg-slate-50 transition-all flex items-center justify-center gap-2 active:scale-95"
              >
                Manage Role <Info size={14} />
              </button>
            ) : null}
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