"use client";

import { createClient } from "@/lib/supabase/client";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { PwaInstallButton } from "@/components/pwa-install-button";

type TotpFactor = {
  id: string;
  friendly_name?: string | null;
  status?: string;
};

type EnrollData = {
  id: string;
  totp: {
    qr_code: string;
    secret: string;
    uri?: string;
  };
};

export function SecurityManager({ email }: { email: string }) {
  const router = useRouter();
  const supabase = useMemo(() => createClient(), []);
  const [loading, setLoading] = useState(true);
  const [factors, setFactors] = useState<TotpFactor[]>([]);
  const [aal, setAal] = useState<string>("—");
  const [enrollData, setEnrollData] = useState<EnrollData | null>(null);
  const [code, setCode] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);

  const refresh = async () => {
    setLoading(true);
    setMessage("");

    const [factorResult, aalResult] = await Promise.all([
      supabase.auth.mfa.listFactors(),
      supabase.auth.mfa.getAuthenticatorAssuranceLevel(),
    ]);

    if (factorResult.error) {
      setMessage(`No se pudieron leer los factores MFA: ${factorResult.error.message}`);
    } else {
      setFactors((factorResult.data?.totp ?? []) as TotpFactor[]);
    }

    if (!aalResult.error) {
      setAal(aalResult.data?.currentLevel ?? "aal1");
    }

    setLoading(false);
  };

  useEffect(() => {
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const verifiedFactors = factors.filter((factor) => factor.status === "verified");
  const hasVerifiedMfa = verifiedFactors.length > 0;

  const startEnrollment = async () => {
    setBusy(true);
    setMessage("");

    try {
      // Limpiamos factores incompletos para evitar acumulación de intentos fallidos.
      const current = await supabase.auth.mfa.listFactors();
      for (const factor of current.data?.totp ?? []) {
        if (factor.status !== "verified") {
          await supabase.auth.mfa.unenroll({ factorId: factor.id });
        }
      }

      const { data, error } = await supabase.auth.mfa.enroll({
        factorType: "totp",
        friendlyName: "ECO HOGAR",
      });

      if (error) throw error;
      setEnrollData(data as EnrollData);
      setCode("");
    } catch (error) {
      setMessage(
        error instanceof Error
          ? `No se pudo iniciar MFA: ${error.message}`
          : "No se pudo iniciar MFA."
      );
    } finally {
      setBusy(false);
    }
  };

  const verifyEnrollment = async () => {
    if (!enrollData || code.trim().length < 6) {
      setMessage("Ingresá el código de 6 dígitos de tu aplicación autenticadora.");
      return;
    }

    setBusy(true);
    setMessage("");

    const { error } = await supabase.auth.mfa.challengeAndVerify({
      factorId: enrollData.id,
      code: code.trim(),
    });

    if (error) {
      setMessage(`Código no válido: ${error.message}`);
      setBusy(false);
      return;
    }

    setEnrollData(null);
    setCode("");
    await refresh();
    setMessage("Autenticación en dos pasos activada correctamente.");
    router.refresh();
    setBusy(false);
  };

  const cancelEnrollment = async () => {
    if (enrollData) {
      await supabase.auth.mfa.unenroll({ factorId: enrollData.id });
    }
    setEnrollData(null);
    setCode("");
    setMessage("");
    await refresh();
  };

  const removeFactor = async (factorId: string) => {
    if (!confirm("¿Desactivar la autenticación en dos pasos para este usuario?")) return;

    setBusy(true);
    setMessage("");
    const { error } = await supabase.auth.mfa.unenroll({ factorId });

    if (error) {
      setMessage(
        `No se pudo desactivar MFA: ${error.message}. Para quitar un factor verificado, la sesión debe estar autenticada con el segundo factor.`
      );
    } else {
      setMessage("Autenticación en dos pasos desactivada.");
      await refresh();
      router.refresh();
    }
    setBusy(false);
  };

  const closeOtherSessions = async () => {
    if (!confirm("¿Cerrar ECO HOGAR en todos los otros dispositivos y conservar solo esta sesión?")) return;
    setBusy(true);
    setMessage("");
    const { error } = await supabase.auth.signOut({ scope: "others" });
    setMessage(error ? `No se pudieron cerrar otras sesiones: ${error.message}` : "Se cerraron las otras sesiones activas.");
    setBusy(false);
  };

  const closeAllSessions = async () => {
    if (!confirm("¿Cerrar sesión en TODOS los dispositivos, incluido este?")) return;
    setBusy(true);
    const { error } = await supabase.auth.signOut({ scope: "global" });
    if (error) {
      setMessage(`No se pudieron cerrar las sesiones: ${error.message}`);
      setBusy(false);
      return;
    }
    router.push("/auth/login");
    router.refresh();
  };

  return (
    <div className="space-y-5">
      <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm md:p-6">
        <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
          <div>
            <p className="text-sm font-semibold text-slate-500">Cuenta</p>
            <p className="mt-1 font-bold text-slate-950">{email}</p>
            <div className="mt-3 flex flex-wrap gap-2">
              <span className={`rounded-full px-2.5 py-1 text-xs font-bold ${hasVerifiedMfa ? "bg-emerald-50 text-emerald-700" : "bg-amber-50 text-amber-700"}`}>
                {hasVerifiedMfa ? "2 pasos activados" : "Solo contraseña"}
              </span>
              <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-bold text-slate-600">
                Sesión {aal.toUpperCase()}
              </span>
            </div>
          </div>
          <PwaInstallButton />
        </div>
      </section>

      <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm md:p-6">
        <h2 className="text-lg font-bold text-slate-950">Autenticación en dos pasos (MFA)</h2>
        <p className="mt-1 text-sm leading-6 text-slate-600">
          Además de tu contraseña, ECO HOGAR puede pedir un código temporal generado por Google Authenticator, Authy, 1Password o una app compatible.
        </p>

        {loading ? (
          <p className="mt-5 text-sm text-slate-500">Revisando seguridad…</p>
        ) : enrollData ? (
          <div className="mt-5 grid gap-5 lg:grid-cols-[220px_1fr]">
            <div className="rounded-2xl border border-slate-200 bg-white p-3">
              {/* Supabase entrega el QR como data URL SVG. */}
              <img src={enrollData.totp.qr_code} alt="Código QR para activar MFA" className="mx-auto h-auto w-full" />
            </div>
            <div>
              <p className="font-semibold text-slate-900">1. Escaneá el QR con tu app autenticadora.</p>
              <p className="mt-3 text-sm text-slate-600">Si no podés escanear, ingresá esta clave manualmente:</p>
              <code className="mt-2 block break-all rounded-xl bg-slate-100 px-3 py-2 text-xs font-bold text-slate-800">
                {enrollData.totp.secret}
              </code>
              <label className="mt-4 block text-sm font-semibold text-slate-700">2. Código de 6 dígitos</label>
              <input
                value={code}
                onChange={(event) => setCode(event.target.value.replace(/\D/g, "").slice(0, 6))}
                inputMode="numeric"
                autoComplete="one-time-code"
                placeholder="123456"
                className="mt-2 w-full max-w-xs rounded-xl border border-slate-300 px-4 py-3 text-lg font-bold tracking-[0.25em] outline-none focus:border-slate-500 focus:ring-2 focus:ring-slate-200"
              />
              <div className="mt-4 flex flex-wrap gap-2">
                <button type="button" disabled={busy} onClick={verifyEnrollment} className="rounded-xl bg-slate-950 px-4 py-3 text-sm font-semibold text-white disabled:opacity-50">
                  Activar y verificar
                </button>
                <button type="button" disabled={busy} onClick={cancelEnrollment} className="rounded-xl border border-slate-300 bg-white px-4 py-3 text-sm font-semibold text-slate-700 disabled:opacity-50">
                  Cancelar
                </button>
              </div>
            </div>
          </div>
        ) : hasVerifiedMfa ? (
          <div className="mt-5 rounded-xl border border-emerald-200 bg-emerald-50 p-4">
            <p className="font-semibold text-emerald-900">MFA activo</p>
            <p className="mt-1 text-sm text-emerald-800">Los próximos inicios de sesión requerirán contraseña + código temporal.</p>
            {verifiedFactors.map((factor) => (
              <div key={factor.id} className="mt-3 flex flex-wrap items-center justify-between gap-3 border-t border-emerald-200 pt-3">
                <span className="text-sm font-medium text-emerald-900">{factor.friendly_name || "Autenticador TOTP"}</span>
                <button type="button" disabled={busy} onClick={() => removeFactor(factor.id)} className="text-sm font-semibold text-red-600 hover:text-red-700 disabled:opacity-50">
                  Desactivar
                </button>
              </div>
            ))}
          </div>
        ) : (
          <div className="mt-5">
            <button type="button" disabled={busy} onClick={startEnrollment} className="rounded-xl bg-slate-950 px-4 py-3 text-sm font-semibold text-white shadow-sm disabled:opacity-50">
              Activar autenticación en dos pasos
            </button>
          </div>
        )}
      </section>

      <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm md:p-6">
        <h2 className="text-lg font-bold text-slate-950">Sesiones y dispositivos</h2>
        <p className="mt-1 text-sm leading-6 text-slate-600">
          Si perdiste un teléfono o dejaste una sesión abierta en otra PC, podés revocar sus sesiones desde acá.
        </p>
        <div className="mt-4 flex flex-wrap gap-2">
          <button type="button" disabled={busy} onClick={closeOtherSessions} className="rounded-xl border border-slate-300 bg-white px-4 py-3 text-sm font-semibold text-slate-700 shadow-sm disabled:opacity-50">
            Cerrar otros dispositivos
          </button>
          <button type="button" disabled={busy} onClick={closeAllSessions} className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-semibold text-red-700 disabled:opacity-50">
            Cerrar sesión en todos
          </button>
        </div>
      </section>

      {message && (
        <div className="rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm font-medium text-slate-700 shadow-sm">
          {message}
        </div>
      )}
    </div>
  );
}
