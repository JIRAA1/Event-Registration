import { createClient, type SupabaseClient } from '@supabase/supabase-js';

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const publishableKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

export const isSupabaseConfigured = Boolean(url && publishableKey && url.startsWith('https://'));
export const supabase: SupabaseClient | null = isSupabaseConfigured
  // This app uses its own short-lived app_sessions token via RPC, not Supabase Auth.
  // Do not restore an unrelated/stale Supabase Auth JWT from browser storage on RPC calls.
  ? createClient(url!, publishableKey!, {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
        detectSessionInUrl: false,
      },
    })
  : null;
