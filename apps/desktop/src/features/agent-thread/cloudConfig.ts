/**
 * Shared cloud config cache — populated once at app startup.
 */

import { invoke } from "@tauri-apps/api/core";

let cached: { url: string; api_key: string } | undefined;
let promise: Promise<{ url: string; api_key: string }> | undefined;

/** Returns a cached or freshly-fetched cloud config. */
export async function getCloudConfig(): Promise<{ url: string; api_key: string }> {
  if (cached) return cached;
  if (promise) return promise;
  try {
    promise = invoke<{ url: string; api_key: string }>("get_cloud_config");
    const config = await promise;
    cached = config;
    return config;
  } finally {
    promise = undefined;
  }
}

export async function refreshCloudConfig(): Promise<{ url: string; api_key: string }> {
  cached = undefined;
  promise = undefined;
  const config = await invoke<{ url: string; api_key: string }>("get_cloud_config");
  cached = config;
  return config;
}
