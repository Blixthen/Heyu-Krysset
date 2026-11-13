import { getCloudflareContext } from "@opennextjs/cloudflare";

/**
 * The R2 bucket for photos and stored puzzles (bound as PHOTOS), or null when
 * the binding is missing (logged by the caller).
 */
export async function storageBucket() {
  try {
    return (await getCloudflareContext({ async: true })).env.PHOTOS ?? null;
  } catch {
    return null;
  }
}
