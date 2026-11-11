<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

A password-protected web app where friends solve a photographed crossword together in real time. Next.js 16 App Router, React 19, Tailwind 4, deployed to Cloudflare Workers. User-facing strings are Swedish; code and comments are English.

Agent instructions live only in this file. Don't add a `CLAUDE.md`: Claude Code reads `AGENTS.md` directly, but only when no `CLAUDE.md` exists.

## Commands

Uses pnpm 12 (pinned through `packageManager`; install with `npx get-pnpm`) and Node 26.

```bash
pnpm install
pnpm dev                          # dev server on :3000; needs .env.local (see .env.example)
pnpm test                         # Vitest, all tests
pnpm test src/lib/board.test.ts   # one file
pnpm test -t "merges letters"     # tests whose name matches
pnpm lint
pnpm typecheck                    # next typegen, then tsc --noEmit
pnpm preview                      # OpenNext build, run on the local Workers runtime; needs .dev.vars
pnpm run deploy                   # build and deploy to Cloudflare
```

`pnpm deploy` is a built-in pnpm command, so the deploy script must be called with `pnpm run deploy`.

CI (`.github/workflows/ci.yml`) runs lint, typecheck, tests and the OpenNext build on pull requests. Pushes to `main` deploy through `.github/workflows/deploy.yml`.

## Architecture

There is no database and no server-side room state. The server does three things: it gates access, hands out the realtime channel name, and proxies photo analysis to Gemini. Everything else happens between browsers over Supabase Realtime broadcast.

