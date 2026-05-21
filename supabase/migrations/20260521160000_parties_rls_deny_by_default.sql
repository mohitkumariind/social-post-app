-- Parties: deny-by-default mutations; authenticated read for mobile app.
-- Admin dashboard mutates via service-role API after session RBAC.

ALTER TABLE public.parties ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS parties_select_authenticated ON public.parties;
CREATE POLICY parties_select_authenticated ON public.parties
  FOR SELECT
  TO authenticated
  USING (true);

COMMENT ON TABLE public.parties IS
  'Political parties reference data. SELECT for authenticated mobile users; INSERT/UPDATE/DELETE only via admin service-role API.';
