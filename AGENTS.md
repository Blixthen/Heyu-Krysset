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

There is no database and no server-side room state. The server does three things: it gates access, hands out the realtime channel name, and stores crossword photos, puzzles, their letters and each room's chat in R2. Everything else happens between browsers over Supabase Realtime broadcast.

**Password gate.** `src/proxy.ts` (Next 16's replacement for `middleware.ts`) lets only `/login` and `/api/unlock` through without the `heyu_gate` cookie, which is an HMAC of `APP_PASSWORD` (`src/lib/gate.ts`). Changing the password invalidates every cookie and also changes the room topic.

**Rooms.** Each crossword has a room of its own: its realtime channel, with its own chat, letters and players. `/api/room` returns a topic derived from `APP_PASSWORD`, and the client adds the room to it (`roomChannel` in `src/lib/room.ts`). The Supabase anon key ships to the browser, so the secret topic is what keeps outsiders out; the puzzle id in every link isn't enough. The topic must never be prerendered (`connection()` opts the route out). `src/lib/supabase.ts` refuses `sb_secret_` keys. A room is named by its first puzzle (`roomOf`): a copy started over names it in `restartOf`, so starting over keeps everyone in the room. `App` shows the start page (`Home`: the uploader and the recent crosswords) or one crossword's `Room`, keyed by its link, and moves between them with `history.pushState`, so a crossword just shared opens in its room straight away. A crossword shared from inside a room opens a new room; the old one keeps its puzzle.

**Sync protocol** (`src/hooks/useCrosswordRoom.ts`), within one room. The hook connects only once it knows the room. Broadcast events are `message`, `puzzle` (full board: puzzle, letters, and who typed each), `cell-update` (one letter and its author), `sync-request` and `reaction` (one player adding or removing an emoji on a chat message). Each client also tracks `{ nickname }` with Supabase Presence, keyed by a per-tab id, so everyone in the room gets a player colour before they type. Messages and reactions carry the browser's own id instead (`senderId` in `src/lib/sender.ts`, kept in `localStorage`), so stored ones stay the player's after a reload. On subscribe, a client broadcasts its board and sends `sync-request`; peers answer after a random jitter, and the rest cancel when they see an answer. Reconnects use exponential backoff, and a 401 from `/api/room` sends the user to `/login`.

**Conflict resolution** lives in the pure `boardReducer` (`src/lib/board.ts`): a different puzzle in the room (a copy started over, or an older link opened for everyone) replaces ours only if its `createdAt` is newer, and the same puzzle merges letters with local values winning, each letter keeping its own author, and takes a peer's stored photo id if ours has none. A photo stored for a puzzle also lands on a copy that starts it over (`restartOf`, `photoBelongsTo`), since "Börja om" can come before the upload finishes. Authors are optional, because tabs from before they existed send none. Keep these rules there, not in the hook.

**Stored chat.** Each room's messages and reactions are stored under `chat/<room>.json` (`GET`/`POST /api/room/<room>/chat`), so whoever joins late or drops out sees what was said. The hook loads it on every subscribe and stores back what it has that the store lacks (`missingFrom`); a sender saves its own message or reaction once broadcast (`useChatSaving`, one request at a time). The store needs no log because `mergeChat` (`src/lib/storedChat.ts`) is a CRDT merge: messages are a set that only grows, and each reaction keeps its highest `version`, so saves give the same chat in any order and however often they repeat. Only the sender changes its own reaction, so its version comes from the sender's clock (`nextVersion`, persisted by `takeReactionVersion`) and is never compared across devices; peers and the server leave out versions more than `MAX_VERSION_AHEAD_MS` ahead, so nobody can pin a reaction. Removals stay as tombstones, so a late older "on" can't bring one back. Saved and loaded chats are checked item by item (`checkChatUpload`, `readStoredChat`), so one item another clock or a tightened rule rules out never costs the rest. The route merges into what it read and writes with `onlyIf`, retrying if a concurrent save won. History from a room's first load is marked so it doesn't count as unread. Keep these rules in `storedChat.ts` and `reactions.ts`, not in the route or hook.

**Untrusted payloads.** Every peer payload is validated and copied field by field before use (`isChatMessage`/`toChatMessage` in `src/lib/chat.ts`, `isReaction`/`toReaction` in `src/lib/reactions.ts`, `checkChatUpload` in `src/lib/storedChat.ts` for the stored chat, `onlineNames` in `src/lib/players.ts` for presence, `isCrosswordPuzzle`/`toCrosswordPuzzle`/`isCellUpdate`/`authorsFromPayload` in `src/lib/crossword.ts`). The same crossword validators check stored puzzles on the server, so that module and `src/lib/players.ts`, which it imports, must stay runtime-agnostic.

**Photo flow.** `src/lib/image.ts` prepares the photo in the browser: the pixels of the reading-size image, and a smaller JPEG, under `SHARE_IMAGE_BUDGET`, to broadcast, because Supabase limits broadcast payload size. `readGrid` (`src/lib/gridImage.ts`) reads the letter squares from the pixels in the browser, which keeps the work off the Worker's 10 ms CPU budget, and returns them in 0–1000 coordinates relative to the image. When it finds no usable grid, or the browser won't hand out the pixels, `PuzzleUploader` says so; there is no server fallback. The reading isn't perfect, so `PuzzleUploader` hands the read puzzle to `Home` or `Room` (`onRead`) instead of sharing it, and `CellEditor` lets that player remove squares and add ones next to them (`src/lib/cellEditing.ts`) before "Klar" opens it in its own room, where `keepPuzzle` stores it.

**Stored photos.** The broadcast copy is too small to read clue text when zoomed, so once the puzzle is shared, `keepPuzzle` (in `PuzzleUploader.tsx`) makes a sharp JPEG (`prepareStoreCopy` in `src/lib/image.ts`, capped in width and pixels) and uploads it to `POST /api/photo`, which checks it (`checkPhotoUpload` in `src/lib/photo.ts`) and stores it in the R2 bucket bound as `PHOTOS` (`wrangler.jsonc`). The hook's `attachPhoto` adds its id to the puzzle's optional `photo` field and shares the board again; `CrosswordGrid` loads it from `GET /api/photo/<id>` over the inline copy, and keeps the inline copy if it fails. Both routes are behind the password gate. The puzzle never waits for the upload and works without it. Photos expire through the bucket's lifecycle rule (README "Deploying"). Each player zooms the grid on their own (`useZoom`, with the math in `src/lib/zoom.ts`): the letter squares are placed in percentages of the photo, so they scale with it, and the view only allows one-finger panning so two-finger pinches reach the hook instead of zooming the page.

**Permanent links.** `keepPuzzle` saves a puzzle as soon as it is shared (`POST /api/puzzle`, checked by `checkPuzzleUpload` in `src/lib/storedPuzzle.ts`) under `puzzles/<id>.json`, and again once its photo is stored. The link is the only way the others reach a new crossword, so `Room` says when that first save fails and offers to retry. Each save also writes R2 custom metadata (`puzzleMetadata`), which `GET /api/puzzles` lists for the start page (`recentPuzzles`, one entry per room) without reading any puzzle: parsing their inline images wouldn't fit the Worker's CPU budget. The second save may only fill in the photo id (`compareStored`); both writes are conditional in R2 (`onlyIf`), so concurrent saves can't both win and nothing else about a stored puzzle ever changes. `/p/<id>` opens that puzzle's room; `useLinkedPuzzle` loads it, `Room` joins its room, and hands it to the hook's `restorePuzzle`, which treats it like a peer's board, so the usual `boardReducer` rules decide (it fills an empty room or joins the same puzzle, but a newer copy started over wins, and then `Room` offers to open the linked one for everyone). The address bar follows the room's current puzzle. The proxy carries a puzzle link through the login as `next`, which `safeNextPath` limits to `/` and `/p/<uuid>`. The letters are saved apart from the puzzle, under `letters/<id>.json` (`PUT`/`GET /api/puzzle/<id>/letters`, checked by `checkLettersUpload` in `src/lib/storedLetters.ts`), because the puzzle never changes and the letters always do; "Börja om" in `Room` shares such a copy (`restartedPuzzle`) and saves it, and the old link keeps the old letters. `useLetterSaving` saves them a moment after this player types, one save at a time and the last one winning, and `useLinkedPuzzle` loads them with the puzzle and hands both to `restorePuzzle`, so the merge rules decide as for a peer's board. Opening a linked puzzle the room had moved on from goes through `restorePuzzle` too, with its saved letters: loading it empty would let the next save wipe them. Saves go out one at a time per tab, and also when the tab is hidden, since phones often discard background tabs without `pagehide`. The hook keeps `boardRef` current with every action (`apply`), so callbacks that run before a render see the latest board.

## Cloudflare Workers constraints

Built with `@opennextjs/cloudflare` (`open-next.config.ts`, `wrangler.jsonc`).

- Do not enable `cacheComponents`: page renders hang on the Workers runtime.
- `src/proxy.ts` runs on OpenNext's experimental Node.js middleware support. After adapter upgrades, check the gate with `pnpm preview`.
- The Workers free plan allows 10 ms CPU per request and a 3 MiB gzipped Worker. `wrangler deploy --dry-run` reports the size.
- `NEXT_PUBLIC_SUPABASE_*` are inlined at build time, so they are GitHub Actions variables. `APP_PASSWORD` is a runtime secret, set with `wrangler secret put`.

## After changing X, also do Y

| You changed | Then |
| --- | --- |
| Dependencies | `pnpm install` and commit `pnpm-lock.yaml`; CI installs with `--frozen-lockfile` |
| A dependency that wants an install script | `pnpm install` stops with `ERR_PNPM_IGNORED_BUILDS`. Allow or deny it under `allowBuilds` in `pnpm-workspace.yaml`; only allow what the build or runtime needs |
| A realtime event or payload shape | Update its validator and copy function, `boardReducer` if it affects the board, and the hook tests. See "Compatibility" below |
| A route that must work without the password | Add it to `PUBLIC_PATHS` in `src/proxy.ts`, plus a test in `src/proxy.test.ts` |
| A Worker binding (`wrangler.jsonc`, such as the `PHOTOS` R2 bucket) | Its type in `src/cloudflare-env.d.ts`, and the README "Deploying" section if it needs creating in Cloudflare first |
| An environment variable | `.env.example`, the README "Deploying" section, and where it is set: GitHub Actions variables for `NEXT_PUBLIC_*` (and the build steps in both workflows), `wrangler secret put` for runtime secrets |
| `next.config.ts`, `proxy.ts`, or Next/OpenNext/wrangler versions | `pnpm preview` and check the login gate and the home page on the Workers runtime; `next build` passing does not prove it runs there |
| Grid detection (`src/lib/gridImage.ts`) | Run `pnpm test`: `src/lib/gridImage.test.ts` covers each rule on synthetic pages, and the photo tests in `src/test/crosswords/` must still find every labelled square, apart from a photo's `knownGridProblems` (update those when a change fixes one). Check new thresholds against the overlays each run writes to `src/test/crosswords/overlays/`, not just the labelled points |

## TypeScript conventions

- Validate `unknown` input (request bodies, peer payloads, stored data) with a type guard before use. Casting is only for reading fields while narrowing, never for treating unvalidated data as the target type.
- In app code, don't silence the type checker with `as unknown as`, `@ts-expect-error`, or non-null `!`; fix the type at its source.
- Name limits and timings as constants with a comment explaining the value (`MAX_MESSAGES`, `SHARE_IMAGE_BUDGET`, `SYNC_JITTER_MS`).
- Functional core, imperative shell: keep logic (state transitions, parsing, validation, decisions) in pure functions in `src/lib/` that take and return plain data, with no I/O, logging, `process.env`, clocks or randomness. Route handlers, hooks and components stay thin: gather inputs, call the core, act on the result.
- Return expected failures as values (`{ ok: true, value } | { ok: false, error }`, like `Result` in `src/lib/result.ts`), not thrown exceptions. Throwing is for effects that really fail, such as a network call.
- Test the pure core directly with plain inputs and no mocks; shell tests only cover the wiring.
- Before writing a helper, look for an existing one in `src/lib/`.
- User-facing text is Swedish and written for friends, not formal.

### Comments

- Explain why, not what. State the invariant the code relies on.
- Keep them short; a comment longer than the code it explains is a smell.
- No history ("previously…", "changed to fix…"); that goes in the commit message.
- Update or delete comments your change made wrong. Keep existing "why" comments that are still true.

## Security defaults

- **Fail closed.** A missing `APP_PASSWORD` or an unreadable cookie means locked, never open.
- **Bound everything a caller controls**: message length, list sizes, cell counts, image size (`MAX_MESSAGE_LENGTH`, `MAX_MESSAGES`, `MAX_CELLS`, `MAX_PHOTO_BYTES`).
- **Never show raw errors** from Supabase, R2 or the runtime to users. Log them and show a generic Swedish message; only put messages that are safe to show in a `UserFailure`.
- **Secrets stay server-side.** Only `NEXT_PUBLIC_*` values reach the browser, and the Supabase key must be the publishable one. Anything derived from `APP_PASSWORD` must not be prerendered into build output.

## Compatibility

After a deploy, browser tabs that are already open keep running the old JavaScript, and they share the room with tabs running the new code.

- Peers ignore events they don't know and drop payloads that fail validation. Adding an optional field or a new event is safe; renaming or removing a field, or making one required, silently breaks sync between old and new tabs.
- Changing `APP_PASSWORD` logs everyone out and moves every room to a new topic.
- Changing how a room's channel is named (`roomChannel`, `roomOf`) splits old and new tabs into different rooms until the old ones reload.

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
