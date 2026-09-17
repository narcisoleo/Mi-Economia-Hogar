import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import {
  CreditCardManager,
  type CreditCardCycleRow,
  type CreditCardRow,
  type CreditCardStatementRow,
} from "@/components/credit-card-manager";
import { calculateAccountBalance, type BalanceMovement } from "@/lib/account-balances";
import { CreditCardCreator } from "@/components/credit-card-creator";

export const instant = false;

type Account = {
  id: string;
  name: string;
  owner_user_id: string | null;
  account_type: string;
};

type HouseholdPerson = {
  full_name: string;
  linked_user_id: string | null;
};

type CreditCardConfig = {
  id: string;
  account_id: string;
  credit_limit: number | string;
  closing_day: number | null;
  due_day: number | null;
  active: boolean;
};

type CreditCardCycleConfig = {
  id: string;
  credit_card_id: string;
  period_month: string;
  closing_date: string;
  due_date: string;
};

type StoredMovement = BalanceMovement & {
  status?: string;
};

function monthBounds() {
  const now = new Date();
  const start = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-01`;
  const next = new Date(now.getFullYear(), now.getMonth() + 1, 1);
  const end = `${next.getFullYear()}-${String(next.getMonth() + 1).padStart(2, "0")}-01`;
  return { start, end };
}

function clampedDate(year: number, monthIndex: number, day: number) {
  const lastDay = new Date(year, monthIndex + 1, 0).getDate();
  const safeDay = Math.min(Math.max(day, 1), lastDay);
  return new Date(year, monthIndex, safeDay);
}

function toDateValue(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(
    date.getDate()
  ).padStart(2, "0")}`;
}

function nextOccurrence(day: number | null) {
  if (!day) return null;
  const today = new Date();
  const candidate = clampedDate(today.getFullYear(), today.getMonth(), day);
  candidate.setHours(23, 59, 59, 999);
  if (candidate >= today) return toDateValue(candidate);
  return toDateValue(clampedDate(today.getFullYear(), today.getMonth() + 1, day));
}

function todayValue() {
  const today = new Date();
  return `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(
    today.getDate()
  ).padStart(2, "0")}`;
}

function addDays(value: string, days: number) {
  const date = new Date(`${value}T12:00:00`);
  date.setDate(date.getDate() + days);
  return toDateValue(date);
}

