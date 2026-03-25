# `posts` table — RLS for mobile app (anon read)

The app uses the **anon** key (`EXPO_PUBLIC_SUPABASE_ANON_KEY`). If **Row Level Security** is enabled on `public.posts` and there is **no policy** allowing `SELECT` for `anon` / `authenticated`, PostgREST returns:

- `code`: often `42501` (permission denied) or `PGRST301`
- `message`: e.g. *new row violates row-level security policy*

### Verify in Supabase Dashboard

1. **Table Editor** → `posts` exists and has expected columns (`state`, `party`, `created_at`, …).
2. **Authentication** → confirm your login flow matches how you query (some apps use only anon; some use `auth.uid()` in policies).
3. **SQL Editor** — run to see policies:

```sql
SELECT polname, cmd, roles, qual::text
FROM pg_policies
WHERE schemaname = 'public' AND tablename = 'posts';
```

### Example: allow anyone to read posts (public feed)

Use only if your product intent is a **public** posts list:

```sql
ALTER TABLE public.posts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow public read posts"
ON public.posts
FOR SELECT
TO anon, authenticated
USING (true);
```

Adjust `USING (...)` if posts must be scoped (e.g. by `auth.uid()` or org).

After changing policies, reload the app; check Metro/Logcat for `[Dashboard fetchPosts] Supabase error:` logs.
