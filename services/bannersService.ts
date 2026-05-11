import { supabase } from '../lib/supabase';

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

export async function fetchDashboardBanners(limit = 10): Promise<{ rows: DashboardBannerRow[]; error: string | null }> {
  const { data, error } = await supabase.rpc('get_dashboard_banners', { p_limit: limit });
  if (error) return { rows: [], error: String(error.message ?? 'Failed to load banners') };
  if (!Array.isArray(data)) return { rows: [], error: 'Invalid response from get_dashboard_banners' };
  return { rows: data as any, error: null };
}

