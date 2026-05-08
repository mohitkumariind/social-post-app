import { NextRequest, NextResponse } from 'next/server';
import { createServiceRoleClient, validateAdminSession } from '@/lib/admin-gate';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { resolveScope } from '@/lib/rbac/unified-scope-engine';
import { RbacError, requireModeratorHasAssignedStates, requireRole, toNumArray, toStrArray } from '@/lib/rbac/require';

function json(body: unknown, status = 200) {
  return NextResponse.json(body, { status, headers: { 'Cache-Control': 'no-store' } });
}

function isMissingTableErr(err: { message?: string } | null | undefined, tableName: string) {
  const msg = String(err?.message ?? '').toLowerCase();
  return (
    msg.includes('could not find the table') ||
    msg.includes('schema cache') ||
    (msg.includes(tableName.toLowerCase()) && (msg.includes('does not exist') || msg.includes('relation')))
  );
}

function toInt(v: string | null, d: number): number {
  const n = Number(v);
  return Number.isFinite(n) ? Math.max(1, Math.min(200, n)) : d;
}

function intersectsNums(a: unknown, b: number[]): boolean {
  const aa = toNumArray(a);
  if (aa.length === 0 || b.length === 0) return false;
  const set = new Set(b.map(Number));
  return aa.some((n) => set.has(Number(n)));
}

function intersectsStr(a: unknown, b: string[]): boolean {
  const aa = toStrArray(a);
  if (aa.length === 0 || b.length === 0) return false;
  const set = new Set(b.map((x) => String(x).trim()).filter(Boolean));
  return aa.some((s) => set.has(String(s).trim()));
}

export async function GET(request: NextRequest) {
  const supabase = await createSupabaseServerClient();
  const auth = await validateAdminSession(supabase);
  if (!auth.ok) return json({ error: auth.status === 401 ? 'Unauthorized' : 'Forbidden' }, auth.status);
  try {
    requireRole(auth, ['admin', 'moderator', 'campaign_manager']);
    requireModeratorHasAssignedStates(auth);
  } catch (e) {
    if (e instanceof RbacError) return json({ error: e.message }, e.status);
    return json({ error: 'Forbidden' }, 403);
  }

  const admin = createServiceRoleClient();
  if (!admin) return json({ error: 'SUPABASE_SERVICE_ROLE_KEY not configured' }, 503);

  const sp = request.nextUrl.searchParams;
  const limit = toInt(sp.get('limit'), 50);
  const cursorCreatedAt = (sp.get('cursor_created_at') ?? '').trim();

  const actor_role = (sp.get('actor_role') ?? '').trim();
  const action_type = (sp.get('action_type') ?? '').trim();
  const resource_type = (sp.get('resource_type') ?? '').trim();
  const severity = (sp.get('severity') ?? '').trim();
  const q = (sp.get('q') ?? '').trim();
  const start = (sp.get('start') ?? '').trim();
  const end = (sp.get('end') ?? '').trim();

  let query = admin.from('admin_logs').select('*').order('created_at', { ascending: false }).limit(limit) as any;

  // Cursor pagination (simple + stable enough): "created_at < cursor_created_at"
  if (cursorCreatedAt) query = query.lt('created_at', cursorCreatedAt);

  // Filters
  if (actor_role) query = query.eq('actor_role', actor_role);
  if (action_type) query = query.eq('action_type', action_type);
  if (resource_type) query = query.eq('resource_type', resource_type);
  if (severity) query = query.eq('severity', severity);
  if (start) query = query.gte('created_at', start);
  if (end) query = query.lte('created_at', end);

  if (q) {
    // Basic search: resource_name ilike OR actor_user_id exact-ish.
    query = query.or(`resource_name.ilike.%${q}%,actor_user_id.eq.${q}`);
  }

  const { data, error } = await query;
  if (error) {
    if (isMissingTableErr(error, 'admin_logs')) {
      return json({ logs: [], next_cursor_created_at: '', schemaMissing: true });
    }
    return json({ error: error.message }, 500);
  }
  const rowsAll = (data ?? []) as any[];

  // RBAC visibility (server-side final gate; query params can only narrow, never widen)
  const scope = resolveScope({
    role: auth.role,
    assigned_state_ids: auth.assigned_state_ids,
    assigned_group_ids: auth.assigned_group_ids,
  });

  const rows =
    auth.role === 'admin'
      ? rowsAll
      : rowsAll.filter((r) => {
          const actorId = String((r as any).actor_user_id ?? '').trim();
          if (actorId && actorId === auth.user.id) return true;
          if (scope.type === 'STATE') return intersectsNums((r as any).scope_state_ids, scope.states);
          if (scope.type === 'GROUP') return intersectsStr((r as any).scope_group_ids, scope.groups);
          return false;
        });
  const nextCursorCreatedAt = rows.length > 0 ? String(rows[rows.length - 1]?.created_at ?? '') : '';

  return json({ logs: rows, next_cursor_created_at: nextCursorCreatedAt, schemaMissing: false });
}

