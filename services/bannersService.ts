import { supabase } from '../lib/supabase';
import { gfxLogCapped } from '../utils/dashboardDebug';

export type DashboardBannerRow = {
  id: string;
  image_url: string;
  title: string | null;
  subtitle: string | null;
  cta_text: string | null;
  link_type: 'none' | 'event' | 'post' | 'external_url';
  link_value: string | null;
  priority: number;
};

function rpcMissingFunction(err: unknown): boolean {
  const msg = String((err as { message?: string })?.message ?? '');
  const code = String((err as { code?: string })?.code ?? '');
  return (
    code === '42883' ||
    code === 'PGRST202' ||
    code === '42P01' ||
    msg.includes('does not exist') ||
    msg.includes('Could not find the function') ||
    msg.includes('schema cache')
  );
}

function tableMissing(err: unknown): boolean {
  const msg = String((err as { message?: string })?.message ?? '');
  const code = String((err as { code?: string })?.code ?? '');
  return code === '42P01' || msg.includes('dashboard_banners') && msg.includes('does not exist');
}

function normalizeBannerRows(data: unknown): DashboardBannerRow[] {
  if (!Array.isArray(data)) return [];
  const out: DashboardBannerRow[] = [];
  for (const row of data) {
    if (!row || typeof row !== 'object') continue;
    const r = row as Record<string, unknown>;
    const id = String(r.id ?? '').trim();
    const image_url = String(r.image_url ?? '').trim();
    if (!id || !image_url) continue;
    out.push({
      id,
      image_url,
      title: r.title != null ? String(r.title) : null,
      subtitle: r.subtitle != null ? String(r.subtitle) : null,
      cta_text: r.cta_text != null ? String(r.cta_text) : null,
      link_type: (String(r.link_type ?? 'none').trim() || 'none') as DashboardBannerRow['link_type'],
      link_value: r.link_value != null ? String(r.link_value) : null,
      priority: Number(r.priority ?? 100),
    });
  }
  return out;
}

/** Wait for persisted session (cold start can return null on first getSession). */
async function ensureAuthenticated(): Promise<boolean> {
  for (let attempt = 0; attempt < 5; attempt++) {
    const { data: sessionData } = await supabase.auth.getSession();
    if (sessionData.session?.access_token) return true;
    const { data: userData, error: userErr } = await supabase.auth.getUser();
    if (userData.user && !userErr) return true;
    await new Promise((r) => setTimeout(r, 150 * (attempt + 1)));
  }
  return false;
}

/** RLS on `dashboard_banners` applies active + schedule rules for authenticated users. */
async function fetchDashboardBannersViaTable(limit: number): Promise<{ rows: DashboardBannerRow[]; error: string | null }> {
  const { data, error } = await supabase
    .from('dashboard_banners')
    .select('id, image_url, title, subtitle, cta_text, link_type, link_value, priority')
    .eq('is_active', true)
    .order('priority', { ascending: true })
    .order('created_at', { ascending: false })
    .limit(limit);

  if (error) {
    if (tableMissing(error)) return { rows: [], error: null };
    return { rows: [], error: String(error.message ?? 'Failed to load banners') };
  }

  return { rows: normalizeBannerRows(data), error: null };
}

export async function fetchDashboardBanners(limit = 10): Promise<{ rows: DashboardBannerRow[]; error: string | null }> {
  const cap = Math.max(0, Math.min(limit, 25));

  if (!(await ensureAuthenticated())) {
    gfxLogCapped('dashboardBannersNoSession', {}, 2);
    return { rows: [], error: null };
  }

  const rpc = await supabase.rpc('get_dashboard_banners', { p_limit: cap });
  if (!rpc.error) {
    if (!Array.isArray(rpc.data)) {
      return fetchDashboardBannersViaTable(cap);
    }
    const rows = normalizeBannerRows(rpc.data);
    if (rows.length > 0) return { rows, error: null };
    gfxLogCapped('dashboardBannersRpcEmpty', { raw: rpc.data?.length ?? 0 }, 2);
    const table = await fetchDashboardBannersViaTable(cap);
    return table.rows.length > 0 ? table : { rows, error: null };
  }

  if (!rpcMissingFunction(rpc.error)) {
    gfxLogCapped('dashboardBannersRpcErr', { error: rpc.error.message, code: rpc.error.code }, 3);
  }

  const table = await fetchDashboardBannersViaTable(cap);
  if (table.rows.length > 0) return table;
  if (table.error) return table;
  if (!rpcMissingFunction(rpc.error)) {
    return { rows: [], error: String(rpc.error.message ?? 'Failed to load banners') };
  }
  return { rows: [], error: null };
}
