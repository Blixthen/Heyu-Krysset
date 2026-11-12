import { gridCells } from "@/test/fixtures";
import { beforeEach, describe, expect, it, vi } from "vitest";

const generateContent = vi.hoisted(() => vi.fn());
const constructorArgs = vi.hoisted(() => [] as unknown[]);
vi.mock("@google/genai", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@google/genai")>()),
  GoogleGenAI: class {
    models = { generateContent };
    constructor(options: unknown) {
      constructorArgs.push(options);
    }
  },
}));

const { POST } = await import("./route");

function analyze(body: unknown) {
  return POST(
    new Request("https://kryss.test/api/analyze-crossword", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: typeof body === "string" ? body : JSON.stringify(body),
    }),
  );
}

const validBody = { image: "AAAA", mimeType: "image/png" };

describe("POST /api/analyze-crossword", () => {
  beforeEach(() => {
    vi.stubEnv("GEMINI_API_KEY", "test-key");
    vi.stubEnv("GEMINI_MODEL", "");
    generateContent.mockReset();
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  it("returns validated, de-duplicated cells", async () => {
    const cells = gridCells();
    generateContent.mockResolvedValue({ text: JSON.stringify({ cells: [...cells, cells[0]] }) });
    const response = await analyze(validBody);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ cells });
    expect(generateContent.mock.calls[0][0].model).toBe("gemini-3-flash-preview");
  });

  it("accepts compact [row, col, x, y, w, h] tuples", async () => {
    const cells = gridCells();
    const tuples = cells.map(({ row, col, x, y, w, h }) => [row, col, x, y, w, h]);
    generateContent.mockResolvedValue({ text: JSON.stringify({ cells: tuples }) });
    const response = await analyze(validBody);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ cells });
  });

  it("requests structured output with an explicit token limit", async () => {
    generateContent.mockResolvedValue({ text: JSON.stringify({ cells: gridCells() }) });
    await analyze(validBody);
    const { config } = generateContent.mock.calls[0][0];
    expect(config.responseSchema).toBeDefined();
    expect(config.maxOutputTokens).toBeGreaterThan(0);
  });

  it("explains truncated output instead of reporting broken JSON", async () => {
    generateContent.mockResolvedValue({
      text: '{"cells":[[0,0,1,1,10,10],[0,1,',
      candidates: [{ finishReason: "MAX_TOKENS" }],
      usageMetadata: { candidatesTokenCount: 32768 },
    });
    const response = await analyze(validBody);
    expect(response.status).toBe(502);
    expect((await response.json()).error).toMatch(/för stort/);
    expect(console.warn).toHaveBeenCalledWith(
      "analyze-crossword rejected model output",
      expect.stringMatching(/för stort/),
      expect.objectContaining({ finishReason: "MAX_TOKENS", outputTokens: 32768 }),
    );
  });

  it("logs diagnostics for rejected model output without the image", async () => {
    generateContent.mockResolvedValue({ text: '{"cells":[', candidates: [{ finishReason: "STOP" }] });
    const response = await analyze({ image: "SECRETIMAGEDATA", mimeType: "image/png" });
    expect((await response.json()).error).toMatch(/ofullständig/);
    expect(console.warn).toHaveBeenCalledWith(
      "analyze-crossword rejected model output",
      expect.any(String),
      expect.objectContaining({ finishReason: "STOP", textLength: 10, textTail: '{"cells":[' }),
    );
    expect(JSON.stringify(vi.mocked(console.warn).mock.calls)).not.toContain("SECRETIMAGEDATA");
  });

  it("does not log client errors", async () => {
    await analyze({ image: "" });
    expect(console.warn).not.toHaveBeenCalled();
  });

  it("uses GEMINI_MODEL when set", async () => {
    vi.stubEnv("GEMINI_MODEL", "gemini-next");
    generateContent.mockResolvedValue({ text: JSON.stringify({ cells: gridCells() }) });
    await analyze(validBody);
    expect(generateContent.mock.calls[0][0].model).toBe("gemini-next");
  });

  it("does not leak SDK error details to the client", async () => {
    generateContent.mockRejectedValue(new Error("403 API key AIza-secret is invalid for project 12345"));
    const response = await analyze(validBody);
    expect(response.status).toBe(502);
    const body = await response.json();
    expect(body.error).toBe("Kunde inte tolka korsordet. Försök igen.");
    expect(JSON.stringify(body)).not.toContain("AIza");
  });

  it("returns our own message for bad model output", async () => {
    generateContent.mockResolvedValue({ text: JSON.stringify({ cells: gridCells().slice(0, 3) }) });
    const response = await analyze(validBody);
    expect(response.status).toBe(502);
    expect((await response.json()).error).toBe("Hittade för få bokstavsrutor i bilden.");
  });

  it("returns 502 for an empty model response", async () => {
    generateContent.mockResolvedValue({ text: "" });
    expect((await analyze(validBody)).status).toBe(502);
  });

  it("validates the request before calling Gemini", async () => {
    expect((await analyze("{not json")).status).toBe(400);
    expect((await analyze({ image: "" })).status).toBe(400);
    expect((await analyze({ image: "<svg>" })).status).toBe(400);
    expect(generateContent).not.toHaveBeenCalled();
  });

  it("reports missing configuration without naming env files", async () => {
    vi.stubEnv("GEMINI_API_KEY", "");
    const response = await analyze(validBody);
    expect(response.status).toBe(500);
    expect((await response.json()).error).not.toContain(".env");
  });
});
