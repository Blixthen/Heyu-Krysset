/**
 * The parts of R2 the photo routes use. Declared here rather than pulling in
 * @cloudflare/workers-types, whose globals clash with the DOM types.
 */
interface PhotoBucketObject {
  body: ReadableStream;
  httpMetadata?: { contentType?: string };
}

interface PhotoBucket {
  put(key: string, value: ArrayBuffer | Uint8Array, options?: { httpMetadata?: { contentType?: string } }): Promise<unknown>;
  get(key: string): Promise<PhotoBucketObject | null>;
}

declare global {
  interface CloudflareEnv {
    /** The R2 bucket "heyu" (wrangler.jsonc). */
    PHOTOS?: PhotoBucket;
  }
}

export {};
