"use client";

import { createClient } from "@/lib/supabase/client";
import { useRouter } from "next/navigation";
import { useState } from "react";

export function LogoutButton({ compact = false }: { compact?: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  const logout = async () => {
    setBusy(true);
    const supabase = createClient();
    await supabase.auth.signOut({ scope: "local" });
    router.replace("/auth/login");
    router.refresh();
  };

  return (
    <button
      type="button"
      onClick={logout}
      disabled={busy}
      className="inline-flex items-center justify-center rounded-xl border border-slate-300 bg-white px-4 py-3 text-sm font-semibold text-slate-700 shadow-sm transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
      title="Cerrar solamente la sesión de este dispositivo"
    >
      {busy ? "Saliendo…" : compact ? "Salir" : "Cerrar sesión"}
    </button>
  );
}
