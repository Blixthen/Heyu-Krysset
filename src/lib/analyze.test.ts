import { gridCells } from "@/test/fixtures";
import { FinishReason } from "@google/genai";
import { describe, expect, it } from "vitest";
import {
  buildGenerateRequest,
  describeReply,
  extractJsonObject,
  interpretReply,
  MAX_IMAGE_BASE64_LENGTH,
  ok,
  parseAnalyzeRequest,
  parseCells,
  stripDataUrl,
  type Result,
} from "./analyze";

function expectFailure(result: Result<unknown>, status: number, message?: RegExp) {
  expect(result.ok).toBe(false);
  if (result.ok) return;
  expect(result.error.status).toBe(status);
  if (message) expect(result.error.message).toMatch(message);
}

describe("stripDataUrl", () => {
  it("removes a data URL prefix", () => {
    expect(stripDataUrl("data:image/png;base64,AAAA")).toBe("AAAA");
    expect(stripDataUrl("AAAA")).toBe("AAAA");
  });
});

describe("parseAnalyzeRequest", () => {
  it("accepts base64 with a known mime type", () => {
    expect(parseAnalyzeRequest({ image: "data:image/png;base64,AAAA", mimeType: "image/png" })).toEqual(
      ok({ image: "AAAA", mimeType: "image/png" }),
    );
  });

  it("falls back to jpeg for unknown mime types", () => {
    expect(parseAnalyzeRequest({ image: "AAAA", mimeType: "image/svg+xml" })).toEqual(
      ok({ image: "AAAA", mimeType: "image/jpeg" }),
    );
  });

  it("rejects missing, invalid and oversized images", () => {
    expectFailure(parseAnalyzeRequest(null), 400);
    expectFailure(parseAnalyzeRequest({ image: "  " }), 400, /saknas/);
    expectFailure(parseAnalyzeRequest({ image: "not base64!" }), 400, /ogiltig/);
    expectFailure(parseAnalyzeRequest({ image: "A".repeat(MAX_IMAGE_BASE64_LENGTH + 1) }), 413);
  });
});

describe("buildGenerateRequest", () => {
  it("sends the image with structured output and an explicit token limit", () => {
    const request = buildGenerateRequest("gemini-x", { image: "AAAA", mimeType: "image/png" });
    expect(request.model).toBe("gemini-x");
    expect(JSON.stringify(request.contents)).toContain('"data":"AAAA"');
    expect(request.config?.responseSchema).toBeDefined();
    expect(request.config?.maxOutputTokens).toBeGreaterThan(0);
  });
});

describe("extractJsonObject", () => {
  it("finds JSON surrounded by prose and code fences", () => {
    expect(extractJsonObject('Here you go:\n```json\n{"cells":[{"a":"}"}]}\n```')).toEqual(ok({ cells: [{ a: "}" }] }));
  });

  it("handles escaped quotes inside strings", () => {
    expect(extractJsonObject('{"a":"say \\"{hi}\\""}')).toEqual(ok({ a: 'say "{hi}"' }));
  });

  it("reports missing, truncated or invalid JSON", () => {
    expectFailure(extractJsonObject("no json here"), 502);
    expectFailure(extractJsonObject('{"cells":['), 502, /ofullständig/);
    expectFailure(extractJsonObject("{cells: nope}"), 502, /ogiltig/);
  });
});

describe("parseCells", () => {
  const cells = gridCells();

  it("returns validated cells", () => {
    expect(parseCells({ cells })).toEqual(ok(cells));
  });

  it("drops non-empty cell types and invalid cells", () => {
    const noisy = [
      ...cells.map((cell) => ({ ...cell, type: "empty" })),
      { row: 5, col: 5, x: 1, y: 1, w: 10, h: 10, type: "clue" },
      { row: 6, col: 6, x: 1, y: 1, w: 10, h: 10, type: "image" },
      { row: 7, col: 7, x: 999, y: 1, w: 10, h: 10 },
    ];
    expect(parseCells({ cells: noisy })).toEqual(ok(cells));
  });

  it("accepts [row, col, x, y, w, h] tuples and drops malformed ones", () => {
    const tuples = cells.map(({ row, col, x, y, w, h }) => [row, col, x, y, w, h]);
    const malformed = [[9, 9, 1, 1, 10], [9, 9, 1, 1, 10, 10, 10], ["a", 0, 1, 1, 10, 10]];
    expect(parseCells({ cells: [...tuples, ...malformed] })).toEqual(ok(cells));
  });

  it("removes duplicate row/col pairs", () => {
    expect(parseCells({ cells: [...cells, { ...cells[0], x: 700 }] })).toEqual(ok(cells));
  });

  it("rejects responses with too few cells or no cell list", () => {
    expectFailure(parseCells({ cells: cells.slice(0, 7) }), 502, /för få/);
    expectFailure(parseCells({}), 502);
  });
});

describe("interpretReply", () => {
  const cells = gridCells();
  const tuples = cells.map(({ row, col, x, y, w, h }) => [row, col, x, y, w, h]);

  it("returns cells from a complete reply", () => {
    const reply = { text: JSON.stringify({ cells: tuples }), finishReason: FinishReason.STOP };
    expect(interpretReply(reply)).toEqual(ok(cells));
  });

  it("explains truncation instead of reporting broken JSON", () => {
    const reply = { text: '{"cells":[[0,0,', finishReason: FinishReason.MAX_TOKENS };
    expectFailure(interpretReply(reply), 502, /för stort/);
  });

  it("reports empty and malformed replies", () => {
    expectFailure(interpretReply({ text: "" }), 502, /inget svar/);
    expectFailure(interpretReply({ text: '{"cells":[' }), 502, /ofullständig/);
  });
});

describe("describeReply", () => {
  it("summarises the reply for logs", () => {
    const reply = { text: `{"cells":[${"x".repeat(500)}`, finishReason: FinishReason.STOP, outputTokens: 42 };
    expect(describeReply(reply)).toEqual({
      finishReason: FinishReason.STOP,
      outputTokens: 42,
      textLength: 510,
      textTail: "x".repeat(200),
    });
  });
});
