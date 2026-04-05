-- SocialBot: authenticated admins (profiles.role = 'admin') can SELECT/UPDATE/DELETE all profiles
-- from the browser client. Without this, RLS typically limits each user to their own row, so the
-- dashboard shows 0 total users while Table Editor (service role) shows all rows.
--
-- SECURITY DEFINER avoids infinite recursion when policies on `profiles` reference admin check.

CREATE OR REPLACE FUNCTION public.is_profiles_admin()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.profiles p
    WHERE p.id = auth.uid()
      AND lower(trim(COALESCE(p.role, ''))) = 'admin'
  );
$$;

REVOKE ALL ON FUNCTION public.is_profiles_admin() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_profiles_admin() TO authenticated;

ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "profiles_select_own_or_admin" ON public.profiles;
CREATE POLICY "profiles_select_own_or_admin"
ON public.profiles
FOR SELECT
TO authenticated
USING (id = auth.uid() OR public.is_profiles_admin());

DROP POLICY IF EXISTS "profiles_update_own_or_admin" ON public.profiles;
CREATE POLICY "profiles_update_own_or_admin"
ON public.profiles
FOR UPDATE
TO authenticated
USING (id = auth.uid() OR public.is_profiles_admin())
WITH CHECK (id = auth.uid() OR public.is_profiles_admin());

DROP POLICY IF EXISTS "profiles_delete_admin" ON public.profiles;
CREATE POLICY "profiles_delete_admin"
ON public.profiles
FOR DELETE
TO authenticated
USING (public.is_profiles_admin());

-- Signup / login upsert (mobile) — own row only
DROP POLICY IF EXISTS "profiles_insert_own" ON public.profiles;
CREATE POLICY "profiles_insert_own"
ON public.profiles
FOR INSERT
TO authenticated
WITH CHECK (id = auth.uid());
