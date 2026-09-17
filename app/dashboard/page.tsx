import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { MonthSelector } from "@/components/month-selector";
import { TransactionActions } from "@/components/transaction-actions";
import { PwaInstallButton } from "@/components/pwa-install-button";
import { LogoutButton } from "@/components/logout-button";
import { VoiceMovementButton } from "@/components/voice-movement-button";

export const instant = false;

type DashboardPageProps = {
  searchParams?: Promise<{
    month?: string;
    type?: string;
    account?: string;
    person?: string;
    category?: string;
    q?: string;
    position?: string;
  }>;
};

type Transaction = {
  id: string;
  transaction_date: string;
  amount: number | string;
  transaction_type: string;
  merchant: string | null;
  description: string | null;
  account_id: string | null;
  destination_account_id: string | null;
  category_id: string | null;
  responsible_person_id: string | null;
  responsible_user_id: string | null;
  status: string;
  is_recurring: boolean | null;
  input_source: string | null;
  receipt_url: string | null;
};

type BalanceTransaction = {
  transaction_date: string;
  amount: number | string;
  transaction_type: string;
  account_id: string | null;
  destination_account_id: string | null;
  economic_destination: string | null;
  merchant: string | null;
};

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
};

type HouseholdPerson = {
  id: string;
  full_name: string;
  linked_user_id: string | null;
};

