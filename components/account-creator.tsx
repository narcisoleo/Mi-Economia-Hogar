"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

export type AccountOwnerOption = {
  userId: string;
  name: string;
};

type AccountCreatorProps = {
  householdId: string;
  owners: AccountOwnerOption[];
};

const ACCOUNT_TYPES = [
  { value: "bank", label: "Cuenta bancaria" },
  { value: "wallet", label: "Billetera virtual" },
  { value: "cash", label: "Efectivo" },
  { value: "other", label: "Otra cuenta" },
];

export function AccountCreator({ householdId, owners }: AccountCreatorProps) {
  const router = useRouter();
  const supabase = useMemo(() => createClient(), []);

  const [name, setName] = useState("");
  const [institution, setInstitution] = useState("");
  const [accountType, setAccountType] = useState("bank");
  const [ownerUserId, setOwnerUserId] = useState(owners[0]?.userId ?? "household");
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [isOpen, setIsOpen] = useState(false);

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setMessage("");

    if (!name.trim()) {
      setMessage("Ingresá un nombre para la cuenta.");
      return;
    }

    setSaving(true);

    const { error } = await supabase.from("accounts").insert({
      household_id: householdId,
      owner_user_id: ownerUserId === "household" ? null : ownerUserId,
      name: name.trim(),
      account_type: accountType,
      institution: institution.trim() || null,
      currency: "ARS",
      initial_balance: 0,
      active: true,
    });

    if (error) {
      console.error("Error creando cuenta:", error);
      setMessage(`Error al crear la cuenta: ${error.message}`);
      setSaving(false);
      return;
    }

    setName("");
    setInstitution("");
    setMessage("Cuenta creada correctamente. Ahora podés definir o conciliar su saldo.");
    setSaving(false);
    router.refresh();
  };

  return (
    <section className="mb-6 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
      <button
        type="button"
        onClick={() => setIsOpen((value) => !value)}
        className="flex w-full items-center justify-between gap-4 px-5 py-5 text-left md:px-6"
      >
        <div>
          <h2 className="text-lg font-bold text-slate-950">Agregar cuenta</h2>
          <p className="mt-1 text-sm text-slate-500">
            Registrá bancos, billeteras, efectivo u otras cuentas nuevas.
          </p>
        </div>
        <span className="text-sm font-semibold text-slate-600">{isOpen ? "Cerrar" : "+ Nueva cuenta"}</span>
      </button>

      {isOpen && (
        <form onSubmit={handleSubmit} className="space-y-5 border-t border-slate-200 p-5 md:p-6">
          <div className="grid grid-cols-1 gap-5 md:grid-cols-2">
            <div>
              <label className="mb-2 block text-sm font-semibold text-slate-700">Nombre</label>
              <input
                value={name}
                onChange={(event) => setName(event.target.value)}
                placeholder="Ej. Banco Galicia Leonardo"
                className="w-full rounded-xl border border-slate-300 bg-white px-4 py-3.5 text-slate-900 outline-none focus:border-slate-500 focus:ring-2 focus:ring-slate-200"
                required
              />
            </div>

            <div>
              <label className="mb-2 block text-sm font-semibold text-slate-700">Tipo</label>
              <select
                value={accountType}
                onChange={(event) => setAccountType(event.target.value)}
                className="w-full rounded-xl border border-slate-300 bg-white px-4 py-3.5 text-slate-900"
              >
                {ACCOUNT_TYPES.map((type) => (
                  <option key={type.value} value={type.value}>
                    {type.label}
                  </option>
                ))}
              </select>
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
                Institución <span className="font-normal text-slate-400">(opcional)</span>
              </label>
              <input
                value={institution}
                onChange={(event) => setInstitution(event.target.value)}
                placeholder="Ej. Banco Galicia"
                className="w-full rounded-xl border border-slate-300 bg-white px-4 py-3.5 text-slate-900 outline-none focus:border-slate-500 focus:ring-2 focus:ring-slate-200"
              />
            </div>
          </div>

          <div className="rounded-xl border border-blue-100 bg-blue-50 px-4 py-3 text-sm text-blue-800">
            Para una tarjeta de crédito usá <a href="/tarjetas" className="font-bold underline">Tarjetas → Agregar tarjeta</a>. Así la deuda queda separada del saldo bancario.
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
            {saving ? "Guardando..." : "Crear cuenta"}
          </button>
        </form>
      )}
    </section>
  );
}
