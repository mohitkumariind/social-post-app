-- Stop infinite recursion on profiles UPSERT/UPDATE: remove any policy branch that calls
-- is_profiles_admin() (it SELECTs profiles → RLS re-enters the same policies).
--
-- Mobile app only needs: read/update/insert own row (id = auth.uid()).
-- SocialBot admin list/delete/count uses service role in Next.js API routes (bypasses RLS).

DROP POLICY IF EXISTS "profiles_select_own_or_admin" ON public.profiles;
DROP POLICY IF EXISTS "profiles_update_own_or_admin" ON public.profiles;
DROP POLICY IF EXISTS "profiles_delete_admin" ON public.profiles;
DROP POLICY IF EXISTS "profiles_insert_own" ON public.profiles;
DROP POLICY IF EXISTS "profiles_select_own" ON public.profiles;
DROP POLICY IF EXISTS "profiles_update_own" ON public.profiles;

CREATE POLICY "profiles_select_own"
ON public.profiles
FOR SELECT
TO authenticated
USING (id = auth.uid());

CREATE POLICY "profiles_update_own"
ON public.profiles
FOR UPDATE
TO authenticated
USING (id = auth.uid())
WITH CHECK (id = auth.uid());

CREATE POLICY "profiles_insert_own"
ON public.profiles
FOR INSERT
TO authenticated
WITH CHECK (id = auth.uid());

DROP FUNCTION IF EXISTS public.is_profiles_admin();
