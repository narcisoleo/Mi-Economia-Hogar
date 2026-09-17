"use client";

import { createClient } from "@/lib/supabase/client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

export function LoginForm() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const router = useRouter();

  const handleLogin = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    const supabase = createClient();

    setIsLoading(true);
    setError(null);

    try {
      const { error: loginError } = await supabase.auth.signInWithPassword({
        email,
        password,
      });

      if (loginError) {
        throw loginError;
      }

      const { data: aalData, error: aalError } =
        await supabase.auth.mfa.getAuthenticatorAssuranceLevel();

      if (aalError) {
        throw aalError;
      }

      if (aalData?.currentLevel === "aal1" && aalData?.nextLevel === "aal2") {
        router.push("/auth/mfa");
      } else {
        router.push("/dashboard");
      }
      router.refresh();
    } catch (loginError: unknown) {
      setError(
        loginError instanceof Error
          ? loginError.message
          : "No se pudo iniciar sesión.",
      );
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <section className="overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-sm">
      <div className="border-b border-slate-200 px-6 py-6 sm:px-8">
        <p className="text-sm font-semibold uppercase tracking-[0.18em] text-slate-500">
          Finanzas familiares
        </p>

        <h1 className="mt-2 text-3xl font-bold tracking-tight text-slate-950">
          ECO HOGAR
        </h1>

        <p className="mt-2 text-sm leading-6 text-slate-600">
          Ingresá con tu cuenta para administrar los movimientos del hogar.
        </p>
      </div>

      <form onSubmit={handleLogin} className="space-y-5 px-6 py-6 sm:px-8">
        <div>
          <label
            htmlFor="email"
            className="mb-2 block text-sm font-semibold text-slate-700"
          >
            Email
          </label>

          <input
            id="email"
            type="email"
            autoComplete="email"
            placeholder="tu@email.com"
            required
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            className="w-full rounded-xl border border-slate-300 bg-white px-4 py-3.5 text-slate-950 outline-none placeholder:text-slate-400 focus:border-slate-500 focus:ring-2 focus:ring-slate-200"
          />
        </div>

        <div>
          <div className="mb-2 flex items-center justify-between gap-4">
            <label
              htmlFor="password"
              className="block text-sm font-semibold text-slate-700"
            >
              Contraseña
            </label>

            <Link
              href="/auth/forgot-password"
              className="text-sm font-medium text-slate-600 underline-offset-4 hover:text-slate-950 hover:underline"
            >
              ¿La olvidaste?
            </Link>
          </div>

          <input
            id="password"
            type="password"
            autoComplete="current-password"
            required
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            className="w-full rounded-xl border border-slate-300 bg-white px-4 py-3.5 text-slate-950 outline-none focus:border-slate-500 focus:ring-2 focus:ring-slate-200"
          />
        </div>

        {error && (
          <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-medium text-red-700">
            {error}
          </div>
        )}

        <button
          type="submit"
          disabled={isLoading}
          className="w-full rounded-xl bg-slate-950 px-5 py-3.5 font-semibold text-white shadow-sm transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {isLoading ? "Ingresando..." : "Ingresar"}
        </button>
      </form>
    </section>
  );
}