type CreditCardConfig = {
  account_id: string;
  credit_limit: number | string;
  active: boolean;
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
  if (value && /^\d{4}-(0[1-9]|1[0-2])$/.test(value)) {
    return value;
  }

  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  return `${year}-${month}`;
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

function buildMonthOptions(selectedMonth: string) {
  return Array.from({ length: 25 }, (_, index) => {
    const value = shiftMonth(selectedMonth, index - 12);
    return { value, label: formatMonthLabel(value) };
  }).reverse();
}

function cleanFilter(value?: string) {
  return typeof value === "string" ? value.trim() : "";
}

export default async function DashboardPage({
  searchParams,
}: DashboardPageProps) {
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
    // Si hay MFA pendiente, esto no es "hogar inexistente": la sesión debe
    // completar el segundo factor antes de consultar household_members.
    const { data: aalData } =
      await supabase.auth.mfa.getAuthenticatorAssuranceLevel();

    if (aalData?.currentLevel === "aal1" && aalData?.nextLevel === "aal2") {
      redirect("/auth/mfa");
    }

    const localDiagnostic =
      process.env.NODE_ENV !== "production" && membershipError
        ? ` Código: ${membershipError.code ?? "sin código"}. ${membershipError.message ?? ""}`
        : "";

    return (
      <main className="min-h-screen bg-[#e7ebf0] px-4 py-10 text-slate-900">
        <div className="mx-auto max-w-3xl rounded-2xl border border-red-200 bg-white p-6 shadow-sm">
          <h1 className="text-xl font-bold text-slate-950">ECO HOGAR</h1>
          <p className="mt-2 text-red-700">
            No se pudo acceder a la membresía del hogar. La sesión existe, pero una política de acceso está bloqueando la consulta.{localDiagnostic}
          </p>
          <p className="mt-3 text-sm text-slate-600">
            No significa que el hogar o los movimientos se hayan borrado.
          </p>
        </div>
      </main>
    );
  }

  const householdId = membership.household_id;
  const params = searchParams ? await searchParams : undefined;

  const selectedMonth = normalizeMonth(params?.month);
  const selectedType = cleanFilter(params?.type);
  const selectedAccount = cleanFilter(params?.account);
  const selectedPerson = cleanFilter(params?.person);
  const selectedCategory = cleanFilter(params?.category);
  const searchText = cleanFilter(params?.q);
  const selectedPosition = params?.position === "close" ? "close" : "current";

  const [selectedYear, selectedMonthNumber] = selectedMonth
    .split("-")
    .map(Number);

  const startOfMonth = `${selectedYear}-${String(selectedMonthNumber).padStart(2, "0")}-01`;
  const nextMonthValue = shiftMonth(selectedMonth, 1);
  const startOfNextMonth = `${nextMonthValue}-01`;

  const previousMonth = shiftMonth(selectedMonth, -1);
  const nextMonth = shiftMonth(selectedMonth, 1);
  const monthOptions = buildMonthOptions(selectedMonth);
  const monthLabel = formatMonthLabel(selectedMonth);

  const now = new Date();
  const todayDate = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
  const lastDayOfSelectedMonth = new Date(
    Date.UTC(selectedYear, selectedMonthNumber, 0)
  ).getUTCDate();
  const selectedMonthEndDate = `${selectedMonth}-${String(lastDayOfSelectedMonth).padStart(2, "0")}`;
  const positionThroughDate =
    selectedPosition === "close" ? selectedMonthEndDate : todayDate;

  const [
    transactionsResult,
    balanceTransactionsResult,
    accountsResult,
    categoriesResult,
    peopleResult,
    cardsResult,
  ] = await Promise.all([
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
        destination_account_id,
        category_id,
        responsible_person_id,
        responsible_user_id,
        status,
        is_recurring,
        input_source,
        receipt_url
      `)
      .eq("household_id", householdId)
      .eq("status", "confirmed")
      .gte("transaction_date", startOfMonth)
      .lt("transaction_date", startOfNextMonth)
      .order("transaction_date", { ascending: false }),

    supabase
      .from("transactions")
      .select("transaction_date, amount, transaction_type, account_id, destination_account_id, economic_destination, merchant")
      .eq("household_id", householdId)
      .eq("status", "confirmed"),

    supabase
      .from("accounts")
      .select("id, name, owner_user_id, account_type")
      .eq("household_id", householdId)
      .eq("active", true)
      .order("name"),

    supabase
      .from("categories")
      .select("id, name, parent_id")
      .eq("household_id", householdId)
      .eq("active", true)
      .order("name"),

    supabase
      .from("household_people")
      .select("id, full_name, linked_user_id")
      .eq("household_id", householdId)
      .eq("active", true)
      .order("full_name"),

    supabase
      .from("credit_cards")
      .select("account_id, credit_limit, active")
      .eq("household_id", householdId)
      .eq("active", true),
  ]);

  if (transactionsResult.error) {
    console.error("Error cargando movimientos:", transactionsResult.error);
  }
  if (balanceTransactionsResult.error) {
    console.error(
      "Error calculando saldos de cuentas:",
      balanceTransactionsResult.error
    );
  }
  if (accountsResult.error) {
    console.error("Error cargando cuentas:", accountsResult.error);
  }
  if (categoriesResult.error) {
    console.error("Error cargando categorías:", categoriesResult.error);
  }
  if (peopleResult.error) {
    console.error("Error cargando responsables:", peopleResult.error);
  }
  if (cardsResult.error) {
    console.error("Error cargando tarjetas para el dashboard:", cardsResult.error);
  }

  const allMonthTransactions = (transactionsResult.data ?? []) as Transaction[];
  // Los ajustes de saldo son movimientos técnicos: afectan el saldo de una cuenta,
  // pero no deben aparecer como gasto, ingreso o transferencia del mes.
  const transactions = allMonthTransactions.filter(
    (transaction) => transaction.transaction_type !== "adjustment"
  );

  const receiptPaths = Array.from(
    new Set(
      transactions
        .map((transaction) => transaction.receipt_url)
        .filter((path): path is string => Boolean(path))
    )
  );

  const receiptUrlEntries = await Promise.all(
    receiptPaths.map(async (path) => {
      const { data } = await supabase.storage
        .from("receipts")
        .createSignedUrl(path, 60 * 60);
      return [path, data?.signedUrl ?? null] as const;
    })
  );
  const receiptUrlByPath = new Map(receiptUrlEntries);
  const balanceTransactions = (balanceTransactionsResult.data ?? []) as BalanceTransaction[];
  const accounts = (accountsResult.data ?? []) as Account[];
  const categories = (categoriesResult.data ?? []) as Category[];
  const householdPeople = (peopleResult.data ?? []) as HouseholdPerson[];
  const creditCardConfigs = (cardsResult.data ?? []) as CreditCardConfig[];

  const accountById = new Map(accounts.map((account) => [account.id, account]));
  const creditCardConfigByAccountId = new Map(
    creditCardConfigs.map((config) => [config.account_id, config])
  );
  const categoryById = new Map(
    categories.map((category) => [category.id, category])
  );
  const personById = new Map(
    householdPeople.map((person) => [person.id, person])
  );
  const personByLinkedUserId = new Map(
    householdPeople
      .filter((person) => person.linked_user_id)
      .map((person) => [person.linked_user_id as string, person])
  );

  const parentCategories = categories.filter(
    (category) => category.parent_id === null
  );

  const accountOwnerName = (account: Account) => {
    if (!account.owner_user_id) return "Hogar";
    return personByLinkedUserId.get(account.owner_user_id)?.full_name ?? "Hogar";
  };

  const accountDisplayName = (account?: Account) =>
    account ? `${account.name} · ${accountOwnerName(account)}` : "Sin cuenta";

  // Posición financiera: "Actual" acumula movimientos hasta hoy.
  // "Al cierre del mes" reconstruye la foto histórica hasta el último día
  // del mes seleccionado. Los movimientos posteriores quedan fuera.
  const positionBalanceTransactions = balanceTransactions.filter(
    (transaction) => transaction.transaction_date <= positionThroughDate
  );

  // Saldos acumulados: ingresos suman, gastos restan y transferencias
  // descuentan de la cuenta origen y suman en la cuenta destino.
  const accountBalances = new Map<string, number>(
    accounts.map((account) => [account.id, 0])
  );

  for (const transaction of positionBalanceTransactions) {
    const amount = Number(transaction.amount) || 0;

    if (transaction.transaction_type === "income" && transaction.account_id) {
      accountBalances.set(
        transaction.account_id,
        (accountBalances.get(transaction.account_id) ?? 0) + amount
      );
    }

    if (transaction.transaction_type === "expense" && transaction.account_id) {
      accountBalances.set(
        transaction.account_id,
        (accountBalances.get(transaction.account_id) ?? 0) - amount
      );
    }

    if (transaction.transaction_type === "transfer") {
      if (transaction.account_id) {
        accountBalances.set(
          transaction.account_id,
          (accountBalances.get(transaction.account_id) ?? 0) - amount
        );
      }

      if (transaction.destination_account_id) {
        accountBalances.set(
          transaction.destination_account_id,
          (accountBalances.get(transaction.destination_account_id) ?? 0) + amount
        );
      }
    }

    if (transaction.transaction_type === "adjustment" && transaction.account_id) {
      const isDecrease =
        transaction.economic_destination === "balance_dec" ||
        (transaction.economic_destination !== "balance_inc" &&
          (transaction.merchant ?? "").trim().endsWith("-"));
      const signedAmount = isDecrease ? -amount : amount;

      accountBalances.set(
        transaction.account_id,
        (accountBalances.get(transaction.account_id) ?? 0) + signedAmount
      );
    }
  }

  const accountBalanceRows = accounts
    .filter((account) => account.account_type !== "credit_card")
    .map((account) => ({
      ...account,
      ownerName: accountOwnerName(account),
      balance: accountBalances.get(account.id) ?? 0,
    }))
    .sort((a, b) => {
      const aMine = a.owner_user_id === user.id ? 0 : 1;
      const bMine = b.owner_user_id === user.id ? 0 : 1;
      if (aMine !== bMine) return aMine - bMine;
      return `${a.ownerName}-${a.name}`.localeCompare(`${b.ownerName}-${b.name}`, "es");
    });

  const totalRegisteredBalance = accountBalanceRows.reduce(
    (total, account) => total + account.balance,
    0
  );

  const creditCardRows = accounts
    .filter((account) => account.account_type === "credit_card")
    .map((account) => {
      const rawBalance = accountBalances.get(account.id) ?? 0;
      const debt = Math.max(0, -rawBalance);
      const config = creditCardConfigByAccountId.get(account.id);
      const creditLimit = Number(config?.credit_limit ?? 0) || 0;
      const monthPurchases = transactions
        .filter(
          (transaction) =>
            transaction.transaction_type === "expense" &&
            transaction.account_id === account.id
        )
        .reduce((sum, transaction) => sum + Number(transaction.amount), 0);
      const monthPayments = transactions
        .filter(
          (transaction) =>
            transaction.transaction_type === "transfer" &&
            transaction.destination_account_id === account.id
        )
        .reduce((sum, transaction) => sum + Number(transaction.amount), 0);

      return {
        ...account,
        ownerName: accountOwnerName(account),
        debt,
        creditLimit,
        available: creditLimit > 0 ? creditLimit - debt : null,
        monthPurchases,
        monthPayments,
      };
    })
    .sort((a, b) => {
      const aMine = a.owner_user_id === user.id ? 0 : 1;
      const bMine = b.owner_user_id === user.id ? 0 : 1;
      if (aMine !== bMine) return aMine - bMine;
      return `${a.ownerName}-${a.name}`.localeCompare(`${b.ownerName}-${b.name}`, "es");
    });

  const totalCardDebt = creditCardRows.reduce((total, card) => total + card.debt, 0);
  const liquidNetAfterCards = totalRegisteredBalance - totalCardDebt;

  // Totales por titular. Se calculan dinámicamente para que también funcionen
  // si más adelante se agregan nuevas personas, cuentas o tarjetas.
  const realBalanceByOwner = new Map<string, number>();
  for (const account of accountBalanceRows) {
    realBalanceByOwner.set(
      account.ownerName,
      (realBalanceByOwner.get(account.ownerName) ?? 0) + account.balance
    );
  }

  const cardDebtByOwner = new Map<string, number>();
  for (const card of creditCardRows) {
    cardDebtByOwner.set(
      card.ownerName,
      (cardDebtByOwner.get(card.ownerName) ?? 0) + card.debt
    );
  }

  const currentOwnerName =
    personByLinkedUserId.get(user.id)?.full_name ?? "Leonardo";

  const ownerSummaryNames = Array.from(
    new Set([
      ...accountBalanceRows.map((account) => account.ownerName),
      ...creditCardRows.map((card) => card.ownerName),
    ])
  ).sort((a, b) => {
    if (a === currentOwnerName && b !== currentOwnerName) return -1;
    if (b === currentOwnerName && a !== currentOwnerName) return 1;
    if (a === "Hogar" && b !== "Hogar") return 1;
    if (b === "Hogar" && a !== "Hogar") return -1;
    return a.localeCompare(b, "es");
  });

  const ownerNetAfterCards = (ownerName: string) =>
    (realBalanceByOwner.get(ownerName) ?? 0) -
    (cardDebtByOwner.get(ownerName) ?? 0);

  const cardExpenses = transactions
    .filter((transaction) => {
      if (transaction.transaction_type !== "expense" || !transaction.account_id) return false;
      return accountById.get(transaction.account_id)?.account_type === "credit_card";
    })
    .reduce((total, transaction) => total + Number(transaction.amount), 0);

  const cashExpenses = transactions
    .filter((transaction) => {
      if (transaction.transaction_type !== "expense" || !transaction.account_id) return false;
      return accountById.get(transaction.account_id)?.account_type !== "credit_card";
    })
    .reduce((total, transaction) => total + Number(transaction.amount), 0);

  const expenses = transactions
    .filter((transaction) => transaction.transaction_type === "expense")
    .reduce((total, transaction) => total + Number(transaction.amount), 0);

  const incomes = transactions
    .filter((transaction) => transaction.transaction_type === "income")
    .reduce((total, transaction) => total + Number(transaction.amount), 0);

  const transferCount = transactions.filter(
    (transaction) => transaction.transaction_type === "transfer"
  ).length;

  const balance = incomes - expenses;
  const expenseCount = transactions.filter(
    (transaction) => transaction.transaction_type === "expense"
  ).length;
  const incomeCount = transactions.filter(
    (transaction) => transaction.transaction_type === "income"
  ).length;

  const filteredTransactions = transactions.filter((transaction) => {
    if (selectedType && transaction.transaction_type !== selectedType) {
      return false;
    }

    if (selectedAccount) {
      const touchesSelectedAccount =
        transaction.account_id === selectedAccount ||
        (transaction.transaction_type === "transfer" &&
          transaction.destination_account_id === selectedAccount);

      if (!touchesSelectedAccount) return false;
    }

    if (selectedCategory) {
      const category = transaction.category_id
        ? categoryById.get(transaction.category_id)
        : undefined;
      const matchesCategory =
        transaction.category_id === selectedCategory ||
        category?.parent_id === selectedCategory;
      if (!matchesCategory) return false;
    }

    if (selectedPerson) {
      if (selectedPerson === "household") {
        if (
          transaction.responsible_person_id ||
          transaction.responsible_user_id
        ) {
          return false;
        }
      } else {
        const selectedPersonData = personById.get(selectedPerson);
        const matchesCurrentPerson =
          transaction.responsible_person_id === selectedPerson;
        const matchesLegacyPerson =
          !transaction.responsible_person_id &&
          Boolean(selectedPersonData?.linked_user_id) &&
          transaction.responsible_user_id === selectedPersonData?.linked_user_id;

        if (!matchesCurrentPerson && !matchesLegacyPerson) return false;
      }
    }

    if (searchText) {
      const sourceAccount = transaction.account_id
        ? accountById.get(transaction.account_id)
        : undefined;
      const destinationAccount = transaction.destination_account_id
        ? accountById.get(transaction.destination_account_id)
        : undefined;

      const haystack = `${transaction.merchant ?? ""} ${transaction.description ?? ""} ${sourceAccount?.name ?? ""} ${destinationAccount?.name ?? ""}`.toLocaleLowerCase("es-AR");

      if (!haystack.includes(searchText.toLocaleLowerCase("es-AR"))) {
        return false;
      }
    }

    return true;
  });

  const hasActiveFilters = Boolean(
    selectedType ||
      selectedAccount ||
      selectedPerson ||
      selectedCategory ||
      searchText
  );

  const formatCurrency = (value: number) =>
    new Intl.NumberFormat("es-AR", {
      style: "currency",
      currency: "ARS",
      maximumFractionDigits: 0,
    }).format(value);

  const formatDate = (date: string) => {
    const formattedDate = new Date(`${date}T12:00:00`);
    return new Intl.DateTimeFormat("es-AR", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
    }).format(formattedDate);
  };

  const buildPositionHref = (position: "current" | "close") => {
    const query = new URLSearchParams();
    query.set("month", selectedMonth);
    query.set("position", position);
    if (selectedType) query.set("type", selectedType);
    if (selectedAccount) query.set("account", selectedAccount);
    if (selectedPerson) query.set("person", selectedPerson);
    if (selectedCategory) query.set("category", selectedCategory);
    if (searchText) query.set("q", searchText);
    return `/dashboard?${query.toString()}`;
  };

  const positionTitle =
    selectedPosition === "close"
      ? `Posición al cierre de ${monthLabel}`
      : "Posición financiera actual";

  const positionDescription =
    selectedPosition === "close"
      ? `Foto histórica acumulada hasta el ${formatDate(selectedMonthEndDate)}. Los movimientos posteriores no se incluyen.`
      : `Foto actual acumulada hasta hoy (${formatDate(todayDate)}), aunque arriba estés consultando otro mes.`;

  return (
    <main className="min-h-screen bg-[#e7ebf0] text-slate-900">
      <div className="mx-auto max-w-6xl px-4 py-7 md:px-8 md:py-10">
        <div className="mb-7 flex flex-col gap-5 md:flex-row md:items-end md:justify-between">
          <div>
            <p className="mb-1 text-sm font-semibold uppercase tracking-wider text-slate-500">
              Finanzas familiares
            </p>
            <div className="flex items-center gap-3">
              <h1 className="text-3xl font-bold tracking-tight text-slate-950 md:text-4xl">
                ECO HOGAR
              </h1>
              <span className="rounded-full border border-slate-200 bg-white px-2.5 py-1 text-xs font-bold text-slate-500 shadow-sm">
                v2.3.3
              </span>
            </div>
            <p className="mt-2 text-sm text-slate-600">{user.email}</p>
          </div>

          <MonthSelector
            selectedMonth={selectedMonth}
            options={monthOptions}
            previousMonth={previousMonth}
            nextMonth={nextMonth}
            extraParams={{ position: selectedPosition }}
          />
        </div>

        <div className="mb-4 flex items-center justify-between gap-3">
          <div>
            <p className="text-sm font-medium text-slate-500">Resumen de</p>
            <h2 className="text-xl font-bold text-slate-950">{monthLabel}</h2>
          </div>
          <div className="flex flex-wrap items-center justify-end gap-2">
            <a
              href="/cuentas"
              className="inline-flex items-center justify-center rounded-xl border border-slate-300 bg-white px-4 py-3 text-sm font-semibold text-slate-700 shadow-sm transition hover:bg-slate-50"
            >
              Cuentas y saldos
            </a>
            <a
              href="/tarjetas"
              className="inline-flex items-center justify-center rounded-xl border border-slate-300 bg-white px-4 py-3 text-sm font-semibold text-slate-700 shadow-sm transition hover:bg-slate-50"
            >
              Tarjetas
            </a>
            <a
              href={`/estadisticas?month=${selectedMonth}`}
              className="inline-flex items-center justify-center rounded-xl border border-slate-300 bg-white px-4 py-3 text-sm font-semibold text-slate-700 shadow-sm transition hover:bg-slate-50"
            >
              Estadísticas
            </a>
            <a
              href={`/planificacion?month=${selectedMonth}`}
              className="inline-flex items-center justify-center rounded-xl border border-slate-300 bg-white px-4 py-3 text-sm font-semibold text-slate-700 shadow-sm transition hover:bg-slate-50"
            >
              Planificación
            </a>
            <a
              href="/importar"
              className="inline-flex items-center justify-center rounded-xl border border-slate-300 bg-white px-4 py-3 text-sm font-semibold text-slate-700 shadow-sm transition hover:bg-slate-50"
            >
              Importar CSV
            </a>
            <a
              href="/tarjetas/resumenes"
              className="inline-flex items-center justify-center rounded-xl border border-violet-200 bg-violet-50 px-4 py-3 text-sm font-semibold text-violet-700 shadow-sm transition hover:bg-violet-100"
            >
              Resúmenes PDF
            </a>
            <a
              href="/seguridad"
              className="inline-flex items-center justify-center rounded-xl border border-slate-300 bg-white px-4 py-3 text-sm font-semibold text-slate-700 shadow-sm transition hover:bg-slate-50"
            >
              Seguridad
            </a>
            <PwaInstallButton compact />
            <LogoutButton compact />
            <VoiceMovementButton compact />
            <a
              href="/movimientos/nuevo#comprobante"
              className="inline-flex items-center justify-center rounded-xl border border-violet-200 bg-violet-50 px-4 py-3 text-sm font-semibold text-violet-700 shadow-sm transition hover:bg-violet-100"
            >
              <span className="sm:hidden">📎 Comprobante</span>
              <span className="hidden sm:inline">📎 Cargar comprobante</span>
            </a>
            <a
              href="/movimientos/nuevo"
              className="inline-flex items-center justify-center rounded-xl bg-slate-950 px-4 py-3 text-sm font-semibold text-white shadow-sm transition hover:bg-slate-800"
            >
              <span className="sm:hidden">+ Movimiento</span>
              <span className="hidden sm:inline">+ Registrar movimiento</span>
            </a>
          </div>
        </div>

        <div className="mb-5 grid grid-cols-1 gap-4 md:grid-cols-3">
          <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm md:p-6">
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="text-sm font-medium text-slate-500">Ingresos</p>
                <p className="mt-2 text-2xl font-bold text-emerald-600 md:text-3xl">
                  {formatCurrency(incomes)}
                </p>
              </div>
              <span className="rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-semibold text-emerald-700">
                {incomeCount} mov.
              </span>
            </div>
          </div>

          <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm md:p-6">
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="text-sm font-medium text-slate-500">Gastos</p>
                <p className="mt-2 text-2xl font-bold text-red-600 md:text-3xl">
                  {formatCurrency(expenses)}
                </p>
              </div>
              <span className="rounded-full bg-red-50 px-2.5 py-1 text-xs font-semibold text-red-700">
                {expenseCount} mov.
              </span>
            </div>
            <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-500">
              <span>Dinero real: <strong className="text-slate-700">{formatCurrency(cashExpenses)}</strong></span>
              <span>Tarjetas: <strong className="text-violet-700">{formatCurrency(cardExpenses)}</strong></span>
            </div>
          </div>

          <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm md:p-6">
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="text-sm font-medium text-slate-500">
                  Resultado del mes
                </p>
                <p
                  className={`mt-2 text-2xl font-bold md:text-3xl ${
                    balance > 0
                      ? "text-emerald-600"
                      : balance < 0
                        ? "text-red-600"
                        : "text-slate-900"
                  }`}
                >
                  {formatCurrency(balance)}
                </p>
              </div>
              {transferCount > 0 && (
                <span className="rounded-full bg-blue-50 px-2.5 py-1 text-xs font-semibold text-blue-700">
                  {transferCount} transf.
                </span>
              )}
            </div>
            <p className="mt-2 text-xs leading-5 text-slate-500">
              Las transferencias no alteran ingresos ni gastos. Las compras con tarjeta sí son gasto del mes,
              pero no bajan el saldo bancario hasta que registrás el pago de la tarjeta.
            </p>
          </div>
        </div>

        <section className="mb-5 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm md:p-6">
          <div className="mb-4 flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="text-base font-bold text-slate-950">{positionTitle}</h2>
                <span className="rounded-full bg-slate-100 px-2.5 py-1 text-[11px] font-bold text-slate-600">
                  {selectedPosition === "close" ? `Cierre ${monthLabel}` : "Actual"}
                </span>
              </div>
              <p className="mt-1 max-w-2xl text-xs leading-5 text-slate-500">
                {positionDescription}
              </p>
            </div>

            <div className="inline-flex w-full rounded-xl border border-slate-200 bg-slate-50 p-1 sm:w-auto">
              <a
                href={buildPositionHref("current")}
                className={`flex-1 rounded-lg px-4 py-2 text-center text-xs font-bold transition sm:flex-none ${
                  selectedPosition === "current"
                    ? "bg-white text-slate-950 shadow-sm"
                    : "text-slate-500 hover:text-slate-800"
                }`}
              >
                Actual
              </a>
              <a
                href={buildPositionHref("close")}
                className={`flex-1 rounded-lg px-4 py-2 text-center text-xs font-bold transition sm:flex-none ${
                  selectedPosition === "close"
                    ? "bg-white text-slate-950 shadow-sm"
                    : "text-slate-500 hover:text-slate-800"
                }`}
              >
                Al cierre del mes
              </a>
            </div>
          </div>
          <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
            <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-4">
              <p className="text-xs font-semibold uppercase tracking-wide text-emerald-700">Dinero real en cuentas</p>
              <p className={`mt-2 text-2xl font-bold ${totalRegisteredBalance < 0 ? "text-red-600" : "text-emerald-800"}`}>
                {formatCurrency(totalRegisteredBalance)}
              </p>
              <p className="mt-1 text-xs text-emerald-700">Bancos, billeteras, efectivo y otras cuentas. No incluye tarjetas.</p>

              <div className="mt-4 space-y-1.5 border-t border-emerald-200 pt-3">
                {ownerSummaryNames.map((ownerName) => {
                  const ownerBalance = realBalanceByOwner.get(ownerName) ?? 0;
                  return (
                    <div key={`real-${ownerName}`} className="flex items-center justify-between gap-3 text-xs">
                      <span className="font-medium text-emerald-800">{ownerName}</span>
                      <strong className={ownerBalance < 0 ? "text-red-600" : "text-emerald-900"}>
                        {formatCurrency(ownerBalance)}
                      </strong>
                    </div>
                  );
                })}
              </div>
            </div>

            <div className="rounded-xl border border-violet-200 bg-violet-50 p-4">
              <p className="text-xs font-semibold uppercase tracking-wide text-violet-700">Deuda total de tarjetas</p>
              <p className="mt-2 text-2xl font-bold text-violet-800">{formatCurrency(totalCardDebt)}</p>
              <p className="mt-1 text-xs text-violet-700">Deuda pendiente a la fecha de referencia seleccionada.</p>

              <div className="mt-4 space-y-1.5 border-t border-violet-200 pt-3">
                {ownerSummaryNames.map((ownerName) => (
                  <div key={`cards-${ownerName}`} className="flex items-center justify-between gap-3 text-xs">
                    <span className="font-medium text-violet-800">{ownerName}</span>
                    <strong className="text-violet-900">
                      {formatCurrency(cardDebtByOwner.get(ownerName) ?? 0)}
                    </strong>
                  </div>
                ))}
              </div>
            </div>

            <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-600">Neto después de tarjetas</p>
              <p className={`mt-2 text-2xl font-bold ${liquidNetAfterCards < 0 ? "text-red-600" : "text-slate-950"}`}>
                {formatCurrency(liquidNetAfterCards)}
              </p>
              <p className="mt-1 text-xs text-slate-500">Dinero real menos la deuda de tarjetas a la fecha de referencia.</p>

              <div className="mt-4 space-y-1.5 border-t border-slate-200 pt-3">
                {ownerSummaryNames.map((ownerName) => {
                  const ownerNet = ownerNetAfterCards(ownerName);
                  return (
                    <div key={`net-${ownerName}`} className="flex items-center justify-between gap-3 text-xs">
                      <span className="font-medium text-slate-600">{ownerName}</span>
                      <strong className={ownerNet < 0 ? "text-red-600" : "text-slate-900"}>
                        {formatCurrency(ownerNet)}
                      </strong>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        </section>

        <details className="group mb-5 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
          <summary className="flex cursor-pointer list-none items-center justify-between gap-4 px-5 py-5 md:px-6 [&::-webkit-details-marker]:hidden">
            <div>
              <h2 className="font-bold text-slate-950">Dinero real en cuentas · {selectedPosition === "close" ? `cierre ${monthLabel}` : "actual"}</h2>
              <p className="mt-0.5 text-xs text-slate-500">
                Bancos, billeteras, efectivo y otras cuentas. Las tarjetas quedan separadas.
              </p>
            </div>
            <div className="flex items-center gap-3 text-right">
              <div>
                <p className="text-xs font-medium text-slate-500">{selectedPosition === "close" ? "Total al cierre" : "Total actual"}</p>
                <p
                  className={`text-lg font-bold ${
                    totalRegisteredBalance < 0 ? "text-red-600" : "text-slate-950"
                  }`}
                >
                  {formatCurrency(totalRegisteredBalance)}
                </p>
              </div>
              <span className="text-xl text-slate-400 transition group-open:rotate-180">
                ⌄
              </span>
            </div>
          </summary>

          <div className="border-t border-slate-200 bg-slate-50 p-5 md:p-6">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {accountBalanceRows.map((account) => (
                <div
                  key={account.id}
                  className="rounded-xl border border-slate-200 bg-white px-4 py-3"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-semibold text-slate-900">
                        {account.name}
                      </p>
                      <p className="mt-0.5 text-xs text-slate-500">
                        {account.ownerName}
                      </p>
                    </div>
                    <p
                      className={`whitespace-nowrap text-sm font-bold ${
                        account.balance < 0 ? "text-red-600" : "text-slate-900"
                      }`}
                    >
                      {formatCurrency(account.balance)}
                    </p>
                  </div>
                </div>
              ))}
            </div>

            <p className="mt-4 text-xs leading-5 text-slate-500">
              Acá se muestran bancos, billeteras, efectivo y otras cuentas disponibles. La deuda de tarjetas se controla por separado desde “Tarjetas”.
            </p>
          </div>
        </details>

        <details className="group mb-5 overflow-hidden rounded-2xl border border-violet-200 bg-white shadow-sm">
          <summary className="flex cursor-pointer list-none items-center justify-between gap-4 px-5 py-5 md:px-6 [&::-webkit-details-marker]:hidden">
            <div>
              <h2 className="font-bold text-slate-950">Tarjetas de crédito · {selectedPosition === "close" ? `cierre ${monthLabel}` : "actual"}</h2>
              <p className="mt-0.5 text-xs text-slate-500">
                Deuda y consumos con tarjeta separados del dinero real disponible.
              </p>
            </div>
            <div className="flex items-center gap-3 text-right">
              <div>
                <p className="text-xs font-medium text-slate-500">{selectedPosition === "close" ? "Deuda al cierre" : "Deuda actual"}</p>
                <p className="text-lg font-bold text-violet-700">{formatCurrency(totalCardDebt)}</p>
              </div>
              <span className="text-xl text-slate-400 transition group-open:rotate-180">⌄</span>
            </div>
          </summary>

          <div className="border-t border-violet-100 bg-violet-50/40 p-5 md:p-6">
            {creditCardRows.length === 0 ? (
              <p className="text-sm text-slate-500">No hay tarjetas de crédito activas.</p>
            ) : (
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {creditCardRows.map((card) => (
                  <div key={card.id} className="rounded-xl border border-violet-100 bg-white px-4 py-4">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-semibold text-slate-900">{card.name}</p>
                        <p className="mt-0.5 text-xs text-slate-500">{card.ownerName}</p>
                      </div>
                      <p className="whitespace-nowrap text-sm font-bold text-violet-700">{formatCurrency(card.debt)}</p>
                    </div>
                    <div className="mt-3 grid grid-cols-2 gap-2 text-xs">
                      <div className="rounded-lg bg-slate-50 p-2.5">
                        <p className="text-slate-500">Gastado este mes</p>
                        <p className="mt-0.5 font-bold text-slate-900">{formatCurrency(card.monthPurchases)}</p>
                      </div>
                      <div className="rounded-lg bg-slate-50 p-2.5">
                        <p className="text-slate-500">Pagado este mes</p>
                        <p className="mt-0.5 font-bold text-slate-900">{formatCurrency(card.monthPayments)}</p>
                      </div>
                    </div>
                    <div className="mt-3 text-xs text-slate-500">
                      {card.available !== null ? (
                        <>Disponible según límite actual: <strong className={card.available < 0 ? "text-red-600" : "text-slate-700"}>{formatCurrency(card.available)}</strong></>
                      ) : (
                        <>Límite todavía sin configurar.</>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
            <p className="mt-4 text-xs leading-5 text-slate-500">
              “Gastado este mes” y “Pagado este mes” corresponden a {monthLabel}. La deuda mostrada en cada tarjeta responde a la vista {selectedPosition === "close" ? `al cierre de ${monthLabel}` : "Actual"}.
            </p>
            <div className="mt-3">
              <a href="/tarjetas" className="text-xs font-semibold text-violet-700 underline decoration-violet-300 underline-offset-4 hover:text-violet-900">
                Abrir gestión de tarjetas
              </a>
            </div>
          </div>
        </details>

        <section className="mb-5 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm md:p-6">
          <div className="mb-4 flex items-center justify-between gap-3">
            <div>
              <h2 className="text-base font-bold text-slate-950">Filtros</h2>
              <p className="mt-0.5 text-xs text-slate-500">
                Encontrá rápidamente un movimiento del mes.
              </p>
            </div>
            {hasActiveFilters && (
              <a
                href={`/dashboard?month=${selectedMonth}&position=${selectedPosition}`}
                className="text-xs font-semibold text-slate-600 underline decoration-slate-300 underline-offset-4 hover:text-slate-950"
              >
                Limpiar filtros
              </a>
            )}
          </div>

          <form
            method="get"
            action="/dashboard"
            className="grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-6"
          >
            <input type="hidden" name="month" value={selectedMonth} />
            <input type="hidden" name="position" value={selectedPosition} />

            <div className="lg:col-span-2">
              <label
                htmlFor="q"
                className="mb-1 block text-xs font-semibold text-slate-600"
              >
                Buscar
              </label>
              <input
                id="q"
                name="q"
                defaultValue={searchText}
                placeholder="Comercio, descripción o cuenta"
                className="h-11 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-900 outline-none focus:border-slate-400 focus:ring-2 focus:ring-slate-200"
              />
            </div>

            <div>
              <label
                htmlFor="type"
                className="mb-1 block text-xs font-semibold text-slate-600"
              >
                Tipo
              </label>
              <select
                id="type"
                name="type"
                defaultValue={selectedType}
                className="h-11 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-900 outline-none focus:border-slate-400 focus:ring-2 focus:ring-slate-200"
              >
                <option value="">Todos</option>
                <option value="expense">Gastos</option>
                <option value="income">Ingresos</option>
                <option value="transfer">Transferencias</option>
              </select>
            </div>

            <div>
              <label
                htmlFor="person"
                className="mb-1 block text-xs font-semibold text-slate-600"
              >
                ¿Para quién fue?
              </label>
              <select
                id="person"
                name="person"
                defaultValue={selectedPerson}
                className="h-11 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-900 outline-none focus:border-slate-400 focus:ring-2 focus:ring-slate-200"
              >
                <option value="">Todos</option>
                <option value="household">Hogar</option>
                {householdPeople.map((person) => (
                  <option key={person.id} value={person.id}>
                    {person.full_name}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label
                htmlFor="account"
                className="mb-1 block text-xs font-semibold text-slate-600"
              >
                Cuenta
              </label>
              <select
                id="account"
                name="account"
                defaultValue={selectedAccount}
                className="h-11 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-900 outline-none focus:border-slate-400 focus:ring-2 focus:ring-slate-200"
              >
                <option value="">Todas</option>
                {accounts.map((account) => (
                  <option key={account.id} value={account.id}>
                    {accountDisplayName(account)}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label
                htmlFor="category"
                className="mb-1 block text-xs font-semibold text-slate-600"
              >
                Categoría
              </label>
              <select
                id="category"
                name="category"
                defaultValue={selectedCategory}
                className="h-11 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-900 outline-none focus:border-slate-400 focus:ring-2 focus:ring-slate-200"
              >
                <option value="">Todas</option>
                {parentCategories.map((category) => (
                  <option key={category.id} value={category.id}>
                    {category.name}
                  </option>
                ))}
              </select>
            </div>

            <div className="md:col-span-2 lg:col-span-6">
              <button
                type="submit"
                className="w-full rounded-xl bg-slate-900 px-4 py-3 text-sm font-semibold text-white transition hover:bg-slate-700 sm:w-auto"
              >
                Aplicar filtros
              </button>
            </div>
          </form>
        </section>

        <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
          <div className="border-b border-slate-200 px-5 py-5 md:px-6">
            <div className="flex items-start justify-between gap-4">
              <div>
                <h2 className="text-xl font-bold text-slate-950">
                  Movimientos de {monthLabel.toLowerCase()}
                </h2>
                <p className="mt-1 text-sm text-slate-500">
                  Gastos, ingresos y transferencias entre cuentas.
                </p>
              </div>
              <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-600">
                {filteredTransactions.length}
                {hasActiveFilters ? ` de ${transactions.length}` : " total"}
              </span>
            </div>
          </div>

          {filteredTransactions.length === 0 ? (
            <div className="px-6 py-12 text-center">
              <p className="font-semibold text-slate-700">
                {hasActiveFilters
                  ? "No encontramos movimientos con esos filtros."
                  : `No hay movimientos en ${monthLabel.toLowerCase()}.`}
              </p>
              <p className="mt-1 text-sm text-slate-500">
                {hasActiveFilters
                  ? "Probá limpiar o cambiar alguno de los filtros."
                  : "Podés cambiar de mes arriba o registrar un movimiento nuevo."}
              </p>
            </div>
          ) : (
            <div className="divide-y divide-slate-200">
              {filteredTransactions.slice(0, 50).map((transaction) => {
                const isExpense = transaction.transaction_type === "expense";
                const isIncome = transaction.transaction_type === "income";
                const isTransfer = transaction.transaction_type === "transfer";

                const account = transaction.account_id
                  ? accountById.get(transaction.account_id)
                  : undefined;

                const destinationAccount = transaction.destination_account_id
                  ? accountById.get(transaction.destination_account_id)
                  : undefined;

                const subcategory = transaction.category_id
                  ? categoryById.get(transaction.category_id)
                  : undefined;

                const parentCategory = subcategory?.parent_id
                  ? categoryById.get(subcategory.parent_id)
                  : undefined;

                const responsible = transaction.responsible_person_id
                  ? personById.get(transaction.responsible_person_id)
                  : transaction.responsible_user_id
                    ? personByLinkedUserId.get(transaction.responsible_user_id)
                    : undefined;

                const categoryText = isTransfer
                  ? "Transferencia entre cuentas"
                  : parentCategory
                    ? `${parentCategory.name} · ${subcategory?.name ?? "Sin subcategoría"}`
                    : subcategory?.name ?? "Sin categoría";

                const detailText = isTransfer
                  ? `${accountDisplayName(account)} → ${accountDisplayName(destinationAccount)}`
                  : `${accountDisplayName(account)} · ${responsible?.full_name ?? "Hogar"}`;

                const title =
                  transaction.merchant ||
                  transaction.description ||
                  (isTransfer ? "Transferencia" : "Movimiento");

                return (
                  <div
                    key={transaction.id}
                    className="flex flex-col gap-4 px-5 py-4 transition hover:bg-slate-50 md:px-6"
                  >
                    <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <p className="font-semibold text-slate-900">{title}</p>
                          <span
                            className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${
                              isExpense
                                ? "bg-red-50 text-red-700"
                                : isIncome
                                  ? "bg-emerald-50 text-emerald-700"
                                  : isTransfer
                                    ? "bg-blue-50 text-blue-700"
                                    : "bg-slate-100 text-slate-600"
                            }`}
                          >
                            {isExpense
                              ? "Gasto"
                              : isIncome
                                ? "Ingreso"
                                : isTransfer
                                  ? "Transferencia"
                                  : "Movimiento"}
                          </span>
                          {isExpense && account?.account_type === "credit_card" && (
                            <span className="rounded-full bg-violet-50 px-2 py-0.5 text-[11px] font-semibold text-violet-700">
                              Compra con tarjeta
                            </span>
                          )}
                          {transaction.is_recurring && (
                            <span className="rounded-full bg-blue-50 px-2 py-0.5 text-[11px] font-semibold text-blue-700">
                              Recurrente
                            </span>
                          )}
                          {transaction.input_source === "csv" && (
                            <span className="rounded-full bg-amber-50 px-2 py-0.5 text-[11px] font-semibold text-amber-700">
                              Importado CSV
                            </span>
                          )}
                          {transaction.input_source === "statement_pdf" && (
                            <span className="rounded-full bg-violet-50 px-2 py-0.5 text-[11px] font-semibold text-violet-700">
                              Resumen PDF
                            </span>
                          )}
                          {transaction.input_source === "voice" && (
                            <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] font-semibold text-emerald-700">
                              🎤 Voz
                            </span>
                          )}
                          {transaction.input_source === "shared" && (
                            <span className="rounded-full bg-cyan-50 px-2 py-0.5 text-[11px] font-semibold text-cyan-700">
                              📲 Compartido
                            </span>
                          )}
                          {transaction.input_source === "receipt" && (
                            <span className="rounded-full bg-fuchsia-50 px-2 py-0.5 text-[11px] font-semibold text-fuchsia-700">
                              📎 Comprobante
                            </span>
                          )}
                        </div>

                        {transaction.merchant && transaction.description && (
                          <p className="mt-0.5 truncate text-sm text-slate-500">
                            {transaction.description}
                          </p>
                        )}

                        <p className="mt-2 text-sm font-medium text-slate-700">
                          {categoryText}
                        </p>

                        <div className="mt-1 flex flex-wrap gap-x-2 gap-y-1 text-xs text-slate-500">
                          <span>{detailText}</span>
                          <span className="hidden sm:inline">•</span>
                          <span>{formatDate(transaction.transaction_date)}</span>
                          {transaction.receipt_url && receiptUrlByPath.get(transaction.receipt_url) && (
                            <>
                              <span className="hidden sm:inline">•</span>
                              <a
                                href={receiptUrlByPath.get(transaction.receipt_url) ?? undefined}
                                target="_blank"
                                rel="noreferrer"
                                className="font-semibold text-blue-700 underline underline-offset-2 hover:text-blue-900"
                              >
                                Ver comprobante
                              </a>
                            </>
                          )}
                        </div>
                      </div>

                      <div
                        className={`whitespace-nowrap text-left text-lg font-bold sm:text-right ${
                          isExpense
                            ? "text-red-600"
                            : isIncome
                              ? "text-emerald-600"
                              : isTransfer
                                ? "text-blue-600"
                                : "text-slate-700"
                        }`}
                      >
                        {isExpense ? "-" : isIncome ? "+" : isTransfer ? "↔ " : ""}
                        {formatCurrency(Number(transaction.amount))}
                      </div>
                    </div>

                    <div className="flex justify-end border-t border-slate-100 pt-3">
                      <TransactionActions transactionId={transaction.id} />
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
