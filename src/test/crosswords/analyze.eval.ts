import { buildGenerateRequest, interpretReply, parseAnalyzeRequest } from "@/lib/analyze";
import { createGeminiClient, DEFAULT_MODEL, toModelReply } from "@/lib/gemini";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { setTimeout as sleep } from "node:timers/promises";
import { describe, expect, it } from "vitest";
import { jpegSize, renderOverlay } from "./overlay";
import { CROSSWORD_PHOTOS, findProblems, photoPath, replyPath, type RecordedReply } from "./photos";

/**
 * Live eval: sends every photo to the real Gemini API with the production
 * prompt and parsing. Run with `pnpm eval`; `pnpm eval:record` also saves
 * each reply for the offline replay tests. Needs GEMINI_API_KEY (from the
 * shell or .env.local) and costs one Gemini call per photo.
 *
 * Each run writes src/test/crosswords/overlays/<name>.svg (gitignored), which
 * draws the reading over the photo for review by eye.
 *
 * The browser re-encodes photos to JPEG at most 1400 px wide before upload;
 * these photos are already narrower, so they are sent as they are.
 */

const apiKey = process.env.GEMINI_API_KEY;
const model = process.env.GEMINI_MODEL || DEFAULT_MODEL;
const record = process.env.RECORD_REPLIES === "1";

/** The free tier allows 5 requests a minute, so calls are spaced 13 s apart. */
const REQUEST_INTERVAL_MS = Number(process.env.EVAL_REQUEST_INTERVAL_MS ?? 13_000);
const OVERLAY_DIRECTORY = new URL("./overlays/", import.meta.url);

let lastRequestAt = 0;
async function waitForRateLimit() {
  const wait = lastRequestAt + REQUEST_INTERVAL_MS - Date.now();
  if (wait > 0) await sleep(wait);
  lastRequestAt = Date.now();
}

describe.skipIf(!apiKey)(`Gemini reads real crossword photos (${model})`, () => {
  // Sequential (not concurrent) so the requests stay under the rate limit.
  it.each(CROSSWORD_PHOTOS)("$name: $description", { timeout: REQUEST_INTERVAL_MS + 70_000 }, async (photo) => {
    const bytes = readFileSync(photoPath(photo));
    const input = parseAnalyzeRequest({ image: bytes.toString("base64"), mimeType: "image/jpeg" });
    if (!input.ok) throw new Error(input.error.message);

    await waitForRateLimit();
    const ai = createGeminiClient(apiKey!);
    const reply = toModelReply(await ai.models.generateContent(buildGenerateRequest(model, input.value)));
    // Recorded before asserting, so a bad reading can be replayed and debugged offline.
    if (record) {
      const recorded: RecordedReply = { model, reply };
      writeFileSync(replyPath(photo), `${JSON.stringify(recorded, null, 2)}\n`);
    }

    const result = interpretReply(reply);
    mkdirSync(OVERLAY_DIRECTORY, { recursive: true });
    const image = { base64: input.value.image, ...jpegSize(bytes) };
    writeFileSync(new URL(`${photo.name}.svg`, OVERLAY_DIRECTORY), renderOverlay(photo, image, result.ok ? result.value : []));

    expect(result, `finishReason ${reply.finishReason}, ${reply.outputTokens} output tokens`).toMatchObject({ ok: true });
    if (result.ok) expect(findProblems(photo, result.value)).toEqual([]);
  });
});
