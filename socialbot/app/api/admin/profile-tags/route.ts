import { NextResponse } from 'next/server';
import { createServiceRoleClient, validateAdminSession } from '@/lib/admin-gate';
import { createSupabaseServerClient } from '@/lib/supabase/server';

export async function GET() {
  const supabase = await createSupabaseServerClient();
  const auth = await validateAdminSession(supabase);
  if (!auth.ok) {
    return NextResponse.json({ error: auth.status === 401 ? 'Unauthorized' : 'Forbidden' }, { status: auth.status });
  }

  const admin = createServiceRoleClient();
  const db = admin ?? supabase;

  // Best-effort: pull tags from profiles and flatten unique values.
  const { data, error } = await db.from('profiles').select('group_tags').limit(2000);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const set = new Set<string>();
  for (const row of (data ?? []) as any[]) {
    const tags = row?.group_tags;
    if (Array.isArray(tags)) {
      for (const t of tags) {
        const s = String(t ?? '').trim();
        if (s) set.add(s);
      }
    } else if (typeof tags === 'string') {
      const s = tags.trim();
      if (s) set.add(s);
    }
  }

  return NextResponse.json({ tags: Array.from(set).sort() }, { headers: { 'Cache-Control': 'no-store' } });
}

