/**
 * Reads a stream until it passes `max` bytes, so a request body without a
 * declared length (chunked) can't fill the Worker's memory: "too-large" once
 * it passes the limit, otherwise the bytes.
 */
export async function readBounded(body: ReadableStream<Uint8Array> | null, max: number): Promise<Uint8Array | "too-large"> {
  if (!body) return new Uint8Array();
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    length += value.length;
    if (length > max) {
      await reader.cancel();
      return "too-large";
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.length;
  }
  return bytes;
}
