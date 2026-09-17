import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { PlanningManager } from "@/components/planning-manager";

export const instant = false;

type PlanningPageProps = {
  searchParams?: Promise<{ month?: string }>;
};

type Category = {
  id: string;
  name: string;
  parent_id: string | null;
  economic_type: string | null;
};

type MonthTransaction = {
  amount: number | string;
  transaction_type: string;
  category_id: string | null;
};

function normalizeMonth(value?: string) {
  if (value && /^\d{4}-(0[1-9]|1[0-2])$/.test(value)) return value;
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
}

export default async function PlanificacionPage({ searchParams }: PlanningPageProps) {
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
  const periodMonth = `${selectedMonth}-01`;
  const [year, month] = selectedMonth.split("-").map(Number);
  const next = new Date(year, month, 1);
  const nextMonth = `${next.getFullYear()}-${String(next.getMonth() + 1).padStart(2, "0")}-01`;
  const householdId = membership.household_id;

  const [accountsResult, categoriesResult, peopleResult, budgetsResult, rulesResult, occurrencesResult, transactionsResult] =
    await Promise.all([
      supabase
        .from("accounts")
        .select("id, name, owner_user_id, account_type")
        .eq("household_id", householdId)
        .eq("active", true)
        .order("name"),
      supabase
        .from("categories")
        .select("id, name, parent_id, economic_type")
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
        .from("monthly_budgets")
        .select("id, category_id, amount, note")
        .eq("household_id", householdId)
        .eq("month", periodMonth)
        .order("created_at"),
      supabase
        .from("recurring_rules")
        .select("id, name, transaction_type, amount, account_id, category_id, responsible_person_id, merchant, description, due_day, start_month, end_month, active")
        .eq("household_id", householdId)
        .order("active", { ascending: false })
        .order("due_day"),
      supabase
        .from("recurring_occurrences")
        .select("rule_id, transaction_id")
        .eq("household_id", householdId)
        .eq("period_month", periodMonth),
      supabase
        .from("transactions")
        .select("amount, transaction_type, category_id")
        .eq("household_id", householdId)
        .eq("status", "confirmed")
        .gte("transaction_date", periodMonth)
        .lt("transaction_date", nextMonth),
    ]);

  const errors = [
    accountsResult.error,
    categoriesResult.error,
    peopleResult.error,
    budgetsResult.error,
    rulesResult.error,
    occurrencesResult.error,
    transactionsResult.error,
  ].filter(Boolean);

  if (errors.length > 0) {
    console.error("Error cargando planificación:", errors);
  }

  const categories = (categoriesResult.data ?? []) as Category[];
  const categoryById = new Map(categories.map((category) => [category.id, category]));
  const spentByParentCategory: Record<string, number> = {};

  for (const movement of (transactionsResult.data ?? []) as MonthTransaction[]) {
    if (movement.transaction_type !== "expense" || !movement.category_id) continue;
    const category = categoryById.get(movement.category_id);
    if (!category) continue;
    const parentId = category.parent_id ?? category.id;
    spentByParentCategory[parentId] =
      (spentByParentCategory[parentId] ?? 0) + Number(movement.amount);
  }

  return (
    <PlanningManager
      householdId={householdId}
      userId={user.id}
      selectedMonth={selectedMonth}
      accounts={accountsResult.data ?? []}
      categories={categories}
      people={peopleResult.data ?? []}
      initialBudgets={budgetsResult.data ?? []}
      initialRules={rulesResult.data ?? []}
      generatedRuleIds={(occurrencesResult.data ?? [])
        .filter((item) => Boolean(item.transaction_id))
        .map((item) => item.rule_id)}
      spentByParentCategory={spentByParentCategory}
    />
  );
}
