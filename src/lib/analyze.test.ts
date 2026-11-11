import { gridCells } from "@/test/fixtures";
import { describe, expect, it } from "vitest";
import { AnalyzeError, extractJsonObject, MAX_IMAGE_BASE64_LENGTH, parseAnalyzeRequest, parseCells, stripDataUrl } from "./analyze";

function expectAnalyzeError(fn: () => unknown, status: number, message?: RegExp) {
  try {
    fn();
  } catch (error) {
    expect(error).toBeInstanceOf(AnalyzeError);
    expect((error as AnalyzeError).status).toBe(status);
    if (message) expect((error as AnalyzeError).message).toMatch(message);
    return;
  }
  throw new Error("expected an AnalyzeError");
}

describe("stripDataUrl", () => {
  it("removes a data URL prefix", () => {
    expect(stripDataUrl("data:image/png;base64,AAAA")).toBe("AAAA");
    expect(stripDataUrl("AAAA")).toBe("AAAA");
  });
});

describe("parseAnalyzeRequest", () => {
  it("accepts base64 with a known mime type", () => {
    expect(parseAnalyzeRequest({ image: "data:image/png;base64,AAAA", mimeType: "image/png" })).toEqual({
      image: "AAAA",
      mimeType: "image/png",
    });
  });

  it("falls back to jpeg for unknown mime types", () => {
    expect(parseAnalyzeRequest({ image: "AAAA", mimeType: "image/svg+xml" }).mimeType).toBe("image/jpeg");
  });

  it("rejects missing, invalid and oversized images", () => {
    expectAnalyzeError(() => parseAnalyzeRequest(null), 400);
    expectAnalyzeError(() => parseAnalyzeRequest({ image: "  " }), 400, /saknas/);
    expectAnalyzeError(() => parseAnalyzeRequest({ image: "not base64!" }), 400, /ogiltig/);
    expectAnalyzeError(() => parseAnalyzeRequest({ image: "A".repeat(MAX_IMAGE_BASE64_LENGTH + 1) }), 413);
  });
});

describe("extractJsonObject", () => {
  it("finds JSON surrounded by prose and code fences", () => {
    expect(extractJsonObject('Here you go:\n```json\n{"cells":[{"a":"}"}]}\n```')).toEqual({ cells: [{ a: "}" }] });
  });

  it("handles escaped quotes inside strings", () => {
    expect(extractJsonObject('{"a":"say \\"{hi}\\""}')).toEqual({ a: 'say "{hi}"' });
  });

  it("throws a user-facing error for missing, truncated or invalid JSON", () => {
    expectAnalyzeError(() => extractJsonObject("no json here"), 502);
    expectAnalyzeError(() => extractJsonObject('{"cells":['), 502, /ofullständig/);
    expectAnalyzeError(() => extractJsonObject("{cells: nope}"), 502, /ogiltig/);
  });
});

describe("parseCells", () => {
  const cells = gridCells();

  it("returns validated cells", () => {
    expect(parseCells({ cells })).toEqual(cells);
  });

  it("drops non-empty cell types and invalid cells", () => {
    const noisy = [
      ...cells.map((cell) => ({ ...cell, type: "empty" })),
      { row: 5, col: 5, x: 1, y: 1, w: 10, h: 10, type: "clue" },
      { row: 6, col: 6, x: 1, y: 1, w: 10, h: 10, type: "image" },
      { row: 7, col: 7, x: 999, y: 1, w: 10, h: 10 },
    ];
    expect(parseCells({ cells: noisy })).toEqual(cells);
  });

  it("removes duplicate row/col pairs", () => {
    expect(parseCells({ cells: [...cells, { ...cells[0], x: 700 }] })).toEqual(cells);
  });

  it("rejects responses with too few cells or no cell list", () => {
    expectAnalyzeError(() => parseCells({ cells: cells.slice(0, 7) }), 502, /för få/);
    expectAnalyzeError(() => parseCells({}), 502);
  });
});
