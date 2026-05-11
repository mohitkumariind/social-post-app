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
