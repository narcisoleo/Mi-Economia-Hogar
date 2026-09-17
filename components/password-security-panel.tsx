"use client";

import { createClient } from "@/lib/supabase/client";
import { useMemo, useState } from "react";

function passwordChecks(value: string) {
  return {
    length: value.length >= 12,
    lower: /[a-záéíóúñ]/.test(value),
    upper: /[A-ZÁÉÍÓÚÑ]/.test(value),
    number: /\d/.test(value),
    symbol: /[^A-Za-zÁÉÍÓÚÑáéíóúñ0-9]/.test(value),
  };
}

export function PasswordSecurityPanel({ email }: { email: string }) {
  const supabase = useMemo(() => createClient(), []);
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [nonce, setNonce] = useState("");
  const [needsNonce, setNeedsNonce] = useState(false);
  const [closeOthers, setCloseOthers] = useState(true);
  const [busy, setBusy] = useState(false);
  const [recoveryBusy, setRecoveryBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [success, setSuccess] = useState(false);

  const checks = passwordChecks(newPassword);
  const strongPassword = Object.values(checks).every(Boolean);

  const changePassword = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setMessage("");
    setSuccess(false);

    if (!currentPassword) {
      setMessage("Ingresá tu contraseña actual.");
      return;
    }

    if (!strongPassword) {
      setMessage("La nueva contraseña todavía no cumple todos los requisitos de seguridad.");
      return;
    }

    if (newPassword !== confirmPassword) {
      setMessage("La nueva contraseña y su confirmación no coinciden.");
      return;
    }

    if (currentPassword === newPassword) {
      setMessage("La nueva contraseña debe ser distinta de la actual.");
      return;
    }

    if (needsNonce && nonce.trim().length < 6) {
      setMessage("Ingresá el código de seguridad enviado a tu email.");
      return;
    }

    setBusy(true);

    const attributes = {
      email,
      current_password: currentPassword,
      password: newPassword,
      ...(needsNonce ? { nonce: nonce.trim() } : {}),
    } as Parameters<typeof supabase.auth.updateUser>[0];

    const { error } = await supabase.auth.updateUser(attributes);

    if (error) {
      const code = "code" in error ? String(error.code ?? "") : "";
      const needsReauthentication =
        code === "reauthentication_needed" ||
        /reauthentic/i.test(error.message);

      if (needsReauthentication && !needsNonce) {
        const { error: reauthError } = await supabase.auth.reauthenticate();
        if (reauthError) {
          setMessage(`Supabase pidió verificar nuevamente tu identidad, pero no pudo enviar el código: ${reauthError.message}`);
        } else {
          setNeedsNonce(true);
          setMessage("Por seguridad te enviamos un código temporal a tu email. Ingresalo abajo y volvé a presionar Cambiar contraseña.");
        }
        setBusy(false);
        return;
      }

      setMessage(`No se pudo cambiar la contraseña: ${error.message}`);
      setBusy(false);
      return;
    }

    if (closeOthers) {
      await supabase.auth.signOut({ scope: "others" });
    }

    setCurrentPassword("");
    setNewPassword("");
    setConfirmPassword("");
    setNonce("");
    setNeedsNonce(false);
    setSuccess(true);
    setMessage(
      closeOthers
        ? "Contraseña actualizada. También se cerraron las otras sesiones activas."
        : "Contraseña actualizada correctamente.",
    );
    setBusy(false);
  };

  const sendRecoveryEmail = async () => {
    if (!confirm(`¿Enviar un enlace de recuperación de contraseña a ${email}?`)) return;

    setRecoveryBusy(true);
    setMessage("");
    setSuccess(false);

    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${window.location.origin}/update-password`,
    });

    if (error) {
      setMessage(`No se pudo enviar el email de recuperación: ${error.message}`);
    } else {
      setSuccess(true);
      setMessage("Se solicitó el email de recuperación. Revisá también Spam/Correo no deseado. Por seguridad, ECO HOGAR no informa si el proveedor llegó a entregar el mensaje.");
    }

    setRecoveryBusy(false);
  };

  const checklist = [
    ["length", "12 caracteres o más"],
    ["upper", "una mayúscula"],
    ["lower", "una minúscula"],
    ["number", "un número"],
    ["symbol", "un símbolo"],
  ] as const;

  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm md:p-6">
      <h2 className="text-lg font-bold text-slate-950">Contraseña</h2>
      <p className="mt-1 text-sm leading-6 text-slate-600">
        Podés cambiarla desde una sesión iniciada o pedir un enlace de recuperación al email de la cuenta.
      </p>

      <form onSubmit={changePassword} className="mt-5 space-y-4">
        <div className="grid gap-4 md:grid-cols-2">
          <div className="md:col-span-2">
            <label htmlFor="current-password" className="mb-2 block text-sm font-semibold text-slate-700">
              Contraseña actual
            </label>
            <input
              id="current-password"
              type="password"
              autoComplete="current-password"
              value={currentPassword}
              onChange={(event) => setCurrentPassword(event.target.value)}
              className="w-full rounded-xl border border-slate-300 bg-white px-4 py-3 text-slate-950 outline-none focus:border-slate-500 focus:ring-2 focus:ring-slate-200"
            />
          </div>

          <div>
            <label htmlFor="security-new-password" className="mb-2 block text-sm font-semibold text-slate-700">
              Nueva contraseña
            </label>
            <input
              id="security-new-password"
              type="password"
              autoComplete="new-password"
              value={newPassword}
              onChange={(event) => setNewPassword(event.target.value)}
              className="w-full rounded-xl border border-slate-300 bg-white px-4 py-3 text-slate-950 outline-none focus:border-slate-500 focus:ring-2 focus:ring-slate-200"
            />
          </div>

          <div>
            <label htmlFor="security-confirm-password" className="mb-2 block text-sm font-semibold text-slate-700">
              Repetir nueva contraseña
            </label>
            <input
              id="security-confirm-password"
              type="password"
              autoComplete="new-password"
              value={confirmPassword}
              onChange={(event) => setConfirmPassword(event.target.value)}
              className="w-full rounded-xl border border-slate-300 bg-white px-4 py-3 text-slate-950 outline-none focus:border-slate-500 focus:ring-2 focus:ring-slate-200"
            />
          </div>
        </div>

        {newPassword && (
          <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
            <p className="text-xs font-bold uppercase tracking-wide text-slate-500">Requisitos recomendados</p>
            <div className="mt-2 flex flex-wrap gap-2">
              {checklist.map(([key, label]) => (
                <span
                  key={key}
                  className={`rounded-full px-2.5 py-1 text-xs font-semibold ${checks[key] ? "bg-emerald-100 text-emerald-700" : "bg-white text-slate-500"}`}
                >
                  {checks[key] ? "✓" : "○"} {label}
                </span>
              ))}
            </div>
          </div>
        )}

        {needsNonce && (
          <div className="rounded-xl border border-amber-200 bg-amber-50 p-4">
            <label htmlFor="reauth-nonce" className="block text-sm font-semibold text-amber-900">
              Código de seguridad recibido por email
            </label>
            <input
              id="reauth-nonce"
              value={nonce}
              onChange={(event) => setNonce(event.target.value.replace(/\D/g, "").slice(0, 8))}
              inputMode="numeric"
              autoComplete="one-time-code"
              placeholder="123456"
              className="mt-2 w-full max-w-xs rounded-xl border border-amber-300 bg-white px-4 py-3 font-bold tracking-[0.2em] text-slate-950 outline-none"
            />
          </div>
        )}

        <label className="flex items-start gap-3 rounded-xl border border-slate-200 p-3 text-sm text-slate-700">
          <input
            type="checkbox"
            checked={closeOthers}
            onChange={(event) => setCloseOthers(event.target.checked)}
            className="mt-0.5 h-4 w-4"
          />
          <span>
            <strong>Cerrar otras sesiones después del cambio.</strong> Recomendado si sospechás que la contraseña pudo quedar guardada en otro dispositivo.
          </span>
        </label>

        <div className="flex flex-wrap gap-2">
          <button
            type="submit"
            disabled={busy}
            className="rounded-xl bg-slate-950 px-4 py-3 text-sm font-semibold text-white shadow-sm disabled:opacity-50"
          >
            {busy ? "Actualizando…" : needsNonce ? "Verificar y cambiar contraseña" : "Cambiar contraseña"}
          </button>
          <button
            type="button"
            disabled={recoveryBusy}
            onClick={sendRecoveryEmail}
            className="rounded-xl border border-slate-300 bg-white px-4 py-3 text-sm font-semibold text-slate-700 shadow-sm disabled:opacity-50"
          >
            {recoveryBusy ? "Enviando…" : "Enviar recuperación por email"}
          </button>
        </div>
      </form>

      {message && (
        <div className={`mt-4 rounded-xl border px-4 py-3 text-sm font-medium ${success ? "border-emerald-200 bg-emerald-50 text-emerald-700" : "border-amber-200 bg-amber-50 text-amber-800"}`}>
          {message}
        </div>
      )}
    </section>
  );
}
