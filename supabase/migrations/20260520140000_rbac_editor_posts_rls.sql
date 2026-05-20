-- Allow editor role to insert/update/delete posts via authenticated client (events UI upload flow).

CREATE OR REPLACE FUNCTION public.dashboard_auth_is_elevated_editor()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.profiles p
    WHERE p.id = auth.uid()
      AND COALESCE(p.role, 'user') IN ('admin', 'super_admin', 'moderator', 'campaign_manager', 'editor')
  );
$$;
