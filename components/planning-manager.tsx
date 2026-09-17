"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

type Account = {
  id: string;
  name: string;
  owner_user_id: string | null;
  account_type: string;
};

type Category = {
  id: string;
  name: string;
  parent_id: string | null;
  economic_type: string | null;
};

type HouseholdPerson = {
  id: string;
  full_name: string;
  linked_user_id: string | null;
};

type Budget = {
  id: string;
  category_id: string;
  amount: number | string;
  note: string | null;
};

type RecurringRule = {
  id: string;
  name: string;
  transaction_type: string;
  amount: number | string;
  account_id: string;
  category_id: string;
  responsible_person_id: string | null;
  merchant: string | null;
  description: string | null;
  due_day: number;
  start_month: string;
  end_month: string | null;
  active: boolean;
};

type PlanningManagerProps = {
  householdId: string;
  userId: string;
  selectedMonth: string;
  accounts: Account[];
  categories: Category[];
  people: HouseholdPerson[];
  initialBudgets: Budget[];
  initialRules: RecurringRule[];
  generatedRuleIds: string[];
  spentByParentCategory: Record<string, number>;
};

const MONTH_NAMES = [
  "enero",
  "febrero",
  "marzo",
  "abril",
  "mayo",
  "junio",
  "julio",
  "agosto",
  "septiembre",
  "octubre",
  "noviembre",
  "diciembre",
];

function formatMonth(monthValue: string) {
  const [year, month] = monthValue.split("-").map(Number);
  const name = MONTH_NAMES[month - 1] ?? "";
  return `${name.charAt(0).toUpperCase()}${name.slice(1)} ${year}`;
}

function monthDate(monthValue: string) {
  return `${monthValue}-01`;
}

function dueDateForMonth(monthValue: string, dueDay: number) {
  const [year, month] = monthValue.split("-").map(Number);
  const lastDay = new Date(year, month, 0).getDate();
  const day = Math.min(Math.max(dueDay, 1), lastDay);
  return `${monthValue}-${String(day).padStart(2, "0")}`;
}

