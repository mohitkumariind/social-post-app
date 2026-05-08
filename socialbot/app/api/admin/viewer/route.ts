import { NextResponse } from 'next/server';
import { validateAdminSession } from '@/lib/admin-gate';
import { createSupabaseServerClient } from '@/lib/supabase/server';

export async function GET() {
  const supabase = await createSupabaseServerClient();
  const auth = await validateAdminSession(supabase);
  if (!auth.ok) {
    return NextResponse.json({ error: auth.status === 401 ? 'Unauthorized' : 'Forbidden' }, { status: auth.status });
  }

  return NextResponse.json(
    { role: auth.role, assigned_state_id: auth.assigned_state_id },
    { headers: { 'Cache-Control': 'no-store' } }
  );
}

