import { GoogleGenAI } from "@google/genai";
import { NextResponse } from "next/server";

type LetterCell = {
  row: number;
  col: number;
  x: number;
  y: number;
  w: number;
  h: number;
};

const PROMPT = `The original photo is shown unchanged. Never redraw it. You only locate the squares where a player types one letter.

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

function stripDataUrl(value: string) {
  const comma = value.indexOf(",");
  if (value.startsWith("data:") && comma >= 0) return value.slice(comma + 1);
  return value;
}

function unit(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 1000;
}

function isLetterCell(value: unknown): value is LetterCell {
  if (!value || typeof value !== "object") return false;
  const cell = value as { type?: unknown; row?: unknown; col?: unknown; x?: unknown; y?: unknown; w?: unknown; h?: unknown };
  if (cell.type === "clue" || cell.type === "block" || cell.type === "image") return false;
  if (cell.type !== undefined && cell.type !== "empty") return false;
  return (
    typeof cell.row === "number" &&
    Number.isInteger(cell.row) &&
    cell.row >= 0 &&
    typeof cell.col === "number" &&
    Number.isInteger(cell.col) &&
    cell.col >= 0 &&
    unit(cell.x) &&
    unit(cell.y) &&
    unit(cell.w) &&
    unit(cell.h) &&
    (cell.w as number) >= 4 &&
    (cell.h as number) >= 4
  );
}

function jsonObject(text: string) {
  const start = text.indexOf("{");
  if (start < 0) throw new Error("Gemini returnerade inte JSON.");
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let index = start; index < text.length; index += 1) {
    const char = text[index];
    if (inString) {
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === "\"") inString = false;
      continue;
    }
    if (char === "\"") inString = true;
    else if (char === "{") depth += 1;
    else if (char === "}") {
      depth -= 1;
      if (depth === 0) return JSON.parse(text.slice(start, index + 1)) as unknown;
    }
  }
  throw new Error("Gemini returnerade ofullständig JSON.");
}

function parseCells(value: unknown) {
  if (!value || typeof value !== "object" || !Array.isArray((value as { cells?: unknown }).cells)) {
    throw new Error("Gemini returnerade inga rutor.");
  }
  const cells = (value as { cells: unknown[] }).cells.filter(isLetterCell);
  if (cells.length < 8) {
    throw new Error("Hittade för få bokstavsrutor i bilden.");
  }
  return { cells };
}

export const maxDuration = 60;

export async function POST(request: Request) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return NextResponse.json(
      { error: "GEMINI_API_KEY saknas i .env.local." },
      { status: 500 },
    );
  }

  let image = "";
  let mimeType = "image/jpeg";

  try {
    const body = (await request.json()) as { image?: unknown; mimeType?: unknown };
    if (typeof body.image !== "string" || body.image.trim().length === 0) {
      return NextResponse.json({ error: "Bilddata saknas." }, { status: 400 });
    }
    image = stripDataUrl(body.image.trim());
    if (
      typeof body.mimeType === "string" &&
      /^image\/(jpeg|png|webp|gif)$/.test(body.mimeType)
    ) {
      mimeType = body.mimeType;
    }
  } catch {
    return NextResponse.json({ error: "Ogiltig begäran." }, { status: 400 });
  }

  if (image.length > 8_000_000) {
    return NextResponse.json({ error: "Bilden är för stor." }, { status: 413 });
  }

  try {
    const ai = new GoogleGenAI({
      apiKey,
      httpOptions: {
        apiVersion: "v1beta",
        timeout: 55_000,
        retryOptions: { attempts: 1 },
      },
    });
    const response = await ai.models.generateContent({
      model: "gemini-3-flash-preview",
      contents: [
        {
          role: "user",
          parts: [
            { text: PROMPT },
            { inlineData: { mimeType, data: image } },
          ],
        },
      ],
      config: {
        temperature: 0,
        responseMimeType: "application/json",
        thinkingConfig: { thinkingBudget: 0 },
      },
    });

    const text = response.text?.trim();
    if (!text) {
      return NextResponse.json(
        { error: "Gemini returnerade inget svar." },
        { status: 502 },
      );
    }

    const parsed = parseCells(jsonObject(text));
    return NextResponse.json(parsed);
  } catch (error) {
    console.error("analyze-crossword failed", error);
    const message =
      error instanceof Error ? error.message : "Kunde inte tolka korsordet.";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
