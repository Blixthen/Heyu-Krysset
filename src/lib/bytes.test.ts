import { describe, expect, it } from "vitest";
import { readBounded } from "./bytes";

function stream(chunks: number[][]) {
  let index = 0;
  const pulled = { count: 0 };
  const body = new ReadableStream<Uint8Array>({
    pull(controller) {
      pulled.count += 1;
      if (index < chunks.length) controller.enqueue(Uint8Array.from(chunks[index++]));
      else controller.close();
    },
  });
  return { body, pulled };
}

describe("readBounded", () => {
  it("joins the chunks of a body within the limit", async () => {
    expect(await readBounded(stream([[1, 2], [3], [4, 5]]).body, 5)).toEqual(Uint8Array.from([1, 2, 3, 4, 5]));
  });

  it("stops reading once the body passes the limit", async () => {
    const { body, pulled } = stream([[1, 2], [3, 4], [5, 6], [7, 8], [9]]);
    expect(await readBounded(body, 3)).toBe("too-large");
    expect(pulled.count).toBeLessThan(5);
  });

  it("reads no body as empty", async () => {
    expect(await readBounded(null, 3)).toEqual(new Uint8Array());
  });
});
