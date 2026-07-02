/**
 * Shared cloud config cache — populated once at app startup.
 */

import { invoke } from "@tauri-apps/api/core";

let cached: { url: string; api_key: string } | null = null;
let promise: Promise<{ url: string; api_key: string }> | null = null;

/** Returns a cached or freshly-fetched cloud config. */
export function getCloudConfig(): Promise<{ url: string; api_key: string }> {
  if (cached) return Promise.resolve(cached);
  if (promise) return promise;
  promise = invoke<{ url: string; api_key: string }>("get_cloud_config")
    .then((config) => {
      cached = config;
      return config;
    })
    .finally(() => { promise = null; });
  return promise;
}

/** Manual refresh — clears cache and re-fetches. */
export async function refreshCloudConfig(): Promise<{ url: string; api_key: string }> {
  cached = null;
  promise = null;
  const config = await invoke<{ url: string; api_key: string }>("get_cloud_config");
  cached = config;
  return config;
}
