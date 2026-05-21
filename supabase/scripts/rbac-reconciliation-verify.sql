-- Read-only verification for RBAC reconciliation (safe on production).
-- Run via: npx supabase db execute -f supabase/scripts/rbac-reconciliation-verify.sql

-- 1) Core tables exist
SELECT 'tables' AS check_group, tablename
FROM pg_tables
WHERE schemaname = 'public'
  AND tablename IN ('events', 'posts', 'parties', 'profiles', 'rbac_audit_logs')
ORDER BY tablename;

-- 2) Key columns on events
SELECT 'events_columns' AS check_group, column_name, data_type, udt_name
FROM information_schema.columns
WHERE table_schema = 'public' AND table_name = 'events'
  AND column_name IN ('created_role', 'created_by', 'state_id', 'party_id', 'target_groups', 'party')
ORDER BY column_name;

-- 3) rbac_audit_logs schema
SELECT 'rbac_audit_logs_columns' AS check_group, column_name, data_type
FROM information_schema.columns
WHERE table_schema = 'public' AND table_name = 'rbac_audit_logs'
ORDER BY ordinal_position;

-- 4) Profile geo columns (211700)
SELECT 'profiles_geo_columns' AS check_group, column_name, data_type
FROM information_schema.columns
WHERE table_schema = 'public' AND table_name = 'profiles'
  AND column_name IN ('assigned_loksabha_ids', 'assigned_assembly_ids', 'assigned_party_ids', 'assigned_state_ids', 'assigned_group_ids')
ORDER BY column_name;

-- 5) RLS enabled
SELECT 'rls_enabled' AS check_group, c.relname AS table_name, c.relrowsecurity AS rls_enabled
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public'
  AND c.relname IN ('events', 'posts', 'parties', 'profiles', 'rbac_audit_logs')
ORDER BY c.relname;

-- 6) Parties policies (expect SELECT only for authenticated, no broad INSERT)
SELECT 'parties_policies' AS check_group, policyname, cmd, roles::text
FROM pg_policies
WHERE schemaname = 'public' AND tablename = 'parties'
ORDER BY policyname;

-- 7) created_role population sample
SELECT 'events_created_role_stats' AS check_group,
  COUNT(*) AS total_events,
  COUNT(created_role) AS with_created_role,
  COUNT(*) FILTER (WHERE created_role IS NULL) AS null_created_role
FROM public.events;

-- 8) Migration history tail (CLI sync check)
SELECT 'migration_history_tail' AS check_group, version, name
FROM supabase_migrations.schema_migrations
ORDER BY version DESC
LIMIT 10;

-- 9) Campaign manager profile scope population (211700 + group assignments)
SELECT 'campaign_manager_scope_stats' AS check_group,
  COUNT(*) AS cm_profiles,
  COUNT(*) FILTER (WHERE COALESCE(cardinality(assigned_group_ids), 0) > 0) AS with_groups,
  COUNT(*) FILTER (WHERE COALESCE(cardinality(assigned_loksabha_ids), 0) > 0) AS with_loksabha,
  COUNT(*) FILTER (WHERE COALESCE(cardinality(assigned_assembly_ids), 0) > 0) AS with_assembly,
  COUNT(*) FILTER (WHERE COALESCE(cardinality(assigned_party_ids), 0) > 0) AS with_party
FROM public.profiles
WHERE role = 'campaign_manager';
