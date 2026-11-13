"use client";

import { dedupeCells, isLetterCell, MIN_CELLS, type CrosswordPuzzle, type LetterCell } from "@/lib/crossword";
import { readGrid, type Pixels } from "@/lib/gridImage";
import { prepareImages, prepareStoreCopy } from "@/lib/image";
import { isPhotoId } from "@/lib/photo";
import { Camera, ImagePlus, Loader2 } from "lucide-react";
import { useRef, useState, type ChangeEvent } from "react";

class UploadError extends Error {}

/** How long the sharp copy (about 0.7 MB) may take to upload; the puzzle is already shared by then. */
const STORE_TIMEOUT_MS = 60_000;

type Upload = Omit<Awaited<ReturnType<typeof prepareImages>>, "pixels">;

/**
 * Reads the grid from the photo's pixels in the browser, and asks Gemini only
 * when that finds no usable grid. Returns a puzzle ready to share.
 */
export async function analyzeCrossword(file: File): Promise<CrosswordPuzzle> {
  const { cells, upload } = await prepare(file);
  return {
    id: crypto.randomUUID(),
    createdAt: Date.now(),
    image: upload.shareDataUrl,
    cells: cells ?? (await askGemini(upload)),
  };
}

/**
 * Makes and uploads a sharp copy of the photo and returns its id, or null if
 * that fails. Runs after the puzzle is shared, so it never delays it or
 * competes with the Gemini request, and is skipped for a photo that couldn't
 * be read; the inline copy still works, only less sharp.
 */
export async function storePhoto(file: File): Promise<string | null> {
  const blob = await prepareStoreCopy(file);
  if (!blob) return null;
  try {
    const response = await fetch("/api/photo", {
      method: "POST",
      headers: { "Content-Type": "image/jpeg" },
      body: blob,
      // The puzzle waits for this, and is fine without it, so don't wait long.
      signal: AbortSignal.timeout(STORE_TIMEOUT_MS),
    });
    const id = ((await response.json().catch(() => null)) as { id?: unknown } | null)?.id;
    if (response.ok && isPhotoId(id)) return id;
    console.warn("Storing the photo failed", response.status);
  } catch (error) {
    console.warn("Storing the photo failed", error);
  }
  return null;
}

/**
 * Prepares the images and reads the grid. The pixel buffer (about 11 MB at
 * 1400 px) stays inside this call, so it can be freed before any Gemini
 * request, which may take seconds on a phone that is short of memory.
 */
async function prepare(file: File): Promise<{ cells: LetterCell[] | null; upload: Upload }> {
  let images: Awaited<ReturnType<typeof prepareImages>>;
  try {
    images = await prepareImages(file);
  } catch {
    throw new UploadError("Kunde inte läsa bilden. Prova en JPEG- eller PNG-bild.");
  }
  const { pixels, ...upload } = images;
  return { cells: pixels ? readLocally(pixels) : null, upload };
}

function readLocally(pixels: Pixels) {
  try {
    const cells = readGrid(pixels);
    if (!cells) console.info("No grid found in the photo; asking Gemini.");
    return cells;
  } catch (error) {
    // A bug in the grid reading shouldn't stop the upload while Gemini can still read it.
    console.error(error);
    return null;
  }
}

async function askGemini(images: Upload): Promise<LetterCell[]> {
  let response: Response;
  try {
    response = await fetch("/api/analyze-crossword", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ image: images.analyzeBase64, mimeType: images.mimeType }),
      signal: AbortSignal.timeout(70_000),
    });
  } catch (error) {
    const timedOut = error instanceof DOMException && (error.name === "TimeoutError" || error.name === "AbortError");
    throw new UploadError(timedOut ? "Tolkningen tog för lång tid. Försök igen." : "Kunde inte skicka bilden.");
  }

  const data: unknown = await response.json().catch(() => null);
  const cells = (data as { cells?: unknown } | null)?.cells;
  if (response.ok && Array.isArray(cells) && cells.length >= MIN_CELLS && cells.every(isLetterCell)) {
    return dedupeCells(cells);
  }
  const error = (data as { error?: unknown } | null)?.error;
  throw new UploadError(typeof error === "string" ? error : "Kunde inte tolka bilden.");
}

/**
 * Saves the puzzle behind its permanent link. Best effort: the room works
 * without it, only the link won't open the puzzle once everyone has left.
 */
