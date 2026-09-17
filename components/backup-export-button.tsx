"use client";

import { createClient } from "@/lib/supabase/client";
import { useMemo, useState } from "react";

const TABLES = [
  "households",
  "household_members",
  "household_people",
  "accounts",
  "categories",
  "transactions",
  "budgets",
  "monthly_budgets",
  "recurring_rules",
  "recurring_occurrences",
  "credit_cards",
  "credit_card_cycles",
  "credit_card_statement_imports",
  "credit_card_future_installments",
] as const;

export function BackupExportButton() {
  const supabase = useMemo(() => createClient(), []);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  const exportBackup = async () => {
    setBusy(true);
    setMessage("");

    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("Sesión no válida.");

      const membership = await supabase
        .from("household_members")
        .select("household_id")
        .eq("user_id", user.id)
        .single();

      if (membership.error || !membership.data) throw new Error("No se pudo identificar el hogar.");
      const householdId = membership.data.household_id;

      const payload: Record<string, unknown> = {
        meta: {
          product: "ECO HOGAR",
          version: "2.2",
          exported_at: new Date().toISOString(),
          household_id: householdId,
          user_email: user.email,
        },
      };

      const warnings: string[] = [];

      for (const table of TABLES) {
        let query = supabase.from(table).select("*");
        // Todas las tablas del módulo financiero son por hogar; households usa id.
        query = table === "households"
          ? query.eq("id", householdId)
          : query.eq("household_id", householdId);

        const { data, error } = await query;
        if (error) {
          warnings.push(`${table}: ${error.message}`);
          continue;
        }
        payload[table] = data ?? [];
      }

      payload.warnings = warnings;
      const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      const date = new Date().toISOString().slice(0, 10);
      link.href = url;
      link.download = `eco-hogar-backup-${date}.json`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
      setMessage(warnings.length ? `Backup creado con ${warnings.length} advertencia(s).` : "Backup creado correctamente.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "No se pudo crear el backup.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      <button type="button" disabled={busy} onClick={exportBackup} className="rounded-xl bg-slate-950 px-4 py-3 text-sm font-semibold text-white shadow-sm disabled:opacity-50">
        {busy ? "Preparando backup…" : "Descargar backup JSON"}
      </button>
      {message && <p className="mt-2 text-xs font-medium text-slate-600">{message}</p>}
    </div>
  );
}
