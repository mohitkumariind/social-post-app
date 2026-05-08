import { NextRequest, NextResponse } from 'next/server';
import { createServiceRoleClient, validateAdminSession } from '@/lib/admin-gate';
import { createSupabaseServerClient } from '@/lib/supabase/server';

type Body = { ids?: string[]; group_tags?: string[]; /** Only if you intentionally want to clear tags for all selected users. */ allowClear?: boolean };

const NO_SERVICE_ROLE =
  'Bulk tag assign requires SUPABASE_SERVICE_ROLE_KEY on the server; otherwise RLS may block updates to other users and group_tags stays null.';

export async function POST(request: NextRequest) {
  const supabase = await createSupabaseServerClient();
  const auth = await validateAdminSession(supabase);
  if (!auth.ok) {
    return NextResponse.json({ error: auth.status === 401 ? 'Unauthorized' : 'Forbidden' }, { status: auth.status });
  }
  if (auth.role === 'moderator') {
    return NextResponse.json({ error: 'Moderators cannot bulk edit profile tags' }, { status: 403 });
  }

  let body: Body = {};
  try {
    body = (await request.json()) as Body;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const ids = Array.isArray(body.ids) ? body.ids.map((x) => String(x).trim()).filter(Boolean) : [];
  const group_tags = Array.isArray(body.group_tags)
    ? body.group_tags.map((x) => String(x).trim()).filter(Boolean)
    : [];

  if (ids.length === 0) return NextResponse.json({ error: 'Missing ids' }, { status: 400 });

  if (group_tags.length === 0 && !body.allowClear) {
    return NextResponse.json(
      {
        error:
          'group_tags is empty. Refusing to set all selected users to [] (prevents accidental wipe). Add at least one tag, or pass allowClear: true if you really want to clear.',
      },
      { status: 400 }
    );
  }

  const admin = createServiceRoleClient();
  if (!admin) {
    return NextResponse.json({ error: NO_SERVICE_ROLE }, { status: 503 });
  }

  /** Column name must match Supabase `profiles.group_tags` (TEXT[]). */
  const { data, error } = await admin.from('profiles').update({ group_tags }).in('id', ids).select('id, group_tags');

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  console.log('[admin/profiles/bulk-tags][POST]', {
    table: 'profiles',
    updateColumn: 'group_tags',
    idCount: ids.length,
    payloadGroupTags: group_tags,
    returnedRows: (data ?? []).length,
    sampleWritten: (data ?? []).slice(0, 5).map((r: { id?: string; group_tags?: unknown }) => ({
      id: r.id,
      group_tags: r.group_tags,
    })),
  });

  return NextResponse.json({ ok: true, updated: ids.length }, { headers: { 'Cache-Control': 'no-store' } });
}
