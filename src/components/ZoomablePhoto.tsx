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
 * (useZoom), with `children` laid over it, placed with cellPlacement. The
 * zoom buttons sit in a row above the photo, with `toolbar` beside them:
 * laid over it they would cover the top squares, which can't scroll out
 * from under them.
 */
export function ZoomablePhoto({ image, toolbar, children }: { image: string; toolbar?: ReactNode; children: ReactNode }) {
  const viewRef = useRef<HTMLDivElement>(null);
  const { zoom, zoomIn, zoomOut, reset } = useZoom(viewRef);
  return (
    <div className="flex h-full max-h-full w-full flex-col gap-2">
      <div className="flex shrink-0 items-center justify-end gap-3">
        <div className="min-w-0 flex-1">{toolbar}</div>
        <div className="flex shrink-0 overflow-hidden rounded-lg border border-slate-700 bg-slate-900 text-sm text-slate-100">
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
      <div
        ref={viewRef}
        role="group"
        aria-label="Korsordet, zoomat"
        className="min-h-0 w-full flex-1 touch-pan-x touch-pan-y overflow-auto overscroll-contain [-webkit-overflow-scrolling:touch]"
      >
        {/* A size container, so letters can grow with their squares (cqw). */}
        <div className="@container relative mx-auto" style={{ width: `calc(max(100%, ${BASE_WIDTH_PX}px) * ${zoom})` }}>
          {/* A data: URL, made from the photo here or by a peer; next/image cannot optimize it. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={image} alt="Korsordet" className="block h-auto w-full select-none" />
          {children}
        </div>
      </div>
    </div>
  );
}
