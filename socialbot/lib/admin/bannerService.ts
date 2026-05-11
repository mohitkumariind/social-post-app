import type { SupabaseClient } from '@supabase/supabase-js';

export type BannerLinkType = 'none' | 'event' | 'post' | 'external_url';

export type DashboardBannerRow = {
  id: string;
  image_url: string;
  title: string | null;
  subtitle: string | null;
  cta_text: string | null;
  link_type: BannerLinkType;
  link_value: string | null;
  priority: number;
  is_active: boolean;
  start_at: string | null;
  end_at: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
};

export type DashboardBannerInput = {
  image_url: string;
  title?: string | null;
  subtitle?: string | null;
  cta_text?: string | null;
  link_type: BannerLinkType;
  link_value?: string | null;
  priority?: number | null;
  is_active?: boolean | null;
  start_at?: string | null;
  end_at?: string | null;
};

export function normalizeBannerInput(input: DashboardBannerInput): {
  ok: true;
  value: Omit<DashboardBannerRow, 'id' | 'created_by' | 'created_at' | 'updated_at'>;
} | { ok: false; error: string } {
  const image_url = String(input.image_url ?? '').trim();
  if (!image_url) return { ok: false, error: 'image_url is required' };

  const link_type = String(input.link_type ?? '').trim().toLowerCase() as BannerLinkType;
  if (!['none', 'event', 'post', 'external_url'].includes(link_type)) {
    return { ok: false, error: 'Invalid link_type' };
  }

  const title = input.title != null ? String(input.title).trim() : null;
  const subtitle = input.subtitle != null ? String(input.subtitle).trim() : null;
  const cta_text = input.cta_text != null ? String(input.cta_text).trim() : null;
  const link_value_raw = input.link_value != null ? String(input.link_value).trim() : '';
  const link_value = link_value_raw ? link_value_raw : null;

  if (link_type === 'none' && link_value) {
    return { ok: false, error: 'link_value must be empty when link_type is none' };
  }
  if (link_type !== 'none' && !link_value) {
    return { ok: false, error: 'link_value is required for this link_type' };
  }

  const priority = input.priority == null ? 100 : Number(input.priority);
  if (!Number.isFinite(priority)) return { ok: false, error: 'Invalid priority' };

  const is_active = input.is_active == null ? true : Boolean(input.is_active);

  const start_at = input.start_at != null && String(input.start_at).trim() !== '' ? String(input.start_at) : null;
  const end_at = input.end_at != null && String(input.end_at).trim() !== '' ? String(input.end_at) : null;
  if (start_at && Number.isNaN(new Date(start_at).getTime())) return { ok: false, error: 'Invalid start_at' };
  if (end_at && Number.isNaN(new Date(end_at).getTime())) return { ok: false, error: 'Invalid end_at' };
  if (start_at && end_at && new Date(start_at).getTime() >= new Date(end_at).getTime()) {
    return { ok: false, error: 'end_at must be after start_at' };
  }

  return {
    ok: true,
    value: {
      image_url,
      title,
      subtitle,
      cta_text,
      link_type,
      link_value,
      priority,
      is_active,
      start_at,
      end_at,
    },
  };
}

export async function listAllBanners(db: SupabaseClient): Promise<DashboardBannerRow[] | { error: string }> {
  const { data, error } = await db
    .from('dashboard_banners')
    .select('*')
    .order('priority', { ascending: true })
    .order('created_at', { ascending: false });
  if (error) return { error: error.message };
  return (data ?? []) as any;
}

