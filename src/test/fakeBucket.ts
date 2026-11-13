import { vi } from "vitest";

type Stored = { bytes: Uint8Array; contentType?: string; etag: string };

/** An in-memory stand-in for the R2 bucket bound as PHOTOS, with R2's conditional writes. */
export function createFakeBucket() {
  const objects = new Map<string, Stored>();
  let version = 0;
  return {
    objects,
    /** Stores an object directly, as if written earlier. */
    seed(key: string, bytes: Uint8Array) {
      objects.set(key, { bytes, etag: `v${(version += 1)}` });
    },
    put: vi.fn(
      async (
        key: string,
        value: Uint8Array | ArrayBuffer,
        options?: { httpMetadata?: { contentType?: string }; onlyIf?: { etagDoesNotMatch?: string; etagMatches?: string } },
      ) => {
        const current = objects.get(key);
        const { etagDoesNotMatch, etagMatches } = options?.onlyIf ?? {};
        if (etagDoesNotMatch === "*" && current) return null;
        if (etagMatches !== undefined && current?.etag !== etagMatches) return null;
        const stored = { bytes: new Uint8Array(value), contentType: options?.httpMetadata?.contentType, etag: `v${(version += 1)}` };
        objects.set(key, stored);
        return {};
      },
    ),
    get: vi.fn(async (key: string) => {
      const object = objects.get(key);
      return object ? { body: new Blob([object.bytes.slice()]).stream(), etag: object.etag } : null;
    }),
  };
}
