import {
  buildGenerateRequest,
  describeReply,
  interpretReply,
  parseAnalyzeRequest,
  type AnalyzeFailure,
  type ModelReply,
} from "@/lib/analyze";
import { createGeminiClient, DEFAULT_MODEL, toModelReply } from "@/lib/gemini";
import { NextResponse } from "next/server";

/** Gemini's timeout in @/lib/gemini is set to fit inside this. */
export const maxDuration = 60;

/** Shown for any failure whose details must stay server-side. */
const GENERIC_FAILURE: AnalyzeFailure = { message: "Kunde inte tolka korsordet. Försök igen.", status: 502 };

function failureResponse({ message, status }: AnalyzeFailure) {
  return NextResponse.json({ error: message }, { status });
}

async function readBody(request: Request): Promise<unknown> {
  try {
    return await request.json();
  } catch (error) {
    // Only the error name: a JSON parse message can quote part of the image.
    console.warn("analyze-crossword: unreadable request body", error instanceof Error ? error.name : typeof error);
    return null;
  }
}

/** Imperative shell: reads env and the body, calls Gemini, logs, responds. All decisions live in @/lib/analyze. */
export async function POST(request: Request) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    console.error("analyze-crossword: GEMINI_API_KEY is not set");
    return failureResponse({ message: "Bildtolkningen är inte konfigurerad.", status: 500 });
  }

  const input = parseAnalyzeRequest(await readBody(request));
  if (!input.ok) return failureResponse(input.error);

  const model = process.env.GEMINI_MODEL || DEFAULT_MODEL;
  let reply: ModelReply;
  try {
    const ai = createGeminiClient(apiKey);
    reply = toModelReply(await ai.models.generateContent(buildGenerateRequest(model, input.value)));
  } catch (error) {
    // SDK, network and quota errors can contain internal details (keys,
    // project ids), so they are logged here and never sent to the user.
    console.error("analyze-crossword: Gemini request failed", { model }, error);
    return failureResponse(GENERIC_FAILURE);
  }

  const diagnostics = { model, ...describeReply(reply) };
  try {
    const result = interpretReply(reply);
    if (!result.ok) {
      console.warn("analyze-crossword: rejected model output", result.error.message, diagnostics);
      return failureResponse(result.error);
    }
    return NextResponse.json({ cells: result.value });
  } catch (error) {
    // interpretReply returns expected failures; a throw here is a bug, so keep the safe 502.
    console.error("analyze-crossword: could not interpret reply", diagnostics, error);
    return failureResponse(GENERIC_FAILURE);
  }
}
