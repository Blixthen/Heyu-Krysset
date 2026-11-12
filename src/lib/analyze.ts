import { FinishReason, Type, type GenerateContentParameters, type GenerateContentResponse, type Schema } from "@google/genai";
import { dedupeCells, isLetterCell, MAX_CELLS, MIN_CELLS, type LetterCell } from "./crossword";

/**
 * Pure core for /api/analyze-crossword. Nothing here performs I/O, logs or
 * throws for expected failures: every outcome is a returned Result so the
 * route handler (the imperative shell) only has to act on it.
 */

/** A failure whose message is safe to show to the user. */
export type AnalyzeFailure = { message: string; status: number };

export type Result<T> = { ok: true; value: T } | { ok: false; error: AnalyzeFailure };

const ok = <T>(value: T): Result<T> => ({ ok: true, value });
const fail = (message: string, status = 502): { ok: false; error: AnalyzeFailure } => ({
  ok: false,
  error: { message, status },
});

export type AnalyzeInput = { image: string; mimeType: string };

/** Max output tokens: MAX_CELLS (2000) tuples at ~15 tokens each fit with headroom. */
export const MAX_OUTPUT_TOKENS = 32_768;
/** Enough of a reply's end to see where it stopped, short enough for a log line. */
const LOG_TAIL_LENGTH = 200;

export const MAX_IMAGE_BASE64_LENGTH = 8_000_000;

export const ANALYZE_PROMPT = `The original photo is shown unchanged. Never redraw it. You only locate the squares where a player types one letter.

Use the same visual rules for every crossword, even when the layout, cell size, language, or decoration differs.
- American crossword: white letter squares, solid black or dark gray blocks.
- Swedish bildkorsord: clues printed in cells, arrows, yellow letter squares, shaded rows, and photographs or drawings that are the clues.
A picture clue may cover one cell or a large area. A text clue may be wider than a letter square. Judge each area by what it looks like, not by a fixed template.

Classify each area before you answer:
- empty: a white, light, or yellow blank square for exactly one letter.
- clue: printed words, a question, or a direction arrow.
- block: solid black, dark gray, or a blocked square with no letter.
- image: a photograph or illustration used as a picture clue. It belongs in the puzzle. Never treat it as a block or as a letter square.

Return JSON only, and only the empty squares. Each square is an array of six integers [row, col, x, y, w, h]:
{"cells":[[0,0,120,80,30,30],[0,1,150,80,30,30]]}
x,y is the top-left. w,h is the size. x, y, w and h are integers from 0 to 1000, relative to the full image.
Scan from the top edge to the bottom edge and from left to right. Do not stop after the first rows.
row increases downward and col increases to the right, counting only letter squares.
Do not return clue, block, or image cells.`;

/**
 * Structured-output schema matching ANALYZE_PROMPT. Cells are compact
 * [row, col, x, y, w, h] tuples because a large bildkorsord has hundreds of
 * squares, and keyed objects would push the reply past the output-token limit.
 */
export const ANALYZE_RESPONSE_SCHEMA: Schema = {
  type: Type.OBJECT,
  properties: {
    cells: {
      type: Type.ARRAY,
      items: { type: Type.ARRAY, items: { type: Type.INTEGER }, minItems: "6", maxItems: "6" },
    },
  },
  required: ["cells"],
};

const MIME_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);
const BASE64 = /^[A-Za-z0-9+/]+={0,2}$/;

export function stripDataUrl(value: string) {
  const comma = value.indexOf(",");
  if (value.startsWith("data:") && comma >= 0) return value.slice(comma + 1);
  return value;
}

/** Validates the request body for /api/analyze-crossword. */
export function parseAnalyzeRequest(body: unknown): Result<AnalyzeInput> {
  if (!body || typeof body !== "object") return fail("Ogiltig begäran.", 400);
  const { image, mimeType } = body as { image?: unknown; mimeType?: unknown };
  if (typeof image !== "string" || image.trim().length === 0) return fail("Bilddata saknas.", 400);
  const data = stripDataUrl(image.trim());
  if (data.length > MAX_IMAGE_BASE64_LENGTH) return fail("Bilden är för stor.", 413);
  if (!BASE64.test(data)) return fail("Bilddata är ogiltig.", 400);
  return ok({
    image: data,
    mimeType: typeof mimeType === "string" && MIME_TYPES.has(mimeType) ? mimeType : "image/jpeg",
  });
}

