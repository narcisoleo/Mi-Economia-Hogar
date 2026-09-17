"use client";

import { createClient } from "@/lib/supabase/client";
import Link from "next/link";
import { useState } from "react";

export function ForgotPasswordForm() {
  const [email, setEmail] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [isLoading, setIsLoading] = useState(false);

  const handleForgotPassword = async (
    event: React.FormEvent<HTMLFormElement>,
  ) => {
    event.preventDefault();

    const supabase = createClient();

    setIsLoading(true);
    setError(null);

    try {
      const { error: resetError } = await supabase.auth.resetPasswordForEmail(
        email,
        {
          redirectTo: `${window.location.origin}/update-password`,
        },
      );

      if (resetError) {
        throw resetError;
      }

      setSuccess(true);
    } catch (resetError: unknown) {
      setError(
        resetError instanceof Error
          ? resetError.message
          : "No se pudo enviar el correo de recuperación.",
      );
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <section className="overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-sm">
      <div className="border-b border-slate-200 px-6 py-6 sm:px-8">
        <p className="text-sm font-semibold uppercase tracking-[0.18em] text-slate-500">
          ECO HOGAR
        </p>
        <h1 className="mt-2 text-2xl font-bold text-slate-950">
          Recuperar contraseña
        </h1>
      </div>

      {success ? (
        <div className="space-y-4 px-6 py-6 sm:px-8">
          <p className="text-sm leading-6 text-slate-600">
            Si el email pertenece a una cuenta registrada, vas a recibir un enlace para crear una contraseña nueva.
          </p>

          <Link
            href="/auth/login"
            className="inline-flex font-semibold text-slate-900 underline underline-offset-4"
          >
            Volver al inicio de sesión
          </Link>
        </div>
      ) : (
        <form onSubmit={handleForgotPassword} className="space-y-5 px-6 py-6 sm:px-8">
          <p className="text-sm leading-6 text-slate-600">
            Ingresá tu email y te enviaremos el enlace de recuperación.
          </p>

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

          {error && (
            <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-medium text-red-700">
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={isLoading}
            className="w-full rounded-xl bg-slate-950 px-5 py-3.5 font-semibold text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {isLoading ? "Enviando..." : "Enviar enlace"}
          </button>

          <div className="text-center text-sm text-slate-600">
            <Link
              href="/auth/login"
              className="font-semibold text-slate-900 underline-offset-4 hover:underline"
            >
              Volver al inicio de sesión
            </Link>
          </div>
        </form>
      )}
    </section>
  );
}
