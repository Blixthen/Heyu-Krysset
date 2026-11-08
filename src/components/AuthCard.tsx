import { Grid3x3 } from "lucide-react";
import type { ReactNode } from "react";

/** Centered card used by the login and nickname screens. */
export function AuthCard({
  title,
  description,
  showGrid = false,
  children,
}: {
  title: string;
  description: string;
  showGrid?: boolean;
  children: ReactNode;
}) {
  return (
    <main className="relative flex min-h-dvh flex-1 items-center justify-center overflow-y-auto px-4 py-8">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top,_rgba(56,189,248,0.16),_transparent_42%),radial-gradient(circle_at_bottom_right,_rgba(168,85,247,0.14),_transparent_36%)]" />
      {showGrid ? (
        <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(to_right,rgba(148,163,184,0.08)_1px,transparent_1px),linear-gradient(to_bottom,rgba(148,163,184,0.08)_1px,transparent_1px)] bg-[size:28px_28px] [mask-image:radial-gradient(ellipse_at_center,black,transparent_75%)]" />
      ) : null}
      <section className="relative w-full max-w-md rounded-3xl border border-slate-800 bg-slate-900/80 p-8 shadow-2xl shadow-black/40 backdrop-blur">
        <div className="mb-8 flex items-center gap-3">
          <span className="flex size-11 items-center justify-center rounded-2xl bg-sky-400/15 text-sky-300">
            <Grid3x3 className="size-5" />
          </span>
          <div>
            <p className="text-xs font-medium text-sky-300">Heyus Fredagskryss</p>
            <h1 className="text-2xl font-semibold tracking-tight text-slate-50">{title}</h1>
          </div>
        </div>
        <p className="mb-6 text-sm leading-6 text-slate-400">{description}</p>
        {children}
      </section>
    </main>
  );
}

export const inputClassName =
  "w-full rounded-2xl border border-slate-700 bg-slate-950 px-4 py-3 text-base text-slate-100 outline-none ring-sky-400/40 placeholder:text-slate-600 focus:border-sky-400 focus:ring-4";

export const primaryButtonClassName =
  "flex min-h-12 w-full touch-manipulation items-center justify-center gap-2 rounded-2xl bg-sky-400 px-4 py-3 text-base font-medium text-slate-950 transition hover:bg-sky-300 disabled:cursor-not-allowed disabled:bg-slate-700 disabled:text-slate-400";
