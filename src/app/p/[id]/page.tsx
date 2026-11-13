import { App } from "@/components/App";
import { isRandomId } from "@/lib/photo";
import { notFound } from "next/navigation";

/** A stored puzzle's permanent link: the app, opening that puzzle. */
export default async function PuzzlePage({ params }: PageProps<"/p/[id]">) {
  const { id } = await params;
  if (!isRandomId(id)) notFound();
  return <App linkedPuzzleId={id} />;
}
