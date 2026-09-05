/**
 * Supabase Browser Client
 *
 * Client-side Supabase client for authentication and real-time features.
 * Uses @supabase/ssr for proper Next.js 15 cookie handling.
 *
 * Two exports:
 * - createBrowserClient() — returns null if not configured (safe for setup flow)
 * - createClient() — throws if not configured (for features that require Supabase)
 */

import { createBrowserClient as createSupabaseBrowserClient } from '@supabase/ssr';
import type { SupabaseClient } from '@supabase/supabase-js';

/** Shape of `/ycode/api/supabase/config`. `schema` is the tenant's Postgres schema. */
interface BrowserSupabaseConfig {
  url: string;
  anonKey: string;
  schema?: string;
}

let browserClient: SupabaseClient | null = null;
let configPromise: Promise<BrowserSupabaseConfig | null> | null = null;

/**
 * Reset cached client and config.
 * Call after credentials change (e.g. during setup) so the next
 * createBrowserClient() picks up the new config from the server.
 */
export function resetBrowserClient(): void {
  browserClient = null;
  configPromise = null;
}

/**
 * Get config from API endpoint.
 * Cached to avoid multiple requests. Returns null if not configured (404).
 */
async function getSupabaseConfig(): Promise<BrowserSupabaseConfig | null> {
  if (!configPromise) {
    configPromise = fetch('/ycode/api/supabase/config')
      .then(async (res) => {
        if (!res.ok) {
          // Handle 404 (not configured) gracefully - expected during setup
          if (res.status === 404) {
            return null;
          }

          const error = await res.json().catch(() => ({ error: 'Unknown error' }));
          console.error('Failed to get Supabase config:', res.status, error);
          return null;
        }
        return res.json();
      })
      .then((data) => {
        if (!data || !data.data) {
          return null;
        }
        return data.data;
      })
      .catch((error) => {
        console.error('Error getting Supabase config:', error);
        // Reset promise so it can be retried
        configPromise = null;
        return null;
      });
  }

  return configPromise;
}

/** Build or return the cached SupabaseClient instance. */
async function getOrCreateClient(): Promise<SupabaseClient | null> {
  if (browserClient) return browserClient;

  const config = await getSupabaseConfig();
  if (!config) return null;

  // The schema is a runtime value; see `dbSchemaForClient` in lib/tenant.ts
  // for why the generic is asserted back to the default instead of threaded.
  browserClient = createSupabaseBrowserClient(config.url, config.anonKey, {
    db: { schema: (config.schema || 'public') as 'public' },
  });
  return browserClient;
}

/**
 * Get browser Supabase client (null-safe).
 * Returns null if Supabase is not configured — use during setup flow.
 */
export async function createBrowserClient(): Promise<SupabaseClient | null> {
  return getOrCreateClient();
}

/**
 * Get browser Supabase client (throws if not configured).
 * Use for features that require a working Supabase connection (realtime, auth, etc).
 */
export async function createClient(): Promise<SupabaseClient> {
  const client = await getOrCreateClient();

  if (!client) {
    throw new Error('Supabase is not configured');
  }

  return client;
}
