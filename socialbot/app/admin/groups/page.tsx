'use client';

import { Search, Tags, Trash2, Users, X } from 'lucide-react';
import React, { useCallback, useEffect, useState } from 'react';

type GroupRow = { tag: string; count: number }; // tag = group_id as string

type MemberRow = {
  id: string;
  name: string;
  phone: string;
  avatar_url: string;
  group_id: number | null;
};

export default function GroupManagementPage() {
  const [groups, setGroups] = useState<GroupRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  // Create Group modal
  const [createOpen, setCreateOpen] = useState(false);
  const [createName, setCreateName] = useState(''); // group id (number) as string
  const [createSearch, setCreateSearch] = useState('');
  const [createSearching, setCreateSearching] = useState(false);
  const [createSearchResults, setCreateSearchResults] = useState<MemberRow[]>([]);
  const [createSelected, setCreateSelected] = useState<MemberRow[]>([]);
  const [createBusy, setCreateBusy] = useState(false);

  const [detailTag, setDetailTag] = useState<string | null>(null);
  const [members, setMembers] = useState<MemberRow[]>([]);
  const [membersLoading, setMembersLoading] = useState(false);
  const [addSearch, setAddSearch] = useState('');
  const [searchResults, setSearchResults] = useState<MemberRow[]>([]);
  const [searching, setSearching] = useState(false);

  const [deleteConfirmTag, setDeleteConfirmTag] = useState<string | null>(null);
  const [busyTag, setBusyTag] = useState<string | null>(null);

  useEffect(() => {
    if (!toast) return;
    const t = window.setTimeout(() => setToast(null), 2800);
    return () => window.clearTimeout(t);
  }, [toast]);

  const loadGroups = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/admin/groups', { credentials: 'same-origin' });
      const json = (await res.json()) as { groups?: GroupRow[]; error?: string };
      if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`);
      setGroups(json.groups ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load groups');
      setGroups([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadGroups();
  }, [loadGroups]);

  const openDetail = async (tag: string) => {
    setDetailTag(tag);
    setMembers([]);
    setAddSearch('');
    setSearchResults([]);
    setMembersLoading(true);
    try {
      const res = await fetch(`/api/admin/groups?tag=${encodeURIComponent(tag)}`, { credentials: 'same-origin' });
      const json = (await res.json()) as { members?: MemberRow[]; error?: string };
      if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`);
      setMembers(json.members ?? []);
    } catch (e) {
      setToast(e instanceof Error ? e.message : 'Failed to load members');
      setDetailTag(null);
    } finally {
      setMembersLoading(false);
    }
  };

  const runUserSearch = async () => {
    const q = addSearch.trim();
    if (!q) {
      setSearchResults([]);
      return;
    }
    setSearching(true);
    try {
      const usp = new URLSearchParams();
      usp.set('search_query', q);
      const res = await fetch(`/api/admin/profiles?${usp.toString()}`, { credentials: 'same-origin' });
      const json = (await res.json()) as { profiles?: Record<string, unknown>[]; error?: string };
      if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`);
      const rows = (json.profiles ?? []).map((r) => ({
        id: String(r.id ?? ''),
        name: String(r.name ?? ''),
        phone: String(r.phone ?? ''),
        avatar_url: String(r.avatar_url ?? ''),
        group_id:
          typeof (r as any).group_id === 'number'
            ? (r as any).group_id
            : (r as any).group_id != null
              ? Number((r as any).group_id)
              : null,
      }));
      setSearchResults(rows.filter((r) => r.id));
    } catch (e) {
      setToast(e instanceof Error ? e.message : 'Search failed');
      setSearchResults([]);
    } finally {
      setSearching(false);
    }
  };

  const addUserToCurrentGroup = async (userId: string) => {
    if (!detailTag) return;
    setBusyTag(detailTag);
    try {
      const res = await fetch('/api/admin/groups', {
        method: 'PATCH',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId, add: [detailTag] }),
      });
      const json = (await res.json()) as { error?: string };
      if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`);
      setToast('User added to group');
      await openDetail(detailTag);
      await loadGroups();
      setSearchResults((prev) => prev.filter((r) => r.id !== userId));
    } catch (e) {
      setToast(e instanceof Error ? e.message : 'Add failed');
    } finally {
      setBusyTag(null);
    }
  };

  const removeUserFromGroup = async (userId: string) => {
    if (!detailTag) return;
    setBusyTag(detailTag);
    try {
      const res = await fetch('/api/admin/groups', {
        method: 'PATCH',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId, remove: [detailTag] }),
      });
      const json = (await res.json()) as { error?: string };
      if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`);
      setToast('Removed from group');
      await openDetail(detailTag);
      await loadGroups();
    } catch (e) {
      setToast(e instanceof Error ? e.message : 'Remove failed');
    } finally {
      setBusyTag(null);
    }
  };

  const deleteGroupEverywhere = async (tag: string) => {
    setBusyTag(tag);
    try {
      const res = await fetch(`/api/admin/groups?tag=${encodeURIComponent(tag)}`, {
        method: 'DELETE',
        credentials: 'same-origin',
      });
      const json = (await res.json()) as { error?: string; profilesUpdated?: number };
      if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`);
      setToast(`Deleted “${tag}” from ${json.profilesUpdated ?? 0} profiles`);
      setDeleteConfirmTag(null);
      if (detailTag === tag) {
        setDetailTag(null);
        setMembers([]);
      }
      await loadGroups();
    } catch (e) {
      setToast(e instanceof Error ? e.message : 'Delete failed');
    } finally {
      setBusyTag(null);
    }
  };

  return (
    <div className="mx-auto max-w-6xl space-y-8 text-slate-700">
      <div className="flex flex-col gap-4 rounded-[40px] border border-slate-100 bg-white p-8 shadow-sm sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-4">
          <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-indigo-600 text-white shadow-xl shadow-indigo-100">
            <Tags size={28} />
          </div>
          <div>
            <h1 className="text-3xl font-black tracking-tight text-slate-900">Group Management</h1>
            <p className="mt-2 text-xs font-bold uppercase tracking-[0.2em] text-slate-400">
              Centralized worker tags from profiles.group_tags
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => {
              setCreateName('');
              setCreateSearch('');
              setCreateSearchResults([]);
              setCreateSelected([]);
              setCreateOpen(true);
            }}
            className="rounded-2xl bg-slate-900 px-6 py-3 text-[10px] font-black uppercase tracking-widest text-white shadow-lg transition-all hover:bg-slate-800 active:scale-95"
          >
            Create Group
          </button>
          <button
            type="button"
            onClick={() => void loadGroups()}
            className="rounded-2xl border border-slate-200 bg-white px-6 py-3 text-[10px] font-black uppercase tracking-widest text-slate-700 shadow-sm transition-all hover:border-blue-300 hover:bg-blue-50 active:scale-95"
          >
            Refresh
          </button>
        </div>
      </div>

      {error && (
        <div className="rounded-2xl border border-rose-100 bg-rose-50 px-4 py-3 text-sm font-bold text-rose-700">{error}</div>
      )}

      {loading ? (
        <div className="py-16 text-center text-sm font-bold text-slate-400">Loading groups…</div>
      ) : groups.length === 0 ? (
        <div className="rounded-[40px] border-2 border-dashed border-slate-100 bg-slate-50 py-20 text-center">
          <p className="text-sm font-black uppercase tracking-widest text-slate-400 italic">No group tags yet. Assign tags from Users or add members below.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {groups.map((g) => (
            <div
              key={g.tag}
              className="flex items-center gap-4 rounded-[26px] border border-slate-100 bg-white px-5 py-4 shadow-sm hover:bg-slate-50/60"
            >
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-black text-slate-900">{g.tag}</p>
              </div>

              <div className="shrink-0">
                <span className="inline-flex items-center rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-[10px] font-black uppercase tracking-widest text-slate-700">
                  {g.count} members
                </span>
              </div>

              <div className="ml-auto flex shrink-0 items-center gap-2">
                <button
                  type="button"
                  onClick={() => void openDetail(g.tag)}
                  className="inline-flex h-10 items-center justify-center rounded-2xl border border-slate-200 bg-white px-4 text-[10px] font-black uppercase tracking-widest text-slate-700 shadow-sm transition-all hover:border-blue-300 hover:bg-blue-50 active:scale-95"
                >
                  View
                </button>
                <button
                  type="button"
                  onClick={() => {
                    void openDetail(g.tag);
                    setAddSearch('');
                  }}
                  className="inline-flex h-10 items-center justify-center rounded-2xl border border-slate-200 bg-white px-4 text-[10px] font-black uppercase tracking-widest text-slate-700 shadow-sm transition-all hover:border-blue-300 hover:bg-blue-50 active:scale-95"
                >
                  Add
                </button>
                <button
                  type="button"
                  onClick={() => setDeleteConfirmTag(g.tag)}
                  disabled={busyTag === g.tag}
                  className="inline-flex h-10 items-center justify-center rounded-2xl border border-rose-100 bg-rose-50 px-4 text-[10px] font-black uppercase tracking-widest text-rose-700 shadow-sm transition-all hover:bg-rose-100 active:scale-95 disabled:opacity-50"
                >
                  Delete
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Create Group */}
      {createOpen && (
        <div className="fixed inset-0 z-[120] flex items-center justify-center bg-black/40 p-4 backdrop-blur-sm">
          <div className="w-full max-w-2xl overflow-hidden rounded-[40px] border border-slate-100 bg-white shadow-2xl">
            <div className="flex items-center justify-between border-b border-slate-100 px-6 py-5">
              <div>
                <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">Create Group</p>
                <p className="text-lg font-black text-slate-900">New group tag + members</p>
              </div>
              <button
                type="button"
                onClick={() => setCreateOpen(false)}
                className="rounded-xl p-2 text-slate-400 hover:bg-slate-50 hover:text-slate-900"
                aria-label="Close"
              >
                <X size={22} />
              </button>
            </div>

            <div className="space-y-5 px-6 py-5">
              <div>
                <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">Group name</p>
                <input
                  value={createName}
                  onChange={(e) => setCreateName(e.target.value)}
                  placeholder="e.g. Team_Test"
                  className="mt-2 w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm font-bold text-slate-900 outline-none placeholder:text-slate-300 focus:border-blue-300"
                />
              </div>

              <div className="rounded-[26px] border border-slate-100 bg-slate-50 p-4">
                <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">Search users (name or phone)</p>
                <div className="mt-2 flex gap-2">
                  <div className="flex flex-1 items-center gap-2 rounded-2xl border border-slate-100 bg-white px-3 py-2">
                    <Search size={16} className="text-slate-400" />
                    <input
                      value={createSearch}
                      onChange={(e) => setCreateSearch(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          const q = createSearch.trim();
                          if (!q) return;
                          void (async () => {
                            setCreateSearching(true);
                            try {
                              const usp = new URLSearchParams();
                              usp.set('search_query', q);
                              const res = await fetch(`/api/admin/profiles?${usp.toString()}`, { credentials: 'same-origin' });
                              const json = (await res.json()) as { profiles?: Record<string, unknown>[]; error?: string };
                              if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`);
                              const rows = (json.profiles ?? []).map((r) => ({
                                id: String(r.id ?? ''),
                                name: String(r.name ?? ''),
                                phone: String(r.phone ?? ''),
                                avatar_url: String(r.avatar_url ?? ''),
                                group_id:
                                  typeof (r as any).group_id === 'number'
                                    ? (r as any).group_id
                                    : (r as any).group_id != null
                                      ? Number((r as any).group_id)
                                      : null,
                              }));
                              setCreateSearchResults(rows.filter((r) => r.id));
                            } catch (e2) {
                              setToast(e2 instanceof Error ? e2.message : 'Search failed');
                              setCreateSearchResults([]);
                            } finally {
                              setCreateSearching(false);
                            }
                          })();
                        }
                      }}
                      placeholder="Type and press Enter…"
                      className="min-w-0 flex-1 bg-transparent text-sm font-bold text-slate-900 outline-none placeholder:text-slate-300"
                    />
                  </div>
                  <button
                    type="button"
                    disabled={createSearching}
                    onClick={() => {
                      const q = createSearch.trim();
                      if (!q) {
                        setCreateSearchResults([]);
                        return;
                      }
                      void (async () => {
                        setCreateSearching(true);
                        try {
                          const usp = new URLSearchParams();
                          usp.set('search_query', q);
                          const res = await fetch(`/api/admin/profiles?${usp.toString()}`, { credentials: 'same-origin' });
                          const json = (await res.json()) as { profiles?: Record<string, unknown>[]; error?: string };
                          if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`);
                          const rows = (json.profiles ?? []).map((r) => ({
                            id: String(r.id ?? ''),
                            name: String(r.name ?? ''),
                            phone: String(r.phone ?? ''),
                            avatar_url: String(r.avatar_url ?? ''),
                            group_id:
                              typeof (r as any).group_id === 'number'
                                ? (r as any).group_id
                                : (r as any).group_id != null
                                  ? Number((r as any).group_id)
                                  : null,
                          }));
                          setCreateSearchResults(rows.filter((r) => r.id));
                        } catch (e2) {
                          setToast(e2 instanceof Error ? e2.message : 'Search failed');
                          setCreateSearchResults([]);
                        } finally {
                          setCreateSearching(false);
                        }
                      })();
                    }}
                    className="rounded-2xl bg-slate-900 px-4 py-2 text-[10px] font-black uppercase tracking-widest text-white disabled:opacity-50"
                  >
                    {createSearching ? '…' : 'Search'}
                  </button>
                </div>

                {createSelected.length > 0 && (
                  <div className="mt-3 flex flex-wrap gap-2">
                    {createSelected.map((u) => (
                      <button
                        key={u.id}
                        type="button"
                        onClick={() => setCreateSelected((prev) => prev.filter((x) => x.id !== u.id))}
                        className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white px-3 py-1.5 text-[10px] font-black uppercase tracking-widest text-slate-700 hover:bg-slate-50"
                        title="Remove"
                      >
                        <span className="max-w-[200px] truncate">{u.name || '—'} · {u.phone || '—'}</span>
                        <X size={14} className="text-slate-400" />
                      </button>
                    ))}
                  </div>
                )}

                {createSearchResults.length > 0 && (
                  <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2">
                    {createSearchResults.map((u) => {
                      const selected = createSelected.some((x) => x.id === u.id);
                      return (
                        <button
                          key={u.id}
                          type="button"
                          onClick={() => {
                            if (selected) return;
                            setCreateSelected((prev) => [...prev, u]);
                          }}
                          disabled={selected}
                          className="flex items-center justify-between gap-3 rounded-2xl border border-slate-100 bg-white px-4 py-3 text-left text-xs font-bold text-slate-800 shadow-sm hover:bg-slate-50 disabled:opacity-50"
                        >
                          <span className="min-w-0 flex-1 truncate">{u.name || '—'} · {u.phone || '—'}</span>
                          <span className="shrink-0 rounded-full bg-indigo-50 px-2 py-1 text-[9px] font-black uppercase tracking-widest text-indigo-700">
                            {selected ? 'Selected' : 'Add'}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>

            <div className="flex items-center justify-end gap-2 border-t border-slate-100 bg-white px-6 py-5">
              <button
                type="button"
                onClick={() => setCreateOpen(false)}
                className="rounded-2xl bg-slate-100 px-5 py-3 text-[10px] font-black uppercase tracking-widest text-slate-700"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={createBusy || !createName.trim() || createSelected.length === 0}
                onClick={() => {
                  const tag = createName.trim();
                  if (!tag) return;
                  const userIds = createSelected.map((u) => u.id).filter(Boolean);
                  if (userIds.length === 0) return;
                  void (async () => {
                    setCreateBusy(true);
                    try {
                      const res = await fetch('/api/admin/groups', {
                        method: 'POST',
                        credentials: 'same-origin',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ tag, userIds }),
                      });
                      const json = (await res.json().catch(() => ({}))) as {
                        error?: string;
                        updated?: number;
                        group_id?: number;
                      };
                      if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`);
                      const gid = typeof json.group_id === 'number' ? json.group_id : tag;
                      setToast(`Created “${tag}” → Group ID ${gid} (${json.updated ?? 0} users)`);
                      setCreateOpen(false);
                      await loadGroups();
                    } catch (e2) {
                      setToast(e2 instanceof Error ? e2.message : 'Create group failed');
                    } finally {
                      setCreateBusy(false);
                    }
                  })();
                }}
                className="rounded-2xl bg-slate-900 px-5 py-3 text-[10px] font-black uppercase tracking-widest text-white disabled:opacity-50"
              >
                {createBusy ? 'Working…' : 'Create'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Delete confirm */}
      {deleteConfirmTag && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/40 p-4 backdrop-blur-sm">
          <div className="w-full max-w-md space-y-6 rounded-[40px] border border-slate-100 bg-white p-10 text-center shadow-2xl">
            <div className="mx-auto flex h-20 w-20 items-center justify-center rounded-full bg-rose-50 text-rose-500 shadow-inner">
              <Trash2 size={36} />
            </div>
            <p className="text-xl font-black text-slate-900">Remove tag everywhere?</p>
            <p className="text-sm font-bold text-slate-500">
              “{deleteConfirmTag}” will be removed from every profile that has it. This cannot be undone from here.
            </p>
            <div className="flex gap-3">
              <button
                type="button"
                onClick={() => setDeleteConfirmTag(null)}
                className="flex-1 rounded-2xl bg-slate-100 py-4 font-bold text-slate-700"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => void deleteGroupEverywhere(deleteConfirmTag)}
                disabled={busyTag === deleteConfirmTag}
                className="flex-1 rounded-2xl bg-rose-600 py-4 font-bold text-white disabled:opacity-50"
              >
                {busyTag === deleteConfirmTag ? 'Working…' : 'Delete'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Members + add modal */}
      {detailTag && (
        <div className="fixed inset-0 z-[110] flex items-center justify-center bg-black/40 p-3 backdrop-blur-sm sm:p-4">
          <div className="flex max-h-[90vh] w-full max-w-lg flex-col overflow-hidden rounded-[40px] border border-slate-100 bg-white shadow-2xl">
            <div className="flex shrink-0 items-center justify-between border-b border-slate-100 px-5 py-4">
              <div>
                <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">Group</p>
                <p className="text-lg font-black text-slate-900">{detailTag}</p>
              </div>
              <button type="button" onClick={() => setDetailTag(null)} className="rounded-xl p-2 text-slate-400 hover:bg-slate-50 hover:text-slate-900">
                <X size={22} />
              </button>
            </div>

            <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-5 py-4">
              <div className="rounded-2xl border border-slate-100 bg-slate-50 p-3">
                <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">Add user (name or phone)</p>
                <div className="mt-2 flex gap-2">
                  <div className="flex flex-1 items-center gap-2 rounded-xl border border-slate-100 bg-white px-3 py-2">
                    <Search size={16} className="text-slate-400" />
                    <input
                      value={addSearch}
                      onChange={(e) => setAddSearch(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') void runUserSearch();
                      }}
                      placeholder="Search…"
                      className="min-w-0 flex-1 bg-transparent text-sm font-bold text-slate-800 outline-none placeholder:text-slate-300"
                    />
                  </div>
                  <button
                    type="button"
                    onClick={() => void runUserSearch()}
                    disabled={searching}
                    className="rounded-xl bg-blue-600 px-4 py-2 text-[10px] font-black uppercase tracking-widest text-white disabled:opacity-50"
                  >
                    {searching ? '…' : 'Search'}
                  </button>
                </div>
                {searchResults.length > 0 && (
                  <ul className="mt-3 max-h-40 space-y-2 overflow-y-auto">
                    {searchResults.map((r) => {
                      const already =
                        members.some((m) => m.id === r.id) || (r.group_id != null && String(r.group_id) === String(detailTag));
                      return (
                        <li key={r.id} className="flex items-center justify-between gap-2 rounded-xl border border-slate-100 bg-white px-3 py-2 text-xs font-bold">
                          <span className="truncate text-slate-800">{r.name || '—'} · {r.phone || '—'}</span>
                          <button
                            type="button"
                            disabled={already || busyTag === detailTag}
                            onClick={() => void addUserToCurrentGroup(r.id)}
                            className="shrink-0 rounded-lg bg-indigo-600 px-2 py-1 text-[9px] font-black uppercase tracking-widest text-white disabled:opacity-40"
                          >
                            {already ? 'In group' : 'Add'}
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </div>

              <div>
                <p className="mb-2 flex items-center gap-2 text-[10px] font-black uppercase tracking-widest text-slate-400">
                  <Users size={14} /> Members ({membersLoading ? '…' : members.length})
                </p>
                {membersLoading ? (
                  <p className="text-sm font-bold text-slate-400">Loading…</p>
                ) : members.length === 0 ? (
                  <p className="text-sm font-bold text-slate-400">No members.</p>
                ) : (
                  <ul className="space-y-2">
                    {members.map((m) => (
                      <li key={m.id} className="flex items-center justify-between gap-3 rounded-2xl border border-slate-100 bg-white px-4 py-3 shadow-sm">
                        <div className="min-w-0">
                          <p className="truncate text-sm font-black text-slate-900">{m.name || '—'}</p>
                          <p className="truncate text-xs font-bold text-slate-500">{m.phone || '—'}</p>
                        </div>
                        <button
                          type="button"
                          disabled={busyTag === detailTag}
                          onClick={() => void removeUserFromGroup(m.id)}
                          className="shrink-0 rounded-xl border border-rose-100 bg-rose-50 px-3 py-2 text-[9px] font-black uppercase tracking-widest text-rose-700 disabled:opacity-50"
                        >
                          Remove
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>

            <div className="shrink-0 border-t border-slate-100 bg-slate-50 px-5 py-3 text-center text-[10px] font-bold text-slate-400">
              Use search above to attach more workers to this tag.
            </div>
          </div>
        </div>
      )}

      {toast && (
        <div className="fixed left-1/2 top-6 z-[200] -translate-x-1/2 rounded-2xl bg-slate-900 px-5 py-3 text-[10px] font-black uppercase tracking-widest text-white shadow-2xl">
          {toast}
        </div>
      )}

    </div>
  );
}
