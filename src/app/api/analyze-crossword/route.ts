import {
  AnalyzeError,
  ANALYZE_PROMPT,
  ANALYZE_RESPONSE_SCHEMA,
  extractJsonObject,
  parseAnalyzeRequest,
  parseCells,
} from "@/lib/analyze";
import { FinishReason, GoogleGenAI, type GenerateContentResponse } from "@google/genai";
import { NextResponse } from "next/server";

export const maxDuration = 60;

const DEFAULT_MODEL = "gemini-3-flash-preview";
/** MAX_CELLS (2000) tuples at ~15 tokens each fit with headroom. */
const MAX_OUTPUT_TOKENS = 32_768;
const LOG_TAIL_LENGTH = 200;

/** What we know about Gemini's reply; logged when it cannot be used. Never includes the image. */
type ModelDiagnostics = {
  model: string;
  finishReason?: string;
  outputTokens?: number;
  textLength?: number;
  textTail?: string;
};

function describeResponse(model: string, response: GenerateContentResponse, text: string | undefined): ModelDiagnostics {
  return {
    model,
    finishReason: response.candidates?.[0]?.finishReason,
    outputTokens: response.usageMetadata?.candidatesTokenCount,
    textLength: text?.length ?? 0,
    textTail: text?.slice(-LOG_TAIL_LENGTH),
  };
}

function errorResponse(
  error: unknown,
  fallback: { message: string; status: number },
  diagnostics?: ModelDiagnostics,
) {
  if (error instanceof AnalyzeError) {
    // Server-side failures (bad model output) are logged so every 502 has a
    // matching explanation; client mistakes (4xx) are not worth the noise.
    if (error.status >= 500) console.warn("analyze-crossword rejected model output", error.message, diagnostics);
    return NextResponse.json({ error: error.message }, { status: error.status });
  }
  // Unknown errors (SDK, network, quota) are logged server-side only; their
  // messages can contain internal details we do not want to show users.
  console.error("analyze-crossword failed", error, diagnostics);
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

  const model = process.env.GEMINI_MODEL || DEFAULT_MODEL;
  let diagnostics: ModelDiagnostics = { model };
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
    });

    const text = response.text?.trim();
    diagnostics = describeResponse(model, response, text);
    if (diagnostics.finishReason === FinishReason.MAX_TOKENS) {
      throw new AnalyzeError("Korsordet var för stort för att tolkas. Prova att fotografera en del i taget.");
    }
    if (!text) throw new AnalyzeError("Gemini returnerade inget svar.");
    return NextResponse.json({ cells: parseCells(extractJsonObject(text)) });
  } catch (error) {
    return errorResponse(error, { message: "Kunde inte tolka korsordet. Försök igen.", status: 502 }, diagnostics);
  }
}