export async function savePuzzle(puzzle: CrosswordPuzzle): Promise<boolean> {
  try {
    const response = await fetch("/api/puzzle", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(puzzle),
      signal: AbortSignal.timeout(STORE_TIMEOUT_MS),
    });
    if (response.ok) return true;
    console.warn("Saving the puzzle failed", response.status);
  } catch (error) {
    console.warn("Saving the puzzle failed", error);
  }
  return false;
}

/**
 * Saves a shared puzzle behind its link straight away, since the address bar
 * shows the link at once, then stores the photo and saves the puzzle again
 * with its id (the only change a second save may make).
 */
async function keepPuzzle(puzzle: CrosswordPuzzle, file: File, onPhoto?: (puzzleId: string, photo: string) => void) {
  const saved = savePuzzle(puzzle);
  const photo = await storePhoto(file);
  if (!photo) return;
  onPhoto?.(puzzle.id, photo);
  await saved;
  await savePuzzle({ ...puzzle, photo });
}

export function PuzzleUploader({
  compact = false,
  onPuzzle,
  onPhoto,
}: {
  compact?: boolean;
  onPuzzle: (puzzle: CrosswordPuzzle) => void;
  /** The sharp copy of a shared puzzle's photo was stored. */
  onPhoto?: (puzzleId: string, photo: string) => void;
}) {
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [error, setError] = useState("");
  const cameraInputRef = useRef<HTMLInputElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  async function onFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    setIsAnalyzing(true);
    setError("");
    try {
      const puzzle = await analyzeCrossword(file);
      onPuzzle(puzzle);
      void keepPuzzle(puzzle, file, onPhoto);
    } catch (failure) {
      if (!(failure instanceof UploadError)) console.error(failure);
      setError(failure instanceof UploadError ? failure.message : "Något gick fel. Försök igen.");
    } finally {
      setIsAnalyzing(false);
    }
  }

  const inputs = (
    <>
      <input ref={cameraInputRef} type="file" accept="image/*" capture="environment" className="hidden" onChange={onFile} />
      <input ref={fileInputRef} type="file" accept="image/*" className="hidden" onChange={onFile} data-testid="file-input" />
    </>
  );

  if (compact) {
    return (
      <div className="flex items-center gap-2">
        {inputs}
        {error ? <p className="text-xs text-rose-300">{error}</p> : null}
        <button
          type="button"
          disabled={isAnalyzing}
          onClick={() => fileInputRef.current?.click()}
          className="inline-flex min-h-9 items-center gap-1.5 rounded-full border border-slate-700 px-3 text-xs font-semibold text-slate-300 transition hover:border-slate-500 hover:text-white disabled:cursor-wait"
        >
          {isAnalyzing ? <Loader2 className="size-3.5 animate-spin" /> : <ImagePlus className="size-3.5" />}
          {isAnalyzing ? "Tolkar…" : "Nytt korsord"}
        </button>
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 w-full flex-col items-center justify-center overflow-auto rounded-3xl border border-dashed border-slate-700 bg-slate-900/50 px-5 py-8 text-center">
      {inputs}
      <h2 className="text-2xl font-semibold tracking-tight text-slate-50">Här hamnar korsordet</h2>
      <p className="mt-3 max-w-md text-sm leading-6 text-slate-400">
        {isAnalyzing
          ? "Läser av rutnätet. Det tar en liten stund."
          : "Fota korsordet eller ladda upp en skärmdump. Bilden blir kvar, och ni skriver i rutorna."}
      </p>
      <div className="mt-6 flex flex-wrap items-center justify-center gap-2">
        <button
          type="button"
          disabled={isAnalyzing}
          onClick={() => cameraInputRef.current?.click()}
          className="inline-flex min-h-12 touch-manipulation items-center gap-2 rounded-2xl bg-sky-400 px-4 py-3 text-base font-medium text-slate-950 transition hover:bg-sky-300 disabled:cursor-wait disabled:bg-slate-700 disabled:text-slate-300"
        >
          {isAnalyzing ? <Loader2 className="size-4 animate-spin" /> : <Camera className="size-4" />}
          {isAnalyzing ? "Tolkar…" : "Ta foto"}
        </button>
        <button
          type="button"
          disabled={isAnalyzing}
          onClick={() => fileInputRef.current?.click()}
          className="inline-flex min-h-12 touch-manipulation items-center gap-2 rounded-2xl border border-slate-600 px-4 py-3 text-base font-medium text-slate-100 transition hover:border-slate-400 disabled:cursor-wait disabled:text-slate-500"
        >
          <ImagePlus className="size-4" />
          Ladda upp bild
        </button>
      </div>
      {error ? <p className="mt-3 max-w-md text-sm text-rose-300">{error}</p> : null}
    </div>
  );
}
