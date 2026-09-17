"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import {
  calculateAccountBalance,
  type BalanceMovement,
} from "@/lib/account-balances";

type AccountRow = {
  id: string;
  name: string;
  ownerName: string;
  currentBalance: number;
  reconciliationCount: number;
  lastReconciliationDate: string | null;
};

export type ReconciliationHistoryItem = {
  id: string;
  accountId: string;
  transactionDate: string;
  createdAt: string | null;
  title: string;
  note: string | null;
  adjustment: number;
  balanceBefore: number;
  balanceAfter: number;
};

type AccountBalanceManagerProps = {
  householdId: string;
  userId: string;
  accounts: AccountRow[];
  movements: BalanceMovement[];
  reconciliationHistory: ReconciliationHistoryItem[];
};

const formatCurrency = (value: number) =>
  new Intl.NumberFormat("es-AR", {
    style: "currency",
    currency: "ARS",
    maximumFractionDigits: 0,
  }).format(value);

const formatDate = (date: string | null) => {
  if (!date) return "Sin conciliaciones";
  return new Intl.DateTimeFormat("es-AR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).format(new Date(`${date}T12:00:00`));
};

function todayValue() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(
    now.getDate()
  ).padStart(2, "0")}`;
}

export function AccountBalanceManager({
  householdId,
  userId,
  accounts,
  movements,
  reconciliationHistory,
}: AccountBalanceManagerProps) {
  const router = useRouter();
  const supabase = useMemo(() => createClient(), []);

  const [selectedAccountId, setSelectedAccountId] = useState(accounts[0]?.id ?? "");
  const [balanceDate, setBalanceDate] = useState(todayValue());
  const [realBalance, setRealBalance] = useState("");
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");

  const selectedAccount = accounts.find((account) => account.id === selectedAccountId);

  const calculatedAtDate = selectedAccountId
    ? calculateAccountBalance(movements, selectedAccountId, balanceDate)
    : 0;

  const parsedRealBalance = Number(realBalance.replace(",", "."));
  const hasValidRealBalance = realBalance.trim() !== "" && Number.isFinite(parsedRealBalance);
  const difference = hasValidRealBalance ? parsedRealBalance - calculatedAtDate : 0;
  const isFirstReconciliation = (selectedAccount?.reconciliationCount ?? 0) === 0;

  const handleSave = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    if (!selectedAccountId) {
      setMessage("Seleccioná una cuenta.");
      return;
    }

    if (!balanceDate) {
      setMessage("Seleccioná una fecha.");
      return;
    }

    if (!hasValidRealBalance) {
      setMessage("Ingresá el saldo real de la cuenta.");
      return;
    }

    if (Math.abs(difference) < 0.005) {
      setMessage("El saldo calculado ya coincide con el saldo real. No hace falta ajustar.");
      return;
    }

    setSaving(true);
    setMessage("");

    const isIncrease = difference > 0;
    const title = isFirstReconciliation ? "Saldo inicial" : "Conciliación";
    const adjustmentLabel = `${title} ${isIncrease ? "+" : "-"}`;

    const { error } = await supabase.from("transactions").insert({
      household_id: householdId,
      created_by: userId,
      responsible_user_id: null,
      responsible_person_id: null,
      account_id: selectedAccountId,
      destination_account_id: null,
      category_id: null,
      transaction_type: "adjustment",
      amount: Math.abs(difference),
      currency: "ARS",
      transaction_date: balanceDate,
      // Usamos un valor ya válido en economic_destination para evitar
      // restricciones VARCHAR/CHECK del esquema existente. El signo técnico
      // del ajuste queda codificado en merchant.
      merchant: adjustmentLabel,
      description: note.trim() || null,
      economic_destination: "household",
      necessity: null,
      is_recurring: false,
      input_source: "manual",
      status: "confirmed",
    });

    if (error) {
      const errorText = [
        error.message,
        error.details,
        error.hint,
        error.code ? `Código: ${error.code}` : null,
      ]
        .filter(Boolean)
        .join(" · ");

      console.error(
        "Error conciliando cuenta:",
        error.message,
        error.details ?? "",
        error.hint ?? "",
        error.code ?? ""
      );
      setMessage(`Error al guardar: ${errorText || "error desconocido"}`);
      setSaving(false);
      return;
    }

    setRealBalance("");
    setNote("");
    setMessage(
      isFirstReconciliation
        ? "Saldo inicial registrado correctamente."
        : "Cuenta conciliada correctamente."
    );
    setSaving(false);
    router.refresh();
  };

  const totalBalance = accounts.reduce((total, account) => total + account.currentBalance, 0);

  const selectedHistory = reconciliationHistory
    .filter((item) => item.accountId === selectedAccountId)
    .sort((a, b) => {
      const dateCompare = b.transactionDate.localeCompare(a.transactionDate);
      if (dateCompare !== 0) return dateCompare;
      return (b.createdAt ?? "").localeCompare(a.createdAt ?? "");
    });

  return (
    <div className="space-y-6">
      <section className="grid grid-cols-1 gap-4 md:grid-cols-3">
        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm md:col-span-2">
          <p className="text-sm font-medium text-slate-500">Saldo total registrado</p>
          <p
            className={`mt-2 text-3xl font-bold ${
              totalBalance < 0 ? "text-red-600" : "text-slate-950"
            }`}
          >
            {formatCurrency(totalBalance)}
          </p>
          <p className="mt-2 text-sm text-slate-500">
            Incluye gastos, ingresos, transferencias y ajustes de conciliación.
          </p>
        </div>

        <div className="rounded-2xl border border-blue-200 bg-blue-50 p-5">
          <p className="text-sm font-bold text-blue-900">¿Qué es conciliar?</p>
          <p className="mt-2 text-sm leading-6 text-blue-800">
            Comparás el saldo que calcula ECO HOGAR con el saldo real del banco o billetera.
            La diferencia se registra como ajuste, sin crear un ingreso o gasto falso.
          </p>
        </div>
      </section>

      <section className="rounded-2xl border border-slate-200 bg-white shadow-sm">
        <div className="border-b border-slate-200 px-5 py-5 md:px-6">
          <h2 className="text-xl font-bold text-slate-950">Saldos por cuenta</h2>
          <p className="mt-1 text-sm text-slate-500">
            Estos saldos se actualizan automáticamente con cada movimiento.
          </p>
        </div>

        <div className="divide-y divide-slate-200">
          {accounts.map((account) => (
            <button
              key={account.id}
              type="button"
              onClick={() => {
                setSelectedAccountId(account.id);
                setMessage("");
              }}
              className={`flex w-full items-center justify-between gap-4 px-5 py-4 text-left transition md:px-6 ${
                selectedAccountId === account.id ? "bg-slate-50" : "hover:bg-slate-50"
              }`}
            >
              <div>
                <p className="font-semibold text-slate-900">{account.name}</p>
                <p className="mt-0.5 text-xs text-slate-500">
                  {account.ownerName} · {account.reconciliationCount > 0
                    ? `Última conciliación: ${formatDate(account.lastReconciliationDate)}`
                    : "Sin saldo inicial conciliado"}
                </p>
              </div>
              <p
                className={`whitespace-nowrap text-lg font-bold ${
                  account.currentBalance < 0 ? "text-red-600" : "text-slate-950"
                }`}
              >
                {formatCurrency(account.currentBalance)}
              </p>
            </button>
          ))}
        </div>
      </section>

      <section className="rounded-2xl border border-slate-200 bg-white shadow-sm">
        <div className="border-b border-slate-200 px-5 py-5 md:px-6">
          <h2 className="text-xl font-bold text-slate-950">
            {isFirstReconciliation ? "Definir saldo inicial" : "Conciliar cuenta"}
          </h2>
          <p className="mt-1 text-sm text-slate-500">
            {isFirstReconciliation
              ? "Ingresá el saldo real de la cuenta en una fecha de referencia."
              : "Ingresá el saldo real que ves hoy en la cuenta para corregir diferencias."}
          </p>
        </div>

        <form onSubmit={handleSave} className="space-y-5 p-5 md:p-6">
          <div className="grid grid-cols-1 gap-5 md:grid-cols-2">
            <div>
              <label htmlFor="balance-account" className="mb-2 block text-sm font-semibold text-slate-700">
                Cuenta
              </label>
              <select
                id="balance-account"
                value={selectedAccountId}
                onChange={(event) => {
                  setSelectedAccountId(event.target.value);
                  setMessage("");
                }}
                className="w-full rounded-xl border border-slate-300 bg-white px-4 py-3.5 text-slate-900 outline-none focus:border-slate-500 focus:ring-2 focus:ring-slate-200"
              >
                {accounts.map((account) => (
                  <option key={account.id} value={account.id}>
                    {account.name} · {account.ownerName}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label htmlFor="balance-date" className="mb-2 block text-sm font-semibold text-slate-700">
                Fecha de referencia
              </label>
              <input
                id="balance-date"
                type="date"
                value={balanceDate}
                onChange={(event) => setBalanceDate(event.target.value)}
                className="w-full rounded-xl border border-slate-300 bg-white px-4 py-3.5 text-slate-900 outline-none focus:border-slate-500 focus:ring-2 focus:ring-slate-200"
                required
              />
            </div>
          </div>

          <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
            <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                ECO HOGAR calcula
              </p>
              <p className="mt-1 text-xl font-bold text-slate-900">
                {formatCurrency(calculatedAtDate)}
              </p>
            </div>

            <div>
              <label htmlFor="real-balance" className="mb-2 block text-sm font-semibold text-slate-700">
                Saldo real
              </label>
              <input
                id="real-balance"
                type="number"
                step="0.01"
                value={realBalance}
                onChange={(event) => setRealBalance(event.target.value)}
                placeholder="Ej. 125000"
                className="w-full rounded-xl border border-slate-300 bg-white px-4 py-3.5 text-lg font-bold text-slate-950 outline-none placeholder:text-slate-300 focus:border-slate-500 focus:ring-2 focus:ring-slate-200"
                required
              />
            </div>

            <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                Diferencia
              </p>
              <p
                className={`mt-1 text-xl font-bold ${
                  !hasValidRealBalance
                    ? "text-slate-400"
                    : difference === 0
                      ? "text-emerald-600"
                      : "text-amber-600"
                }`}
              >
                {hasValidRealBalance ? formatCurrency(difference) : "—"}
              </p>
            </div>
          </div>

          <div>
            <label htmlFor="balance-note" className="mb-2 block text-sm font-semibold text-slate-700">
              Nota <span className="font-normal text-slate-400">(opcional)</span>
            </label>
            <input
              id="balance-note"
              type="text"
              value={note}
              onChange={(event) => setNote(event.target.value)}
              placeholder="Ej. Saldo según app de Banco Provincia"
              className="w-full rounded-xl border border-slate-300 bg-white px-4 py-3.5 text-slate-900 outline-none placeholder:text-slate-400 focus:border-slate-500 focus:ring-2 focus:ring-slate-200"
            />
          </div>

          {message && (
            <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm font-medium text-slate-700">
              {message}
            </div>
          )}

          <button
            type="submit"
            disabled={saving || accounts.length === 0}
            className="w-full rounded-xl bg-slate-950 px-5 py-4 font-bold text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-50 md:w-auto"
          >
            {saving
              ? "Guardando..."
              : isFirstReconciliation
                ? "Guardar saldo inicial"
                : "Conciliar saldo"}
          </button>
        </form>
      </section>

      <section className="rounded-2xl border border-slate-200 bg-white shadow-sm">
        <div className="border-b border-slate-200 px-5 py-5 md:px-6">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <h2 className="text-xl font-bold text-slate-950">Historial de conciliaciones</h2>
              <p className="mt-1 text-sm text-slate-500">
                Ajustes técnicos de la cuenta seleccionada. No se contabilizan como ingresos ni gastos.
              </p>
            </div>
            {selectedAccount && (
              <span className="text-sm font-semibold text-slate-600">
                {selectedAccount.name} · {selectedAccount.ownerName}
              </span>
            )}
          </div>
        </div>

        {selectedHistory.length === 0 ? (
          <div className="px-5 py-8 text-center md:px-6">
            <p className="font-semibold text-slate-700">Todavía no hay conciliaciones para esta cuenta.</p>
            <p className="mt-1 text-sm text-slate-500">
              Cuando definas el saldo inicial o corrijas una diferencia, aparecerá acá.
            </p>
          </div>
        ) : (
          <div className="divide-y divide-slate-200">
            {selectedHistory.map((item) => (
              <div key={item.id} className="px-5 py-5 md:px-6">
                <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="font-bold text-slate-950">{item.title}</p>
                      <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-semibold text-slate-600">
                        {formatDate(item.transactionDate)}
                      </span>
                    </div>
                    {item.note && (
                      <p className="mt-2 text-sm text-slate-600">{item.note}</p>
                    )}
                  </div>

                  <div className="grid min-w-full grid-cols-1 gap-2 text-sm sm:grid-cols-3 md:min-w-[430px]">
                    <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                      <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Antes</p>
                      <p className="mt-1 font-bold text-slate-900">{formatCurrency(item.balanceBefore)}</p>
                    </div>
                    <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                      <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Ajuste</p>
                      <p
                        className={`mt-1 font-bold ${
                          item.adjustment < 0 ? "text-red-600" : "text-emerald-600"
                        }`}
                      >
                        {item.adjustment > 0 ? "+" : ""}
                        {formatCurrency(item.adjustment)}
                      </p>
                    </div>
                    <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                      <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Después</p>
                      <p className="mt-1 font-bold text-slate-900">{formatCurrency(item.balanceAfter)}</p>
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
