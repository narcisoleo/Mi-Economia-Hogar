"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

type AccountOption = {
  id: string;
  name: string;
  ownerName: string;
};

export type CreditCardRow = {
  id: string;
  accountId: string;
  name: string;
  ownerName: string;
  creditLimit: number;
  closingDay: number | null;
  dueDay: number | null;
  balance: number;
  debt: number;
  available: number;
  monthPurchases: number;
  monthPayments: number;
  nextClosingDate: string | null;
  nextDueDate: string | null;
};

export type CreditCardCycleRow = {
  id: string;
  creditCardId: string;
  cardName: string;
  periodMonth: string;
  closingDate: string;
  dueDate: string;
};

export type CreditCardStatementRow = {
  id: string;
  creditCardId: string;
  cardName: string;
  ownerName: string;
  periodMonth: string;
  startDate: string;
  closingDate: string;
  dueDate: string;
  amount: number;
  purchaseCount: number;
  exactStart: boolean;
  status: "open" | "closed" | "future";
};

type CreditCardManagerProps = {
  householdId: string;
  userId: string;
  cards: CreditCardRow[];
  cycles: CreditCardCycleRow[];
  statements: CreditCardStatementRow[];
  configAccounts: AccountOption[];
  paymentAccounts: AccountOption[];
};

const formatCurrency = (value: number) =>
  new Intl.NumberFormat("es-AR", {
    style: "currency",
    currency: "ARS",
    maximumFractionDigits: 0,
  }).format(value);

