import { Grid3x3 } from "lucide-react";
import type { ReactNode } from "react";

/**
 * The banner, the title (which leads to all the crosswords) and "Byt namn",
 * with `actions` before it. `className` sets its display, so a room can hide it.
 */
export function AppHeader({
  nickname,
  onHome,
  onLeave,
  actions,
  className = "grid",
}: {
  nickname: string;
  onHome: () => void;
  onLeave: () => void;
  actions?: ReactNode;
  className?: string;
}) {
  return (
    // Phones have no room beside the title and buttons, so the photo gets its own row above them.
    <header
      className={`${className} shrink-0 grid-cols-[minmax(0,1fr)_auto] items-center gap-3 border-b border-slate-800 px-4 py-3 sm:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] sm:px-5`}
    >
      {/* Decoration only. The still frame stands in when the user asks for less motion. */}
      <picture className="col-span-2 justify-self-center sm:col-span-1 sm:col-start-2 sm:row-start-1">
        <source media="(prefers-reduced-motion: reduce)" srcSet="/banner-still.webp" />
        {/* Square crop of a portrait photo; 30% from the top keeps the whole face in. */}
        <img src="/banner.webp" alt="" className="size-24 rounded-2xl object-cover object-[50%_30%] sm:size-28 lg:size-32" />
      </picture>
      <button
        type="button"
        onClick={onHome}
        aria-label="Alla korsord"
        className="flex min-w-0 items-center gap-3 text-left sm:row-start-1"
      >
        {/* Phones need the room for the buttons beside the title. */}
        <span className="hidden size-10 shrink-0 items-center justify-center rounded-2xl bg-sky-400/15 text-sky-300 sm:flex">
          <Grid3x3 className="size-5" />
        </span>
        <span className="min-w-0">
          <span className="block truncate text-sm font-semibold text-slate-50">Heyus Fredagskryss</span>
          <span className="block truncate text-xs text-slate-400">Inloggad som {nickname}</span>
        </span>
      </button>
      <div className="flex items-center justify-end gap-2 sm:col-start-3 sm:row-start-1">
        {actions}
        <button
          type="button"
          onClick={onLeave}
          className="min-h-9 shrink-0 rounded-full border border-slate-700 px-3 text-xs font-semibold text-slate-300 transition hover:border-slate-500 hover:text-white"
        >
          Byt namn
        </button>
      </div>
    </header>
  );
}
