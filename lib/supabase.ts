import { createClient, type SupabaseClient } from '@supabase/supabase-js';

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const publishableKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

export const isSupabaseConfigured = Boolean(url && publishableKey && url.startsWith('https://'));
export const supabase: SupabaseClient | null = isSupabaseConfigured
  ? createClient(url!, publishableKey!, { auth: { persistSession: true, autoRefreshToken: true } })
  : null;
