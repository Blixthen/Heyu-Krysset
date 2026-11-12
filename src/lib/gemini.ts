import { GoogleGenAI, type GenerateContentResponse } from "@google/genai";
import type { ModelReply } from "./analyze";

/**
 * Gemini SDK adapter shared by /api/analyze-crossword and the photo eval
 * (`pnpm eval`), so both send and read requests the same way.
 */

export const DEFAULT_MODEL = "gemini-3-flash-preview";
/** Below the route's maxDuration (60 s), leaving time to parse the reply and respond. */
const GEMINI_TIMEOUT_MS = 55_000;
/** No retries: a second attempt would not fit inside the route's maxDuration. */
const GEMINI_ATTEMPTS = 1;

export function createGeminiClient(apiKey: string) {
  return new GoogleGenAI({
    apiKey,
    httpOptions: { apiVersion: "v1beta", timeout: GEMINI_TIMEOUT_MS, retryOptions: { attempts: GEMINI_ATTEMPTS } },
  });
}

/** Reads the SDK's `text` getter exactly once; it concatenates parts and can warn. */
export function toModelReply(response: GenerateContentResponse): ModelReply {
  return {
    text: response.text?.trim() ?? "",
    finishReason: response.candidates?.[0]?.finishReason,
    outputTokens: response.usageMetadata?.candidatesTokenCount,
  };
}
