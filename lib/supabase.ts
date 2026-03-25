import AsyncStorage from '@react-native-async-storage/async-storage';
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = 'https://gnghotkdiwkbewhgybwy.supabase.co';
const supabaseAnonKey =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImduZ2hvdGtkaXdrYmV3aGd5Ynd5Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzIxNDA3MDMsImV4cCI6MjA4NzcxNjcwM30.sx6Klrim_9iCCt0SDphIcScvuxXVeZxKbsvZ3aYpOdc';

if (/localhost|127\.0\.0\.1/i.test(supabaseUrl)) {
  throw new Error('Invalid Supabase URL: use hosted https://*.supabase.co URL, not localhost.');
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    storage: AsyncStorage,
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: false,
  },
});
export { supabaseUrl };
