import { dedupeCells, isLetterCell, MAX_CELLS, MIN_CELLS, type LetterCell } from "./crossword";

/** An error whose message is safe to show to the user. */
export class AnalyzeError extends Error {
  constructor(
    message: string,
    readonly status = 502,
  ) {
    super(message);
    this.name = "AnalyzeError";
  }
}

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

Return JSON only, and only the empty squares:
{"cells":[{"row":0,"col":0,"type":"empty","x":0,"y":0,"w":0,"h":0}]}
x,y is the top-left. w,h is the size. All four numbers are integers from 0 to 1000, relative to the full image.
Scan from the top edge to the bottom edge and from left to right. Do not stop after the first rows.
row increases downward and col increases to the right, counting only letter squares.
Do not return clue, block, or image cells.`;

const MIME_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);
const BASE64 = /^[A-Za-z0-9+/]+={0,2}$/;

export function stripDataUrl(value: string) {
  const comma = value.indexOf(",");
  if (value.startsWith("data:") && comma >= 0) return value.slice(comma + 1);
  return value;
}

/** Validates the request body for /api/analyze-crossword. */
export function parseAnalyzeRequest(body: unknown): { image: string; mimeType: string } {
  if (!body || typeof body !== "object") throw new AnalyzeError("Ogiltig begäran.", 400);
  const { image, mimeType } = body as { image?: unknown; mimeType?: unknown };
  if (typeof image !== "string" || image.trim().length === 0) {
    throw new AnalyzeError("Bilddata saknas.", 400);
  }
  const data = stripDataUrl(image.trim());
  if (data.length > MAX_IMAGE_BASE64_LENGTH) throw new AnalyzeError("Bilden är för stor.", 413);
  if (!BASE64.test(data)) throw new AnalyzeError("Bilddata är ogiltig.", 400);
  return {
    image: data,
    mimeType: typeof mimeType === "string" && MIME_TYPES.has(mimeType) ? mimeType : "image/jpeg",
  };
}

/** Extracts the first balanced JSON object from model output, tolerating prose around it. */
export function extractJsonObject(text: string): unknown {
  const start = text.indexOf("{");
  if (start < 0) throw new AnalyzeError("Gemini returnerade inte JSON.");
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
      if (depth === 0) {
        try {
          return JSON.parse(text.slice(start, index + 1)) as unknown;
        } catch {
          throw new AnalyzeError("Gemini returnerade ogiltig JSON.");
        }
      }
    }
  }
  throw new AnalyzeError("Gemini returnerade ofullständig JSON.");
}

function isEmptyType(value: unknown) {
  const type = (value as { type?: unknown } | null)?.type;
  return type === undefined || type === "empty";
}

/** Turns Gemini's JSON into validated, de-duplicated letter cells. */
export function parseCells(value: unknown): LetterCell[] {
  if (!value || typeof value !== "object" || !Array.isArray((value as { cells?: unknown }).cells)) {
    throw new AnalyzeError("Gemini returnerade inga rutor.");
  }
  const raw = (value as { cells: unknown[] }).cells;
  const cells = dedupeCells(raw.filter(isEmptyType).filter(isLetterCell));
  if (cells.length < MIN_CELLS) throw new AnalyzeError("Hittade för få bokstavsrutor i bilden.");
  if (cells.length > MAX_CELLS) throw new AnalyzeError("Hittade orimligt många rutor i bilden.");
  return cells;
}
