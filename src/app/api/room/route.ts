import { roomTopic } from "@/lib/gate";
import { connection, NextResponse } from "next/server";

/**
 * Returns the realtime channel name. Gated by the proxy, so only clients that
 * know the app password learn it.
 */
export async function GET() {
  // Opt out of prerendering: the topic is derived from a secret and must
  // never be baked into build output.
  await connection();
  const password = process.env.APP_PASSWORD;
  if (!password) {
    return NextResponse.json({ error: "Servern saknar lösenord." }, { status: 500 });
  }
  return NextResponse.json(
    { topic: roomTopic(password) },
    { headers: { "Cache-Control": "no-store" } },
  );
}