/** The Gemini request for one crossword photo. */
export function buildGenerateRequest(model: string, input: AnalyzeInput): GenerateContentParameters {
  return {
    model,
    contents: [
      {
        role: "user",
        parts: [{ text: ANALYZE_PROMPT }, { inlineData: { mimeType: input.mimeType, data: input.image } }],
      },
    ],
    config: {
      temperature: 0,
      maxOutputTokens: MAX_OUTPUT_TOKENS,
      responseMimeType: "application/json",
      responseSchema: ANALYZE_RESPONSE_SCHEMA,
      thinkingConfig: { thinkingBudget: 0 },
    },
  };
}

/** Extracts the first balanced JSON object from model output, tolerating prose around it. */
export function extractJsonObject(text: string): Result<unknown> {
  const start = text.indexOf("{");
  if (start < 0) return fail("Gemini returnerade inte JSON.");
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let index = start; index < text.length; index += 1) {
    const char = text[index];
    if (inString) {
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === '"') inString = false;
      continue;
    }
    if (char === '"') inString = true;
    else if (char === "{") depth += 1;
    else if (char === "}") {
      depth -= 1;
      if (depth === 0) return parseJson(text.slice(start, index + 1));
    }
  }
  return fail("Gemini returnerade ofullständig JSON.");
}

function parseJson(text: string): Result<unknown> {
  try {
    return ok(JSON.parse(text) as unknown);
  } catch {
    return fail("Gemini returnerade ogiltig JSON.");
  }
}

function isEmptyType(value: unknown) {
  const type = (value as { type?: unknown } | null)?.type;
  return type === undefined || type === "empty";
}

/** Accepts a [row, col, x, y, w, h] tuple or a keyed cell object. */
function toCellCandidate(value: unknown): unknown {
  if (!Array.isArray(value)) return value;
  if (value.length !== 6) return null;
  const [row, col, x, y, w, h] = value as unknown[];
  return { row, col, x, y, w, h };
}

/** Turns Gemini's JSON into validated, de-duplicated letter cells. */
export function parseCells(value: unknown): Result<LetterCell[]> {
  if (!value || typeof value !== "object" || !Array.isArray((value as { cells?: unknown }).cells)) {
    return fail("Gemini returnerade inga rutor.");
  }
  const raw = (value as { cells: unknown[] }).cells;
  const cells = dedupeCells(raw.map(toCellCandidate).filter(isEmptyType).filter(isLetterCell));
  if (cells.length < MIN_CELLS) return fail("Hittade för få bokstavsrutor i bilden.");
  if (cells.length > MAX_CELLS) return fail("Hittade orimligt många rutor i bilden.");
  return ok(cells);
}

/** The parts of a Gemini response we read. */
export type ModelReply = Pick<GenerateContentResponse, "text" | "candidates" | "usageMetadata">;

/** What we know about a reply, for logging. Never includes the image. */
export type ModelDiagnostics = {
  finishReason?: string;
  outputTokens?: number;
  textLength: number;
  textTail?: string;
};

export function describeReply(reply: ModelReply): ModelDiagnostics {
  const text = reply.text;
  return {
    finishReason: reply.candidates?.[0]?.finishReason,
    outputTokens: reply.usageMetadata?.candidatesTokenCount,
    textLength: text?.length ?? 0,
    textTail: text?.slice(-LOG_TAIL_LENGTH),
  };
}

/** Turns a Gemini reply into letter cells, or a user-facing failure. */
export function interpretReply(reply: ModelReply): Result<LetterCell[]> {
  if (reply.candidates?.[0]?.finishReason === FinishReason.MAX_TOKENS) {
    return fail("Korsordet var för stort för att tolkas. Prova att fotografera en del i taget.");
  }
  const text = reply.text?.trim();
  if (!text) return fail("Gemini returnerade inget svar.");
  const json = extractJsonObject(text);
  return json.ok ? parseCells(json.value) : json;
}
