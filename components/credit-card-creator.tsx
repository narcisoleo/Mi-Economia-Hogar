"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

export type CardOwnerOption = {
  userId: string;
  name: string;
};

type CreditCardCreatorProps = {
  householdId: string;
  owners: CardOwnerOption[];
};

function errorText(error: {
  message?: string;
  details?: string | null;
  hint?: string | null;
  code?: string;
}) {
  return [
    error.message,
    error.details,
    error.hint,
    error.code ? `Código: ${error.code}` : null,
  ]
    .filter(Boolean)
    .join(" · ");
}

export function CreditCardCreator({ householdId, owners }: CreditCardCreatorProps) {
  const router = useRouter();
  const supabase = useMemo(() => createClient(), []);

  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [institution, setInstitution] = useState("");
  const [ownerUserId, setOwnerUserId] = useState(owners[0]?.userId ?? "household");
  const [creditLimit, setCreditLimit] = useState("");
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setMessage("");

    const cleanName = name.trim();
    const cleanInstitution = institution.trim();

    if (!cleanName) {
      setMessage("Ingresá un nombre para la tarjeta.");
      return;
    }

    const limit = Number(creditLimit || 0);
    if (!Number.isFinite(limit) || limit < 0) {
      setMessage("El límite no puede ser negativo.");
      return;
    }

    setSaving(true);

    // v1.6.3: se crea directamente en las tablas accounts + credit_cards.
    // Así no dependemos del RPC/PostgREST schema cache que podía devolver
    // "Could not find function ... in the schema cache".
    const { data: createdAccount, error: accountError } = await supabase
      .from("accounts")
      .insert({
        household_id: householdId,
        owner_user_id: ownerUserId === "household" ? null : ownerUserId,
        name: cleanName,
        account_type: "credit_card",
        institution: cleanInstitution || null,
        currency: "ARS",
        initial_balance: 0,
        active: true,
      })
      .select("id")
      .single();

    if (accountError || !createdAccount) {
      const detail = accountError ? errorText(accountError) : "No se recibió el ID de la tarjeta.";
      console.error("Error creando la cuenta de tarjeta:", accountError ?? detail);
      setMessage(`Error al crear la tarjeta: ${detail}`);
      setSaving(false);
      return;
    }

    const { error: cardError } = await supabase.from("credit_cards").insert({
      household_id: householdId,
      account_id: createdAccount.id,
      credit_limit: limit,
      closing_day: null,
      due_day: null,
      active: true,
    });

    if (cardError) {
      // Si falla la segunda parte, intentamos limpiar la cuenta creada para no
      // dejar una tarjeta incompleta visible en Registrar movimiento.
      const { error: cleanupError } = await supabase
        .from("accounts")
        .delete()
        .eq("id", createdAccount.id)
        .eq("household_id", householdId);

      if (cleanupError) {
        console.error("No se pudo limpiar la cuenta incompleta:", cleanupError);
      }

      const detail = errorText(cardError);
      console.error("Error creando configuración de tarjeta:", cardError);
      setMessage(`Error al crear la tarjeta: ${detail}`);
      setSaving(false);
      return;
    }

    setName("");
    setInstitution("");
    setCreditLimit("");
    setMessage(
      "Tarjeta creada correctamente. Ya podés cargar su calendario y registrar consumos."
    );
    setSaving(false);
    router.refresh();
  };

  return (
    <section className="mb-6 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        className="flex w-full items-center justify-between gap-4 px-5 py-5 text-left md:px-6"
      >
        <div>
          <h2 className="text-lg font-bold text-slate-950">Agregar tarjeta</h2>
          <p className="mt-1 text-sm text-slate-500">
            Crea una tarjeta separada de la cuenta bancaria para controlar deuda y pagos correctamente.
          </p>
        </div>
        <span className="text-sm font-semibold text-slate-600">
          {open ? "Cerrar" : "+ Nueva tarjeta"}
        </span>
      </button>

      {open && (
        <form onSubmit={handleSubmit} className="space-y-5 border-t border-slate-200 p-5 md:p-6">
          <div className="grid grid-cols-1 gap-5 md:grid-cols-2">
            <div>
              <label className="mb-2 block text-sm font-semibold text-slate-700">
                Nombre de la tarjeta
              </label>
              <input
                value={name}
                onChange={(event) => setName(event.target.value)}
                placeholder="Ej. Visa Banco Provincia"
                className="w-full rounded-xl border border-slate-300 bg-white px-4 py-3.5 text-slate-900 outline-none focus:border-slate-500 focus:ring-2 focus:ring-slate-200"
                required
              />
            </div>

            <div>
              <label className="mb-2 block text-sm font-semibold text-slate-700">Titular</label>
              <select
                value={ownerUserId}
                onChange={(event) => setOwnerUserId(event.target.value)}
                className="w-full rounded-xl border border-slate-300 bg-white px-4 py-3.5 text-slate-900"
              >
                <option value="household">Hogar</option>
                {owners.map((owner) => (
                  <option key={owner.userId} value={owner.userId}>
                    {owner.name}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="mb-2 block text-sm font-semibold text-slate-700">
                Banco / institución <span className="font-normal text-slate-400">(opcional)</span>
              </label>
              <input
                value={institution}
                onChange={(event) => setInstitution(event.target.value)}
                placeholder="Ej. Banco Provincia"
                className="w-full rounded-xl border border-slate-300 bg-white px-4 py-3.5 text-slate-900 outline-none focus:border-slate-500 focus:ring-2 focus:ring-slate-200"
              />
            </div>

            <div>
              <label className="mb-2 block text-sm font-semibold text-slate-700">Límite actual</label>
              <input
                type="number"
                min="0"
                step="0.01"
                value={creditLimit}
                onChange={(event) => setCreditLimit(event.target.value)}
                placeholder="Ej. 1000000"
                className="w-full rounded-xl border border-slate-300 bg-white px-4 py-3.5 text-slate-900"
              />
            </div>
          </div>

          <div className="rounded-xl border border-emerald-100 bg-emerald-50 px-4 py-3 text-sm leading-6 text-emerald-900">
            La tarjeta se crea como una cuenta de tipo <strong>tarjeta de crédito</strong>. Una compra
            aumenta la deuda de la tarjeta, pero <strong>no baja el saldo de ninguna cuenta bancaria</strong>.
            El banco recién baja cuando registrás el pago desde el módulo Tarjetas.
          </div>

          {message && (
            <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm font-medium text-slate-700">
              {message}
            </div>
          )}

          <button
            type="submit"
            disabled={saving}
            className="rounded-xl bg-slate-950 px-5 py-3.5 font-bold text-white transition hover:bg-slate-800 disabled:opacity-50"
          >
            {saving ? "Creando..." : "Crear tarjeta"}
          </button>
        </form>
      )}
    </section>
  );
}
