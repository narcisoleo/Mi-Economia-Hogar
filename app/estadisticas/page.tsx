import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { MonthSelector } from "@/components/month-selector";

export const instant = false;

type StatisticsPageProps = {
  searchParams?: Promise<{ month?: string }>;
};

type Transaction = {
  id: string;
  transaction_date: string;
  amount: number | string;
  transaction_type: string;
  merchant: string | null;
  description: string | null;
  account_id: string | null;
  category_id: string | null;
  responsible_person_id: string | null;
  responsible_user_id: string | null;
  status: string;
};

type Account = {
  id: string;
  name: string;
  account_type: string;
};

type Category = {
  id: string;
  name: string;
  parent_id: string | null;
};

type HouseholdPerson = {
  id: string;
  full_name: string;
  linked_user_id: string | null;
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

function normalizeMonth(value?: string) {
  if (value && /^\d{4}-(0[1-9]|1[0-2])$/.test(value)) return value;
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
}

function shiftMonth(monthValue: string, offset: number) {
  const [year, month] = monthValue.split("-").map(Number);
  const date = new Date(year, month - 1 + offset, 1);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

function formatMonthLabel(monthValue: string) {
  const [year, month] = monthValue.split("-").map(Number);
  const monthName = MONTH_NAMES[month - 1] ?? "";
  return `${monthName.charAt(0).toUpperCase()}${monthName.slice(1)} ${year}`;
}

function shortMonth(monthValue: string) {
  const [, month] = monthValue.split("-").map(Number);
  const name = MONTH_NAMES[month - 1] ?? "";
  return name.slice(0, 3).replace(/^./, (letter) => letter.toUpperCase());
}

function buildMonthOptions(selectedMonth: string) {
  return Array.from({ length: 25 }, (_, index) => {
    const value = shiftMonth(selectedMonth, index - 12);
    return { value, label: formatMonthLabel(value) };
  }).reverse();
}

export default async function EstadisticasPage({ searchParams }: StatisticsPageProps) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/auth/login");

  const { data: membership, error: membershipError } = await supabase
    .from("household_members")
    .select("household_id")
    .eq("user_id", user.id)
    .single();

  if (membershipError || !membership) {
    return (
      <main className="min-h-screen bg-[#e7ebf0] px-4 py-10 text-slate-900">
        <div className="mx-auto max-w-3xl rounded-2xl border border-red-200 bg-white p-6 shadow-sm">
          <h1 className="text-xl font-bold text-slate-950">ECO HOGAR</h1>
          <p className="mt-2 text-red-700">No se pudo identificar el hogar.</p>
        </div>
      </main>
    );
  }

  const params = searchParams ? await searchParams : undefined;
  const selectedMonth = normalizeMonth(params?.month);
  const householdId = membership.household_id;
  const startHistoryMonth = shiftMonth(selectedMonth, -5);
  const startHistory = `${startHistoryMonth}-01`;
  const nextSelectedMonth = shiftMonth(selectedMonth, 1);
  const endHistory = `${nextSelectedMonth}-01`;
  const previousMonth = shiftMonth(selectedMonth, -1);
  const nextMonth = shiftMonth(selectedMonth, 1);
  const monthOptions = buildMonthOptions(selectedMonth);

  const [transactionsResult, accountsResult, categoriesResult, peopleResult] =
    await Promise.all([
      supabase
        .from("transactions")
        .select(`
          id,
          transaction_date,
          amount,
          transaction_type,
          merchant,
          description,
          account_id,
          category_id,
          responsible_person_id,
          responsible_user_id,
          status
        `)
        .eq("household_id", householdId)
        .eq("status", "confirmed")
        .gte("transaction_date", startHistory)
        .lt("transaction_date", endHistory)
        .order("transaction_date", { ascending: true }),
      supabase
        .from("accounts")
        .select("id, name, account_type")
        .eq("household_id", householdId)
        .eq("active", true),
      supabase
        .from("categories")
        .select("id, name, parent_id")
        .eq("household_id", householdId)
        .eq("active", true),
      supabase
        .from("household_people")
        .select("id, full_name, linked_user_id")
        .eq("household_id", householdId)
        .eq("active", true),
    ]);

  const errors = [
    transactionsResult.error,
    accountsResult.error,
    categoriesResult.error,
    peopleResult.error,
  ].filter(Boolean);

  if (errors.length > 0) {
    console.error("Error cargando estadísticas:", errors);
  }

  const transactions = ((transactionsResult.data ?? []) as Transaction[]).filter(
    (transaction) => transaction.transaction_type !== "adjustment"
  );
  const accounts = (accountsResult.data ?? []) as Account[];
  const categories = (categoriesResult.data ?? []) as Category[];
  const people = (peopleResult.data ?? []) as HouseholdPerson[];

  const accountById = new Map(accounts.map((account) => [account.id, account]));
  const categoryById = new Map(categories.map((category) => [category.id, category]));
  const personById = new Map(people.map((person) => [person.id, person]));
  const personByLinkedUserId = new Map(
    people
      .filter((person) => person.linked_user_id)
      .map((person) => [person.linked_user_id as string, person])
  );

  const monthKeyForDate = (date: string) => date.slice(0, 7);
  const historyMonths = Array.from({ length: 6 }, (_, index) =>
    shiftMonth(selectedMonth, index - 5)
  );

  const selectedTransactions = transactions.filter(
    (transaction) => monthKeyForDate(transaction.transaction_date) === selectedMonth
  );
  const previousTransactions = transactions.filter(
    (transaction) => monthKeyForDate(transaction.transaction_date) === previousMonth
  );

  const sumType = (rows: Transaction[], type: string) =>
    rows
      .filter((transaction) => transaction.transaction_type === type)
      .reduce((sum, transaction) => sum + Number(transaction.amount), 0);

  const currentIncome = sumType(selectedTransactions, "income");
  const currentExpense = sumType(selectedTransactions, "expense");
  const previousExpense = sumType(previousTransactions, "expense");
  const currentResult = currentIncome - currentExpense;
  const expenseVariation =
    previousExpense > 0
      ? ((currentExpense - previousExpense) / previousExpense) * 100
      : null;
  const savingsRate = currentIncome > 0 ? (currentResult / currentIncome) * 100 : null;

  const monthlySeries = historyMonths.map((month) => {
    const rows = transactions.filter(
      (transaction) => monthKeyForDate(transaction.transaction_date) === month
    );
    const income = sumType(rows, "income");
    const expense = sumType(rows, "expense");
    return {
      month,
      income,
      expense,
      result: income - expense,
    };
  });

  const monthsWithExpense = monthlySeries.filter((item) => item.expense > 0);
  const sixMonthAverageExpense =
    monthsWithExpense.length > 0
      ? monthsWithExpense.reduce((sum, item) => sum + item.expense, 0) /
        monthsWithExpense.length
      : 0;
  const highestExpenseMonth = monthlySeries.reduce(
    (best, item) => (item.expense > best.expense ? item : best),
    monthlySeries[0] ?? { month: selectedMonth, income: 0, expense: 0, result: 0 }
  );
  const chartMax = Math.max(
    1,
    ...monthlySeries.flatMap((item) => [item.income, item.expense])
  );

  const parentCategoryFor = (categoryId: string | null) => {
    if (!categoryId) return null;
    const category = categoryById.get(categoryId);
    if (!category) return null;
    return category.parent_id ? categoryById.get(category.parent_id) ?? category : category;
  };

  const expenseByCategory = new Map<string, number>();
  for (const transaction of selectedTransactions) {
    if (transaction.transaction_type !== "expense") continue;
    const parent = parentCategoryFor(transaction.category_id);
    const name = parent?.name ?? "Sin categoría";
    expenseByCategory.set(
      name,
      (expenseByCategory.get(name) ?? 0) + Number(transaction.amount)
    );
  }
  const categoryRows = Array.from(expenseByCategory.entries())
    .map(([name, amount]) => ({ name, amount }))
    .sort((a, b) => b.amount - a.amount);
  const maxCategoryExpense = Math.max(1, ...categoryRows.map((row) => row.amount));

  const responsibleName = (transaction: Transaction) => {
    if (transaction.responsible_person_id) {
      return personById.get(transaction.responsible_person_id)?.full_name ?? "Hogar";
    }
    if (transaction.responsible_user_id) {
      return personByLinkedUserId.get(transaction.responsible_user_id)?.full_name ?? "Hogar";
    }
    return "Hogar";
  };

  const expenseByPerson = new Map<string, number>();
  for (const transaction of selectedTransactions) {
    if (transaction.transaction_type !== "expense") continue;
    const name = responsibleName(transaction);
    expenseByPerson.set(
      name,
      (expenseByPerson.get(name) ?? 0) + Number(transaction.amount)
    );
  }
  const personRows = Array.from(expenseByPerson.entries())
    .map(([name, amount]) => ({ name, amount }))
    .sort((a, b) => b.amount - a.amount);
  const maxPersonExpense = Math.max(1, ...personRows.map((row) => row.amount));

  let cardExpenses = 0;
  let realMoneyExpenses = 0;
  for (const transaction of selectedTransactions) {
    if (transaction.transaction_type !== "expense") continue;
    const amount = Number(transaction.amount);
    const account = transaction.account_id
      ? accountById.get(transaction.account_id)
      : undefined;
    if (account?.account_type === "credit_card") cardExpenses += amount;
    else realMoneyExpenses += amount;
  }

  const merchantTotals = new Map<string, number>();
  for (const transaction of selectedTransactions) {
    if (transaction.transaction_type !== "expense") continue;
    const merchant = (transaction.merchant || transaction.description || "Sin comercio").trim();
    merchantTotals.set(
      merchant,
      (merchantTotals.get(merchant) ?? 0) + Number(transaction.amount)
    );
  }
  const topMerchants = Array.from(merchantTotals.entries())
    .map(([name, amount]) => ({ name, amount }))
    .sort((a, b) => b.amount - a.amount)
    .slice(0, 8);

  const formatCurrency = (value: number) =>
    new Intl.NumberFormat("es-AR", {
      style: "currency",
      currency: "ARS",
      maximumFractionDigits: 0,
    }).format(value);

  const formatPercent = (value: number) =>
    new Intl.NumberFormat("es-AR", {
      maximumFractionDigits: 1,
      minimumFractionDigits: 0,
    }).format(value);

  return (
    <main className="min-h-screen bg-[#e7ebf0] text-slate-900">
      <div className="mx-auto max-w-6xl px-4 py-7 md:px-8 md:py-10">
        <div className="mb-7 flex flex-col gap-5 md:flex-row md:items-end md:justify-between">
          <div>
            <a
              href={`/dashboard?month=${selectedMonth}`}
              className="mb-4 inline-flex text-sm font-medium text-slate-600 transition hover:text-slate-950"
            >
              ← Volver al dashboard
            </a>
            <div className="flex items-center gap-3">
              <h1 className="text-3xl font-bold tracking-tight text-slate-950 md:text-4xl">
                Estadísticas
              </h1>
              <span className="rounded-full border border-slate-200 bg-white px-2.5 py-1 text-xs font-bold text-slate-500 shadow-sm">
                v2.3.3
              </span>
            </div>
            <p className="mt-2 text-sm text-slate-600">
              Analizá cómo se distribuyen y evolucionan las finanzas del hogar.
            </p>
          </div>

          <MonthSelector
            selectedMonth={selectedMonth}
            options={monthOptions}
            previousMonth={previousMonth}
            nextMonth={nextMonth}
            basePath="/estadisticas"
          />
        </div>

        <div className="mb-5">
          <p className="text-sm font-medium text-slate-500">Análisis de</p>
          <h2 className="text-xl font-bold text-slate-950">
            {formatMonthLabel(selectedMonth)}
          </h2>
        </div>

        <section className="mb-5 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <p className="text-sm font-medium text-slate-500">Gasto del mes</p>
            <p className="mt-2 text-2xl font-bold text-red-600">
              {formatCurrency(currentExpense)}
            </p>
            <p className="mt-2 text-xs text-slate-500">
              {expenseVariation === null ? (
                "Sin base suficiente para comparar."
              ) : (
                <>
                  <strong
                    className={
                      expenseVariation > 0
                        ? "text-red-600"
                        : expenseVariation < 0
                          ? "text-emerald-700"
                          : "text-slate-700"
                    }
                  >
                    {expenseVariation > 0 ? "+" : ""}
                    {formatPercent(expenseVariation)}%
                  </strong>{" "}
                  vs. {formatMonthLabel(previousMonth)}
                </>
              )}
            </p>
          </div>

          <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <p className="text-sm font-medium text-slate-500">Ingreso del mes</p>
            <p className="mt-2 text-2xl font-bold text-emerald-600">
              {formatCurrency(currentIncome)}
            </p>
            <p className="mt-2 text-xs text-slate-500">Ingresos confirmados del período.</p>
          </div>

          <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <p className="text-sm font-medium text-slate-500">Resultado</p>
            <p
              className={`mt-2 text-2xl font-bold ${
                currentResult < 0 ? "text-red-600" : "text-slate-950"
              }`}
            >
              {formatCurrency(currentResult)}
            </p>
            <p className="mt-2 text-xs text-slate-500">Ingresos menos gastos.</p>
          </div>

          <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <p className="text-sm font-medium text-slate-500">Tasa de ahorro</p>
            <p
              className={`mt-2 text-2xl font-bold ${
                savingsRate !== null && savingsRate < 0
                  ? "text-red-600"
                  : "text-blue-700"
              }`}
            >
              {savingsRate === null ? "—" : `${formatPercent(savingsRate)}%`}
            </p>
            <p className="mt-2 text-xs text-slate-500">
              Parte del ingreso que queda después de los gastos.
            </p>
          </div>
        </section>

        <section className="mb-5 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm md:p-6">
          <div className="mb-5 flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <h2 className="text-lg font-bold text-slate-950">Evolución de 6 meses</h2>
              <p className="mt-1 text-xs text-slate-500">
                Comparación de ingresos y gastos mes a mes.
              </p>
            </div>
            <div className="flex flex-wrap gap-4 text-xs text-slate-600">
              <span><strong className="text-slate-900">Promedio gasto:</strong> {formatCurrency(sixMonthAverageExpense)}</span>
              <span><strong className="text-slate-900">Mayor gasto:</strong> {formatMonthLabel(highestExpenseMonth.month)}</span>
            </div>
          </div>

          <div className="overflow-x-auto">
            <div className="grid min-w-[640px] grid-cols-6 gap-3">
              {monthlySeries.map((item) => {
                const incomeHeight = Math.max(3, (item.income / chartMax) * 150);
                const expenseHeight = Math.max(3, (item.expense / chartMax) * 150);
                return (
                  <div key={item.month} className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                    <div className="flex h-40 items-end justify-center gap-2">
                      <div
                        title={`Ingresos ${formatCurrency(item.income)}`}
                        className="w-5 rounded-t bg-emerald-500"
                        style={{ height: `${incomeHeight}px` }}
                      />
                      <div
                        title={`Gastos ${formatCurrency(item.expense)}`}
                        className="w-5 rounded-t bg-red-500"
                        style={{ height: `${expenseHeight}px` }}
                      />
                    </div>
                    <p className="mt-2 text-center text-xs font-bold text-slate-700">
                      {shortMonth(item.month)}
                    </p>
                    <p className={`mt-1 text-center text-xs font-semibold ${item.result < 0 ? "text-red-600" : "text-emerald-700"}`}>
                      {formatCurrency(item.result)}
                    </p>
                  </div>
                );
              })}
            </div>
          </div>

          <div className="mt-4 flex items-center gap-5 text-xs text-slate-500">
            <span className="flex items-center gap-2"><span className="h-2.5 w-2.5 rounded-sm bg-emerald-500" /> Ingresos</span>
            <span className="flex items-center gap-2"><span className="h-2.5 w-2.5 rounded-sm bg-red-500" /> Gastos</span>
          </div>
        </section>

        <div className="mb-5 grid grid-cols-1 gap-5 lg:grid-cols-2">
          <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm md:p-6">
            <h2 className="text-lg font-bold text-slate-950">Gastos por categoría</h2>
            <p className="mt-1 text-xs text-slate-500">Dónde se fue el dinero durante el mes.</p>

            {categoryRows.length === 0 ? (
              <p className="mt-6 text-sm text-slate-500">No hay gastos para analizar.</p>
            ) : (
              <div className="mt-5 space-y-4">
                {categoryRows.slice(0, 10).map((row) => {
                  const percent = currentExpense > 0 ? (row.amount / currentExpense) * 100 : 0;
                  return (
                    <div key={row.name}>
                      <div className="mb-1.5 flex items-center justify-between gap-3 text-sm">
                        <span className="font-medium text-slate-700">{row.name}</span>
                        <span className="text-right">
                          <strong className="text-slate-950">{formatCurrency(row.amount)}</strong>
                          <span className="ml-2 text-xs text-slate-400">{formatPercent(percent)}%</span>
                        </span>
                      </div>
                      <div className="h-2.5 overflow-hidden rounded-full bg-slate-100">
                        <div
                          className="h-full rounded-full bg-slate-700"
                          style={{ width: `${Math.max(1, (row.amount / maxCategoryExpense) * 100)}%` }}
                        />
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </section>

          <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm md:p-6">
            <h2 className="text-lg font-bold text-slate-950">Gastos según para quién fueron</h2>
            <p className="mt-1 text-xs text-slate-500">Distribución entre Hogar, Leonardo, Sofía y Alma; no indica quién usó la cuenta para pagar.</p>

            {personRows.length === 0 ? (
              <p className="mt-6 text-sm text-slate-500">No hay gastos para analizar.</p>
            ) : (
              <div className="mt-5 space-y-4">
                {personRows.map((row) => {
                  const percent = currentExpense > 0 ? (row.amount / currentExpense) * 100 : 0;
                  return (
                    <div key={row.name}>
                      <div className="mb-1.5 flex items-center justify-between gap-3 text-sm">
                        <span className="font-medium text-slate-700">{row.name}</span>
                        <span className="text-right">
                          <strong className="text-slate-950">{formatCurrency(row.amount)}</strong>
                          <span className="ml-2 text-xs text-slate-400">{formatPercent(percent)}%</span>
                        </span>
                      </div>
                      <div className="h-2.5 overflow-hidden rounded-full bg-slate-100">
                        <div
                          className="h-full rounded-full bg-blue-600"
                          style={{ width: `${Math.max(1, (row.amount / maxPersonExpense) * 100)}%` }}
                        />
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </section>
        </div>

        <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
          <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm md:p-6">
            <h2 className="text-lg font-bold text-slate-950">Cómo pagaste los gastos</h2>
            <p className="mt-1 text-xs text-slate-500">Separa dinero real de compras financiadas con tarjeta.</p>

            <div className="mt-5 grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-4">
                <p className="text-xs font-semibold uppercase tracking-wide text-emerald-700">Dinero real</p>
                <p className="mt-2 text-xl font-bold text-emerald-900">{formatCurrency(realMoneyExpenses)}</p>
                <p className="mt-1 text-xs text-emerald-700">
                  {currentExpense > 0 ? `${formatPercent((realMoneyExpenses / currentExpense) * 100)}% del gasto` : "Sin gastos"}
                </p>
              </div>
              <div className="rounded-xl border border-violet-200 bg-violet-50 p-4">
                <p className="text-xs font-semibold uppercase tracking-wide text-violet-700">Tarjetas</p>
                <p className="mt-2 text-xl font-bold text-violet-900">{formatCurrency(cardExpenses)}</p>
                <p className="mt-1 text-xs text-violet-700">
                  {currentExpense > 0 ? `${formatPercent((cardExpenses / currentExpense) * 100)}% del gasto` : "Sin gastos"}
                </p>
              </div>
            </div>
          </section>

          <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm md:p-6">
            <h2 className="text-lg font-bold text-slate-950">Principales comercios / conceptos</h2>
            <p className="mt-1 text-xs text-slate-500">Los lugares o conceptos donde más gastaste.</p>

            {topMerchants.length === 0 ? (
              <p className="mt-6 text-sm text-slate-500">No hay gastos para analizar.</p>
            ) : (
              <div className="mt-4 divide-y divide-slate-100">
                {topMerchants.map((merchant, index) => (
                  <div key={`${merchant.name}-${index}`} className="flex items-center justify-between gap-4 py-3 text-sm">
                    <div className="flex min-w-0 items-center gap-3">
                      <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-slate-100 text-xs font-bold text-slate-500">
                        {index + 1}
                      </span>
                      <span className="truncate font-medium text-slate-700">{merchant.name}</span>
                    </div>
                    <strong className="whitespace-nowrap text-slate-950">{formatCurrency(merchant.amount)}</strong>
                  </div>
                ))}
              </div>
            )}
          </section>
        </div>
      </div>
    </main>
  );
}
