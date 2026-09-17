import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { SecurityManager } from "@/components/security-manager";
import { BackupExportButton } from "@/components/backup-export-button";
import { PasswordSecurityPanel } from "@/components/password-security-panel";

export const instant = false;

export default async function SecurityPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/auth/login");

  return (
    <main className="min-h-screen bg-[#e7ebf0] px-4 py-7 text-slate-900 md:px-8 md:py-10">
      <div className="mx-auto max-w-4xl">
        <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <a href="/dashboard" className="text-sm font-medium text-slate-600 hover:text-slate-950">← Volver al dashboard</a>
            <div className="mt-3 flex items-center gap-3">
              <h1 className="text-3xl font-bold tracking-tight text-slate-950">Seguridad y dispositivo</h1>
              <span className="rounded-full border border-slate-200 bg-white px-2.5 py-1 text-xs font-bold text-slate-500 shadow-sm">v2.3.3</span>
            </div>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-600">Instalación móvil, MFA, contraseña, recuperación por email, control de sesiones y copia local de respaldo.</p>
          </div>
        </div>

        <SecurityManager email={user.email ?? "Usuario"} />

        <div className="mt-5">
          <PasswordSecurityPanel email={user.email ?? ""} />
        </div>

        <section className="mt-5 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm md:p-6">
          <h2 className="text-lg font-bold text-slate-950">Privacidad en el celular</h2>
          <p className="mt-1 text-sm leading-6 text-slate-600">La PWA no guarda en caché movimientos, saldos, comprobantes ni respuestas de Supabase. Sin conexión solo muestra una pantalla informativa, reduciendo la exposición de datos financieros en el dispositivo.</p>
        </section>

        <section className="mt-5 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm md:p-6">
          <h2 className="text-lg font-bold text-slate-950">Copia de seguridad local</h2>
          <p className="mt-1 text-sm leading-6 text-slate-600">Exporta un JSON con los datos financieros visibles para tu hogar. El archivo contiene información privada: guardalo en un lugar seguro.</p>
          <div className="mt-4"><BackupExportButton /></div>
        </section>
      </div>
    </main>
  );
}
