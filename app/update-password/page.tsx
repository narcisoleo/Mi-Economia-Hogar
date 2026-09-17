"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

export default function UpdatePasswordPage() {
  const router = useRouter();
  const supabase = useMemo(() => createClient(), []);

  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [message, setMessage] = useState("");
  const [success, setSuccess] = useState(false);
  const [loading, setLoading] = useState(false);

  const handleUpdatePassword = async (
    event: React.FormEvent<HTMLFormElement>,
  ) => {
    event.preventDefault();

    setMessage("");
    setSuccess(false);

    const strongPassword =
      password.length >= 12 &&
      /[a-záéíóúñ]/.test(password) &&
      /[A-ZÁÉÍÓÚÑ]/.test(password) &&
      /\d/.test(password) &&
      /[^A-Za-zÁÉÍÓÚÑáéíóúñ0-9]/.test(password);

    if (!strongPassword) {
      setMessage("Usá al menos 12 caracteres e incluí mayúscula, minúscula, número y símbolo.");
      return;
    }

    if (password !== confirmPassword) {
      setMessage("Las contraseñas no coinciden.");
      return;
    }

    setLoading(true);

    const { error } = await supabase.auth.updateUser({
      password,
    });

    if (error) {
      setMessage(`Error: ${error.message}`);
      setLoading(false);
      return;
    }

    setSuccess(true);
    setMessage("Contraseña actualizada correctamente.");
    setPassword("");
    setConfirmPassword("");
    setLoading(false);
  };

  return (
    <main className="flex min-h-screen items-center justify-center bg-[#e7ebf0] px-4 py-10 text-slate-900">
      <section className="w-full max-w-md overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-sm">
        <div className="border-b border-slate-200 px-6 py-6 sm:px-8">
          <p className="text-sm font-semibold uppercase tracking-[0.18em] text-slate-500">
            ECO HOGAR
          </p>
          <h1 className="mt-2 text-2xl font-bold text-slate-950">
            Nueva contraseña
          </h1>
          <p className="mt-2 text-sm leading-6 text-slate-600">
            Creá una contraseña fuerte para tu cuenta. Si llegaste desde un email de recuperación, este cambio reemplaza la contraseña anterior.
          </p>
        </div>

        <form onSubmit={handleUpdatePassword} className="space-y-5 px-6 py-6 sm:px-8">
          <div>
            <label
              htmlFor="new-password"
              className="mb-2 block text-sm font-semibold text-slate-700"
            >
              Nueva contraseña
            </label>

            <input
              id="new-password"
              type="password"
              autoComplete="new-password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              className="w-full rounded-xl border border-slate-300 bg-white px-4 py-3.5 text-slate-950 outline-none focus:border-slate-500 focus:ring-2 focus:ring-slate-200"
              required
            />
          </div>

          <div>
            <label
              htmlFor="confirm-password"
              className="mb-2 block text-sm font-semibold text-slate-700"
            >
              Confirmar contraseña
            </label>

            <p className="mb-3 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs leading-5 text-slate-600">
              Recomendado: 12 o más caracteres, mayúscula, minúscula, número y símbolo. No reutilices la contraseña del email, banco o billeteras.
            </p>

            <input
              id="confirm-password"
              type="password"
              autoComplete="new-password"
              value={confirmPassword}
              onChange={(event) => setConfirmPassword(event.target.value)}
              className="w-full rounded-xl border border-slate-300 bg-white px-4 py-3.5 text-slate-950 outline-none focus:border-slate-500 focus:ring-2 focus:ring-slate-200"
              required
            />
          </div>

          {message && (
            <div
              className={`rounded-xl border px-4 py-3 text-sm font-medium ${
                success
                  ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                  : "border-red-200 bg-red-50 text-red-700"
              }`}
            >
              {message}
            </div>
          )}

          <button
            type="submit"
            disabled={loading}
            className="w-full rounded-xl bg-slate-950 px-5 py-3.5 font-semibold text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {loading ? "Actualizando..." : "Actualizar contraseña"}
          </button>

          {success && (
            <button
              type="button"
              onClick={() => router.push("/dashboard")}
              className="w-full rounded-xl border border-slate-300 bg-white px-5 py-3.5 font-semibold text-slate-900 transition hover:bg-slate-50"
            >
              Ir al dashboard
            </button>
          )}
        </form>
      </section>
    </main>
  );
}
