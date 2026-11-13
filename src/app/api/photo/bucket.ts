import { getCloudflareContext } from "@opennextjs/cloudflare";

/** The photo bucket, or null when the binding is missing (logged by the caller). */
export async function photoBucket() {
  try {
    return (await getCloudflareContext({ async: true })).env.PHOTOS ?? null;
  } catch {
    return null;
  }
}
