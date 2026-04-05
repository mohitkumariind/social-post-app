-- Fix "infinite recursion detected" on profiles UPDATE/UPSERT (mobile app).
-- Policies use is_profiles_admin(), which SELECTs from profiles; without bypassing RLS inside
-- that function, Postgres re-enters the same policies forever.
--
-- SECURITY DEFINER + row_security=off on the function is the supported pattern (see Postgres RLS docs).

ALTER FUNCTION public.is_profiles_admin() SET row_security = off;
