/**
 * One colour per player slot (see assignColours): a faint tint behind the
 * letters they typed, mostly transparent so the printed square shows
 * through, and a solid dot for the legend. No sky, which marks the selected
 * word.
 */
export const PLAYER_COLOURS = [
  { tint: "bg-rose-300/40", dot: "bg-rose-300" },
  { tint: "bg-emerald-300/40", dot: "bg-emerald-300" },
  { tint: "bg-amber-300/40", dot: "bg-amber-300" },
  { tint: "bg-violet-300/40", dot: "bg-violet-300" },
  { tint: "bg-orange-300/40", dot: "bg-orange-300" },
  { tint: "bg-lime-300/40", dot: "bg-lime-300" },
  { tint: "bg-fuchsia-300/40", dot: "bg-fuchsia-300" },
  { tint: "bg-teal-300/40", dot: "bg-teal-300" },
] as const;

/** Who has which colour: the players who typed letters and those in the room. */
export function PlayerLegend({ colours }: { colours: Map<string, number> }) {
  if (colours.size === 0) return null;
  return (
    <ul aria-label="Spelare" className="flex shrink-0 gap-3 overflow-x-auto px-1 text-xs text-slate-300">
      {[...colours].map(([name, slot]) => (
        <li key={name} className="flex shrink-0 items-center gap-1.5">
          <span aria-hidden className={`size-2.5 rounded-full ${PLAYER_COLOURS[slot].dot}`} />
          {name}
        </li>
      ))}
    </ul>
  );
}