function todayValue() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(
    now.getDate()
  ).padStart(2, "0")}`;
}

function currentMonthValue() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
}

function formatDate(value: string | null) {
  if (!value) return "Sin definir";
  return new Intl.DateTimeFormat("es-AR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).format(new Date(`${value}T12:00:00`));
}

function formatPeriod(value: string) {
  const date = new Date(`${value.slice(0, 7)}-01T12:00:00`);
  return new Intl.DateTimeFormat("es-AR", {
    month: "long",
    year: "numeric",
  }).format(date);
}

function statementStatusLabel(status: CreditCardStatementRow["status"]) {
  if (status === "open") return "En curso";
  if (status === "future") return "Próximo";
  return "Cerrado";
}

export function CreditCardManager({
  householdId,
  userId,
  cards,
  cycles,
  statements,
  configAccounts,
  paymentAccounts,
}: CreditCardManagerProps) {
  const router = useRouter();
  const supabase = useMemo(() => createClient(), []);

  const [selectedCardId, setSelectedCardId] = useState(cards[0]?.id ?? "");
  const [paymentAccountId, setPaymentAccountId] = useState(paymentAccounts[0]?.id ?? "");
  const [paymentAmount, setPaymentAmount] = useState("");
  const [paymentDate, setPaymentDate] = useState(todayValue());
  const [paymentNote, setPaymentNote] = useState("");
  const [savingPayment, setSavingPayment] = useState(false);
  const [paymentMessage, setPaymentMessage] = useState("");

  const initialConfigCard = cards[0];
  const [configAccountId, setConfigAccountId] = useState(
    initialConfigCard?.accountId ?? configAccounts[0]?.id ?? ""
  );
  const [creditLimit, setCreditLimit] = useState(
    initialConfigCard ? String(initialConfigCard.creditLimit) : ""
  );
  const [closingDay, setClosingDay] = useState(
    initialConfigCard?.closingDay ? String(initialConfigCard.closingDay) : ""
  );
  const [dueDay, setDueDay] = useState(
    initialConfigCard?.dueDay ? String(initialConfigCard.dueDay) : ""
  );
  const [savingConfig, setSavingConfig] = useState(false);
  const [configMessage, setConfigMessage] = useState("");

  const [cycleCardId, setCycleCardId] = useState(cards[0]?.id ?? "");
  const [cyclePeriod, setCyclePeriod] = useState(currentMonthValue());
  const [cycleClosingDate, setCycleClosingDate] = useState("");
  const [cycleDueDate, setCycleDueDate] = useState("");
  const [savingCycle, setSavingCycle] = useState(false);
  const [cycleMessage, setCycleMessage] = useState("");
  const [deletingCardId, setDeletingCardId] = useState<string | null>(null);
  const [cardActionMessage, setCardActionMessage] = useState("");

  const selectedCard = cards.find((card) => card.id === selectedCardId) ?? cards[0];

  const totalDebt = cards.reduce((sum, card) => sum + card.debt, 0);
  const totalPurchases = cards.reduce((sum, card) => sum + card.monthPurchases, 0);
  const totalPayments = cards.reduce((sum, card) => sum + card.monthPayments, 0);


  const statementByCycleId = new Map(statements.map((statement) => [statement.id, statement]));

  const nextStatements = cards
    .map((card) =>
      statements
        .filter(
          (statement) =>
            statement.creditCardId === card.id && statement.status !== "closed"
        )
        .sort((a, b) => a.closingDate.localeCompare(b.closingDate))[0]
    )
    .filter((statement): statement is CreditCardStatementRow => Boolean(statement));

  useEffect(() => {
    const existing = cycles.find(
      (cycle) => cycle.creditCardId === cycleCardId && cycle.periodMonth.slice(0, 7) === cyclePeriod
    );
    setCycleClosingDate(existing?.closingDate ?? "");
    setCycleDueDate(existing?.dueDate ?? "");
    setCycleMessage("");
  }, [cycleCardId, cyclePeriod, cycles]);

  const handlePayment = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setPaymentMessage("");

    if (!selectedCard || !paymentAccountId) {
      setPaymentMessage("Seleccioná la tarjeta y la cuenta desde la que vas a pagar.");
      return;
    }

    const amount = Number(paymentAmount);
    if (!Number.isFinite(amount) || amount <= 0) {
      setPaymentMessage("Ingresá un importe válido.");
      return;
    }

    if (paymentAccountId === selectedCard.accountId) {
      setPaymentMessage("La cuenta de pago no puede ser la misma tarjeta.");
      return;
    }

    setSavingPayment(true);

    const { error } = await supabase.from("transactions").insert({
      household_id: householdId,
      created_by: userId,
      responsible_person_id: null,
      responsible_user_id: null,
      account_id: paymentAccountId,
      destination_account_id: selectedCard.accountId,
      category_id: null,
      transaction_type: "transfer",
      amount,
      currency: "ARS",
      transaction_date: paymentDate,
      merchant: `Pago tarjeta ${selectedCard.name}`,
      description: paymentNote.trim() || null,
      economic_destination: "household",
      necessity: null,
      is_recurring: false,
      input_source: "manual",
      status: "confirmed",
    });

    if (error) {
      console.error("Error pagando tarjeta:", error);
      setPaymentMessage(`Error al guardar: ${error.message}`);
      setSavingPayment(false);
      return;
    }

    setPaymentAmount("");
    setPaymentNote("");
    setPaymentMessage("Pago registrado. Baja el saldo del banco y reduce la deuda de la tarjeta.");
    setSavingPayment(false);
    router.refresh();
  };

  const handleConfig = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setConfigMessage("");

    if (!configAccountId) {
      setConfigMessage("Seleccioná una tarjeta.");
      return;
    }

    const limit = Number(creditLimit || 0);
    const close = closingDay ? Number(closingDay) : null;
    const due = dueDay ? Number(dueDay) : null;

    if (!Number.isFinite(limit) || limit < 0) {
      setConfigMessage("El límite no puede ser negativo.");
      return;
    }

    if (close !== null && (close < 1 || close > 31)) {
      setConfigMessage("El día habitual de cierre debe estar entre 1 y 31.");
      return;
    }

    if (due !== null && (due < 1 || due > 31)) {
      setConfigMessage("El día habitual de vencimiento debe estar entre 1 y 31.");
      return;
    }

    setSavingConfig(true);

    const { error } = await supabase.from("credit_cards").upsert(
      {
        household_id: householdId,
        account_id: configAccountId,
        credit_limit: limit,
        closing_day: close,
        due_day: due,
        active: true,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "account_id" }
    );

    if (error) {
      console.error("Error configurando tarjeta:", error);
      setConfigMessage(`Error al guardar: ${error.message}`);
      setSavingConfig(false);
      return;
    }

    setConfigMessage("Tarjeta configurada correctamente.");
    setSavingConfig(false);
    router.refresh();
  };

  const handleCycle = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setCycleMessage("");

    if (!cycleCardId || !cyclePeriod || !cycleClosingDate || !cycleDueDate) {
      setCycleMessage("Completá tarjeta, período, fecha de cierre y fecha de vencimiento.");
      return;
    }

    if (cycleDueDate < cycleClosingDate) {
      setCycleMessage("El vencimiento no puede ser anterior al cierre.");
      return;
    }

    setSavingCycle(true);

    const { error } = await supabase.from("credit_card_cycles").upsert(
      {
        household_id: householdId,
        credit_card_id: cycleCardId,
        period_month: `${cyclePeriod}-01`,
        closing_date: cycleClosingDate,
        due_date: cycleDueDate,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "credit_card_id,period_month" }
    );

    if (error) {
      console.error("Error guardando calendario de tarjeta:", error);
      setCycleMessage(`Error al guardar: ${error.message}`);
      setSavingCycle(false);
      return;
    }

    setCycleMessage("Fechas exactas del período guardadas correctamente.");
    setSavingCycle(false);
    router.refresh();
  };

  const visibleCycles = cycles
    .filter((cycle) => !cycleCardId || cycle.creditCardId === cycleCardId)
    .slice(0, 8);

  const handleDeleteCard = async (card: CreditCardRow) => {
    setCardActionMessage("");

    if (!window.confirm(`¿Eliminar ${card.name}? ECO HOGAR primero revisará qué datos tiene asociados.`)) {
      return;
    }

    setDeletingCardId(card.id);

    try {
      const [movementsCheck, statementsCheck, recurringCheck] = await Promise.all([
        supabase
          .from("transactions")
          .select("id, statement_import_id")
          .eq("household_id", householdId)
          .or(`account_id.eq.${card.accountId},destination_account_id.eq.${card.accountId}`),
        supabase
          .from("credit_card_statement_imports")
          .select("id, file_path")
          .eq("household_id", householdId)
          .eq("credit_card_id", card.id),
        supabase
          .from("recurring_rules")
          .select("id")
          .eq("household_id", householdId)
          .eq("account_id", card.accountId),
      ]);

      const checkError = movementsCheck.error || statementsCheck.error || recurringCheck.error;
      if (checkError) throw checkError;

      const movements = movementsCheck.data ?? [];
      const summaries = statementsCheck.data ?? [];
      const recurring = recurringCheck.data ?? [];
      const importedMovements = movements.filter((movement) => movement.statement_import_id !== null);
      const manualMovements = movements.filter((movement) => movement.statement_import_id === null);

      if (movements.length > 0 || summaries.length > 0 || recurring.length > 0) {
        const detail = [
          `${movements.length} movimiento(s) en total`,
          `${importedMovements.length} importado(s) desde PDF`,
          `${manualMovements.length} manual(es)/pago(s)`,
          `${summaries.length} resumen(es) PDF`,
          `${recurring.length} recurrente(s)`,
        ].join("\n• ");

        const purgeConfirmed = window.confirm(
          `${card.name} todavía tiene datos asociados:\n\n• ${detail}\n\nSi continuás se eliminará LA TARJETA COMPLETA junto con esos movimientos, resúmenes, calendarios y recurrentes. Usá esta opción solo para tarjetas de prueba o cargadas por error.\n\n¿Eliminar todo?`
        );

        if (!purgeConfirmed) {
          setCardActionMessage(
            `${card.name} no se eliminó. Detecté ${movements.length} movimiento(s), ${summaries.length} resumen(es) y ${recurring.length} recurrente(s).`
          );
          setDeletingCardId(null);
          return;
        }
      }

      // Primero quitamos los movimientos y recurrentes porque pueden tener FK
      // hacia la cuenta con ON DELETE RESTRICT.
      if (movements.length > 0) {
        const { error: movementsDeleteError } = await supabase
          .from("transactions")
          .delete()
          .eq("household_id", householdId)
          .or(`account_id.eq.${card.accountId},destination_account_id.eq.${card.accountId}`);
        if (movementsDeleteError) throw movementsDeleteError;
      }

      if (recurring.length > 0) {
        const { error: recurringDeleteError } = await supabase
          .from("recurring_rules")
          .delete()
          .eq("household_id", householdId)
          .eq("account_id", card.accountId);
        if (recurringDeleteError) throw recurringDeleteError;
      }

      // Al borrar la cuenta se elimina en cascada credit_cards, calendarios,
      // resúmenes y cuotas futuras. Guardamos antes las rutas de PDF para limpiar Storage.
      const { error: accountDeleteError } = await supabase
        .from("accounts")
        .delete()
        .eq("id", card.accountId)
        .eq("household_id", householdId);

      if (accountDeleteError) throw accountDeleteError;

      const pdfPaths = summaries
        .map((summary) => summary.file_path)
        .filter((value): value is string => Boolean(value));

      if (pdfPaths.length > 0) {
        const { error: storageError } = await supabase.storage.from("receipts").remove(pdfPaths);
        if (storageError) {
          console.error("Tarjeta eliminada, pero quedaron PDFs huérfanos en Storage:", storageError);
        }
      }

      setCardActionMessage(
        `${card.name} fue eliminada por completo. Se quitaron también ${movements.length} movimiento(s), ${summaries.length} resumen(es) y ${recurring.length} recurrente(s) asociados.`
      );
      router.refresh();
    } catch (error) {
      console.error("Error eliminando tarjeta:", error);
      const detail =
        error && typeof error === "object" && "message" in error
          ? String(error.message)
          : String(error);
      setCardActionMessage(`Error al eliminar ${card.name}: ${detail}`);
    } finally {
      setDeletingCardId(null);
    }
  };

  return (
    <div className="space-y-6">
      <section className="grid grid-cols-1 gap-4 md:grid-cols-3">
        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <p className="text-sm font-medium text-slate-500">Deuda total</p>
          <p className="mt-2 text-3xl font-bold text-red-600">{formatCurrency(totalDebt)}</p>
        </div>
        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <p className="text-sm font-medium text-slate-500">Consumos del mes</p>
          <p className="mt-2 text-3xl font-bold text-slate-950">{formatCurrency(totalPurchases)}</p>
        </div>
        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <p className="text-sm font-medium text-slate-500">Pagos del mes</p>
          <p className="mt-2 text-3xl font-bold text-emerald-600">{formatCurrency(totalPayments)}</p>
        </div>
      </section>

      <section className="rounded-2xl border border-slate-200 bg-white shadow-sm">
        <div className="border-b border-slate-200 px-5 py-5 md:px-6">
          <h2 className="text-xl font-bold text-slate-950">Tus tarjetas</h2>
          <p className="mt-1 text-sm text-slate-500">
            Los consumos son gastos cuando los hacés. El pago posterior de la tarjeta no vuelve a contarse como gasto.
          </p>
        </div>

        {cards.length === 0 ? (
          <div className="px-6 py-10 text-center">
            <p className="font-semibold text-slate-700">Todavía no hay tarjetas configuradas.</p>
            <p className="mt-1 text-sm text-slate-500">Usá el bloque “Agregar tarjeta” de arriba.</p>
          </div>
        ) : (
          <div className="p-5 md:p-6">
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              {cards.map((card) => (
                <div
                  key={card.id}
                  className={`overflow-hidden rounded-2xl border transition ${
                    selectedCardId === card.id
                      ? "border-slate-900 bg-slate-50"
                      : "border-slate-200 bg-white"
                  }`}
                >
                  <button
                    type="button"
                    onClick={() => setSelectedCardId(card.id)}
                    className="w-full p-5 text-left hover:bg-slate-50"
                  >
                    <div className="flex items-start justify-between gap-4">
                      <div>
                        <p className="font-bold text-slate-950">{card.name}</p>
                        <p className="mt-0.5 text-xs text-slate-500">{card.ownerName}</p>
                      </div>
                      <span className="rounded-full bg-red-50 px-2.5 py-1 text-xs font-bold text-red-700">
                        Deuda {formatCurrency(card.debt)}
                      </span>
                    </div>

                    <div className="mt-4 grid grid-cols-2 gap-3 text-sm">
                      <div>
                        <p className="text-slate-500">Límite</p>
                        <p className="font-semibold text-slate-900">{formatCurrency(card.creditLimit)}</p>
                      </div>
                      <div>
                        <p className="text-slate-500">Disponible</p>
                        <p className={`font-semibold ${card.available < 0 ? "text-red-600" : "text-slate-900"}`}>
                          {formatCurrency(card.available)}
                        </p>
                      </div>
                      <div>
                        <p className="text-slate-500">Próximo cierre</p>
                        <p className="font-semibold text-slate-900">{formatDate(card.nextClosingDate)}</p>
                      </div>
                      <div>
                        <p className="text-slate-500">Próximo vencimiento</p>
                        <p className="font-semibold text-slate-900">{formatDate(card.nextDueDate)}</p>
                      </div>
                    </div>
                  </button>

                  <div className="flex items-center justify-between border-t border-slate-200 px-5 py-3">
                    <span className="text-xs text-slate-400">Seleccioná la tarjeta para operar</span>
                    <button
                      type="button"
                      onClick={() => handleDeleteCard(card)}
                      disabled={deletingCardId === card.id}
                      className="text-xs font-bold text-red-600 hover:text-red-800 disabled:opacity-50"
                    >
                      {deletingCardId === card.id ? "Eliminando..." : "Eliminar tarjeta"}
                    </button>
                  </div>
                </div>
              ))}
            </div>

            {cardActionMessage && (
              <div className="mt-4 rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm font-medium text-slate-700">
                {cardActionMessage}
              </div>
            )}
          </div>
        )}
      </section>

      {cards.length > 0 && (
        <section className="rounded-2xl border border-slate-200 bg-white shadow-sm">
          <div className="border-b border-slate-200 px-5 py-5 md:px-6">
            <h2 className="text-xl font-bold text-slate-950">Próximos resúmenes</h2>
            <p className="mt-1 text-sm text-slate-500">
              ECO HOGAR agrupa las compras según las fechas exactas de cierre que cargaste. Una compra posterior al cierre pasa al período siguiente.
            </p>
          </div>

          {nextStatements.length === 0 ? (
            <div className="px-6 py-8">
              <p className="font-semibold text-slate-700">Todavía no hay un próximo resumen calculable.</p>
              <p className="mt-1 text-sm text-slate-500">
                Cargá abajo al menos un período de cierre para cada tarjeta. Para máxima precisión también conviene cargar el cierre anterior.
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-4 p-5 md:grid-cols-2 md:p-6">
              {nextStatements.map((statement) => (
                <div key={statement.id} className="rounded-2xl border border-slate-200 bg-slate-50 p-5">
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <p className="font-bold text-slate-950">{statement.cardName}</p>
                      <p className="mt-0.5 text-xs text-slate-500">
                        {statement.ownerName} · período <span className="capitalize">{formatPeriod(statement.periodMonth)}</span>
                      </p>
                    </div>
                    <span className="rounded-full bg-violet-50 px-2.5 py-1 text-xs font-bold text-violet-700">
                      {statementStatusLabel(statement.status)}
                    </span>
                  </div>

                  <div className="mt-4">
                    <p className="text-sm text-slate-500">Acumulado del resumen</p>
                    <p className="mt-1 text-3xl font-bold text-slate-950">{formatCurrency(statement.amount)}</p>
                    <p className="mt-1 text-xs text-slate-500">
                      {statement.purchaseCount} {statement.purchaseCount === 1 ? "compra" : "compras"} registrada{statement.purchaseCount === 1 ? "" : "s"}
                    </p>
                  </div>

                  <div className="mt-4 grid grid-cols-2 gap-3 text-sm">
                    <div>
                      <p className="text-slate-500">Cierra</p>
                      <p className="font-semibold text-slate-900">{formatDate(statement.closingDate)}</p>
                    </div>
                    <div>
                      <p className="text-slate-500">Vence</p>
                      <p className="font-semibold text-slate-900">{formatDate(statement.dueDate)}</p>
                    </div>
                  </div>

                  <div className={`mt-4 rounded-xl px-3 py-2 text-xs ${
                    statement.exactStart
                      ? "bg-emerald-50 text-emerald-800"
                      : "bg-amber-50 text-amber-800"
                  }`}>
                    {statement.exactStart
                      ? `Ventana exacta desde ${formatDate(statement.startDate)} hasta ${formatDate(statement.closingDate)}.`
                      : `Estimación desde ${formatDate(statement.startDate)}. Cargá el cierre anterior para delimitar el período con precisión.`}
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>
      )}

      {cards.length > 0 && (
        <section className="rounded-2xl border border-slate-200 bg-white shadow-sm">
          <div className="border-b border-slate-200 px-5 py-5 md:px-6">
            <h2 className="text-xl font-bold text-slate-950">Calendario mensual</h2>
            <p className="mt-1 text-sm text-slate-500">
              Cargá las fechas exactas de cada resumen. Esto es lo recomendado cuando cierre y vencimiento cambian mes a mes.
            </p>
          </div>

          <form onSubmit={handleCycle} className="space-y-5 p-5 md:p-6">
            <div className="grid grid-cols-1 gap-5 md:grid-cols-2">
              <div>
                <label className="mb-2 block text-sm font-semibold text-slate-700">Tarjeta</label>
                <select
                  value={cycleCardId}
                  onChange={(event) => setCycleCardId(event.target.value)}
                  className="w-full rounded-xl border border-slate-300 bg-white px-4 py-3.5 text-slate-900"
                >
                  {cards.map((card) => (
                    <option key={card.id} value={card.id}>
                      {card.name} · {card.ownerName}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="mb-2 block text-sm font-semibold text-slate-700">Período del resumen</label>
                <input
                  type="month"
                  value={cyclePeriod}
                  onChange={(event) => setCyclePeriod(event.target.value)}
                  className="w-full rounded-xl border border-slate-300 bg-white px-4 py-3.5 text-slate-900"
                  required
                />
              </div>
            </div>

            <div className="grid grid-cols-1 gap-5 md:grid-cols-2">
              <div>
                <label className="mb-2 block text-sm font-semibold text-slate-700">Fecha exacta de cierre</label>
                <input
                  type="date"
                  value={cycleClosingDate}
                  onChange={(event) => setCycleClosingDate(event.target.value)}
                  className="w-full rounded-xl border border-slate-300 bg-white px-4 py-3.5 text-slate-900"
                  required
                />
              </div>
              <div>
                <label className="mb-2 block text-sm font-semibold text-slate-700">Fecha exacta de vencimiento</label>
                <input
                  type="date"
                  value={cycleDueDate}
                  onChange={(event) => setCycleDueDate(event.target.value)}
                  className="w-full rounded-xl border border-slate-300 bg-white px-4 py-3.5 text-slate-900"
                  required
                />
              </div>
            </div>

            {cycleMessage && (
              <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm font-medium text-slate-700">
                {cycleMessage}
              </div>
            )}

            <button
              type="submit"
              disabled={savingCycle}
              className="rounded-xl bg-slate-950 px-5 py-3.5 font-bold text-white transition hover:bg-slate-800 disabled:opacity-50"
            >
              {savingCycle ? "Guardando..." : "Guardar fechas del período"}
            </button>
          </form>

          {visibleCycles.length > 0 && (
            <div className="border-t border-slate-200 px-5 py-5 md:px-6">
              <h3 className="font-bold text-slate-950">Períodos cargados</h3>
              <div className="mt-3 space-y-2">
                {visibleCycles.map((cycle) => (
                  <div
                    key={cycle.id}
                    className="grid grid-cols-1 gap-2 rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm md:grid-cols-5"
                  >
                    <div>
                      <span className="text-slate-500">Período</span>
                      <p className="font-semibold capitalize text-slate-900">{formatPeriod(cycle.periodMonth)}</p>
                    </div>
                    <div>
                      <span className="text-slate-500">Cierre</span>
                      <p className="font-semibold text-slate-900">{formatDate(cycle.closingDate)}</p>
                    </div>
                    <div>
                      <span className="text-slate-500">Vencimiento</span>
                      <p className="font-semibold text-slate-900">{formatDate(cycle.dueDate)}</p>
                    </div>
                    <div>
                      <span className="text-slate-500">Consumos</span>
                      <p className="font-semibold text-slate-900">
                        {formatCurrency(statementByCycleId.get(cycle.id)?.amount ?? 0)}
                      </p>
                    </div>
                    <div>
                      <span className="text-slate-500">Estado</span>
                      <p className="font-semibold text-slate-900">
                        {statementStatusLabel(statementByCycleId.get(cycle.id)?.status ?? "future")}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </section>
      )}

      {cards.length > 0 && (
        <section className="rounded-2xl border border-slate-200 bg-white shadow-sm">
          <div className="border-b border-slate-200 px-5 py-5 md:px-6">
            <h2 className="text-xl font-bold text-slate-950">Pagar tarjeta</h2>
            <p className="mt-1 text-sm text-slate-500">
              Se registra como transferencia: baja dinero de la cuenta origen y reduce la deuda, sin duplicar el gasto.
            </p>
          </div>

          <form onSubmit={handlePayment} className="space-y-5 p-5 md:p-6">
            <div className="grid grid-cols-1 gap-5 md:grid-cols-2">
              <div>
                <label className="mb-2 block text-sm font-semibold text-slate-700">Tarjeta</label>
                <select
                  value={selectedCardId}
                  onChange={(event) => setSelectedCardId(event.target.value)}
                  className="w-full rounded-xl border border-slate-300 bg-white px-4 py-3.5 text-slate-900"
                >
                  {cards.map((card) => (
                    <option key={card.id} value={card.id}>
                      {card.name} · deuda {formatCurrency(card.debt)}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="mb-2 block text-sm font-semibold text-slate-700">Pagar desde</label>
                <select
                  value={paymentAccountId}
                  onChange={(event) => setPaymentAccountId(event.target.value)}
                  className="w-full rounded-xl border border-slate-300 bg-white px-4 py-3.5 text-slate-900"
                >
                  <option value="">Seleccionar cuenta</option>
                  {paymentAccounts
                    .filter((account) => account.id !== selectedCard?.accountId)
                    .map((account) => (
                      <option key={account.id} value={account.id}>
                        {account.name} · {account.ownerName}
                      </option>
                    ))}
                </select>
              </div>
            </div>

            <div className="grid grid-cols-1 gap-5 md:grid-cols-2">
              <div>
                <label className="mb-2 block text-sm font-semibold text-slate-700">Importe</label>
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  value={paymentAmount}
                  onChange={(event) => setPaymentAmount(event.target.value)}
                  placeholder="Ej. 80000"
                  className="w-full rounded-xl border border-slate-300 bg-white px-4 py-3.5 text-lg font-bold text-slate-950"
                  required
                />
              </div>
              <div>
                <label className="mb-2 block text-sm font-semibold text-slate-700">Fecha</label>
                <input
                  type="date"
                  value={paymentDate}
                  onChange={(event) => setPaymentDate(event.target.value)}
                  className="w-full rounded-xl border border-slate-300 bg-white px-4 py-3.5 text-slate-900"
                  required
                />
              </div>
            </div>

            <div>
              <label className="mb-2 block text-sm font-semibold text-slate-700">
                Nota <span className="font-normal text-slate-400">(opcional)</span>
              </label>
              <input
                type="text"
                value={paymentNote}
                onChange={(event) => setPaymentNote(event.target.value)}
                placeholder="Ej. Pago resumen agosto"
                className="w-full rounded-xl border border-slate-300 bg-white px-4 py-3.5 text-slate-900"
              />
            </div>

            {paymentMessage && (
              <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm font-medium text-slate-700">
                {paymentMessage}
              </div>
            )}

            <button
              type="submit"
              disabled={savingPayment || paymentAccounts.length === 0}
              className="rounded-xl bg-slate-950 px-5 py-3.5 font-bold text-white transition hover:bg-slate-800 disabled:opacity-50"
            >
              {savingPayment ? "Guardando..." : "Registrar pago"}
            </button>
          </form>
        </section>
      )}

      <section className="rounded-2xl border border-slate-200 bg-white shadow-sm">
        <div className="border-b border-slate-200 px-5 py-5 md:px-6">
          <h2 className="text-xl font-bold text-slate-950">Configurar tarjeta existente</h2>
          <p className="mt-1 text-sm text-slate-500">
            Definí el límite. Los días habituales son opcionales y solo funcionan como referencia si todavía no cargaste el calendario exacto de ese mes.
          </p>
        </div>

        <form onSubmit={handleConfig} className="space-y-5 p-5 md:p-6">
          {configAccounts.length === 0 ? (
            <p className="text-sm text-slate-500">No hay tarjetas activas para configurar. Creá una desde “Agregar tarjeta”.</p>
          ) : (
            <>
              <div>
                <label className="mb-2 block text-sm font-semibold text-slate-700">Tarjeta</label>
                <select
                  value={configAccountId}
                  onChange={(event) => {
                    const accountId = event.target.value;
                    setConfigAccountId(accountId);
                    const existing = cards.find((card) => card.accountId === accountId);
                    setCreditLimit(existing ? String(existing.creditLimit) : "");
                    setClosingDay(existing?.closingDay ? String(existing.closingDay) : "");
                    setDueDay(existing?.dueDay ? String(existing.dueDay) : "");
                    setConfigMessage("");
                  }}
                  className="w-full rounded-xl border border-slate-300 bg-white px-4 py-3.5 text-slate-900"
                >
                  {configAccounts.map((account) => (
                    <option key={account.id} value={account.id}>
                      {account.name} · {account.ownerName}
                    </option>
                  ))}
                </select>
              </div>

              <div className="grid grid-cols-1 gap-5 md:grid-cols-3">
                <div>
                  <label className="mb-2 block text-sm font-semibold text-slate-700">Límite</label>
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    value={creditLimit}
                    onChange={(event) => setCreditLimit(event.target.value)}
                    placeholder="Ej. 1500000"
                    className="w-full rounded-xl border border-slate-300 bg-white px-4 py-3.5 text-slate-900"
                  />
                </div>
                <div>
                  <label className="mb-2 block text-sm font-semibold text-slate-700">Día habitual de cierre</label>
                  <input
                    type="number"
                    min="1"
                    max="31"
                    value={closingDay}
                    onChange={(event) => setClosingDay(event.target.value)}
                    placeholder="Opcional"
                    className="w-full rounded-xl border border-slate-300 bg-white px-4 py-3.5 text-slate-900"
                  />
                </div>
                <div>
                  <label className="mb-2 block text-sm font-semibold text-slate-700">Día habitual de vencimiento</label>
                  <input
                    type="number"
                    min="1"
                    max="31"
                    value={dueDay}
                    onChange={(event) => setDueDay(event.target.value)}
                    placeholder="Opcional"
                    className="w-full rounded-xl border border-slate-300 bg-white px-4 py-3.5 text-slate-900"
                  />
                </div>
              </div>

              {configMessage && (
                <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm font-medium text-slate-700">
                  {configMessage}
                </div>
              )}

              <button
                type="submit"
                disabled={savingConfig}
                className="rounded-xl bg-slate-950 px-5 py-3.5 font-bold text-white transition hover:bg-slate-800 disabled:opacity-50"
              >
                {savingConfig ? "Guardando..." : "Guardar / actualizar tarjeta"}
              </button>
            </>
          )}
        </form>
      </section>
    </div>
  );
}
