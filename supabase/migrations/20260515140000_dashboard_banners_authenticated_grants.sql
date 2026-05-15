-- Mobile clients read banners via RPC and (fallback) direct SELECT; ensure authenticated role can read.
GRANT SELECT ON public.dashboard_banners TO authenticated;
