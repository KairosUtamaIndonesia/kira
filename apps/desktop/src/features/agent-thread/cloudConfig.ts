/**
 * Shared cloud config cache — populated once at app startup.
 */

import { invoke } from "@tauri-apps/api/core";

let cached: { url: string; api_key: string } | undefined;
let inFlight: Promise<{ url: string; api_key: string }> | undefined;

/** Returns a cached or freshly-fetched cloud config. */
export async function getCloudConfig(): Promise<{ url: string; api_key: string }> {
  if (cached) return cached;
  if (!inFlight) {
    inFlight = invoke<{ url: string; api_key: string }>("get_cloud_config");
  }
  try {
    const config = await inFlight;
    cached = config;
    return config;
  } finally {
    inFlight = undefined;
  }
}

/** Manual refresh — clears cache and re-fetches. */
export async function refreshCloudConfig(): Promise<{ url: string; api_key: string }> {
  cached = undefined;
  inFlight = undefined;
  const config = await invoke<{ url: string; api_key: string }>("get_cloud_config");
  cached = config;
  return config;
}
