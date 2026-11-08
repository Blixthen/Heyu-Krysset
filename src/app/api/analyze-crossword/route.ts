import { AnalyzeError, ANALYZE_PROMPT, extractJsonObject, parseAnalyzeRequest, parseCells } from "@/lib/analyze";
import { GoogleGenAI } from "@google/genai";
import { NextResponse } from "next/server";

export const maxDuration = 60;

const DEFAULT_MODEL = "gemini-3-flash-preview";

function errorResponse(error: unknown, fallback: { message: string; status: number }) {
  if (error instanceof AnalyzeError) {
    return NextResponse.json({ error: error.message }, { status: error.status });
  }
  // Unknown errors (SDK, network, quota) are logged server-side only; their
  // messages can contain internal details we do not want to show users.
  console.error("analyze-crossword failed", error);
  return NextResponse.json({ error: fallback.message }, { status: fallback.status });
}

export async function POST(request: Request) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    console.error("analyze-crossword: GEMINI_API_KEY is not set");
    return NextResponse.json({ error: "Bildtolkningen är inte konfigurerad." }, { status: 500 });
  }

  let input: { image: string; mimeType: string };
  try {
    input = parseAnalyzeRequest(await request.json());
  } catch (error) {
    return errorResponse(error, { message: "Ogiltig begäran.", status: 400 });
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
      model: process.env.GEMINI_MODEL || DEFAULT_MODEL,
      contents: [
        {
          role: "user",
          parts: [{ text: ANALYZE_PROMPT }, { inlineData: { mimeType: input.mimeType, data: input.image } }],
        },
      ],
      config: {
        temperature: 0,
        responseMimeType: "application/json",
        thinkingConfig: { thinkingBudget: 0 },
      },
    });

    const text = response.text?.trim();
    if (!text) throw new AnalyzeError("Gemini returnerade inget svar.");
    return NextResponse.json({ cells: parseCells(extractJsonObject(text)) });
  } catch (error) {
    return errorResponse(error, { message: "Kunde inte tolka korsordet. Försök igen.", status: 502 });
  }
}
