import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { CardStatementImporter } from "@/components/card-statement-importer";
import { StatementHistoryActions } from "@/components/statement-history-actions";

export const instant = false;

type Account = {
  id: string;
  name: string;
  owner_user_id: string | null;
  account_type: string;
};

type Person = {
  id: string;
  full_name: string;
  linked_user_id: string | null;
};

type CardConfig = {
  id: string;
  account_id: string;
  active: boolean;
  issuer: string | null;
  brand: string | null;
  card_last4: string | null;
};

type Category = {
  id: string;
  name: string;
  parent_id: string | null;
};

type SavedStatement = {
  id: string;
  credit_card_id: string;
  file_path: string | null;
  issuer: string | null;
  brand: string | null;
  card_last4: string | null;
  closing_date: string;
  due_date: string | null;
  statement_balance: number | string | null;
  minimum_payment: number | string | null;
  total_purchases: number | string | null;
  created_at: string;
};

const formatCurrency = (value: number | string | null) =>
  value === null
    ? "—"
    : new Intl.NumberFormat("es-AR", {
        style: "currency",
        currency: "ARS",
        maximumFractionDigits: 2,
      }).format(Number(value));

function formatDate(value: string | null) {
  if (!value) return "—";
  return new Intl.DateTimeFormat("es-AR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).format(new Date(`${value}T12:00:00`));
}

export default async function ResumenesTarjetaPage() {
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

  if (membershipError || !membership) redirect("/dashboard");
  const householdId = membership.household_id;

  const [accountsResult, peopleResult, cardsResult, categoriesResult, statementsResult] =
    await Promise.all([
      supabase
        .from("accounts")
        .select("id, name, owner_user_id, account_type")
        .eq("household_id", householdId)
        .eq("active", true)
        .order("name"),
      supabase
        .from("household_people")
        .select("id, full_name, linked_user_id")
        .eq("household_id", householdId)
        .eq("active", true),
      supabase
        .from("credit_cards")
        .select("id, account_id, active, issuer, brand, card_last4")
        .eq("household_id", householdId)
        .eq("active", true),
      supabase
        .from("categories")
        .select("id, name, parent_id")
        .eq("household_id", householdId)
        .eq("active", true)
        .order("name"),
      supabase
        .from("credit_card_statement_imports")
        .select(
          "id, credit_card_id, file_path, issuer, brand, card_last4, closing_date, due_date, statement_balance, minimum_payment, total_purchases, created_at"
        )
        .eq("household_id", householdId)
        .order("closing_date", { ascending: false })
        .limit(12),
    ]);

  if (statementsResult.error) {
    return (
      <main className="min-h-screen bg-[#e7ebf0] text-slate-900">
        <div className="mx-auto max-w-4xl px-4 py-10">
          <a href="/tarjetas" className="text-sm font-medium text-slate-600 hover:text-slate-950">
            ← Volver a Tarjetas
          </a>
          <div className="mt-5 rounded-2xl border border-amber-200 bg-amber-50 p-6">
            <div className="flex items-center gap-3">
              <h1 className="text-2xl font-bold text-amber-950">Activar Resúmenes inteligentes</h1>
              <span className="rounded-full bg-white px-2.5 py-1 text-xs font-bold text-amber-700">v2.3.3</span>
            </div>
            <p className="mt-3 leading-6 text-amber-900">
              Ejecutá una sola vez en Supabase → SQL Editor el archivo
              <strong> SUPABASE-v2.0-RESUMENES-INTELIGENTES.sql</strong> incluido en el ZIP.
            </p>
            <p className="mt-2 text-sm text-amber-800">Detalle técnico: {statementsResult.error.message}</p>
          </div>
        </div>
      </main>
    );
  }

  const accounts = (accountsResult.data ?? []) as Account[];
  const people = (peopleResult.data ?? []) as Person[];
  const cardConfigs = (cardsResult.data ?? []) as CardConfig[];
  const categories = (categoriesResult.data ?? []) as Category[];
  const savedStatements = (statementsResult.data ?? []) as SavedStatement[];

  const accountById = new Map(accounts.map((account) => [account.id, account]));
  const personByUserId = new Map(
    people
      .filter((person) => person.linked_user_id)
      .map((person) => [person.linked_user_id as string, person])
  );

  const cards = cardConfigs
    .map((config) => {
      const account = accountById.get(config.account_id);
      if (!account || account.account_type !== "credit_card") return null;
      const owner = account.owner_user_id ? personByUserId.get(account.owner_user_id) ?? null : null;
      return {
        id: config.id,
        accountId: account.id,
        name: account.name,
        ownerName: owner?.full_name ?? "Hogar",
        ownerPersonId: owner?.id ?? null,
        ownerUserId: account.owner_user_id,
        issuer: config.issuer,
        brand: config.brand,
        cardLast4: config.card_last4,
      };
    })
    .filter((card) => card !== null)
    .sort((a, b) => `${a.ownerName}-${a.name}`.localeCompare(`${b.ownerName}-${b.name}`, "es"));

  const parentById = new Map(
    categories.filter((category) => category.parent_id === null).map((category) => [category.id, category.name])
  );

  const categoryOptions = categories
    .filter((category) => category.parent_id !== null)
    .map((category) => ({
      id: category.id,
      name: category.name,
      parentName: parentById.get(category.parent_id as string) ?? "Otra",
      label: `${parentById.get(category.parent_id as string) ?? "Otra"} · ${category.name}`,
    }))
    .sort((a, b) => a.label.localeCompare(b.label, "es"));

  const cardNameById = new Map(cards.map((card) => [card.id, `${card.name} · ${card.ownerName}`]));

  const statementsWithLinks = await Promise.all(
    savedStatements.map(async (statement) => {
      if (!statement.file_path) return { ...statement, signedUrl: null as string | null };
      const { data } = await supabase.storage.from("receipts").createSignedUrl(statement.file_path, 60 * 30);
      return { ...statement, signedUrl: data?.signedUrl ?? null };
    })
  );

  return (
    <main className="min-h-screen bg-[#e7ebf0] text-slate-900">
      <div className="mx-auto max-w-7xl px-4 py-7 md:px-8 md:py-10">
        <div className="mb-7">
          <a href="/tarjetas" className="mb-4 inline-flex text-sm font-medium text-slate-600 hover:text-slate-950">
            ← Volver a Tarjetas
          </a>
          <div className="flex items-center gap-3">
            <h1 className="text-3xl font-bold tracking-tight text-slate-950 md:text-4xl">Resúmenes inteligentes</h1>
            <span className="rounded-full border border-violet-200 bg-violet-50 px-2.5 py-1 text-xs font-bold text-violet-700">v2.3.3</span>
          </div>
          <p className="mt-2 max-w-4xl text-sm leading-6 text-slate-600">
            Subí el PDF del resumen, revisá lo detectado y recién después confirmá calendario, límite, consumos y costos. Los pagos posteriores de la tarjeta siguen sin contarse dos veces como gasto.
          </p>
        </div>

        <CardStatementImporter
          householdId={householdId}
          userId={user.id}
          cards={cards}
          people={people.map((person) => ({
            id: person.id,
            fullName: person.full_name,
            linkedUserId: person.linked_user_id,
          }))}
          categories={categoryOptions}
        />

        <section className="mt-6 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
          <div className="border-b border-slate-200 px-5 py-5 md:px-6">
            <h2 className="text-xl font-bold text-slate-950">Últimos resúmenes guardados</h2>
            <p className="mt-1 text-sm text-slate-500">Sirve como historial y respaldo del PDF original.</p>
          </div>

          {statementsWithLinks.length === 0 ? (
            <div className="px-6 py-10 text-center text-slate-500">Todavía no hay resúmenes guardados.</div>
          ) : (
            <div className="divide-y divide-slate-100">
              {statementsWithLinks.map((statement) => (
                <div key={statement.id} className="grid gap-3 px-5 py-4 md:grid-cols-[1.4fr_repeat(4,1fr)_auto] md:items-center md:px-6">
                  <div>
                    <p className="font-bold text-slate-950">{cardNameById.get(statement.credit_card_id) ?? "Tarjeta"}</p>
                    <p className="text-xs text-slate-500">{statement.brand ?? "Resumen"} · cierre {formatDate(statement.closing_date)}</p>
                  </div>
                  <div><p className="text-xs text-slate-500">Vencimiento</p><p className="font-semibold">{formatDate(statement.due_date)}</p></div>
                  <div><p className="text-xs text-slate-500">Saldo</p><p className="font-semibold">{formatCurrency(statement.statement_balance)}</p></div>
                  <div><p className="text-xs text-slate-500">Pago mínimo</p><p className="font-semibold">{formatCurrency(statement.minimum_payment)}</p></div>
                  <div><p className="text-xs text-slate-500">Consumos</p><p className="font-semibold">{formatCurrency(statement.total_purchases)}</p></div>
                  <div className="flex flex-col items-start gap-2">
                    {statement.signedUrl ? (
                      <a href={statement.signedUrl} target="_blank" rel="noreferrer" className="inline-flex rounded-lg border border-slate-300 px-3 py-2 text-xs font-bold text-slate-700 hover:bg-slate-50">Ver PDF</a>
                    ) : (
                      <span className="text-xs text-slate-400">Sin PDF</span>
                    )}
                    <StatementHistoryActions
                      householdId={householdId}
                      statementId={statement.id}
                      cardName={cardNameById.get(statement.credit_card_id) ?? "Tarjeta"}
                      filePath={statement.file_path}
                    />
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>
      </div>
    </main>
  );
}
