"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

type TransactionActionsProps = {
  transactionId: string;
};

export function TransactionActions({
  transactionId,
}: TransactionActionsProps) {
  const router = useRouter();
  const supabase = useMemo(() => createClient(), []);
  const [deleting, setDeleting] = useState(false);

  const handleDelete = async () => {
    const confirmed = window.confirm(
      "¿Eliminar este movimiento? Esta acción no se puede deshacer."
    );

    if (!confirmed) return;

    setDeleting(true);

    const { data: transactionData } = await supabase
      .from("transactions")
      .select("receipt_url")
      .eq("id", transactionId)
      .maybeSingle();

    const { error } = await supabase
      .from("transactions")
      .delete()
      .eq("id", transactionId);

    if (error) {
      console.error("Error eliminando movimiento:", error);
      window.alert(
        `No se pudo eliminar el movimiento: ${error.message}`
      );
      setDeleting(false);
      return;
    }

    if (transactionData?.receipt_url) {
      const { error: receiptError } = await supabase.storage
        .from("receipts")
        .remove([transactionData.receipt_url]);
      if (receiptError) {
        console.warn("No se pudo borrar el comprobante asociado:", receiptError);
      }
    }

    router.refresh();
  };

  return (
    <div className="flex items-center gap-2">
      <button
        type="button"
        onClick={() =>
          router.push(`/movimientos/${transactionId}/editar`)
        }
        className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 transition hover:bg-slate-100"
      >
        Editar
      </button>

      <button
        type="button"
        onClick={handleDelete}
        disabled={deleting}
        className="rounded-lg border border-red-200 bg-red-50 px-3 py-1.5 text-xs font-semibold text-red-700 transition hover:bg-red-100 disabled:cursor-not-allowed disabled:opacity-50"
      >
        {deleting ? "Eliminando..." : "Eliminar"}
      </button>
    </div>
  );
}
