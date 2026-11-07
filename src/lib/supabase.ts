import { createClient, type SupabaseClient } from "@supabase/supabase-js";

function projectUrl(value: string) {
  const trimmed = value.trim();
  try {
    const url = new URL(trimmed);
    return `${url.protocol}//${url.host}`;
  } catch {
    return trimmed.replace(/\/+$/, "").replace(/\/rest\/v1$/i, "");
  }
}

const supabaseUrl = projectUrl(process.env.NEXT_PUBLIC_SUPABASE_URL ?? "");
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";

export const isSecretSupabaseKey = supabaseAnonKey.startsWith("sb_secret_");

export const isSupabaseConfigured =
  supabaseUrl.length > 0 && supabaseAnonKey.length > 0 && !isSecretSupabaseKey;

export const supabase: SupabaseClient | null = isSupabaseConfigured
  ? createClient(supabaseUrl, supabaseAnonKey, {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
        detectSessionInUrl: false,
      },
      realtime: {
        heartbeatIntervalMs: 25000,
        timeout: 10000,
      },
    })
  : null;
