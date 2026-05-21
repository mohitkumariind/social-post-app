import { NextRequest, NextResponse } from 'next/server';
import { createServiceRoleClient, validateAdminSession } from '@/lib/admin-gate';
import { canAccessDashboardModule, toDashboardActor } from '@/lib/rbac/dashboard-access';
import { canPerformMutation } from '@/lib/rbac/mutation-gateway';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { RbacError, requireRole } from '@/lib/rbac/require';

function json(body: unknown, status = 200) {
  return NextResponse.json(body, { status, headers: { 'Cache-Control': 'no-store' } });
}

function requirePartiesModuleAccess(
  auth: Extract<Awaited<ReturnType<typeof validateAdminSession>>, { ok: true }>
) {
  requireRole(auth, ['admin', 'super_admin']);
  const actor = toDashboardActor(auth);
  if (!canAccessDashboardModule(actor, 'parties')) {
    throw new RbacError('Forbidden: parties module not available for role', 403);
  }
}

export async function GET() {
  const supabase = await createSupabaseServerClient();
  const auth = await validateAdminSession(supabase);
  if (!auth.ok) return json({ error: auth.status === 401 ? 'Unauthorized' : 'Forbidden' }, auth.status);
  try {
    requirePartiesModuleAccess(auth);
  } catch (e) {
    if (e instanceof RbacError) return json({ error: e.message }, e.status);
    return json({ error: 'Forbidden' }, 403);
  }

  const admin = createServiceRoleClient();
  if (!admin) return json({ error: 'SUPABASE_SERVICE_ROLE_KEY not configured' }, 503);

  const { data, error } = await admin
    .from('parties')
    .select('id,name,logo_url')
    .order('name', { ascending: true });
  if (error) return json({ error: error.message }, 500);
  return json({ parties: data ?? [] });
}

type PartyBody = { id?: string; name?: string; logo_url?: string | null };

export async function POST(request: NextRequest) {
  const supabase = await createSupabaseServerClient();
  const auth = await validateAdminSession(supabase);
  if (!auth.ok) return json({ error: auth.status === 401 ? 'Unauthorized' : 'Forbidden' }, auth.status);
  try {
    requirePartiesModuleAccess(auth);
  } catch (e) {
    if (e instanceof RbacError) return json({ error: e.message }, e.status);
    return json({ error: 'Forbidden' }, 403);
  }

  let body: PartyBody = {};
  try {
    body = (await request.json()) as PartyBody;
  } catch {
    return json({ error: 'Invalid JSON body' }, 400);
  }

  const id = String(body.id ?? '').trim();
  const name = String(body.name ?? '').trim();
  const logo_url = body.logo_url != null && String(body.logo_url).trim() !== '' ? String(body.logo_url).trim() : null;
  if (!id || !name) return json({ error: 'Missing id or name' }, 400);

  const admin = createServiceRoleClient();
  if (!admin) return json({ error: 'SUPABASE_SERVICE_ROLE_KEY not configured' }, 503);

  const mutationUser = {
    id: auth.user.id,
    role: auth.role,
    assigned_state_ids: auth.assigned_state_ids,
    assigned_group_ids: auth.assigned_group_ids,
  };
  const decision = canPerformMutation(
    mutationUser,
    'parties.create',
    { id },
    { id, name, logo_url },
    { resourceType: 'parties', resourceId: id, resourceName: name }
  );
  if (!decision.ok) return json({ error: decision.reason }, 403);

  const { data, error } = await admin.from('parties').insert({ id, name, logo_url }).select('id,name,logo_url').single();
  if (error) return json({ error: error.message }, 400);
  return json({ party: data }, 201);
}

export async function PATCH(request: NextRequest) {
  const supabase = await createSupabaseServerClient();
  const auth = await validateAdminSession(supabase);
  if (!auth.ok) return json({ error: auth.status === 401 ? 'Unauthorized' : 'Forbidden' }, auth.status);
  try {
    requirePartiesModuleAccess(auth);
  } catch (e) {
    if (e instanceof RbacError) return json({ error: e.message }, e.status);
    return json({ error: 'Forbidden' }, 403);
  }

  let body: PartyBody = {};
  try {
    body = (await request.json()) as PartyBody;
  } catch {
    return json({ error: 'Invalid JSON body' }, 400);
  }

  const id = String(body.id ?? '').trim();
  const name = String(body.name ?? '').trim();
  const logo_url = body.logo_url != null && String(body.logo_url).trim() !== '' ? String(body.logo_url).trim() : null;
  if (!id || !name) return json({ error: 'Missing id or name' }, 400);

  const admin = createServiceRoleClient();
  if (!admin) return json({ error: 'SUPABASE_SERVICE_ROLE_KEY not configured' }, 503);

  const mutationUser = {
    id: auth.user.id,
    role: auth.role,
    assigned_state_ids: auth.assigned_state_ids,
    assigned_group_ids: auth.assigned_group_ids,
  };
  const decision = canPerformMutation(
    mutationUser,
    'parties.update',
    { id },
    { id, name, logo_url },
    { resourceType: 'parties', resourceId: id, resourceName: name }
  );
  if (!decision.ok) return json({ error: decision.reason }, 403);

  const { data, error } = await admin
    .from('parties')
    .update({ name, logo_url })
    .eq('id', id)
    .select('id,name,logo_url')
    .single();
  if (error) return json({ error: error.message }, 400);
  return json({ party: data });
}

export async function DELETE(request: NextRequest) {
  const supabase = await createSupabaseServerClient();
  const auth = await validateAdminSession(supabase);
  if (!auth.ok) return json({ error: auth.status === 401 ? 'Unauthorized' : 'Forbidden' }, auth.status);
  try {
    requirePartiesModuleAccess(auth);
  } catch (e) {
    if (e instanceof RbacError) return json({ error: e.message }, e.status);
    return json({ error: 'Forbidden' }, 403);
  }

  const id = (request.nextUrl.searchParams.get('id') ?? '').trim();
  if (!id) return json({ error: 'Missing id' }, 400);

  const admin = createServiceRoleClient();
  if (!admin) return json({ error: 'SUPABASE_SERVICE_ROLE_KEY not configured' }, 503);

  const mutationUser = {
    id: auth.user.id,
    role: auth.role,
    assigned_state_ids: auth.assigned_state_ids,
    assigned_group_ids: auth.assigned_group_ids,
  };
  const decision = canPerformMutation(
    mutationUser,
    'parties.delete',
    { id },
    null,
    { resourceType: 'parties', resourceId: id }
  );
  if (!decision.ok) return json({ error: decision.reason }, 403);

  const { error } = await admin.from('parties').delete().eq('id', id);
  if (error) return json({ error: error.message }, 400);
  return json({ ok: true });
}
