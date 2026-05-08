-- Analytics v1: minimal daily rollups (derived data)

CREATE TABLE IF NOT EXISTS public.analytics_daily_notifications (
  day DATE PRIMARY KEY,
  sent_count INT NOT NULL DEFAULT 0,
  delivered_count INT NOT NULL DEFAULT 0,
  opened_count INT NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS public.analytics_daily_events (
  day DATE PRIMARY KEY,
  active_published_count INT NOT NULL DEFAULT 0,
  published_count INT NOT NULL DEFAULT 0
);

