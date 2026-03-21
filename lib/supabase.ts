import { createClient } from '@supabase/supabase-js';

const supabaseUrl =
  process.env.EXPO_PUBLIC_SUPABASE_URL ?? 'https://gnghotkdiwkbewhgybwy.supabase.co';
const supabaseAnonKey =
  process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ??
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImduZ2hvdGtkaXdrYmV3aGd5Ynd5Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzIxNDA3MDMsImV4cCI6MjA4NzcxNjcwM30.sx6Klrim_9iCCt0SDphIcScvuxXVeZxKbsvZ3aYpOdc';

/** No-cache fetch to avoid stale profile data (e.g. state NULL not reflecting) */
const noCacheFetch: typeof fetch = (input, init) =>
  fetch(input, { ...init, cache: 'no-store' });

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  global: { fetch: noCacheFetch },
});
export { supabaseUrl };
