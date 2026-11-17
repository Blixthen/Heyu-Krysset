# Heyus Fredagskryss

Solve a crossword together in real time. One person photographs the puzzle,
the app finds the letter squares, and everyone who opens its link types into
the same grid and chats alongside it. Each crossword has a room of its own;
the start page lists the past week's.

## Getting started

Requires Node 26 (see `.nvmrc`) and pnpm 12. If you don't have pnpm, install
it with `npx get-pnpm`.

```bash
cp .env.example .env.local   # fill in the values
pnpm install
pnpm dev
```

Open <http://localhost:3000> and enter `APP_PASSWORD`.

## Scripts

| Script            | What it does                                   |
| ----------------- | ---------------------------------------------- |
| `pnpm dev`        | Start the dev server                           |
| `pnpm build`      | Production build                               |
| `pnpm test`       | Run the Vitest suite                           |
| `pnpm lint`       | ESLint                                         |
| `pnpm typecheck`  | Generate Next route types, then `tsc --noEmit` |
| `pnpm preview`    | Build and run on the local Workers runtime     |
| `pnpm run deploy` | Build and deploy to Cloudflare Workers         |

`pnpm deploy` is a built-in pnpm command, so the deploy script needs `pnpm run`.

Pull requests run lint, typecheck, tests and the Workers build in GitHub
Actions (`.github/workflows/ci.yml`).

## Deploying

Pushes to `main` deploy to Cloudflare Workers through GitHub Actions
(`.github/workflows/deploy.yml`), whoever the commit author is. One-time setup:

1. In GitHub, add the repository secrets `CLOUDFLARE_API_TOKEN` (from the
   "Edit Cloudflare Workers" template) and `CLOUDFLARE_ACCOUNT_ID`, plus the
   repository variables `NEXT_PUBLIC_SUPABASE_URL` and
   `NEXT_PUBLIC_SUPABASE_ANON_KEY`.
2. Create the R2 bucket for crossword photos, puzzles, their letters and each room's chat, named `heyu` (bound
   as `PHOTOS` in `wrangler.jsonc`), and let them expire after 7 days:
   `pnpm exec wrangler r2 bucket create heyu`,
   `pnpm exec wrangler r2 bucket lifecycle add heyu expire-photos photos/ --expire-days 7`,
   `pnpm exec wrangler r2 bucket lifecycle add heyu expire-puzzles puzzles/ --expire-days 7`,
   `pnpm exec wrangler r2 bucket lifecycle add heyu expire-letters letters/ --expire-days 7` and
   `pnpm exec wrangler r2 bucket lifecycle add heyu expire-chat chat/ --expire-days 7`.
   R2 counts the days from an object's last write, so a room's chat lasts
   7 days from its latest message.
3. After the first deploy, set the runtime secrets:
   `pnpm exec wrangler secret put APP_PASSWORD` and
   `pnpm exec wrangler secret put GEMINI_API_KEY`.

To run on the local Workers runtime, put those two secrets in `.dev.vars` and
use `pnpm preview`.

## How it fits together

- **Password gate**: `src/proxy.ts` blocks everything except `/login` and
  `/api/unlock` until the visitor has the `heyu_gate` cookie, an HMAC of
  `APP_PASSWORD`.
- **Rooms**: clients fetch a secret topic from `/api/room` (behind the gate),
  so the public Supabase anon key alone is not enough to join, and add the
  crossword's id to it (`src/lib/room.ts`): each crossword is its own room,
  with its own chat. Starting a crossword over stays in its room.
- **Analysis**: the browser reads the letter squares from the photo's pixels
  (`src/lib/gridImage.ts`). If it finds no grid, `/api/analyze-crossword`
  sends the photo to Gemini and returns validated letter cells
  (`src/lib/analyze.ts`).
- **Photos**: the browser uploads a sharp copy of the photo to `/api/photo`
  (behind the gate), which stores it in the R2 bucket; the puzzle carries only
  its id, plus a small inline copy.
- **Links**: the uploader also saves the puzzle to `/api/puzzle`, and
  `/p/<id>` opens its room, even after everyone has left. The address bar
  shows the current puzzle's link. `/api/puzzles` lists the recent ones for
  the start page, from metadata stored beside each puzzle.
- **Sync**: peers exchange chat messages, letters and the puzzle over Supabase
  Realtime broadcast (`src/hooks/useCrosswordRoom.ts`). When a client joins it
  asks the room for the current puzzle, and loads the room's stored chat
  (`src/lib/storedChat.ts`), so a late joiner or someone who dropped out sees
  what was said. Within a room the newest puzzle wins (a crossword started
  over) and letters are merged (`src/lib/board.ts`). Every payload from a peer
  is validated before use.

### Known limitations

- A puzzle's link brings back the puzzle, its letters and the room's chat
  until they expire.
- Anyone with the password is trusted: they can open any crossword, start it
  over, or use any nickname.
