import { existsSync, readFileSync } from "node:fs";
import { parseEnv } from "node:util";
import { defineConfig } from "vitest/config";
import base from "./vitest.config.mjs";

// Live Gemini eval (`pnpm eval`), kept out of `pnpm test` and CI because it
// calls the real API. Reads GEMINI_* from .env.local like `next dev` does;
// non-empty values already set in the shell win.
const ENV_FILE = ".env.local";
const fileEnv = existsSync(ENV_FILE) ? parseEnv(readFileSync(ENV_FILE, "utf8")) : {};
// Empty values are dropped first, so `GEMINI_API_KEY=` in the shell can't hide the file's key.
const setGeminiValues = (env: Record<string, string | undefined>) =>
  Object.entries(env).filter((entry): entry is [string, string] => entry[0].startsWith("GEMINI_") && !!entry[1]);
const geminiEnv = Object.fromEntries([...setGeminiValues(fileEnv), ...setGeminiValues(process.env)]);

export default defineConfig({
  ...base,
  test: {
    ...base.test,
    include: ["src/**/*.eval.ts"],
    env: geminiEnv,
    // One Gemini call per photo; the SDK gives up after 55 s.
    testTimeout: 70_000,
  },
});