function todayValue() {
  const today = new Date();
  return `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
}

function currentMonthValue() {
  return todayValue().slice(0, 7);
}

function formatDateShort(value: string) {
  return new Intl.DateTimeFormat("es-AR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).format(new Date(`${value}T12:00:00`));
}

function formatCurrency(value: number) {
  return new Intl.NumberFormat("es-AR", {
    style: "currency",
    currency: "ARS",
    maximumFractionDigits: 0,
  }).format(value);
}

export function PlanningManager({
  householdId,
  userId,
  selectedMonth,
  accounts,
  categories,
  people,
  initialBudgets,
  initialRules,
  generatedRuleIds,
  spentByParentCategory,
}: PlanningManagerProps) {
  const router = useRouter();
  const supabase = useMemo(() => createClient(), []);

  const [budgets, setBudgets] = useState(initialBudgets);
  const [rules, setRules] = useState(initialRules);
  const [generated, setGenerated] = useState(() => new Set(generatedRuleIds));
  const [message, setMessage] = useState("");
  const [saving, setSaving] = useState(false);
  const [generating, setGenerating] = useState(false);

  const [budgetCategoryId, setBudgetCategoryId] = useState("");
  const [budgetAmount, setBudgetAmount] = useState("");
  const [budgetNote, setBudgetNote] = useState("");

  const [ruleType, setRuleType] = useState<"expense" | "income">("expense");
  const [ruleName, setRuleName] = useState("");
  const [ruleAmount, setRuleAmount] = useState("");
  const [ruleAccountId, setRuleAccountId] = useState("");
  const [ruleParentCategoryId, setRuleParentCategoryId] = useState("");
  const [ruleCategoryId, setRuleCategoryId] = useState("");
  const [ruleResponsible, setRuleResponsible] = useState("household");
  const [ruleDueDay, setRuleDueDay] = useState("1");
  const [ruleMerchant, setRuleMerchant] = useState("");
  const [ruleDescription, setRuleDescription] = useState("");

  const parentExpenseCategories = categories.filter(
    (category) =>
      category.parent_id === null && !["Ingresos", "Ahorro"].includes(category.name)
  );

  const ruleParentCategories = categories.filter((category) => {
    if (category.parent_id !== null) return false;
    if (ruleType === "income") return category.name === "Ingresos";
    return !["Ingresos", "Ahorro"].includes(category.name);
  });

  const ruleSubcategories = categories.filter(
    (category) => category.parent_id === ruleParentCategoryId
  );

  const categoryById = new Map(categories.map((category) => [category.id, category]));
  const accountById = new Map(accounts.map((account) => [account.id, account]));
  const personById = new Map(people.map((person) => [person.id, person]));

  const budgetTotal = budgets.reduce((sum, budget) => sum + Number(budget.amount), 0);
  const spentAgainstBudgets = budgets.reduce(
    (sum, budget) => sum + (spentByParentCategory[budget.category_id] ?? 0),
    0
  );
  const remainingBudget = budgetTotal - spentAgainstBudgets;
  const budgetProgress = budgetTotal > 0 ? (spentAgainstBudgets / budgetTotal) * 100 : 0;

  const isRuleEligible = (rule: RecurringRule) => {
    const period = monthDate(selectedMonth);
    return (
      rule.active &&
      rule.start_month <= period &&
      (!rule.end_month || rule.end_month >= period)
    );
  };

  const eligibleRules = rules.filter(isRuleEligible);
  const expectedRecurring = eligibleRules.reduce(
    (sum, rule) => sum + Number(rule.amount),
    0
  );

  const today = todayValue();
  const currentMonth = currentMonthValue();

  const isRuleDue = (rule: RecurringRule) => {
    if (!isRuleEligible(rule)) return false;

    // Meses pasados: todo recurrente pendiente ya está vencido.
    if (selectedMonth < currentMonth) return true;

    // Meses futuros: se muestran como programados, pero no se generan todavía.
    if (selectedMonth > currentMonth) return false;

    // Mes actual: sólo se puede generar cuando llegó su fecha prevista.
    return dueDateForMonth(selectedMonth, rule.due_day) <= today;
  };

  const pendingRules = eligibleRules.filter(
    (rule) => !generated.has(rule.id) && isRuleDue(rule)
  );

  const scheduledRules = eligibleRules.filter(
    (rule) => !generated.has(rule.id) && !isRuleDue(rule)
  );

  const saveBudget = async () => {
    if (!budgetCategoryId || !budgetAmount || Number(budgetAmount) < 0) {
      setMessage("Seleccioná una categoría e ingresá un presupuesto válido.");
      return;
    }

    setSaving(true);
    setMessage("");

    const payload = {
      household_id: householdId,
      month: monthDate(selectedMonth),
      category_id: budgetCategoryId,
      amount: Number(budgetAmount),
      note: budgetNote.trim() || null,
      created_by: userId,
      updated_at: new Date().toISOString(),
    };

    const { data, error } = await supabase
      .from("monthly_budgets")
      .upsert(payload, { onConflict: "household_id,month,category_id" })
      .select("id, category_id, amount, note")
      .single();

    if (error || !data) {
      console.error("Error guardando presupuesto:", error);
      setMessage(`Error al guardar presupuesto: ${error?.message ?? "sin detalle"}`);
      setSaving(false);
      return;
    }

    setBudgets((current) => {
      const without = current.filter((item) => item.category_id !== data.category_id);
      return [...without, data].sort((a, b) => {
        const aName = categoryById.get(a.category_id)?.name ?? "";
        const bName = categoryById.get(b.category_id)?.name ?? "";
        return aName.localeCompare(bName, "es");
      });
    });
    setBudgetAmount("");
    setBudgetNote("");
    setMessage("Presupuesto guardado.");
    setSaving(false);
  };

  const deleteBudget = async (budget: Budget) => {
    if (!window.confirm("¿Eliminar este presupuesto del mes?")) return;
    const { error } = await supabase
      .from("monthly_budgets")
      .delete()
      .eq("id", budget.id)
      .eq("household_id", householdId);

    if (error) {
      setMessage(`Error al eliminar: ${error.message}`);
      return;
    }

    setBudgets((current) => current.filter((item) => item.id !== budget.id));
    setMessage("Presupuesto eliminado.");
  };

  const createRule = async () => {
    const amount = Number(ruleAmount);
    const dueDay = Number(ruleDueDay);

    if (!ruleName.trim()) {
      setMessage("Poné un nombre al movimiento recurrente.");
      return;
    }
    if (!Number.isFinite(amount) || amount <= 0) {
      setMessage("Ingresá un importe válido para el recurrente.");
      return;
    }
    if (!ruleAccountId || !ruleCategoryId) {
      setMessage("Seleccioná cuenta, categoría y subcategoría.");
      return;
    }
    if (!Number.isInteger(dueDay) || dueDay < 1 || dueDay > 31) {
      setMessage("El día previsto debe estar entre 1 y 31.");
      return;
    }

    setSaving(true);
    setMessage("");

    const { data, error } = await supabase
      .from("recurring_rules")
      .insert({
        household_id: householdId,
        created_by: userId,
        name: ruleName.trim(),
        transaction_type: ruleType,
        amount,
        account_id: ruleAccountId,
        category_id: ruleCategoryId,
        responsible_person_id:
          ruleResponsible === "household" ? null : ruleResponsible,
        merchant: ruleMerchant.trim() || null,
        description: ruleDescription.trim() || null,
        due_day: dueDay,
        start_month: monthDate(selectedMonth),
        end_month: null,
        active: true,
      })
      .select(
        "id, name, transaction_type, amount, account_id, category_id, responsible_person_id, merchant, description, due_day, start_month, end_month, active"
      )
      .single();

    if (error || !data) {
      console.error("Error creando recurrente:", error);
      setMessage(`Error al crear recurrente: ${error?.message ?? "sin detalle"}`);
      setSaving(false);
      return;
    }

    setRules((current) => [...current, data].sort((a, b) => a.due_day - b.due_day));
    setRuleName("");
    setRuleAmount("");
    setRuleMerchant("");
    setRuleDescription("");
    setRuleParentCategoryId("");
    setRuleCategoryId("");
    setMessage("Movimiento recurrente creado.");
    setSaving(false);
  };

  const toggleRule = async (rule: RecurringRule) => {
    const { error } = await supabase
      .from("recurring_rules")
      .update({ active: !rule.active, updated_at: new Date().toISOString() })
      .eq("id", rule.id)
      .eq("household_id", householdId);

    if (error) {
      setMessage(`Error al actualizar recurrente: ${error.message}`);
      return;
    }

    setRules((current) =>
      current.map((item) =>
        item.id === rule.id ? { ...item, active: !item.active } : item
      )
    );
  };

  const deleteRule = async (rule: RecurringRule) => {
    if (
      !window.confirm(
        "¿Eliminar esta regla recurrente? Los movimientos ya generados no se borrarán."
      )
    )
      return;

    const { error } = await supabase
      .from("recurring_rules")
      .delete()
      .eq("id", rule.id)
      .eq("household_id", householdId);

    if (error) {
      setMessage(`Error al eliminar recurrente: ${error.message}`);
      return;
    }

    setRules((current) => current.filter((item) => item.id !== rule.id));
    setGenerated((current) => {
      const next = new Set(current);
      next.delete(rule.id);
      return next;
    });
  };

  const generateRule = async (rule: RecurringRule) => {
    if (generated.has(rule.id)) return { ok: true, skipped: true };

    if (!isRuleDue(rule)) {
      const dueDate = dueDateForMonth(selectedMonth, rule.due_day);
      return {
        ok: false,
        message: `Está programado para ${formatDateShort(dueDate)}. Todavía no corresponde registrarlo como movimiento real.`,
      };
    }

    const periodMonth = monthDate(selectedMonth);

    // Antes de reservar, verificamos si quedó una occurrence huérfana de un
    // intento anterior. Sólo consideramos "generado" si realmente tiene
    // transaction_id asociado.
    const existingOccurrence = await supabase
      .from("recurring_occurrences")
      .select("id, transaction_id")
      .eq("household_id", householdId)
      .eq("rule_id", rule.id)
      .eq("period_month", periodMonth)
      .maybeSingle();

    if (existingOccurrence.error) {
      return {
        ok: false,
        message: existingOccurrence.error.message,
      };
    }

    if (existingOccurrence.data?.transaction_id) {
      setGenerated((current) => new Set([...current, rule.id]));
      return { ok: true, skipped: true };
    }

    if (existingOccurrence.data && !existingOccurrence.data.transaction_id) {
      const cleanup = await supabase
        .from("recurring_occurrences")
        .delete()
        .eq("id", existingOccurrence.data.id);

      if (cleanup.error) {
        return {
          ok: false,
          message: `Hay un registro recurrente incompleto que no se pudo reparar: ${cleanup.error.message}`,
        };
      }
    }

    const occurrenceResult = await supabase
      .from("recurring_occurrences")
      .insert({
        household_id: householdId,
        rule_id: rule.id,
        period_month: periodMonth,
      })
      .select("id")
      .single();

    if (occurrenceResult.error || !occurrenceResult.data) {
      return {
        ok: false,
        message: occurrenceResult.error?.message ?? "No se pudo reservar el recurrente.",
      };
    }

    const person = rule.responsible_person_id
      ? personById.get(rule.responsible_person_id)
      : undefined;
    const category = categoryById.get(rule.category_id);
    const transactionDate = dueDateForMonth(selectedMonth, rule.due_day);

    const transactionResult = await supabase
      .from("transactions")
      .insert({
        household_id: householdId,
        created_by: userId,
        responsible_person_id: rule.responsible_person_id,
        responsible_user_id: person?.linked_user_id ?? null,
        account_id: rule.account_id,
        destination_account_id: null,
        category_id: rule.category_id,
        transaction_type: rule.transaction_type,
        amount: Number(rule.amount),
        currency: "ARS",
        transaction_date: transactionDate,
        description: rule.description,
        merchant: rule.merchant || rule.name,
        economic_destination: "household",
        necessity:
          rule.transaction_type === "expense" ? category?.economic_type ?? null : null,
        is_recurring: true,
        input_source: "manual",
        status: "confirmed",
      })
      .select("id")
      .single();

    if (transactionResult.error || !transactionResult.data) {
      await supabase
        .from("recurring_occurrences")
        .delete()
        .eq("id", occurrenceResult.data.id);
      return {
        ok: false,
        message: transactionResult.error?.message ?? "No se pudo crear el movimiento.",
      };
    }

    const updateOccurrence = await supabase
      .from("recurring_occurrences")
      .update({ transaction_id: transactionResult.data.id })
      .eq("id", occurrenceResult.data.id);

    if (updateOccurrence.error) {
      console.error("Movimiento creado pero no se pudo enlazar occurrence:", updateOccurrence.error);
    }

    setGenerated((current) => new Set([...current, rule.id]));
    return { ok: true, skipped: false };
  };

  const generateAllPending = async () => {
    if (pendingRules.length === 0) {
      setMessage("No hay recurrentes pendientes para este mes.");
      return;
    }

    setGenerating(true);
    setMessage("");
    let created = 0;

    for (const rule of pendingRules) {
      const result = await generateRule(rule);
      if (!result.ok) {
        setMessage(`Se generaron ${created}. Error en “${rule.name}”: ${result.message}`);
        setGenerating(false);
        router.refresh();
        return;
      }
      if (!result.skipped) created += 1;
    }

    setMessage(
      `${created} movimiento${created === 1 ? "" : "s"} recurrente${created === 1 ? "" : "s"} generado${created === 1 ? "" : "s"}. ` +
        `Se registran con su fecha prevista; por ejemplo, uno del día 1 aparecerá ordenado junto a los movimientos del día 1 en el Dashboard.`
    );
    setGenerating(false);
    router.refresh();
  };

  const ruleAccountOptions = accounts.filter((account) => {
    if (ruleType === "income") return account.account_type !== "credit_card";
    return true;
  });

  return (
    <main className="min-h-screen bg-[#e7ebf0] text-slate-900">
      <div className="mx-auto max-w-6xl px-4 py-7 md:px-8 md:py-10">
        <div className="mb-7 flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
          <div>
            <a
              href={`/dashboard?month=${selectedMonth}`}
              className="mb-4 inline-flex text-sm font-medium text-slate-600 transition hover:text-slate-950"
            >
              ← Volver al dashboard
            </a>
            <div className="flex items-center gap-3">
              <h1 className="text-3xl font-bold tracking-tight text-slate-950 md:text-4xl">
                Planificación
              </h1>
              <span className="rounded-full border border-slate-200 bg-white px-2.5 py-1 text-xs font-bold text-slate-500 shadow-sm">
                v2.3.3
              </span>
            </div>
            <p className="mt-2 max-w-3xl text-sm text-slate-600">
              Presupuestá categorías y prepará gastos o ingresos que se repiten todos los meses.
            </p>
          </div>

          <label className="flex items-center gap-3 rounded-xl border border-slate-200 bg-white px-4 py-3 shadow-sm">
            <span className="text-sm font-semibold text-slate-600">Mes</span>
            <input
              type="month"
              value={selectedMonth}
              onChange={(event) => {
                window.location.href = `/planificacion?month=${event.target.value}`;
              }}
              className="bg-white text-sm font-semibold text-slate-900 outline-none"
            />
          </label>
        </div>

        {message && (
          <div className="mb-5 rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm font-medium text-slate-700 shadow-sm">
            {message}
          </div>
        )}

        <div className="mb-6 grid grid-cols-1 gap-4 md:grid-cols-3">
          <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <p className="text-sm font-medium text-slate-500">Presupuesto cargado</p>
            <p className="mt-2 text-2xl font-bold text-slate-950">{formatCurrency(budgetTotal)}</p>
            <p className="mt-1 text-xs text-slate-500">{formatMonth(selectedMonth)}</p>
          </div>
          <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <p className="text-sm font-medium text-slate-500">Gastado en categorías presupuestadas</p>
            <p className={`mt-2 text-2xl font-bold ${remainingBudget < 0 ? "text-red-600" : "text-slate-950"}`}>
              {formatCurrency(spentAgainstBudgets)}
            </p>
            <p className="mt-1 text-xs text-slate-500">
              {budgetTotal > 0 ? `${Math.round(budgetProgress)}% utilizado` : "Todavía sin presupuestos"}
            </p>
          </div>
          <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <p className="text-sm font-medium text-slate-500">Recurrentes previstos</p>
            <p className="mt-2 text-2xl font-bold text-slate-950">{formatCurrency(expectedRecurring)}</p>
            <p className="mt-1 text-xs text-slate-500">
              {pendingRules.length} pendiente{pendingRules.length === 1 ? "" : "s"} de generar
            </p>
          </div>
        </div>

        <section className="mb-6 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
          <div className="border-b border-slate-200 px-5 py-5 md:px-6">
            <h2 className="text-xl font-bold text-slate-950">Presupuesto mensual</h2>
            <p className="mt-1 text-sm text-slate-500">
              Definí cuánto querés gastar por categoría principal en {formatMonth(selectedMonth).toLowerCase()}.
            </p>
          </div>

          <div className="grid grid-cols-1 gap-5 p-5 md:grid-cols-[1fr_180px_1fr_auto] md:items-end md:p-6">
            <div>
              <label className="mb-2 block text-sm font-semibold text-slate-700">Categoría</label>
              <select
                value={budgetCategoryId}
                onChange={(event) => {
                  const value = event.target.value;
                  setBudgetCategoryId(value);
                  const existing = budgets.find((budget) => budget.category_id === value);
                  setBudgetAmount(existing ? String(existing.amount) : "");
                  setBudgetNote(existing?.note ?? "");
                }}
                className="h-12 w-full rounded-xl border border-slate-300 bg-white px-3 text-slate-900"
              >
                <option value="">Seleccionar categoría</option>
                {parentExpenseCategories.map((category) => (
                  <option key={category.id} value={category.id}>{category.name}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="mb-2 block text-sm font-semibold text-slate-700">Tope mensual</label>
              <input
                type="number"
                min="0"
                step="0.01"
                value={budgetAmount}
                onChange={(event) => setBudgetAmount(event.target.value)}
                placeholder="150000"
                className="h-12 w-full rounded-xl border border-slate-300 bg-white px-3 text-slate-900"
              />
            </div>
            <div>
              <label className="mb-2 block text-sm font-semibold text-slate-700">Nota (opcional)</label>
              <input
                value={budgetNote}
                onChange={(event) => setBudgetNote(event.target.value)}
                placeholder="Ej. bajar delivery este mes"
                className="h-12 w-full rounded-xl border border-slate-300 bg-white px-3 text-slate-900"
              />
            </div>
            <button
              type="button"
              onClick={saveBudget}
              disabled={saving}
              className="h-12 rounded-xl bg-slate-950 px-5 text-sm font-bold text-white disabled:opacity-50"
            >
              Guardar
            </button>
          </div>

          {budgets.length === 0 ? (
            <div className="border-t border-slate-200 px-6 py-8 text-center text-sm text-slate-500">
              Todavía no cargaste presupuestos para este mes.
            </div>
          ) : (
            <div className="divide-y divide-slate-200 border-t border-slate-200">
              {budgets.map((budget) => {
                const category = categoryById.get(budget.category_id);
                const spent = spentByParentCategory[budget.category_id] ?? 0;
                const amount = Number(budget.amount);
                const remaining = amount - spent;
                const percent = amount > 0 ? Math.min((spent / amount) * 100, 100) : 0;
                return (
                  <div key={budget.id} className="px-5 py-4 md:px-6">
                    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center justify-between gap-3">
                          <p className="font-semibold text-slate-900">{category?.name ?? "Categoría"}</p>
                          <p className={`text-sm font-bold ${remaining < 0 ? "text-red-600" : "text-slate-800"}`}>
                            {formatCurrency(spent)} / {formatCurrency(amount)}
                          </p>
                        </div>
                        <div className="mt-2 h-2 overflow-hidden rounded-full bg-slate-100">
                          <div
                            className={`h-full rounded-full ${remaining < 0 ? "bg-red-500" : percent >= 80 ? "bg-amber-500" : "bg-emerald-500"}`}
                            style={{ width: `${percent}%` }}
                          />
                        </div>
                        <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-slate-500">
                          <span>{remaining >= 0 ? `Disponible ${formatCurrency(remaining)}` : `Excedido ${formatCurrency(Math.abs(remaining))}`}</span>
                          {budget.note && <span>{budget.note}</span>}
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={() => deleteBudget(budget)}
                        className="text-sm font-semibold text-red-600 hover:text-red-800"
                      >
                        Eliminar
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </section>

        <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
          <div className="border-b border-slate-200 px-5 py-5 md:px-6">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <h2 className="text-xl font-bold text-slate-950">Gastos e ingresos recurrentes</h2>
                <p className="mt-1 text-sm text-slate-500">
                  Creá una regla mensual y generá el movimiento cuando llegue su fecha prevista. Los futuros quedan programados y no afectan el resultado antes de tiempo.
                </p>
                {scheduledRules.length > 0 && (
                  <p className="mt-1 text-xs font-medium text-blue-700">
                    {scheduledRules.length} recurrente{scheduledRules.length === 1 ? "" : "s"} programado{scheduledRules.length === 1 ? "" : "s"} para más adelante en este período.
                  </p>
                )}
              </div>
              <button
                type="button"
                onClick={generateAllPending}
                disabled={generating || pendingRules.length === 0}
                className="rounded-xl bg-blue-600 px-4 py-3 text-sm font-bold text-white transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-40"
              >
                {generating ? "Generando..." : `Generar pendientes (${pendingRules.length})`}
              </button>
            </div>
          </div>

          <div className="border-b border-slate-200 bg-slate-50 p-5 md:p-6">
            <div className="mb-4 grid grid-cols-2 gap-3">
              <button
                type="button"
                onClick={() => {
                  setRuleType("expense");
                  setRuleAccountId("");
                  setRuleParentCategoryId("");
                  setRuleCategoryId("");
                }}
                className={`rounded-xl border py-3 font-semibold ${ruleType === "expense" ? "border-red-600 bg-red-600 text-white" : "border-slate-200 bg-white text-slate-700"}`}
              >
                Gasto recurrente
              </button>
              <button
                type="button"
                onClick={() => {
                  setRuleType("income");
                  setRuleAccountId("");
                  setRuleParentCategoryId("");
                  setRuleCategoryId("");
                }}
                className={`rounded-xl border py-3 font-semibold ${ruleType === "income" ? "border-emerald-600 bg-emerald-600 text-white" : "border-slate-200 bg-white text-slate-700"}`}
              >
                Ingreso recurrente
              </button>
            </div>

            <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-4">
              <div className="lg:col-span-2">
                <label className="mb-1.5 block text-sm font-semibold text-slate-700">Nombre</label>
                <input value={ruleName} onChange={(e) => setRuleName(e.target.value)} placeholder="Ej. Telecentro / Sueldo Leo" className="h-12 w-full rounded-xl border border-slate-300 bg-white px-3" />
              </div>
              <div>
                <label className="mb-1.5 block text-sm font-semibold text-slate-700">Importe estimado</label>
                <input type="number" min="0" step="0.01" value={ruleAmount} onChange={(e) => setRuleAmount(e.target.value)} placeholder="45000" className="h-12 w-full rounded-xl border border-slate-300 bg-white px-3" />
              </div>
              <div>
                <label className="mb-1.5 block text-sm font-semibold text-slate-700">Día previsto</label>
                <input type="number" min="1" max="31" value={ruleDueDay} onChange={(e) => setRuleDueDay(e.target.value)} className="h-12 w-full rounded-xl border border-slate-300 bg-white px-3" />
                <p className="mt-1 text-[11px] text-slate-500">Entre 1 y 31. Si el mes tiene menos días, se usa el último día del mes.</p>
              </div>
              <div className="lg:col-span-2">
                <label className="mb-1.5 block text-sm font-semibold text-slate-700">Cuenta</label>
                <select value={ruleAccountId} onChange={(e) => setRuleAccountId(e.target.value)} className="h-12 w-full rounded-xl border border-slate-300 bg-white px-3">
                  <option value="">Seleccionar cuenta</option>
                  {ruleAccountOptions.map((account) => (
                    <option key={account.id} value={account.id}>{account.name}{account.account_type === "credit_card" ? " · tarjeta" : ""}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="mb-1.5 block text-sm font-semibold text-slate-700">Categoría</label>
                <select value={ruleParentCategoryId} onChange={(e) => { setRuleParentCategoryId(e.target.value); setRuleCategoryId(""); }} className="h-12 w-full rounded-xl border border-slate-300 bg-white px-3">
                  <option value="">Seleccionar</option>
                  {ruleParentCategories.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}
                </select>
              </div>
              <div>
                <label className="mb-1.5 block text-sm font-semibold text-slate-700">Subcategoría</label>
                <select value={ruleCategoryId} onChange={(e) => setRuleCategoryId(e.target.value)} disabled={!ruleParentCategoryId} className="h-12 w-full rounded-xl border border-slate-300 bg-white px-3 disabled:bg-slate-100">
                  <option value="">Seleccionar</option>
                  {ruleSubcategories.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}
                </select>
              </div>
              <div>
                <label className="mb-1.5 block text-sm font-semibold text-slate-700">¿Para quién será?</label>
                <select value={ruleResponsible} onChange={(e) => setRuleResponsible(e.target.value)} className="h-12 w-full rounded-xl border border-slate-300 bg-white px-3">
                  <option value="household">Hogar</option>
                  {people.map((person) => <option key={person.id} value={person.id}>{person.full_name}</option>)}
                </select>
              </div>
              <div>
                <label className="mb-1.5 block text-sm font-semibold text-slate-700">Comercio / origen</label>
                <input value={ruleMerchant} onChange={(e) => setRuleMerchant(e.target.value)} placeholder="Opcional" className="h-12 w-full rounded-xl border border-slate-300 bg-white px-3" />
              </div>
              <div className="lg:col-span-2">
                <label className="mb-1.5 block text-sm font-semibold text-slate-700">Descripción</label>
                <input value={ruleDescription} onChange={(e) => setRuleDescription(e.target.value)} placeholder="Opcional" className="h-12 w-full rounded-xl border border-slate-300 bg-white px-3" />
              </div>
              <div className="flex items-end lg:col-span-2">
                <button type="button" onClick={createRule} disabled={saving} className="h-12 w-full rounded-xl bg-slate-950 px-5 text-sm font-bold text-white disabled:opacity-50">
                  Crear recurrente
                </button>
              </div>
            </div>
          </div>

          {rules.length === 0 ? (
            <div className="px-6 py-10 text-center text-sm text-slate-500">Todavía no hay reglas recurrentes.</div>
          ) : (
            <div className="divide-y divide-slate-200">
              {rules.map((rule) => {
                const account = accountById.get(rule.account_id);
                const subcategory = categoryById.get(rule.category_id);
                const parent = subcategory?.parent_id ? categoryById.get(subcategory.parent_id) : undefined;
                const person = rule.responsible_person_id ? personById.get(rule.responsible_person_id) : undefined;
                const eligible = isRuleEligible(rule);
                const isGenerated = generated.has(rule.id);
                const dueDate = dueDateForMonth(selectedMonth, rule.due_day);
                const dueNow = isRuleDue(rule);
                return (
                  <div key={rule.id} className="px-5 py-4 md:px-6">
                    <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <p className="font-semibold text-slate-900">{rule.name}</p>
                          <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${rule.transaction_type === "expense" ? "bg-red-50 text-red-700" : "bg-emerald-50 text-emerald-700"}`}>
                            {rule.transaction_type === "expense" ? "Gasto" : "Ingreso"}
                          </span>
                          {!rule.active && <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-semibold text-slate-500">Pausado</span>}
                          {eligible && isGenerated && (
                            <span className="rounded-full bg-blue-50 px-2 py-0.5 text-[11px] font-semibold text-blue-700">
                              Registrado {formatDateShort(dueDate)}
                            </span>
                          )}
                          {eligible && !isGenerated && !dueNow && (
                            <span className="rounded-full bg-violet-50 px-2 py-0.5 text-[11px] font-semibold text-violet-700">
                              Programado {formatDateShort(dueDate)}
                            </span>
                          )}
                        </div>
                        <p className="mt-1 text-lg font-bold text-slate-950">{formatCurrency(Number(rule.amount))}</p>
                        <p className="mt-1 text-xs text-slate-500">
                          Día {rule.due_day} · {account?.name ?? "Cuenta"} · {parent?.name ?? ""}{parent ? " · " : ""}{subcategory?.name ?? "Categoría"} · {person?.full_name ?? "Hogar"}
                        </p>
                      </div>
                      <div className="flex flex-wrap gap-2">
                        {eligible && !isGenerated && dueNow && (
                          <button
                            type="button"
                            onClick={async () => {
                              setGenerating(true);
                              const result = await generateRule(rule);
                              setGenerating(false);
                              if (!result.ok) setMessage(`Error: ${result.message}`);
                              else {
                                setMessage(
                                  result.skipped
                                    ? "Ya estaba generado."
                                    : `Movimiento registrado con fecha ${formatDateShort(dueDate)}. En el Dashboard se ordena por la fecha del movimiento.`
                                );
                                router.refresh();
                              }
                            }}
                            disabled={generating}
                            className="rounded-lg bg-blue-600 px-3 py-2 text-xs font-bold text-white disabled:opacity-50"
                          >
                            Generar ahora
                          </button>
                        )}
                        {eligible && !isGenerated && !dueNow && (
                          <span className="rounded-lg border border-violet-200 bg-violet-50 px-3 py-2 text-xs font-semibold text-violet-700">
                            Aún no venció
                          </span>
                        )}
                        <button type="button" onClick={() => toggleRule(rule)} className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-semibold text-slate-700">
                          {rule.active ? "Pausar" : "Activar"}
                        </button>
                        <button type="button" onClick={() => deleteRule(rule)} className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs font-semibold text-red-700">
                          Eliminar
                        </button>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </section>
      </div>
    </main>
  );
}
