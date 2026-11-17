import { readBounded } from "@/lib/bytes";
import { isRandomId } from "@/lib/photo";
import {
  checkChatUpload,
  chatKey,
  EMPTY_CHAT,
  isEmptyChat,
  MAX_CHAT_BYTES,
  mergeChat,
  missingFrom,
  readStoredChat,
  type StoredChat,
} from "@/lib/storedChat";
import { puzzleKey } from "@/lib/storedPuzzle";
import { NextResponse } from "next/server";
import { storageBucket } from "../../../storage";

const SAVE_FAILURE = "Chatten kunde inte sparas.";
const LOAD_FAILURE = "Kunde inte hämta chatten.";
const NO_ROOM = "Rummet finns inte.";

/**
 * Saves that lose to a concurrent one read again and retry this often. Each
 * attempt is a read and a write, well within the Worker's subrequest limit.
 */
const MAX_SAVE_ATTEMPTS = 4;

type Context = { params: Promise<{ id: string }> };

function failure(message: string, status: number) {
  return NextResponse.json({ error: message }, { status, headers: { "Cache-Control": "no-store" } });
}

type Bucket = NonNullable<Awaited<ReturnType<typeof storageBucket>>>;

/**
 * The stored chat and its etag, or no etag when there is none. What is no
 * longer valid in it is left out (readStoredChat), and the next save drops it.
 */
async function readChat(bucket: Bucket, room: string): Promise<{ chat: StoredChat; etag?: string }> {
  const object = await bucket.get(chatKey(room));
  if (!object) return { chat: EMPTY_CHAT };
  let parsed: unknown = null;
  try {
    parsed = JSON.parse(await new Response(object.body).text());
  } catch {
    // Nothing in it can be read, so nothing is lost by replacing it.
    console.error("chat: stored chat is unreadable", room);
  }
  return { chat: readStoredChat(parsed, Date.now()), etag: object.etag };
}

/**
 * Adds messages and reactions to a room's stored chat. Gated by the proxy.
 * The upload is merged into what is stored (mergeChat), so saves in any
 * order, or the same one twice, give the same chat. The write is conditional
 * on what was read, so a concurrent save can't be overwritten; the loser
 * reads again and retries.
 */
export async function POST(request: Request, { params }: Context) {
  const { id } = await params;
  if (!isRandomId(id)) return failure(NO_ROOM, 404);
  const bucket = await storageBucket();
  if (!bucket) {
    console.error("chat: the PHOTOS bucket binding is missing");
    return failure(SAVE_FAILURE, 500);
  }

  let body: unknown;
  try {
    const bytes = await readBounded(request.body, MAX_CHAT_BYTES);
    if (bytes === "too-large") return failure(SAVE_FAILURE, 413);
    body = JSON.parse(new TextDecoder().decode(bytes));
  } catch (error) {
    console.warn("chat: unreadable upload", error instanceof Error ? error.name : typeof error);
    return failure(SAVE_FAILURE, 400);
  }
  const upload = checkChatUpload(body, Date.now());
  if (!upload.ok) return failure(upload.error.message, upload.error.status);

  try {
    for (let attempt = 0; attempt < MAX_SAVE_ATTEMPTS; attempt += 1) {
      const { chat, etag } = await readChat(bucket, id);
      // A room is named by its first puzzle, so chats never pile up under ids nobody can open.
      if (etag === undefined && !(await bucket.head(puzzleKey(id)))) return failure(NO_ROOM, 404);
      // Most saves after a reconnect add nothing; they cost no write.
      if (etag !== undefined && isEmptyChat(missingFrom(chat, upload.value))) return new NextResponse(null, { status: 204 });
      const merged = mergeChat(chat, upload.value);
      const written = await bucket.put(chatKey(id), new TextEncoder().encode(JSON.stringify(merged)), {
        httpMetadata: { contentType: "application/json" },
        onlyIf: etag === undefined ? { etagDoesNotMatch: "*" } : { etagMatches: etag },
      });
      if (written) return new NextResponse(null, { status: 204 });
    }
  } catch (error) {
    console.error("chat: storing failed", error);
    return failure(SAVE_FAILURE, 502);
  }
  console.warn("chat: gave up after concurrent saves", id);
  return failure(SAVE_FAILURE, 409);
}

/** Loads a room's stored chat; an empty one if nothing is stored yet. */
export async function GET(_request: Request, { params }: Context) {
  const { id } = await params;
  if (!isRandomId(id)) return failure(NO_ROOM, 404);
  const bucket = await storageBucket();
  if (!bucket) {
    console.error("chat: the PHOTOS bucket binding is missing");
    return failure(LOAD_FAILURE, 500);
  }
  try {
    const { chat } = await readChat(bucket, id);
    return NextResponse.json(chat, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("chat: reading failed", error);
    return failure(LOAD_FAILURE, 502);
  }
}
