/**
 * The parts of R2 the photo routes use. Declared here rather than pulling in
 * @cloudflare/workers-types, whose globals clash with the DOM types.
 */
interface PhotoBucketObject {
  body: ReadableStream;
  etag: string;
  httpMetadata?: { contentType?: string };
}

interface PhotoBucketPutOptions {
  httpMetadata?: { contentType?: string };
  /** Write only if this holds; put then resolves to null instead of writing. */
  onlyIf?: { etagDoesNotMatch?: string; etagMatches?: string };
}

interface PhotoBucket {
  put(key: string, value: ArrayBuffer | Uint8Array, options?: PhotoBucketPutOptions): Promise<object | null>;
  get(key: string): Promise<PhotoBucketObject | null>;
}

declare global {
  interface CloudflareEnv {
    /** The R2 bucket "heyu" (wrangler.jsonc): photos and stored puzzles. */
    PHOTOS?: PhotoBucket;
  }
}

export {};
