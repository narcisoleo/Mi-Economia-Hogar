"use client";

import { createClient } from "@/lib/supabase/client";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";

type Factor = { id: string; friendly_name?: string | null; status?: string };

export function MfaChallengeForm() {
  const router = useRouter();
  const supabase = useMemo(() => createClient(), []);
  const [factors, setFactors] = useState<Factor[]>([]);
  const [factorId, setFactorId] = useState("");
  const [code, setCode] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  useEffect(() => {
    const load = async () => {
      const aalResult = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
      if (!aalResult.error && aalResult.data?.currentLevel === "aal2") {
        // Refrescamos el JWT antes de volver al servidor para evitar que
        // una navegación SSR use un token anterior al desafío MFA.
        await supabase.auth.refreshSession();
        window.location.replace("/dashboard");
        return;
      }

      const { data, error } = await supabase.auth.mfa.listFactors();
      if (error) {
        setMessage(`No se pudo cargar el segundo factor: ${error.message}`);
        setLoading(false);
        return;
      }

      const verified = ((data?.totp ?? []) as Factor[]).filter((factor) => factor.status === "verified");
      setFactors(verified);
      setFactorId(verified[0]?.id ?? "");
      if (verified.length === 0) {
        setMessage("No hay un autenticador verificado. Volvé a Seguridad para configurarlo.");
      }
      setLoading(false);
    };
    load();
  }, [router, supabase]);

  const verify = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!factorId || code.length !== 6) {
      setMessage("Ingresá el código de 6 dígitos.");
      return;
    }

    setBusy(true);
    setMessage("");
    const { error } = await supabase.auth.mfa.challengeAndVerify({
      factorId,
      code,
    });

    if (error) {
      setMessage(`Código incorrecto o vencido: ${error.message}`);
      setBusy(false);
      return;
    }

    // challengeAndVerify eleva la sesión a AAL2. Forzamos además una
    // renovación y una navegación completa para que las cookies SSR queden
    // sincronizadas antes de consultar datos protegidos por RLS.
    const refreshResult = await supabase.auth.refreshSession();
    if (refreshResult.error) {
      setMessage(`MFA verificado, pero no se pudo renovar la sesión: ${refreshResult.error.message}`);
      setBusy(false);
      return;
    }

    window.location.replace("/dashboard");
  };

  const cancel = async () => {
    await supabase.auth.signOut({ scope: "local" });
    router.replace("/auth/login");
    router.refresh();
  };

  return (
    <section className="overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-sm">
      <div className="border-b border-slate-200 px-6 py-6 sm:px-8">
        <p className="text-sm font-semibold uppercase tracking-[0.18em] text-slate-500">Segundo factor</p>
        <h1 className="mt-2 text-3xl font-bold tracking-tight text-slate-950">Verificar acceso</h1>
        <p className="mt-2 text-sm leading-6 text-slate-600">Abrí tu aplicación autenticadora e ingresá el código temporal para entrar a ECO HOGAR.</p>
      </div>

      <form onSubmit={verify} className="space-y-5 px-6 py-6 sm:px-8">
        {loading ? (
          <p className="text-sm text-slate-500">Cargando autenticador…</p>
        ) : (
          <>
            {factors.length > 1 && (
              <div>
                <label className="mb-2 block text-sm font-semibold text-slate-700">Autenticador</label>
                <select value={factorId} onChange={(event) => setFactorId(event.target.value)} className="w-full rounded-xl border border-slate-300 bg-white px-4 py-3 text-slate-900">
                  {factors.map((factor) => <option key={factor.id} value={factor.id}>{factor.friendly_name || "ECO HOGAR"}</option>)}
                </select>
              </div>
            )}

            <div>
              <label htmlFor="mfa-code" className="mb-2 block text-sm font-semibold text-slate-700">Código de 6 dígitos</label>
              <input
                id="mfa-code"
                value={code}
                onChange={(event) => setCode(event.target.value.replace(/\D/g, "").slice(0, 6))}
                inputMode="numeric"
                autoComplete="one-time-code"
                autoFocus
                placeholder="123456"
                className="w-full rounded-xl border border-slate-300 bg-white px-4 py-3.5 text-center text-2xl font-bold tracking-[0.35em] text-slate-950 outline-none focus:border-slate-500 focus:ring-2 focus:ring-slate-200"
              />
            </div>

            {message && <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-medium text-amber-800">{message}</div>}

            <button type="submit" disabled={busy || !factorId} className="w-full rounded-xl bg-slate-950 px-5 py-3.5 font-semibold text-white shadow-sm disabled:opacity-50">
              {busy ? "Verificando…" : "Verificar y entrar"}
            </button>
            <button type="button" onClick={cancel} className="w-full rounded-xl border border-slate-300 bg-white px-5 py-3 text-sm font-semibold text-slate-600">Cancelar inicio de sesión</button>
          </>
        )}
      </form>
    </section>
  );
}
