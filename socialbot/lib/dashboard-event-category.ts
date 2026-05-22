/** Allowed non-null values for `events.dashboard_category` / `posts.dashboard_category` (matches DB CHECK). */
export const EVENT_DASHBOARD_CATEGORY_VALUES = [
  'good_morning',
  'good_night',
  'motivation',
  'devotional',
  'birthday_wishes',
] as const;

export type EventDashboardCategoryValue = (typeof EVENT_DASHBOARD_CATEGORY_VALUES)[number];

export function isActiveEventDashboardCategory(v: unknown): v is EventDashboardCategoryValue {
  return typeof v === 'string' && (EVENT_DASHBOARD_CATEGORY_VALUES as readonly string[]).includes(v);
}

/** Roles that may create or edit dashboard category events. */
export function isDashboardCategoryAdminRole(role: string | null | undefined): boolean {
  const r = String(role ?? '').trim().toLowerCase();
  return r === 'admin' || r === 'super_admin';
}

/** True when a write payload attempts to set a non-null dashboard category. */
export function payloadSetsActiveDashboardCategory(payload: Record<string, unknown>): boolean {
  if (!Object.prototype.hasOwnProperty.call(payload, 'dashboard_category')) return false;
  return isActiveEventDashboardCategory(payload.dashboard_category);
}
