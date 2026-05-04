'use client';

import { Search, Tags, Trash2, UserPlus, Users, X } from 'lucide-react';
import React, { useCallback, useEffect, useState } from 'react';

type GroupRow = { tag: string; count: number };

type MemberRow = {
  id: string;
  name: string;
  phone: string;
  avatar_url: string;
  group_tags: string[];
};

export default function GroupManagementPage() {
  const [groups, setGroups] = useState<GroupRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);

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
        phone: String(r.phone ?? r.phone_number ?? ''),
        avatar_url: String(r.avatar_url ?? ''),
        group_tags: Array.isArray(r.group_tags)
          ? (r.group_tags as unknown[]).map((x) => String(x ?? '').trim()).filter(Boolean)
          : [],
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
        <button
          type="button"
          onClick={() => void loadGroups()}
          className="rounded-2xl bg-slate-900 px-6 py-3 text-[10px] font-black uppercase tracking-widest text-white shadow-lg transition-all hover:bg-slate-800 active:scale-95"
        >
          Refresh
        </button>
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
        <div className="overflow-hidden rounded-[32px] border border-slate-100 bg-white shadow-sm">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-slate-100 bg-slate-50 text-[10px] font-black uppercase tracking-widest text-slate-400">
              <tr>
                <th className="px-6 py-4">Group</th>
                <th className="px-6 py-4">Members</th>
                <th className="px-6 py-4 text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {groups.map((g) => (
                <tr key={g.tag} className="border-b border-slate-50 last:border-0 hover:bg-slate-50/80">
                  <td className="px-6 py-4">
                    <span className="inline-flex items-center rounded-xl border border-indigo-100 bg-indigo-50 px-3 py-1 text-xs font-black uppercase tracking-widest text-indigo-800">
                      {g.tag}
                    </span>
                  </td>
                  <td className="px-6 py-4 font-bold text-slate-800">{g.count}</td>
                  <td className="px-6 py-4 text-right">
                    <div className="flex flex-wrap justify-end gap-2">
                      <button
                        type="button"
                        onClick={() => void openDetail(g.tag)}
                        className="rounded-xl bg-slate-900 px-3 py-2 text-[10px] font-black uppercase tracking-widest text-white transition-all hover:bg-slate-800 active:scale-95"
                      >
                        View Members
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          void openDetail(g.tag);
                          setAddSearch('');
                        }}
                        className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-[10px] font-black uppercase tracking-widest text-slate-700 transition-all hover:border-blue-300 hover:bg-blue-50 active:scale-95"
                      >
                        Add User
                      </button>
                      <button
                        type="button"
                        onClick={() => setDeleteConfirmTag(g.tag)}
                        disabled={busyTag === g.tag}
                        className="rounded-xl border border-rose-100 bg-rose-50 px-3 py-2 text-[10px] font-black uppercase tracking-widest text-rose-700 transition-all hover:bg-rose-100 active:scale-95 disabled:opacity-50"
                      >
                        Delete Group
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
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
                      const already = members.some((m) => m.id === r.id) || r.group_tags.some((t) => t.toLowerCase() === detailTag.toLowerCase());
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
              <UserPlus className="mx-auto mb-1 inline text-slate-300" size={16} /> Use search above to attach more workers to this tag.
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
