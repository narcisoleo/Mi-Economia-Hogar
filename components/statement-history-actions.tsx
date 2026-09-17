"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

type Props = {
  householdId: string;
  statementId: string;
  cardName: string;
  filePath: string | null;
};

export function StatementHistoryActions({
  householdId,
  statementId,
  cardName,
  filePath,
}: Props) {
  const router = useRouter();
  const supabase = useMemo(() => createClient(), []);
  const [deleting, setDeleting] = useState(false);
  const [message, setMessage] = useState("");

  async function handleDelete() {
    setMessage("");

    const confirmed = window.confirm(
      `¿Eliminar este resumen de ${cardName}?\n\nTambién se eliminarán los movimientos que hayan sido importados específicamente desde este PDF. Los movimientos manuales de la tarjeta no se tocarán.`
    );

    if (!confirmed) return;

    setDeleting(true);

    try {
      const { error: txError } = await supabase
        .from("transactions")
        .delete()
        .eq("household_id", householdId)
        .eq("statement_import_id", statementId);

      if (txError) throw txError;

      const { error: statementError } = await supabase
        .from("credit_card_statement_imports")
        .delete()
        .eq("household_id", householdId)
        .eq("id", statementId);

      if (statementError) throw statementError;

      let storageWarning = false;
      if (filePath) {
        const { error: storageError } = await supabase.storage
          .from("receipts")
          .remove([filePath]);

        if (storageError) {
          storageWarning = true;
          console.error("El resumen se eliminó, pero no se pudo borrar el PDF del Storage:", storageError);
        }
      }

      setMessage(
        storageWarning
          ? "Resumen y movimientos importados eliminados. El PDF pudo quedar como archivo huérfano en Storage."
          : "Resumen y movimientos importados eliminados correctamente."
      );

      router.refresh();
    } catch (error) {
      console.error("Error eliminando resumen:", error);
      const detail =
        error && typeof error === "object" && "message" in error
          ? String(error.message)
          : String(error);
      setMessage(`No se pudo eliminar el resumen: ${detail}`);
    } finally {
      setDeleting(false);
    }
  }

  return (
    <div className="mt-2 md:mt-0">
      <button
        type="button"
        onClick={handleDelete}
        disabled={deleting}
        className="inline-flex rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs font-bold text-red-700 hover:bg-red-100 disabled:opacity-50"
      >
        {deleting ? "Eliminando..." : "Eliminar resumen"}
      </button>
      {message && <p className="mt-2 max-w-xs text-xs text-slate-500">{message}</p>}
    </div>
  );
}
