import { NextRequest, NextResponse } from 'next/server';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { createServiceRoleClient, validateAdminSession } from '@/lib/admin-gate';
import { BANNER_MANAGER_ROLES } from '@/lib/permissions';
import { canPerformMutation } from '@/lib/rbac/mutation-gateway';
import { RbacError, requireRole } from '@/lib/rbac/require';
import { listAllBanners, normalizeBannerInput, type DashboardBannerInput } from '@/lib/admin/bannerService';

function json(body: unknown, status = 200) {
  return NextResponse.json(body, { status, headers: { 'Cache-Control': 'no-store' } });
}

function requireBannerManagerAccess(auth: Extract<Awaited<ReturnType<typeof validateAdminSession>>, { ok: true }>) {
  try {
    requireRole(auth, [...BANNER_MANAGER_ROLES]);
  } catch (e) {
    if (e instanceof RbacError) throw e;
    throw new RbacError('Forbidden', 403);
  }
}

export async function GET() {
  const supabase = await createSupabaseServerClient();
  const auth = await validateAdminSession(supabase);
  if (!auth.ok) return json({ error: auth.status === 401 ? 'Unauthorized' : 'Forbidden' }, auth.status);

  try {
    requireBannerManagerAccess(auth);
  } catch (e) {
    if (e instanceof RbacError) return json({ error: e.message }, e.status);
    return json({ error: 'Forbidden' }, 403);
  }

  const admin = createServiceRoleClient();
  if (!admin) return json({ error: 'SUPABASE_SERVICE_ROLE_KEY not configured' }, 503);

  const rows = await listAllBanners(admin);
  if ('error' in rows) return json({ error: rows.error }, 500);
  return json({ banners: rows });
}

export async function POST(request: NextRequest) {
  const supabase = await createSupabaseServerClient();
  const auth = await validateAdminSession(supabase);
  if (!auth.ok) return json({ error: auth.status === 401 ? 'Unauthorized' : 'Forbidden' }, auth.status);

  try {
    requireBannerManagerAccess(auth);
  } catch (e) {
    if (e instanceof RbacError) return json({ error: e.message }, e.status);
    return json({ error: 'Forbidden' }, 403);
  }

  const admin = createServiceRoleClient();
  if (!admin) return json({ error: 'SUPABASE_SERVICE_ROLE_KEY not configured' }, 503);

  let body: DashboardBannerInput | null = null;
  try {
    body = (await request.json()) as DashboardBannerInput;
  } catch {
    return json({ error: 'Invalid JSON body' }, 400);
  }

  const norm = normalizeBannerInput(body as any);
  if (!norm.ok) return json({ error: norm.error }, 400);

  const mutationUser = {
    id: auth.user.id,
    role: auth.role,
    assigned_state_ids: auth.assigned_state_ids,
    assigned_group_ids: auth.assigned_group_ids,
  };
  const createDecision = canPerformMutation(
    mutationUser,
    'banners.create',
    null,
    norm.value as Record<string, unknown>,
    { resourceType: 'dashboard_banners', resourceName: String((norm.value as { title?: string }).title ?? '') }
  );
  if (!createDecision.ok) return json({ error: createDecision.reason }, 403);

  const { data, error } = await admin
    .from('dashboard_banners')
    .insert({ ...norm.value, created_by: auth.user.id } as any)
    .select('*')
    .single();
  if (error) return json({ error: error.message }, 500);

  return json({ ok: true, banner: data });
}

export async function PUT(request: NextRequest) {
  const supabase = await createSupabaseServerClient();
  const auth = await validateAdminSession(supabase);
  if (!auth.ok) return json({ error: auth.status === 401 ? 'Unauthorized' : 'Forbidden' }, auth.status);

  try {
    requireBannerManagerAccess(auth);
  } catch (e) {
    if (e instanceof RbacError) return json({ error: e.message }, e.status);
    return json({ error: 'Forbidden' }, 403);
  }

  const admin = createServiceRoleClient();
  if (!admin) return json({ error: 'SUPABASE_SERVICE_ROLE_KEY not configured' }, 503);

  let body: (DashboardBannerInput & { id?: string }) | null = null;
  try {
    body = (await request.json()) as any;
  } catch {
    return json({ error: 'Invalid JSON body' }, 400);
  }
  const id = String(body?.id ?? '').trim();
  if (!id) return json({ error: 'id is required' }, 400);

  const norm = normalizeBannerInput(body as any);
  if (!norm.ok) return json({ error: norm.error }, 400);

  const mutationUser = {
    id: auth.user.id,
    role: auth.role,
    assigned_state_ids: auth.assigned_state_ids,
    assigned_group_ids: auth.assigned_group_ids,
  };
  const updateDecision = canPerformMutation(
    mutationUser,
    'banners.update',
    { id },
    norm.value as Record<string, unknown>,
    { resourceType: 'dashboard_banners', resourceId: id }
  );
  if (!updateDecision.ok) return json({ error: updateDecision.reason }, 403);

  const { data, error } = await admin.from('dashboard_banners').update(norm.value as any).eq('id', id).select('*').single();
  if (error) return json({ error: error.message }, 500);
  return json({ ok: true, banner: data });
}

