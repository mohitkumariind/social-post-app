'use client';

import { useCallback, useEffect, useState } from 'react';

type DebugUser = {
  id: string;
  email: string | null;
  role: string;
};

type Evaluation = {
  user: DebugUser & {
    assigned_state_ids: number[];
    assigned_group_ids: string[];
    assigned_party_ids: string[];
  };
  normalized_scope: Record<string, unknown>;
  allowed_modules: string[];
  denied_modules: { module: string; label: string }[];
  can_use_global_filters: boolean;
  analytics_scope: Record<string, unknown>;
  broadcast_scope: Record<string, unknown>;
  sample_events: {
    id: string;
    name: string;
    can_view: boolean;
    can_edit: boolean;
    can_upload: boolean;
    denied_reason?: string;
    visibility_match: boolean;
    ownership_match: boolean;
  }[];
};

export default function RbacDebugClient() {
  const [users, setUsers] = useState<DebugUser[]>([]);
  const [selectedId, setSelectedId] = useState('');
  const [evaluation, setEvaluation] = useState<Evaluation | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadUsers = useCallback(async () => {
    const res = await fetch('/api/admin/rbac-debug', { credentials: 'same-origin' });
    const d = (await res.json().catch(() => ({}))) as { users?: DebugUser[]; error?: string };
    if (!res.ok) throw new Error(d.error ?? 'Failed to load users');
    setUsers(Array.isArray(d.users) ? d.users : []);
  }, []);

  const loadEvaluation = useCallback(async (userId: string) => {
    if (!userId) {
      setEvaluation(null);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/admin/rbac-debug?user_id=${encodeURIComponent(userId)}`, {
        credentials: 'same-origin',
      });
      const d = (await res.json().catch(() => ({}))) as { evaluation?: Evaluation; error?: string };
      if (!res.ok) throw new Error(d.error ?? 'Evaluation failed');
      setEvaluation(d.evaluation ?? null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed');
      setEvaluation(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadUsers().catch((e) => setError(e instanceof Error ? e.message : 'Failed'));
  }, [loadUsers]);

  useEffect(() => {
    void loadEvaluation(selectedId);
  }, [selectedId, loadEvaluation]);

  return (
    <div className="mx-auto max-w-5xl space-y-6 text-zinc-100">
      <div>
        <h1 className="text-2xl font-semibold text-white">RBAC Debug</h1>
        <p className="mt-1 text-sm text-zinc-400">
          Inspect centralized permissions for any admin-panel user (modules, scope, events, filters).
        </p>
      </div>

      <label className="flex max-w-md flex-col gap-1 text-sm">
        <span className="text-zinc-400">User</span>
        <select
          className="rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-white"
          value={selectedId}
          onChange={(e) => setSelectedId(e.target.value)}
        >
          <option value="">Select a user…</option>
          {users.map((u) => (
            <option key={u.id} value={u.id}>
              {u.email ?? u.id} ({u.role})
            </option>
          ))}
        </select>
      </label>

      {error ? <p className="text-sm text-red-300">{error}</p> : null}
      {loading ? <p className="text-sm text-zinc-500">Evaluating…</p> : null}

      {evaluation ? (
        <div className="space-y-4 rounded-xl border border-zinc-800 bg-zinc-900/60 p-4">
          <section>
            <h2 className="text-lg font-medium text-white">Identity</h2>
            <p className="text-sm text-zinc-400">
              Role: <span className="text-zinc-200">{evaluation.user.role}</span>
            </p>
            <p className="text-sm text-zinc-400">
              Global filters:{' '}
              <span className={evaluation.can_use_global_filters ? 'text-emerald-400' : 'text-rose-400'}>
                {evaluation.can_use_global_filters ? 'allowed' : 'denied'}
              </span>
            </p>
          </section>

          <section>
            <h2 className="text-lg font-medium text-white">Normalized scope</h2>
            <pre className="mt-2 overflow-auto rounded-lg bg-zinc-950 p-3 text-xs text-zinc-300">
              {JSON.stringify(evaluation.normalized_scope, null, 2)}
            </pre>
          </section>

          <section className="grid gap-4 md:grid-cols-2">
            <div>
              <h3 className="font-medium text-emerald-400">Can access</h3>
              <ul className="mt-2 list-inside list-disc text-sm text-zinc-300">
                {evaluation.allowed_modules.map((m) => (
                  <li key={m}>{m}</li>
                ))}
              </ul>
            </div>
            <div>
              <h3 className="font-medium text-rose-400">Cannot access</h3>
              <ul className="mt-2 list-inside list-disc text-sm text-zinc-300">
                {evaluation.denied_modules.map((d) => (
                  <li key={d.module}>{d.label}</li>
                ))}
              </ul>
            </div>
          </section>

          <section>
            <h2 className="text-lg font-medium text-white">Targeting scopes</h2>
            <pre className="mt-2 overflow-auto rounded-lg bg-zinc-950 p-3 text-xs text-zinc-300">
              {JSON.stringify(
                { analytics: evaluation.analytics_scope, broadcast: evaluation.broadcast_scope },
                null,
                2
              )}
            </pre>
          </section>

          <section>
            <h2 className="text-lg font-medium text-white">Sample events</h2>
            <div className="mt-2 overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead className="text-zinc-500">
                  <tr>
                    <th className="p-2">Event</th>
                    <th className="p-2">View</th>
                    <th className="p-2">Edit</th>
                    <th className="p-2">Upload</th>
                    <th className="p-2">Visibility</th>
                    <th className="p-2">Owner</th>
                    <th className="p-2">Denied</th>
                  </tr>
                </thead>
                <tbody>
                  {evaluation.sample_events.map((ev) => (
                    <tr key={ev.id} className="border-t border-zinc-800">
                      <td className="p-2">{ev.name || ev.id}</td>
                      <td className="p-2">{ev.can_view ? '✔' : '✖'}</td>
                      <td className="p-2">{ev.can_edit ? '✔' : '✖'}</td>
                      <td className="p-2">{ev.can_upload ? '✔' : '✖'}</td>
                      <td className="p-2">{ev.visibility_match ? '✔' : '✖'}</td>
                      <td className="p-2">{ev.ownership_match ? '✔' : '✖'}</td>
                      <td className="p-2 text-xs text-zinc-500">{ev.denied_reason ?? '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        </div>
      ) : null}
    </div>
  );
}
