import { NextRequest, NextResponse } from 'next/server';
import { createServiceRoleClient, validateAdminSession } from '@/lib/admin-gate';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { RbacError, requireRole } from '@/lib/rbac/require';

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

function clampInt(v: string | null, d: number, min = 1, max = 200) {
  const n = Number(v);
  return Number.isFinite(n) ? Math.max(min, Math.min(max, n)) : d;
}

export async function GET(request: NextRequest) {
  const supabase = await createSupabaseServerClient();
  const auth = await validateAdminSession(supabase);
  if (!auth.ok) return json({ error: auth.status === 401 ? 'Unauthorized' : 'Forbidden' }, auth.status);
  try {
    requireRole(auth, ['admin']);
  } catch (e) {
    if (e instanceof RbacError) return json({ error: e.message }, e.status);
    return json({ error: 'Forbidden' }, 403);
  }

  const admin = createServiceRoleClient();
  if (!admin) return json({ error: 'SUPABASE_SERVICE_ROLE_KEY not configured' }, 503);

  const sp = request.nextUrl.searchParams;
  const limit = clampInt(sp.get('limit'), 50);
  const cursorCreatedAt = (sp.get('cursor_created_at') ?? '').trim();
  const role = (sp.get('role') ?? '').trim();
  const severity = (sp.get('severity') ?? '').trim();
  const event_type = (sp.get('event_type') ?? '').trim();
  const result = (sp.get('result') ?? '').trim();
  const start = (sp.get('start') ?? '').trim();
  const end = (sp.get('end') ?? '').trim();

  let q = admin
    .from('rbac_observability_events')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(limit) as any;

  if (cursorCreatedAt) q = q.lt('created_at', cursorCreatedAt);
  if (role) q = q.eq('role', role);
  if (severity) q = q.eq('severity', severity);
  if (event_type) q = q.eq('event_type', event_type);
  if (result) q = q.eq('result', result);
  if (start) q = q.gte('created_at', start);
  if (end) q = q.lte('created_at', end);

  const { data, error } = await q;
  if (error) {
    if (isMissingTableErr(error, 'rbac_observability_events')) {
      return json({ events: [], next_cursor_created_at: '', schemaMissing: true });
    }
    return json({ error: error.message }, 500);
  }

  const rows = (data ?? []) as any[];
  const next = rows.length > 0 ? String(rows[rows.length - 1]?.created_at ?? '') : '';

  // Overview counts (last 24h)
  const sinceIso = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const { data: agg } = await admin
    .from('rbac_observability_events')
    .select('role,result,severity')
    .gte('created_at', sinceIso);

  const overview = {
    since: sinceIso,
    allowed: 0,
    denied: 0,
    by_role: {} as Record<string, { allowed: number; denied: number; critical: number; warning: number }>,
  };

  for (const r of (agg ?? []) as any[]) {
    const rr = String(r.role ?? 'unknown');
    const res = String(r.result ?? '');
    const sev = String(r.severity ?? '');
    if (!overview.by_role[rr]) overview.by_role[rr] = { allowed: 0, denied: 0, critical: 0, warning: 0 };
    if (res === 'allowed') {
      overview.allowed++;
      overview.by_role[rr].allowed++;
    } else if (res === 'denied') {
      overview.denied++;
      overview.by_role[rr].denied++;
    }
    if (sev === 'critical') overview.by_role[rr].critical++;
    if (sev === 'warning') overview.by_role[rr].warning++;
  }

  return json({ events: rows, next_cursor_created_at: next, schemaMissing: false, overview });
}

