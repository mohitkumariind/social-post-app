import { createBrowserClient } from '@supabase/ssr';

/**
 * Browser Supabase client (cookie session, shared with middleware / server via @supabase/ssr).
 * Use in client components only.
 */
export const supabase = createBrowserClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);
