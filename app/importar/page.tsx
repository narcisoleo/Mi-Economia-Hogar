import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { TransactionImporter } from "@/components/transaction-importer";

export const instant = false;

export default async function ImportarPage() {
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
  const [accountsResult, categoriesResult, peopleResult] = await Promise.all([
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
  ]);

  return (
    <main className="min-h-screen bg-[#e7ebf0] text-slate-900">
      <div className="mx-auto max-w-6xl px-4 py-7 md:px-8 md:py-10">
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
                Importar
              </h1>
              <span className="rounded-full border border-slate-200 bg-white px-2.5 py-1 text-xs font-bold text-slate-500 shadow-sm">
                v2.3.3
              </span>
            </div>
            <p className="mt-2 text-sm text-slate-600">
              Carga masiva de movimientos y base para digitalizar comprobantes.
            </p>
          </div>
        </div>

        <TransactionImporter
          householdId={householdId}
          userId={user.id}
          accounts={accountsResult.data ?? []}
          categories={categoriesResult.data ?? []}
          people={peopleResult.data ?? []}
        />
      </div>
    </main>
  );
}
