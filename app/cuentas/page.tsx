import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import {
  AccountBalanceManager,
  type ReconciliationHistoryItem,
} from "@/components/account-balance-manager";
import { AccountCreator } from "@/components/account-creator";
import {
  calculateAccountBalance,
  movementEffectForAccount,
  type BalanceMovement,
} from "@/lib/account-balances";

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

type StoredMovement = BalanceMovement & {
  id: string;
  merchant: string | null;
  description: string | null;
  created_at: string | null;
};

export default async function CuentasPage() {
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

  const [accountsResult, peopleResult, movementsResult] = await Promise.all([
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
      .from("transactions")
      .select(
        "id, transaction_date, amount, transaction_type, account_id, destination_account_id, economic_destination, merchant, description, created_at"
      )
      .eq("household_id", householdId)
      .eq("status", "confirmed")
      .order("transaction_date", { ascending: true }),
  ]);

  if (accountsResult.error) console.error("Error cargando cuentas:", accountsResult.error);
  if (peopleResult.error) console.error("Error cargando personas:", peopleResult.error);
  if (movementsResult.error) console.error("Error cargando movimientos:", movementsResult.error);

  const allAccounts = (accountsResult.data ?? []) as Account[];
  const accounts = allAccounts.filter((account) => account.account_type !== "credit_card");
  const people = (peopleResult.data ?? []) as HouseholdPerson[];
  const movements = (movementsResult.data ?? []) as StoredMovement[];

  const personByUserId = new Map(
    people
      .filter((person) => person.linked_user_id)
      .map((person) => [person.linked_user_id as string, person.full_name])
  );

  const adjustmentMovements = movements.filter(
    (movement) => movement.transaction_type === "adjustment"
  );

  const runningBalanceByAccount = new Map<string, number>();
  const reconciliationHistory: ReconciliationHistoryItem[] = [];

  const orderedMovements = [...movements].sort((a, b) => {
    const dateCompare = a.transaction_date.localeCompare(b.transaction_date);
    if (dateCompare !== 0) return dateCompare;
    return (a.created_at ?? "").localeCompare(b.created_at ?? "");
  });

  for (const movement of orderedMovements) {
    const affectedAccountIds = new Set<string>();
    if (movement.account_id) affectedAccountIds.add(movement.account_id);
    if (movement.destination_account_id) affectedAccountIds.add(movement.destination_account_id);

    for (const accountId of affectedAccountIds) {
      const before = runningBalanceByAccount.get(accountId) ?? 0;
      const effect = movementEffectForAccount(movement, accountId);
      const after = before + effect;

      if (
        movement.transaction_type === "adjustment" &&
        movement.account_id === accountId
      ) {
        reconciliationHistory.push({
          id: movement.id,
          accountId,
          transactionDate: movement.transaction_date,
          createdAt: movement.created_at,
          title: movement.merchant?.replace(/[+-]\s*$/, "").trim() || "Conciliación",
          note: movement.description,
          adjustment: effect,
          balanceBefore: before,
          balanceAfter: after,
        });
      }

      runningBalanceByAccount.set(accountId, after);
    }
  }

  const accountRows = accounts
    .map((account) => {
      const accountAdjustments = adjustmentMovements.filter(
        (movement) => movement.account_id === account.id
      );
      const lastAdjustment = accountAdjustments.at(-1);

      return {
        id: account.id,
        name: account.name,
        ownerName: account.owner_user_id
          ? personByUserId.get(account.owner_user_id) ?? "Hogar"
          : "Hogar",
        currentBalance: calculateAccountBalance(movements, account.id),
        reconciliationCount: accountAdjustments.length,
        lastReconciliationDate: lastAdjustment?.transaction_date ?? null,
      };
    })
    .sort((a, b) => {
      const aMine = accounts.find((account) => account.id === a.id)?.owner_user_id === user.id ? 0 : 1;
      const bMine = accounts.find((account) => account.id === b.id)?.owner_user_id === user.id ? 0 : 1;
      if (aMine !== bMine) return aMine - bMine;
      return `${a.ownerName}-${a.name}`.localeCompare(`${b.ownerName}-${b.name}`, "es");
    });

  return (
    <main className="min-h-screen bg-[#e7ebf0] text-slate-900">
      <div className="mx-auto max-w-5xl px-4 py-7 md:px-8 md:py-10">
        <div className="mb-7 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <a
              href="/dashboard"
              className="mb-4 inline-flex text-sm font-medium text-slate-600 transition hover:text-slate-950"
            >
              ← Volver al dashboard
            </a>
            <div className="flex items-center gap-3">
              <h1 className="text-3xl font-bold tracking-tight text-slate-950 md:text-4xl">
                Cuentas y saldos
              </h1>
              <span className="rounded-full border border-slate-200 bg-white px-2.5 py-1 text-xs font-bold text-slate-500 shadow-sm">
                v2.3.3
              </span>
            </div>
            <p className="mt-2 text-sm text-slate-600">
              Saldos reales, saldo inicial y conciliación sin alterar tus gastos o ingresos.
              Para deuda y pagos de tarjeta usá {" "}
              <a href="/tarjetas" className="font-semibold text-slate-800 underline underline-offset-2">Tarjetas</a>.
            </p>
          </div>
        </div>

        <AccountCreator
          householdId={householdId}
          owners={people
            .filter((person) => person.linked_user_id)
            .map((person) => ({
              userId: person.linked_user_id as string,
              name: person.full_name,
            }))}
        />

        {accountRows.length === 0 ? (
          <div className="rounded-2xl border border-slate-200 bg-white p-8 text-center shadow-sm">
            <p className="font-semibold text-slate-700">No hay cuentas activas.</p>
            <p className="mt-1 text-sm text-slate-500">Creá la primera cuenta desde el bloque “Agregar cuenta”.</p>
          </div>
        ) : (
          <AccountBalanceManager
            householdId={householdId}
            userId={user.id}
            accounts={accountRows}
            movements={movements}
            reconciliationHistory={reconciliationHistory}
          />
        )}
      </div>
    </main>
  );
}