**Password gate.** `src/proxy.ts` (Next 16's replacement for `middleware.ts`) lets only `/login` and `/api/unlock` through without the `heyu_gate` cookie, which is an HMAC of `APP_PASSWORD` (`src/lib/gate.ts`). Changing the password invalidates every cookie and also changes the room topic.

**Room topic.** `/api/room` returns a channel name derived from `APP_PASSWORD`. The Supabase anon key ships to the browser, so the secret topic is what keeps outsiders out of the room. It must never be prerendered (`connection()` opts the route out). `src/lib/supabase.ts` refuses `sb_secret_` keys.

**Sync protocol** (`src/hooks/useCrosswordRoom.ts`). Broadcast events are `message`, `puzzle` (full board: puzzle plus letters), `cell-update` (one letter) and `sync-request`. On subscribe, a client broadcasts its board and sends `sync-request`; peers answer after a random jitter, and the rest cancel when they see an answer. Reconnects use exponential backoff, and a 401 from `/api/room` sends the user to `/login`.

**Conflict resolution** lives in the pure `boardReducer` (`src/lib/board.ts`): a different puzzle replaces ours only if its `createdAt` is newer, and the same puzzle merges letters with local values winning. Keep these rules there, not in the hook.

**Untrusted payloads.** Every peer payload is validated and copied field by field before use (`isChatMessage`/`toChatMessage` in `src/lib/chat.ts`, `isCrosswordPuzzle`/`toCrosswordPuzzle`/`isCellUpdate` in `src/lib/crossword.ts`). The same crossword validators check Gemini's output on the server, so that module must stay runtime-agnostic.

**Photo flow.** `src/lib/image.ts` makes two JPEGs in the browser: a larger one for Gemini and a smaller one, under `SHARE_IMAGE_BUDGET`, to broadcast, because Supabase limits broadcast payload size. `/api/analyze-crossword` sends the photo and `ANALYZE_PROMPT` (`src/lib/analyze.ts`) to Gemini and returns validated letter cells in 0–1000 coordinates relative to the image. Only `AnalyzeError` messages reach users; other errors are logged.

## Cloudflare Workers constraints

Built with `@opennextjs/cloudflare` (`open-next.config.ts`, `wrangler.jsonc`).

- Do not enable `cacheComponents`: page renders hang on the Workers runtime.
- `src/proxy.ts` runs on OpenNext's experimental Node.js middleware support. After adapter upgrades, check the gate with `pnpm preview`.
- The Workers free plan allows 10 ms CPU per request and a 3 MiB gzipped Worker. `wrangler deploy --dry-run` reports the size.
- `NEXT_PUBLIC_SUPABASE_*` are inlined at build time, so they are GitHub Actions variables. `APP_PASSWORD` and `GEMINI_API_KEY` are runtime secrets, set with `wrangler secret put`.

## After changing X, also do Y

| You changed | Then |
| --- | --- |
| Dependencies | `pnpm install` and commit `pnpm-lock.yaml`; CI installs with `--frozen-lockfile` |
| A dependency that wants an install script | `pnpm install` stops with `ERR_PNPM_IGNORED_BUILDS`. Allow or deny it under `allowBuilds` in `pnpm-workspace.yaml`; only allow what the build or runtime needs |
| A realtime event or payload shape | Update its validator and copy function, `boardReducer` if it affects the board, and the hook tests. See "Compatibility" below |
| A route that must work without the password | Add it to `PUBLIC_PATHS` in `src/proxy.ts`, plus a test in `src/proxy.test.ts` |
| An environment variable | `.env.example`, the README "Deploying" section, and where it is set: GitHub Actions variables for `NEXT_PUBLIC_*` (and the build steps in both workflows), `wrangler secret put` for runtime secrets |
| `next.config.ts`, `proxy.ts`, or Next/OpenNext/wrangler versions | `pnpm preview` and check the login gate and the home page on the Workers runtime; `next build` passing does not prove it runs there |
| The Gemini prompt or cell parsing | `src/lib/analyze.test.ts`; Gemini output is untrusted input like any peer payload |

## TypeScript conventions

- Validate `unknown` input (request bodies, peer payloads, Gemini output) with a type guard before use. Casting is only for reading fields while narrowing, never for treating unvalidated data as the target type.
- In app code, don't silence the type checker with `as unknown as`, `@ts-expect-error`, or non-null `!`; fix the type at its source.
- Name limits and timings as constants with a comment explaining the value (`MAX_MESSAGES`, `SHARE_IMAGE_BUDGET`, `SYNC_JITTER_MS`).
- Keep state transitions pure and testable in `src/lib/`; hooks and components wire them to React and the network.
- Before writing a helper, look for an existing one in `src/lib/`.
- User-facing text is Swedish and written for friends, not formal.

### Comments

- Explain why, not what. State the invariant the code relies on.
- Keep them short; a comment longer than the code it explains is a smell.
- No history ("previously…", "changed to fix…"); that goes in the commit message.
- Update or delete comments your change made wrong. Keep existing "why" comments that are still true.

## Security defaults

- **Fail closed.** A missing `APP_PASSWORD` or an unreadable cookie means locked, never open.
- **Bound everything a caller controls**: message length, list sizes, cell counts, image size (`MAX_MESSAGE_LENGTH`, `MAX_MESSAGES`, `MAX_CELLS`, `MAX_IMAGE_BASE64_LENGTH`).
- **Never show raw errors** from Gemini, Supabase or the runtime to users. Log them and show a generic Swedish message; throw `AnalyzeError` only for messages that are safe to show.
- **Secrets stay server-side.** Only `NEXT_PUBLIC_*` values reach the browser, and the Supabase key must be the publishable one. Anything derived from `APP_PASSWORD` must not be prerendered into build output.

## Compatibility

After a deploy, browser tabs that are already open keep running the old JavaScript, and they share the room with tabs running the new code.

- Peers ignore events they don't know and drop payloads that fail validation. Adding an optional field or a new event is safe; renaming or removing a field, or making one required, silently breaks sync between old and new tabs.
- Changing `APP_PASSWORD` logs everyone out and moves the room to a new topic.

## Testing

All changes need tests. Tests must be able to fail: use distinct values per case, include negative cases, and drive the production code path.

- Vitest runs in the `node` environment by default; component and hook tests opt into jsdom with a `// @vitest-environment jsdom` first line.
- Realtime tests mock `@/lib/supabase` with `createFakeSupabase()` from `src/test/fakeSupabase.ts`, which simulates channel status changes and peer broadcasts. See `src/hooks/useCrosswordRoom.test.tsx` for the pattern. Shared test data lives in `src/test/fixtures.ts`.
- Component tests use Testing Library and assert behavior: what the user sees, and what a click or keystroke sends. Don't assert values the test itself defined.
- Route handlers are tested by calling the exported `GET`/`POST` directly, not through a server.

## Pull requests

- Titles follow Conventional Commits: `feat: ...`, `fix: ...`, `chore: ...`, `ci: ...`, `docs: ...`, `test: ...`, `refactor: ...`, with an optional scope such as `fix(sync): ...`. `.github/workflows/pr-title.yml` checks this.
- Merging to `main` deploys to production immediately. Say in the PR if anything must happen first, such as a new GitHub variable or `wrangler secret`.
- Keep a PR to one feature or fix, with no drive-by refactors.
- The description says what changed, why, and how it was verified (commands run; screenshots for UI changes). Keep it accurate as the code changes.
- Call out anything that breaks old open tabs (see "Compatibility").

## Before you finish

- [ ] `pnpm lint`, `pnpm typecheck` and `pnpm test` pass
- [ ] `pnpm preview` checked, if you changed anything in the "next.config.ts, proxy.ts…" row above
- [ ] The follow-ups in "After changing X" are done
- [ ] New code has tests; comments you added explain why and contain no history

If a test fails in code you don't think you touched, keep going with the rest of the work, but tell the user and resolve it before calling the task done.

When you finish a task that produced a diff, ask the user once whether to run a code review (in Claude Code, the `/code-review` skill). Don't run it automatically, and skip this for read-only work or if the user already declined in this session.
