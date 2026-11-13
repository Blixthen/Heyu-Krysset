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
 * A photo fails when Gemini errors or the reply can't be parsed, and when a
 * photo with no knownProblems reads with problems. Readings vary between
 * runs, so for photos with knownProblems the current problems are reported
 * as test annotations instead.
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

// Recording without a key would skip every photo and leave stale replies looking fresh.
if (record && !apiKey) throw new Error("pnpm eval:record needs GEMINI_API_KEY (shell or .env.local)");

/** The free tier allows 5 requests a minute, so calls are spaced 13 s apart by default. */
const REQUEST_INTERVAL_MS = parseInterval(process.env.EVAL_REQUEST_INTERVAL_MS ?? "13000");
const OVERLAY_DIRECTORY = new URL("./overlays/", import.meta.url);

function parseInterval(value: string) {
  const ms = Number(value);
  if (!Number.isFinite(ms) || ms < 0) throw new Error(`EVAL_REQUEST_INTERVAL_MS must be milliseconds, got "${value}"`);
  return ms;
}

let lastRequestAt = 0;
async function waitForRateLimit() {
  const wait = lastRequestAt + REQUEST_INTERVAL_MS - Date.now();
  if (wait > 0) await sleep(wait);
  lastRequestAt = Date.now();
}

describe.skipIf(!apiKey)(`Gemini reads real crossword photos (${model})`, () => {
  // Sequential (not concurrent) so the requests stay under the rate limit.
  it.for(CROSSWORD_PHOTOS)("$name: $description", { timeout: REQUEST_INTERVAL_MS + 70_000 }, async (photo, { annotate }) => {
    const bytes = readFileSync(photoPath(photo));
    const input = parseAnalyzeRequest({ image: bytes.toString("base64"), mimeType: "image/jpeg" });
    if (!input.ok) throw new Error(input.error.message);

    await waitForRateLimit();
    const ai = createGeminiClient(apiKey!);
    const reply = toModelReply(await ai.models.generateContent(buildGenerateRequest(model, input.value)));
    const result = interpretReply(reply);

    mkdirSync(OVERLAY_DIRECTORY, { recursive: true });
    const image = { base64: input.value.image, ...jpegSize(bytes) };
    writeFileSync(new URL(`${photo.name}.svg`, OVERLAY_DIRECTORY), renderOverlay(photo, image, result.ok ? result.value : []));

    // An unusable reply is never recorded, so it can't replace a good baseline.
    expect(result, `finishReason ${reply.finishReason}, ${reply.outputTokens} output tokens`).toMatchObject({ ok: true });
    if (!result.ok) return;
    if (record) {
      const recorded: RecordedReply = { model, reply };
      writeFileSync(replyPath(photo), `${JSON.stringify(recorded, null, 2)}\n`);
    }

    const problems = findProblems(photo, result.value);
    if (!photo.knownProblems) {
      expect(problems).toEqual([]);
      return;
    }
    if (problems.length === 0) {
      await annotate("reads cleanly now: re-record and remove knownProblems", "notice");
    } else {
      for (const problem of problems) await annotate(problem, "warning");
    }
  });
});
