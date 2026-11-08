import { AuthCard, inputClassName, primaryButtonClassName } from "@/components/AuthCard";
import { Suspense } from "react";

export default function LoginPage({ searchParams }: PageProps<"/login">) {
  return (
    <AuthCard title="Lösenord" description="Sidan är låst. Skriv lösenordet för att komma in till polarna.">
      <form action="/api/unlock" method="post" className="space-y-4">
        <label className="block">
          <span className="mb-2 block text-sm text-slate-300">Lösenord</span>
          <input
            autoFocus
            required
            type="password"
            name="password"
            autoComplete="current-password"
            className={inputClassName}
          />
        </label>
        <Suspense fallback={null}>
          <LoginError searchParams={searchParams} />
        </Suspense>
        <button type="submit" className={primaryButtonClassName}>
          Öppna
        </button>
      </form>
    </AuthCard>
  );
}

async function LoginError({ searchParams }: Pick<PageProps<"/login">, "searchParams">) {
  const { error } = await searchParams;
  return error ? <p className="text-sm text-rose-300">Fel lösenord. Försök igen.</p> : null;
}