export default async function TarjetasPage() {
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

  const householdId = membership.household_id;
  const { start: monthStart, end: nextMonthStart } = monthBounds();

  const [accountsResult, peopleResult, cardsResult, cyclesResult, movementsResult] = await Promise.all([
    supabase
      .from("accounts")
      .select("id, name, owner_user_id, account_type")
      .eq("household_id", householdId)
      .eq("active", true)
      .order("name"),
    supabase
      .from("household_people")
      .select("full_name, linked_user_id")
      .eq("household_id", householdId)
      .eq("active", true),
    supabase
      .from("credit_cards")
      .select("id, account_id, credit_limit, closing_day, due_day, active")
      .eq("household_id", householdId)
      .eq("active", true),
    supabase
      .from("credit_card_cycles")
      .select("id, credit_card_id, period_month, closing_date, due_date")
      .eq("household_id", householdId)
      .order("period_month", { ascending: false }),
    supabase
      .from("transactions")
      .select(
        "transaction_date, amount, transaction_type, account_id, destination_account_id, economic_destination, merchant"
      )
      .eq("household_id", householdId)
      .eq("status", "confirmed"),
  ]);

  if (cardsResult.error) {
    return (
      <main className="min-h-screen bg-[#e7ebf0] text-slate-900">
        <div className="mx-auto max-w-4xl px-4 py-10">
          <a href="/dashboard" className="text-sm font-medium text-slate-600 hover:text-slate-950">
            ← Volver al dashboard
          </a>
          <div className="mt-5 rounded-2xl border border-amber-200 bg-amber-50 p-6">
            <h1 className="text-2xl font-bold text-amber-950">Falta activar Tarjetas v1.6</h1>
            <p className="mt-3 leading-6 text-amber-900">
              Ejecutá en Supabase SQL Editor el archivo <strong>SUPABASE-v1.6-TARJETAS.sql</strong>
              que viene dentro del ZIP y luego actualizá esta página.
            </p>
            <p className="mt-2 text-sm text-amber-800">Detalle técnico: {cardsResult.error.message}</p>
          </div>
        </div>
      </main>
    );
  }

  if (cyclesResult.error) {
    return (
      <main className="min-h-screen bg-[#e7ebf0] text-slate-900">
        <div className="mx-auto max-w-4xl px-4 py-10">
          <a href="/dashboard" className="text-sm font-medium text-slate-600 hover:text-slate-950">
            ← Volver al dashboard
          </a>
          <div className="mt-5 rounded-2xl border border-amber-200 bg-amber-50 p-6">
            <h1 className="text-2xl font-bold text-amber-950">Falta activar el calendario mensual de tarjetas</h1>
            <p className="mt-3 leading-6 text-amber-900">
              Ejecutá UNA VEZ en Supabase SQL Editor el archivo
              <strong> SUPABASE-v1.6.3-CALENDARIO-TARJETAS.sql</strong> y luego actualizá esta página.
            </p>
            <p className="mt-2 text-sm text-amber-800">Detalle técnico: {cyclesResult.error.message}</p>
          </div>
        </div>
      </main>
    );
  }

  if (accountsResult.error) console.error("Error cargando cuentas:", accountsResult.error);
  if (peopleResult.error) console.error("Error cargando personas:", peopleResult.error);
  if (movementsResult.error) console.error("Error cargando movimientos:", movementsResult.error);

  const accounts = (accountsResult.data ?? []) as Account[];
  const people = (peopleResult.data ?? []) as HouseholdPerson[];
  const cardConfigs = (cardsResult.data ?? []) as CreditCardConfig[];
  const cycleConfigs = (cyclesResult.data ?? []) as CreditCardCycleConfig[];
  const movements = (movementsResult.data ?? []) as StoredMovement[];

  const personByUserId = new Map(
    people
      .filter((person) => person.linked_user_id)
      .map((person) => [person.linked_user_id as string, person.full_name])
  );

  const accountById = new Map(accounts.map((account) => [account.id, account]));
  const today = todayValue();

  const accountOption = (account: Account) => ({
    id: account.id,
    name: account.name,
    ownerName: account.owner_user_id
      ? personByUserId.get(account.owner_user_id) ?? "Hogar"
      : "Hogar",
  });

  const cardRows: CreditCardRow[] = cardConfigs
    .map((config) => {
      const account = accountById.get(config.account_id);
      if (!account || account.account_type !== "credit_card") return null;

      const balance = calculateAccountBalance(movements, account.id);
      const debt = Math.max(0, -balance);
      const limit = Number(config.credit_limit) || 0;

      const monthPurchases = movements
        .filter(
          (movement) =>
            movement.transaction_type === "expense" &&
            movement.account_id === account.id &&
            movement.transaction_date >= monthStart &&
            movement.transaction_date < nextMonthStart
        )
        .reduce((sum, movement) => sum + Number(movement.amount || 0), 0);

      const monthPayments = movements
        .filter(
          (movement) =>
            movement.transaction_type === "transfer" &&
            movement.destination_account_id === account.id &&
            movement.transaction_date >= monthStart &&
            movement.transaction_date < nextMonthStart
        )
        .reduce((sum, movement) => sum + Number(movement.amount || 0), 0);

      const cardCycles = cycleConfigs.filter((cycle) => cycle.credit_card_id === config.id);

      const exactNextClosing = cardCycles
        .map((cycle) => cycle.closing_date)
        .filter((date) => date >= today)
        .sort()[0] ?? null;

      const exactNextDue = cardCycles
        .map((cycle) => cycle.due_date)
        .filter((date) => date >= today)
        .sort()[0] ?? null;

      return {
        id: config.id,
        accountId: account.id,
        name: account.name,
        ownerName: account.owner_user_id
          ? personByUserId.get(account.owner_user_id) ?? "Hogar"
          : "Hogar",
        creditLimit: limit,
        closingDay: config.closing_day,
        dueDay: config.due_day,
        balance,
        debt,
        available: limit - debt,
        monthPurchases,
        monthPayments,
        nextClosingDate: exactNextClosing ?? nextOccurrence(config.closing_day),
        nextDueDate: exactNextDue ?? nextOccurrence(config.due_day),
      } satisfies CreditCardRow;
    })
    .filter((row) => row !== null) as CreditCardRow[];

  cardRows.sort((a, b) =>
    `${a.ownerName}-${a.name}`.localeCompare(`${b.ownerName}-${b.name}`, "es")
  );

  const cardNameById = new Map(cardRows.map((card) => [card.id, card.name]));

  const cycles: CreditCardCycleRow[] = cycleConfigs
    .map((cycle) => ({
      id: cycle.id,
      creditCardId: cycle.credit_card_id,
      cardName: cardNameById.get(cycle.credit_card_id) ?? "Tarjeta",
      periodMonth: cycle.period_month,
      closingDate: cycle.closing_date,
      dueDate: cycle.due_date,
    }))
    .sort((a, b) => b.periodMonth.localeCompare(a.periodMonth));

  const cardById = new Map(cardRows.map((card) => [card.id, card]));

  const statements: CreditCardStatementRow[] = cycleConfigs
    .map((cycle) => {
      const card = cardById.get(cycle.credit_card_id);
      if (!card) return null;

      const sameCardCycles = cycleConfigs
        .filter((item) => item.credit_card_id === cycle.credit_card_id)
        .sort((a, b) => a.closing_date.localeCompare(b.closing_date));

      const cycleIndex = sameCardCycles.findIndex((item) => item.id === cycle.id);
      const previousCycle = cycleIndex > 0 ? sameCardCycles[cycleIndex - 1] : null;
      const startDate = previousCycle ? addDays(previousCycle.closing_date, 1) : cycle.period_month;
      const exactStart = Boolean(previousCycle);
      const effectiveEnd = cycle.closing_date < today ? cycle.closing_date : today;

      const purchases =
        effectiveEnd >= startDate
          ? movements.filter(
              (movement) =>
                movement.transaction_type === "expense" &&
                movement.account_id === card.accountId &&
                movement.transaction_date >= startDate &&
                movement.transaction_date <= effectiveEnd
            )
          : [];

      const amount = purchases.reduce(
        (sum, movement) => sum + Number(movement.amount || 0),
        0
      );

      const status: CreditCardStatementRow["status"] =
        today > cycle.closing_date ? "closed" : today < startDate ? "future" : "open";

      return {
        id: cycle.id,
        creditCardId: cycle.credit_card_id,
        cardName: card.name,
        ownerName: card.ownerName,
        periodMonth: cycle.period_month,
        startDate,
        closingDate: cycle.closing_date,
        dueDate: cycle.due_date,
        amount,
        purchaseCount: purchases.length,
        exactStart,
        status,
      } satisfies CreditCardStatementRow;
    })
    .filter((statement) => statement !== null) as CreditCardStatementRow[];

  statements.sort((a, b) => b.closingDate.localeCompare(a.closingDate));

  const configAccounts = accounts
    .filter((account) => account.account_type === "credit_card")
    .map(accountOption);

  const paymentAccounts = accounts
    .filter((account) => account.account_type !== "credit_card")
    .map(accountOption);

  return (
    <main className="min-h-screen bg-[#e7ebf0] text-slate-900">
      <div className="mx-auto max-w-6xl px-4 py-7 md:px-8 md:py-10">
        <div className="mb-7">
          <a
            href="/dashboard"
            className="mb-4 inline-flex text-sm font-medium text-slate-600 transition hover:text-slate-950"
          >
            ← Volver al dashboard
          </a>
          <div className="flex items-center gap-3">
            <h1 className="text-3xl font-bold tracking-tight text-slate-950 md:text-4xl">Tarjetas</h1>
            <span className="rounded-full border border-slate-200 bg-white px-2.5 py-1 text-xs font-bold text-slate-500 shadow-sm">
              v2.3.3
            </span>
          </div>
          <p className="mt-2 text-sm text-slate-600">
            Controlá consumos, deuda, límite, cierres, vencimientos y pagos sin contar el mismo gasto dos veces.
          </p>
          <div className="mt-4">
            <a
              href="/tarjetas/resumenes"
              className="inline-flex items-center justify-center rounded-xl bg-violet-700 px-4 py-3 text-sm font-bold text-white shadow-sm transition hover:bg-violet-600"
            >
              Leer resumen PDF
            </a>
          </div>
        </div>

        <CreditCardCreator
          householdId={householdId}
          owners={people
            .filter((person) => person.linked_user_id)
            .map((person) => ({
              userId: person.linked_user_id as string,
              name: person.full_name,
            }))}
        />

        <CreditCardManager
          householdId={householdId}
          userId={user.id}
          cards={cardRows}
          cycles={cycles}
          statements={statements}
          configAccounts={configAccounts}
          paymentAccounts={paymentAccounts}
        />
      </div>
    </main>
  );
}
