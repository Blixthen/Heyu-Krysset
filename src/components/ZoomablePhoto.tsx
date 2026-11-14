"use client";

import { useZoom } from "@/hooks/useZoom";
import type { LetterCell } from "@/lib/crossword";
import { BASE_WIDTH_PX } from "@/lib/zoom";
import { useRef, type ReactNode } from "react";

/** Places a square over the photo: cells are in thousandths of it, so they scale with the photo as it zooms. */
export function cellPlacement(cell: LetterCell) {
  return { left: `${cell.x / 10}%`, top: `${cell.y / 10}%`, width: `${cell.w / 10}%`, height: `${cell.h / 10}%` };
}

/**
 * The crossword photo in a view each player zooms and pans on their own
 * (useZoom), with `children` laid over it, placed with cellPlacement.
 */
export function ZoomablePhoto({ image, children }: { image: string; children: ReactNode }) {
  const viewRef = useRef<HTMLDivElement>(null);
  const { zoom, zoomIn, zoomOut, reset } = useZoom(viewRef);
  return (
    <div className="relative h-full max-h-full w-full">
      <div
        ref={viewRef}
        className="h-full max-h-full w-full touch-pan-x touch-pan-y overflow-auto overscroll-contain [-webkit-overflow-scrolling:touch]"
      >
        {/* A size container, so letters can grow with their squares (cqw). */}
        <div className="@container relative mx-auto" style={{ width: `calc(max(100%, ${BASE_WIDTH_PX}px) * ${zoom})` }}>
          {/* A data: URL, made from the photo here or by a peer; next/image cannot optimize it. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={image} alt="Korsordet" className="block h-auto w-full select-none" />
          {children}
        </div>
      </div>
      <div className="absolute top-2 right-2 flex overflow-hidden rounded-lg border border-slate-700 bg-slate-900/85 text-sm text-slate-100 shadow-lg backdrop-blur">
        <button type="button" onClick={zoomOut} aria-label="Zooma ut" className="px-3 py-1.5 hover:bg-slate-800">
          −
        </button>
        <button type="button" onClick={reset} aria-label="Återställ zoom" className="min-w-14 px-2 py-1.5 tabular-nums hover:bg-slate-800">
          {Math.round(zoom * 100)} %
        </button>
        <button type="button" onClick={zoomIn} aria-label="Zooma in" className="px-3 py-1.5 hover:bg-slate-800">
          +
        </button>
      </div>
    </div>
  );
}