export async function PATCH(request: NextRequest) {
  const supabase = await createSupabaseServerClient();
  const auth = await validateAdminSession(supabase);
  if (!auth.ok) return json({ error: auth.status === 401 ? 'Unauthorized' : 'Forbidden' }, auth.status);

  try {
    requireBannerManagerAccess(auth);
  } catch (e) {
    if (e instanceof RbacError) return json({ error: e.message }, e.status);
    return json({ error: 'Forbidden' }, 403);
  }

  const admin = createServiceRoleClient();
  if (!admin) return json({ error: 'SUPABASE_SERVICE_ROLE_KEY not configured' }, 503);

  let body: { reorder?: Array<{ id: string; priority: number }> } | null = null;
  try {
    body = (await request.json()) as any;
  } catch {
    return json({ error: 'Invalid JSON body' }, 400);
  }
  const reorder = Array.isArray(body?.reorder) ? body!.reorder! : [];
  if (reorder.length === 0) return json({ error: 'reorder[] is required' }, 400);
  if (reorder.length > 200) return json({ error: 'Too many rows' }, 400);

  const mutationUser = {
    id: auth.user.id,
    role: auth.role,
    assigned_state_ids: auth.assigned_state_ids,
    assigned_group_ids: auth.assigned_group_ids,
  };
  const reorderDecision = canPerformMutation(
    mutationUser,
    'banners.update',
    null,
    { reorder },
    { resourceType: 'dashboard_banners', resourceName: 'reorder' }
  );
  if (!reorderDecision.ok) return json({ error: reorderDecision.reason }, 403);

  // Update in a simple loop; priorities are small and count is limited.
  for (const row of reorder) {
    const id = String(row.id ?? '').trim();
    const priority = Number((row as any).priority);
    if (!id || !Number.isFinite(priority)) return json({ error: 'Invalid reorder row' }, 400);
    const { error } = await admin.from('dashboard_banners').update({ priority } as any).eq('id', id);
    if (error) return json({ error: error.message }, 500);
  }

  return json({ ok: true });
}

export async function DELETE(request: NextRequest) {
  const supabase = await createSupabaseServerClient();
  const auth = await validateAdminSession(supabase);
  if (!auth.ok) return json({ error: auth.status === 401 ? 'Unauthorized' : 'Forbidden' }, auth.status);

  try {
    requireBannerManagerAccess(auth);
  } catch (e) {
    if (e instanceof RbacError) return json({ error: e.message }, e.status);
    return json({ error: 'Forbidden' }, 403);
  }

  const admin = createServiceRoleClient();
  if (!admin) return json({ error: 'SUPABASE_SERVICE_ROLE_KEY not configured' }, 503);

  const id = String(request.nextUrl.searchParams.get('id') ?? '').trim();
  if (!id) return json({ error: 'Missing id' }, 400);

  const mutationUser = {
    id: auth.user.id,
    role: auth.role,
    assigned_state_ids: auth.assigned_state_ids,
    assigned_group_ids: auth.assigned_group_ids,
  };
  const deleteDecision = canPerformMutation(
    mutationUser,
    'banners.delete',
    { id },
    null,
    { resourceType: 'dashboard_banners', resourceId: id }
  );
  if (!deleteDecision.ok) return json({ error: deleteDecision.reason }, 403);

  const { error } = await admin.from('dashboard_banners').delete().eq('id', id);
  if (error) return json({ error: error.message }, 500);
  return json({ ok: true });
}

