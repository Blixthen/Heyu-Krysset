import {
  buildGenerateRequest,
  describeReply,
  interpretReply,
  parseAnalyzeRequest,
  type AnalyzeFailure,
} from "@/lib/analyze";
import { GoogleGenAI } from "@google/genai";
import { NextResponse } from "next/server";

export const maxDuration = 60;

const DEFAULT_MODEL = "gemini-3-flash-preview";

function failureResponse({ message, status }: AnalyzeFailure) {
  return NextResponse.json({ error: message }, { status });
}

/** Imperative shell: reads env and the body, calls Gemini, logs, responds. All decisions live in @/lib/analyze. */
export async function POST(request: Request) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    console.error("analyze-crossword: GEMINI_API_KEY is not set");
    return failureResponse({ message: "Bildtolkningen är inte konfigurerad.", status: 500 });
  }

  const body: unknown = await request.json().catch(() => null);
  const input = parseAnalyzeRequest(body);
  if (!input.ok) return failureResponse(input.error);

  const model = process.env.GEMINI_MODEL || DEFAULT_MODEL;
  const ai = new GoogleGenAI({
    apiKey,
    httpOptions: { apiVersion: "v1beta", timeout: 55_000, retryOptions: { attempts: 1 } },
  });

  let reply;
  try {
    reply = await ai.models.generateContent(buildGenerateRequest(model, input.value));
  } catch (error) {
    // SDK, network and quota errors can contain internal details (keys,
    // project ids), so they are logged here and never sent to the user.
    console.error("analyze-crossword: Gemini request failed", { model }, error);
    return failureResponse({ message: "Kunde inte tolka korsordet. Försök igen.", status: 502 });
  }

  const result = interpretReply(reply);
  if (!result.ok) {
    console.warn("analyze-crossword: rejected model output", result.error.message, { model, ...describeReply(reply) });
    return failureResponse(result.error);
  }
  return NextResponse.json({ cells: result.value });
}
