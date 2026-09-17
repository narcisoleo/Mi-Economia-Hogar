"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

type CardOption = {
  id: string;
  accountId: string;
  name: string;
  ownerName: string;
  ownerPersonId: string | null;
  ownerUserId: string | null;
  issuer?: string | null;
  brand?: string | null;
  cardLast4?: string | null;
};

type PersonOption = {
  id: string;
  fullName: string;
  linkedUserId: string | null;
};

type CategoryOption = {
  id: string;
  name: string;
  parentName: string;
  label: string;
};

type ParsedLine = {
  date: string | null;
  merchant: string;
  amount: number;
  installmentCurrent: number | null;
  installmentTotal: number | null;
  kind: "purchase" | "charge";
  chargeType?: "tax" | "interest" | string;
  raw: string;
};

type FutureInstallment = {
  periodMonth: string;
  label: string;
  amount: number;
};

type ParsedStatement = {
  issuer: string;
  brand: string;
  holderName: string | null;
  cardLast4: string | null;
  closingDate: string | null;
  dueDate: string | null;
  previousClosingDate: string | null;
  previousDueDate: string | null;
  nextClosingDate: string | null;
  nextDueDate: string | null;
  purchaseLimit: number | null;
  financingLimit: number | null;
  statementBalance: number | null;
  minimumPayment: number | null;
  totalPurchases: number | null;
  purchases: ParsedLine[];
  charges: ParsedLine[];
  futureInstallments: FutureInstallment[];
  filename: string;
  pageCount: number;
  textLength: number;
};

type ReviewRow = ParsedLine & {
  key: string;
  selected: boolean;
  categoryId: string;
  duplicateStatus: "new" | "possible" | "imported";
};

type ExistingMovement = {
  transaction_date: string;
  amount: number | string;
  merchant: string | null;
  statement_import_id: string | null;
  source_line_key: string | null;
};

type Props = {
  householdId: string;
  userId: string;
  cards: CardOption[];
  people: PersonOption[];
  categories: CategoryOption[];
};

const formatCurrency = (value: number | null | undefined) =>
  value === null || value === undefined
    ? "—"
    : new Intl.NumberFormat("es-AR", {
        style: "currency",
        currency: "ARS",
        maximumFractionDigits: 2,
      }).format(value);

function formatDate(value: string | null) {
  if (!value) return "—";
  return new Intl.DateTimeFormat("es-AR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).format(new Date(`${value}T12:00:00`));
}

function normalize(value: string | null | undefined) {
  return (value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function ownerMatches(holderName: string | null, personName: string) {
  if (!holderName) return false;
  const holder = normalize(holderName);
  const tokens = normalize(personName).split(" ").filter((token) => token.length >= 3);
  return tokens.length > 0 && tokens.every((token) => holder.includes(token));
}

function cardMatchesStatement(card: CardOption, parsed: ParsedStatement) {
  const cardName = normalize(card.name);
  const parsedBrand = normalize(parsed.brand);
  const parsedIssuer = normalize(parsed.issuer);
  const sameOwner = parsed.holderName ? ownerMatches(parsed.holderName, card.ownerName) : true;

  if (parsed.cardLast4) {
    if (card.cardLast4 === parsed.cardLast4 && sameOwner) return 100;
    if (cardName.includes(parsed.cardLast4) && sameOwner) return 95;
  }

  const brandMatch = Boolean(parsedBrand) && (normalize(card.brand) === parsedBrand || cardName.includes(parsedBrand));
  const issuerMatch = !parsedIssuer || normalize(card.issuer) === parsedIssuer || cardName.includes(parsedIssuer);

  if (brandMatch && issuerMatch && sameOwner) return 80;
  if (brandMatch && sameOwner) return 70;
  return 0;
}

function detectedCardName(parsed: ParsedStatement) {
  const parts = [parsed.brand, parsed.issuer].filter(Boolean);
  const base = parts.join(" ") || "Tarjeta";
  return parsed.cardLast4 ? `${base} • ${parsed.cardLast4}` : base;
}

function simpleHash(value: string) {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

function monthStart(date: string | null) {
  return date ? `${date.slice(0, 7)}-01` : null;
}

function suggestedCategoryId(line: ParsedLine, categories: CategoryOption[]) {
  const haystack = normalize(`${line.merchant} ${line.raw}`);
  const byLabel = (parts: string[]) => {
    const found = categories.find((category) => {
      const label = normalize(category.label);
      return parts.every((part) => label.includes(normalize(part)));
    });
    return found?.id ?? "";
  };

  if (line.kind === "charge") {
    if (line.chargeType === "interest") {
      return byLabel(["finanzas", "intereses tarjeta"]) || byLabel(["finanzas"]);
    }
    return byLabel(["impuestos", "otros impuestos"]) || byLabel(["impuestos"]);
  }

  const rules: Array<[RegExp, string[][]]> = [
    [/spotify|primevideo|netflix|disney|stream/i, [["servicios", "streaming"], ["ocio", "entretenimiento"]]],
    [/telecentro/i, [["servicios", "telecentro"], ["servicios"]]],
    [/mostaza|mcdonald|burger|kfc/i, [["alimentacion", "comida rapida"], ["alimentacion"]]],
    [/aubasa|peaje/i, [["transporte", "peajes"], ["transporte"]]],
    [/mercado.?libre/i, [["compras", "mercado libre"], ["compras"]]],
    [/multiteatro|plateanet|cine|teatro/i, [["ocio", "cine teatro"], ["ocio"]]],
    [/atomik|ropa|indument/i, [["ropa"]]],
    [/club atletico bo|boca/i, [["ocio", "boca"], ["ocio"]]],
    [/plan rombo|cuota|financi/i, [["finanzas", "cuotas financiacion"], ["finanzas"]]],
    [/sommier|electro|hogar/i, [["compras", "articulos para el hogar"], ["vivienda"]]],
  ];

  for (const [regex, candidateLabels] of rules) {
    if (!regex.test(haystack)) continue;
    for (const parts of candidateLabels) {
      const id = byLabel(parts);
      if (id) return id;
    }
  }

  return byLabel(["otros gastos", "gastos no identificados"]) || byLabel(["otros gastos"]);
}

function effectiveDate(line: ParsedLine, closingDate: string | null) {
  if (line.kind === "charge") return closingDate ?? line.date ?? "";
  if (line.installmentCurrent && line.installmentTotal) return closingDate ?? line.date ?? "";
  return line.date ?? closingDate ?? "";
}

export function CardStatementImporter({ householdId, userId, cards, people, categories }: Props) {
  const router = useRouter();
  const supabase = useMemo(() => createClient(), []);

  const [availableCards, setAvailableCards] = useState<CardOption[]>(cards);
  const [file, setFile] = useState<File | null>(null);
  const [analysis, setAnalysis] = useState<ParsedStatement | null>(null);
  const [rows, setRows] = useState<ReviewRow[]>([]);
  const [selectedCardId, setSelectedCardId] = useState(cards[0]?.id ?? "");
  const [detectedOwnerPersonId, setDetectedOwnerPersonId] = useState(
    people.find((person) => person.linkedUserId === userId)?.id ?? people[0]?.id ?? ""
  );
  const [creatingDetectedCard, setCreatingDetectedCard] = useState(false);
  const [analyzing, setAnalyzing] = useState(false);
  const [savingSummary, setSavingSummary] = useState(false);
  const [importing, setImporting] = useState(false);
  const [statementImportId, setStatementImportId] = useState<string | null>(null);
  const [message, setMessage] = useState("");

  const selectedCard = availableCards.find((card) => card.id === selectedCardId) ?? null;
  const selectedCount = rows.filter((row) => row.selected).length;
  const selectedTotal = rows.filter((row) => row.selected).reduce((sum, row) => sum + row.amount, 0);
  const detectedPurchaseTotal = analysis?.purchases.reduce((sum, row) => sum + row.amount, 0) ?? 0;
  const detectedChargeTotal = analysis?.charges.reduce((sum, row) => sum + row.amount, 0) ?? 0;

  async function checkDuplicates(nextRows: ReviewRow[], card: CardOption, parsed: ParsedStatement) {
    const { data, error } = await supabase
      .from("transactions")
      .select("transaction_date, amount, merchant, statement_import_id, source_line_key")
      .eq("household_id", householdId)
      .eq("account_id", card.accountId)
      .eq("status", "confirmed");

    if (error) {
      console.error("Error revisando duplicados:", error);
      return nextRows;
    }

    const existing = (data ?? []) as ExistingMovement[];

    return nextRows.map((row) => {
      const date = effectiveDate(row, parsed.closingDate);
      const merchant = normalize(row.merchant);
      const amount = Number(row.amount.toFixed(2));

      const imported = existing.some(
        (movement) => movement.source_line_key === row.key && movement.statement_import_id
      );
      if (imported) return { ...row, selected: false, duplicateStatus: "imported" as const };

      const exact = existing.some(
        (movement) =>
          movement.transaction_date === date &&
          Number(Number(movement.amount).toFixed(2)) === amount &&
          normalize(movement.merchant) === merchant
      );
      if (exact) return { ...row, selected: false, duplicateStatus: "possible" as const };

      return row;
    });
  }

  async function handleAnalyze() {
    if (!file) {
      setMessage("Seleccioná un resumen PDF.");
      return;
    }

    setAnalyzing(true);
    setMessage("");
    setAnalysis(null);
    setRows([]);
    setStatementImportId(null);

    try {
      const form = new FormData();
      form.append("file", file);
      const response = await fetch("/api/resumen-tarjeta/parse", { method: "POST", body: form });
      const result = await response.json();
      if (!response.ok || !result.ok) throw new Error(result.error || "No se pudo interpretar el PDF.");

      const parsed = result.data as ParsedStatement;
      setAnalysis(parsed);

      const owner =
        people.find((person) => ownerMatches(parsed.holderName, person.fullName)) ??
        people.find((person) => person.linkedUserId === userId) ??
        people[0] ??
        null;
      if (owner) setDetectedOwnerPersonId(owner.id);

      const ranked = availableCards
        .map((card) => ({ card, score: cardMatchesStatement(card, parsed) }))
        .filter((item) => item.score > 0)
        .sort((a, b) => b.score - a.score);

      const preferred = ranked[0]?.score >= 70 ? ranked[0].card : null;
      const card = preferred ?? null;
      setSelectedCardId(card?.id ?? "");

      let reviewRows: ReviewRow[] = [...parsed.purchases, ...parsed.charges].map((line, index) => ({
        ...line,
        key: simpleHash(`${line.kind}|${line.raw}|${line.amount}|${index}`),
        selected: true,
        categoryId: suggestedCategoryId(line, categories),
        duplicateStatus: "new" as const,
      }));

      if (card) reviewRows = await checkDuplicates(reviewRows, card, parsed);
      setRows(reviewRows);
      setMessage(
        card
          ? `PDF leído y asociado a ${card.name}. ${parsed.purchases.length} consumos y ${parsed.charges.length} cargos detectados.`
          : `PDF leído. No encontré una tarjeta registrada que coincida con ${parsed.brand}${parsed.cardLast4 ? ` •••• ${parsed.cardLast4}` : ""}. Al guardar el resumen, ECO HOGAR puede crearla como una tarjeta nueva.`
      );
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setAnalyzing(false);
    }
  }

  async function recheckForCard(cardId: string) {
    setSelectedCardId(cardId);
    if (!analysis) return;
    const card = availableCards.find((item) => item.id === cardId);
    if (!card) {
      setRows((current) => current.map((row) => ({ ...row, duplicateStatus: "new" as const, selected: true })));
      return;
    }
    setRows(await checkDuplicates(rows.map((row) => ({ ...row, duplicateStatus: "new" as const, selected: row.duplicateStatus !== "imported" })), card, analysis));
  }

  async function createDetectedCard() {
    if (!analysis) return null;

    const owner = people.find((person) => person.id === detectedOwnerPersonId) ?? null;
    if (!owner) {
      setMessage("Seleccioná el titular de la nueva tarjeta detectada.");
      return null;
    }

    const errorDetail = (error: unknown) => {
      if (!error || typeof error !== "object") return String(error);
      const candidate = error as {
        message?: string;
        details?: string | null;
        hint?: string | null;
        code?: string | null;
      };
      return [
        candidate.message,
        candidate.details,
        candidate.hint,
        candidate.code ? `Código: ${candidate.code}` : null,
      ]
        .filter(Boolean)
        .join(" · ") || "Error desconocido de Supabase";
    };

    setCreatingDetectedCard(true);
    try {
      const cardName = detectedCardName(analysis);

      // v2.2: primero buscamos una cuenta de tarjeta que haya quedado huérfana
      // de un intento anterior. Así no creamos duplicados innecesarios.
      let accountId: string | null = null;
      let createdAccountNow = false;

      let accountQuery = supabase
        .from("accounts")
        .select("id, name, owner_user_id, account_type")
        .eq("household_id", householdId)
        .eq("account_type", "credit_card")
        .eq("name", cardName)
        .limit(1);

      if (owner.linkedUserId) {
        accountQuery = accountQuery.eq("owner_user_id", owner.linkedUserId);
      } else {
        accountQuery = accountQuery.is("owner_user_id", null);
      }

      const { data: existingAccounts, error: existingAccountError } = await accountQuery;
      if (existingAccountError) {
        throw new Error(`No se pudo revisar si la tarjeta ya existía: ${errorDetail(existingAccountError)}`);
      }

      const existingAccount = existingAccounts?.[0] ?? null;
      if (existingAccount) {
        accountId = existingAccount.id;
      } else {
        const { data: account, error: accountError } = await supabase
          .from("accounts")
          .insert({
            household_id: householdId,
            owner_user_id: owner.linkedUserId,
            name: cardName,
            account_type: "credit_card",
            institution: analysis.issuer || null,
            currency: "ARS",
            initial_balance: 0,
            active: true,
          })
          .select("id")
          .single();

        if (accountError || !account) {
          throw new Error(
            `No se pudo crear la cuenta de la tarjeta: ${
              accountError ? errorDetail(accountError) : "Supabase no devolvió el ID de la cuenta"
            }`
          );
        }

        accountId = account.id;
        createdAccountNow = true;
      }

      // Puede existir la cuenta credit_card pero faltar su fila de configuración.
      const { data: existingConfigs, error: configLookupError } = await supabase
        .from("credit_cards")
        .select("id")
        .eq("household_id", householdId)
        .eq("account_id", accountId)
        .limit(1);

      if (configLookupError) {
        if (createdAccountNow) {
          await supabase.from("accounts").delete().eq("id", accountId).eq("household_id", householdId);
        }
        throw new Error(`No se pudo revisar la configuración de la tarjeta: ${errorDetail(configLookupError)}`);
      }

      let cardConfigId = existingConfigs?.[0]?.id ?? null;

      if (!cardConfigId) {
        // Insertamos SOLO columnas históricas de credit_cards. Los metadatos de
        // marca/emisor/últimos 4 se actualizan después. Esto evita fallas por
        // schema-cache cuando una migración recién fue ejecutada.
        const { data: cardConfig, error: cardError } = await supabase
          .from("credit_cards")
          .insert({
            household_id: householdId,
            account_id: accountId,
            credit_limit: analysis.purchaseLimit ?? 0,
            closing_day: null,
            due_day: null,
            active: true,
          })
          .select("id")
          .single();

        if (cardError || !cardConfig) {
          if (createdAccountNow) {
            await supabase.from("accounts").delete().eq("id", accountId).eq("household_id", householdId);
          }
          throw new Error(
            `No se pudo crear la configuración de la tarjeta: ${
              cardError ? errorDetail(cardError) : "Supabase no devolvió el ID de credit_cards"
            }`
          );
        }

        cardConfigId = cardConfig.id;
      }

      // Actualización base: ésta sí debe funcionar en cualquier versión previa.
      const { error: baseUpdateError } = await supabase
        .from("credit_cards")
        .update({
          credit_limit: analysis.purchaseLimit ?? 0,
          active: true,
          updated_at: new Date().toISOString(),
        })
        .eq("id", cardConfigId)
        .eq("household_id", householdId);

      if (baseUpdateError) {
        throw new Error(`La tarjeta se creó, pero no pude actualizar su límite: ${errorDetail(baseUpdateError)}`);
      }

      // Metadatos v2.2+. Si PostgREST todavía no refrescó el schema cache,
      // no bloqueamos toda la creación: el SQL v2.0.4 fuerza ese refresco.
      const { error: metadataError } = await supabase
        .from("credit_cards")
        .update({
          issuer: analysis.issuer || null,
          brand: analysis.brand || null,
          card_last4: analysis.cardLast4 || null,
          updated_at: new Date().toISOString(),
        })
        .eq("id", cardConfigId)
        .eq("household_id", householdId);

      if (metadataError) {
        console.warn("Tarjeta creada; metadatos pendientes de refresco:", metadataError);
      }

      const nextCard: CardOption = {
        id: cardConfigId,
        accountId: accountId!,
        name: cardName,
        ownerName: owner.fullName,
        ownerPersonId: owner.id,
        ownerUserId: owner.linkedUserId,
        issuer: analysis.issuer,
        brand: analysis.brand,
        cardLast4: analysis.cardLast4,
      };

      setAvailableCards((current) => {
        const withoutDuplicate = current.filter((item) => item.id !== nextCard.id);
        return [...withoutDuplicate, nextCard];
      });
      setSelectedCardId(nextCard.id);
      setRows((current) =>
        current.map((row) => ({ ...row, duplicateStatus: "new" as const, selected: true }))
      );
      setMessage(`Tarjeta lista: ${cardName}. Ahora podés guardar el resumen.`);
      router.refresh();
      return nextCard;
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      console.error("Error creando tarjeta desde resumen:", detail);
      setMessage(`No se pudo crear la tarjeta detectada: ${detail}`);
      return null;
    } finally {
      setCreatingDetectedCard(false);
    }
  }

  async function saveSummary() {
    if (!analysis || !file || !analysis.closingDate) {
      setMessage("El PDF no contiene una fecha de cierre reconocible.");
      return null;
    }

    setSavingSummary(true);
    setMessage("");

    try {
      let card = selectedCard;
      if (!card) {
        card = await createDetectedCard();
        if (!card) return null;
      }

      {
        const baseCardUpdate: Record<string, string | number | null> = {
          updated_at: new Date().toISOString(),
        };
        if (analysis.purchaseLimit !== null) baseCardUpdate.credit_limit = analysis.purchaseLimit;

        const { error: baseCardUpdateError } = await supabase
          .from("credit_cards")
          .update(baseCardUpdate)
          .eq("id", card.id)
          .eq("household_id", householdId);
        if (baseCardUpdateError) throw baseCardUpdateError;

        const { error: cardMetadataError } = await supabase
          .from("credit_cards")
          .update({
            issuer: analysis.issuer || null,
            brand: analysis.brand || null,
            card_last4: analysis.cardLast4 || null,
            updated_at: new Date().toISOString(),
          })
          .eq("id", card.id)
          .eq("household_id", householdId);

        if (cardMetadataError) {
          console.warn("No se pudieron actualizar los metadatos de identidad de la tarjeta:", cardMetadataError);
        }
      }

      const cycles = [
        [analysis.previousClosingDate, analysis.previousDueDate],
        [analysis.closingDate, analysis.dueDate],
        [analysis.nextClosingDate, analysis.nextDueDate],
      ]
        .filter((pair): pair is [string, string] => Boolean(pair[0] && pair[1]))
        .map(([closingDate, dueDate]) => ({
          household_id: householdId,
          credit_card_id: card.id,
          period_month: monthStart(closingDate),
          closing_date: closingDate,
          due_date: dueDate,
          updated_at: new Date().toISOString(),
        }));

      if (cycles.length) {
        const { error: cycleError } = await supabase
          .from("credit_card_cycles")
          .upsert(cycles, { onConflict: "credit_card_id,period_month" });
        if (cycleError) throw cycleError;
      }

      const statementPayload = {
        household_id: householdId,
        credit_card_id: card.id,
        created_by: userId,
        original_filename: file.name,
        issuer: analysis.issuer,
        brand: analysis.brand,
        card_last4: analysis.cardLast4,
        closing_date: analysis.closingDate,
        due_date: analysis.dueDate,
        previous_closing_date: analysis.previousClosingDate,
        previous_due_date: analysis.previousDueDate,
        next_closing_date: analysis.nextClosingDate,
        next_due_date: analysis.nextDueDate,
        statement_balance: analysis.statementBalance,
        minimum_payment: analysis.minimumPayment,
        purchase_limit: analysis.purchaseLimit,
        total_purchases: analysis.totalPurchases,
        parsed_data: analysis,
        updated_at: new Date().toISOString(),
      };

      // v2.2: antes de crear otro registro, buscamos el mismo resumen aunque haya
      // sido asignado accidentalmente a otra tarjeta. Así, al volver a cargar un
      // Mastercard que había quedado sobre Visa, ECO HOGAR lo reasigna y mueve sus
      // consumos importados a la tarjeta correcta.
      let identityQuery = supabase
        .from("credit_card_statement_imports")
        .select("id, credit_card_id, file_path")
        .eq("household_id", householdId)
        .eq("closing_date", analysis.closingDate)
        .eq("brand", analysis.brand);

      identityQuery = analysis.cardLast4
        ? identityQuery.eq("card_last4", analysis.cardLast4)
        : identityQuery.eq("original_filename", file.name);

      const { data: existingIdentity, error: identityError } = await identityQuery
        .limit(1)
        .maybeSingle();
      if (identityError) throw identityError;

      const previousCardId = existingIdentity?.credit_card_id ?? null;
      let statementRow: { id: string; file_path: string | null } | null = null;

      if (existingIdentity) {
        const { data, error } = await supabase
          .from("credit_card_statement_imports")
          .update(statementPayload)
          .eq("id", existingIdentity.id)
          .select("id, file_path")
          .single();
        if (error || !data) throw error ?? new Error("No se pudo reasignar el resumen existente.");
        statementRow = data;
      } else {
        const { data, error } = await supabase
          .from("credit_card_statement_imports")
          .upsert(statementPayload, { onConflict: "credit_card_id,closing_date" })
          .select("id, file_path")
          .single();
        if (error || !data) throw error ?? new Error("No se pudo guardar el resumen.");
        statementRow = data;
      }

      const statementId = statementRow.id as string;

      if (previousCardId && previousCardId !== card.id) {
        const { error: moveTransactionsError } = await supabase
          .from("transactions")
          .update({
            account_id: card.accountId,
            responsible_person_id: card.ownerPersonId,
            responsible_user_id: card.ownerUserId,
          })
          .eq("statement_import_id", statementId)
          .eq("household_id", householdId);
        if (moveTransactionsError) throw moveTransactionsError;

        const { error: moveFutureError } = await supabase
          .from("credit_card_future_installments")
          .update({ credit_card_id: card.id })
          .eq("statement_import_id", statementId)
          .eq("household_id", householdId);
        if (moveFutureError) throw moveFutureError;

        const { data: priorStatement } = await supabase
          .from("credit_card_statement_imports")
          .select("purchase_limit")
          .eq("credit_card_id", previousCardId)
          .neq("id", statementId)
          .not("purchase_limit", "is", null)
          .order("closing_date", { ascending: false })
          .limit(1)
          .maybeSingle();

        if (priorStatement?.purchase_limit !== null && priorStatement?.purchase_limit !== undefined) {
          await supabase
            .from("credit_cards")
            .update({ credit_limit: priorStatement.purchase_limit, updated_at: new Date().toISOString() })
            .eq("id", previousCardId)
            .eq("household_id", householdId);
        }
      }

      const safeName = file.name.replace(/[^a-zA-Z0-9._-]+/g, "-");
      const storagePath = `${householdId}/statements/${card.accountId}/${statementId}-${safeName}`;

      const { error: uploadError } = await supabase.storage
        .from("receipts")
        .upload(storagePath, file, { upsert: true });
      if (uploadError) throw uploadError;

      const { error: pathError } = await supabase
        .from("credit_card_statement_imports")
        .update({ file_path: storagePath, updated_at: new Date().toISOString() })
        .eq("id", statementId);
      if (pathError) throw pathError;

      if (existingIdentity?.file_path && existingIdentity.file_path !== storagePath) {
        const { error: oldFileError } = await supabase.storage
          .from("receipts")
          .remove([existingIdentity.file_path]);
        if (oldFileError) console.error("No se pudo limpiar el PDF anterior:", oldFileError);
      }

      const { error: deleteFutureError } = await supabase
        .from("credit_card_future_installments")
        .delete()
        .eq("statement_import_id", statementId);
      if (deleteFutureError) throw deleteFutureError;

      if (analysis.futureInstallments.length) {
        const { error: futureError } = await supabase
          .from("credit_card_future_installments")
          .insert(
            analysis.futureInstallments.map((item) => ({
              household_id: householdId,
              credit_card_id: card.id,
              statement_import_id: statementId,
              period_month: item.periodMonth,
              amount: item.amount,
            }))
          );
        if (futureError) throw futureError;
      }

      setStatementImportId(statementId);
      setMessage(
        previousCardId && previousCardId !== card.id
          ? `Resumen reasignado a ${card.name}. También moví los consumos que habían sido importados desde este PDF.`
          : `Resumen guardado en ${card.name}. Límite, cierres, vencimientos y cuotas futuras quedaron actualizados.`
      );
      router.refresh();
      return statementId;
    } catch (error) {
      console.error("Error guardando resumen:", error);
      const detail = error && typeof error === "object" && "message" in error ? String(error.message) : String(error);
      setMessage(`Error al guardar el resumen: ${detail}`);
      return null;
    } finally {
      setSavingSummary(false);
    }
  }

  async function importSelected() {
    if (!analysis || !selectedCard) {
      setMessage("Primero analizá el PDF y seleccioná la tarjeta correcta.");
      return;
    }

    let statementId = statementImportId;
    if (!statementId) statementId = await saveSummary();
    if (!statementId) return;

    const selected = rows.filter((row) => row.selected && row.duplicateStatus === "new");
    if (!selected.length) {
      setMessage("No hay filas nuevas seleccionadas para importar.");
      return;
    }

    setImporting(true);
    setMessage("");

    try {
      const batch = selected.map((row) => {
        const date = effectiveDate(row, analysis.closingDate);
        const installmentText =
          row.installmentCurrent && row.installmentTotal
            ? `Cuota ${row.installmentCurrent}/${row.installmentTotal}. Compra original ${formatDate(row.date)}.`
            : null;
        const chargeText = row.kind === "charge" ? `Cargo detectado en resumen ${analysis.brand}.` : null;

        return {
          household_id: householdId,
          created_by: userId,
          responsible_person_id: selectedCard.ownerPersonId,
          responsible_user_id: selectedCard.ownerUserId,
          account_id: selectedCard.accountId,
          destination_account_id: null,
          category_id: row.categoryId || null,
          transaction_type: "expense",
          amount: row.amount,
          currency: "ARS",
          transaction_date: date,
          description: installmentText || chargeText || `Importado desde resumen ${analysis.brand}.`,
          merchant: row.merchant,
          economic_destination: "household",
          necessity: null,
          is_recurring: false,
          input_source: "statement_pdf",
          status: "confirmed",
          statement_import_id: statementId,
          source_line_key: row.key,
        };
      });

      const { error } = await supabase.from("transactions").insert(batch);
      if (error) throw error;

      setRows((current) =>
        current.map((row) =>
          selected.some((saved) => saved.key === row.key)
            ? { ...row, selected: false, duplicateStatus: "imported" }
            : row
        )
      );
      setMessage(`${batch.length} movimientos del resumen fueron importados. No se vuelve a contar el pago de la tarjeta como gasto.`);
      router.refresh();
    } catch (error) {
      console.error("Error importando resumen:", error);
      const detail = error && typeof error === "object" && "message" in error ? String(error.message) : String(error);
      setMessage(`Error al importar movimientos: ${detail}`);
    } finally {
      setImporting(false);
    }
  }

  function updateRow(key: string, patch: Partial<ReviewRow>) {
    setRows((current) => current.map((row) => (row.key === key ? { ...row, ...patch } : row)));
  }

  return (
    <div className="space-y-6">
      <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
        <div className="border-b border-slate-200 px-5 py-5 md:px-6">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <h2 className="text-xl font-bold text-slate-950">Leer resumen PDF</h2>
              <p className="mt-1 max-w-3xl text-sm leading-6 text-slate-600">
                v2.2 reconoce inicialmente resúmenes digitales de Visa y Mastercard Banco Provincia. El análisis se hace localmente con Python y no usa una API paga.
              </p>
            </div>
            <span className="rounded-full bg-violet-50 px-3 py-1 text-xs font-bold text-violet-700">Revisión antes de guardar</span>
          </div>
        </div>

        <div className="space-y-5 p-5 md:p-6">
          <div className="grid gap-4 md:grid-cols-[1fr_auto] md:items-end">
            <div>
              <label className="mb-2 block text-sm font-semibold text-slate-700">Resumen PDF</label>
              <input
                type="file"
                accept="application/pdf,.pdf"
                onChange={(event) => {
                  setFile(event.target.files?.[0] ?? null);
                  setAnalysis(null);
                  setRows([]);
                  setStatementImportId(null);
                  setMessage("");
                }}
                className="block w-full rounded-xl border border-slate-300 bg-white px-4 py-3 text-sm text-slate-800 file:mr-4 file:rounded-lg file:border-0 file:bg-slate-950 file:px-4 file:py-2 file:font-semibold file:text-white"
              />
            </div>
            <button
              type="button"
              onClick={handleAnalyze}
              disabled={!file || analyzing}
              className="rounded-xl bg-slate-950 px-5 py-3 font-bold text-white disabled:cursor-not-allowed disabled:opacity-50"
            >
              {analyzing ? "Leyendo PDF..." : "Analizar resumen"}
            </button>
          </div>

          {message && (
            <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm font-medium text-slate-700">
              {message}
            </div>
          )}
        </div>
      </section>

      {analysis && (
        <>
          <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
            <div className="border-b border-slate-200 px-5 py-5 md:px-6">
              <h2 className="text-xl font-bold text-slate-950">Información detectada</h2>
              <p className="mt-1 text-sm text-slate-500">Confirmá la tarjeta correcta antes de guardar.</p>
            </div>

            <div className="space-y-5 p-5 md:p-6">
              <div>
                <label className="mb-2 block text-sm font-semibold text-slate-700">Asignar a tarjeta</label>
                <select
                  value={selectedCardId}
                  onChange={(event) => recheckForCard(event.target.value)}
                  className="w-full rounded-xl border border-slate-300 bg-white px-4 py-3.5 text-slate-900"
                >
                  <option value="">Crear una tarjeta nueva desde este resumen</option>
                  {availableCards.map((card) => (
                    <option key={card.id} value={card.id}>{card.name} · {card.ownerName}</option>
                  ))}
                </select>
              </div>

              {!selectedCard && (
                <div className="rounded-xl border border-violet-200 bg-violet-50 p-4">
                  <p className="font-bold text-violet-950">Nueva tarjeta detectada</p>
                  <p className="mt-1 text-sm text-violet-800">
                    {detectedCardName(analysis)} no coincide con una tarjeta existente. Al guardar el resumen se creará automáticamente como tarjeta de crédito separada.
                  </p>
                  <div className="mt-3 max-w-md">
                    <label className="mb-1 block text-xs font-bold uppercase tracking-wide text-violet-700">Titular</label>
                    <select
                      value={detectedOwnerPersonId}
                      onChange={(event) => setDetectedOwnerPersonId(event.target.value)}
                      className="w-full rounded-lg border border-violet-200 bg-white px-3 py-2.5 text-sm text-slate-900"
                    >
                      {people.map((person) => (
                        <option key={person.id} value={person.id}>{person.fullName}</option>
                      ))}
                    </select>
                  </div>
                </div>
              )}

              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                <Info title="Emisor" value={`${analysis.issuer} · ${analysis.brand}${analysis.cardLast4 ? ` •••• ${analysis.cardLast4}` : ""}`} />
                <Info title="Titular detectado" value={analysis.holderName ?? "—"} />
                <Info title="Cierre" value={formatDate(analysis.closingDate)} />
                <Info title="Vencimiento" value={formatDate(analysis.dueDate)} />
                <Info title="Cierre anterior" value={formatDate(analysis.previousClosingDate)} />
                <Info title="Próximo cierre" value={formatDate(analysis.nextClosingDate)} />
                <Info title="Próximo vencimiento" value={formatDate(analysis.nextDueDate)} />
                <Info title="Límite detectado" value={formatCurrency(analysis.purchaseLimit)} />
                <Info title="Saldo del resumen" value={formatCurrency(analysis.statementBalance)} />
                <Info title="Pago mínimo" value={formatCurrency(analysis.minimumPayment)} />
                <Info title="Consumos según resumen" value={formatCurrency(analysis.totalPurchases)} />
                <Info title="Suma de líneas detectadas" value={formatCurrency(detectedPurchaseTotal)} />
              </div>

              <div className="flex flex-wrap gap-3">
                <button
                  type="button"
                  onClick={saveSummary}
                  disabled={savingSummary || creatingDetectedCard || (!selectedCardId && !detectedOwnerPersonId)}
                  className="rounded-xl bg-violet-700 px-5 py-3 font-bold text-white disabled:opacity-50"
                >
                  {savingSummary || creatingDetectedCard ? "Guardando..." : statementImportId ? "Resumen guardado ✓" : selectedCard ? "Guardar resumen y calendario" : "Crear tarjeta + guardar resumen"}
                </button>
              </div>
            </div>
          </section>

          {analysis.futureInstallments.length > 0 && (
            <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
              <div className="border-b border-slate-200 px-5 py-5 md:px-6">
                <h2 className="text-xl font-bold text-slate-950">Cuotas futuras detectadas</h2>
                <p className="mt-1 text-sm text-slate-500">Se guardan como compromisos futuros al confirmar el resumen.</p>
              </div>
              <div className="grid gap-3 p-5 sm:grid-cols-2 lg:grid-cols-4 md:p-6">
                {analysis.futureInstallments.map((item) => (
                  <div key={item.periodMonth} className="rounded-xl border border-slate-200 bg-slate-50 p-4">
                    <p className="text-xs font-bold uppercase text-slate-500">{item.label}</p>
                    <p className="mt-1 text-lg font-bold text-slate-950">{formatCurrency(item.amount)}</p>
                  </div>
                ))}
              </div>
            </section>
          )}

          <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
            <div className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-200 px-5 py-5 md:px-6">
              <div>
                <h2 className="text-xl font-bold text-slate-950">Consumos y costos para importar</h2>
                <p className="mt-1 text-sm text-slate-500">
                  {rows.length} líneas · {selectedCount} seleccionadas · {formatCurrency(selectedTotal)} seleccionados. Las cuotas se registran en la fecha de cierre y conservan la fecha original en la descripción.
                </p>
              </div>
              <button
                type="button"
                onClick={importSelected}
                disabled={importing || selectedCount === 0 || !selectedCard}
                className="rounded-xl bg-slate-950 px-5 py-3 font-bold text-white disabled:opacity-50"
              >
                {importing ? "Importando..." : `Importar seleccionados (${selectedCount})`}
              </button>
            </div>

            <div className="overflow-x-auto">
              <table className="min-w-full text-left text-sm">
                <thead className="bg-slate-50 text-xs uppercase text-slate-500">
                  <tr>
                    <th className="px-4 py-3">✓</th>
                    <th className="px-4 py-3">Fecha</th>
                    <th className="px-4 py-3">Concepto</th>
                    <th className="px-4 py-3">Cuota</th>
                    <th className="px-4 py-3 text-right">Importe</th>
                    <th className="px-4 py-3">Categoría sugerida</th>
                    <th className="px-4 py-3">Estado</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {rows.map((row) => (
                    <tr key={row.key} className={row.duplicateStatus !== "new" ? "bg-amber-50/60" : ""}>
                      <td className="px-4 py-3 align-top">
                        <input
                          type="checkbox"
                          checked={row.selected}
                          disabled={row.duplicateStatus === "imported"}
                          onChange={(event) => updateRow(row.key, { selected: event.target.checked })}
                          className="h-4 w-4"
                        />
                      </td>
                      <td className="whitespace-nowrap px-4 py-3 align-top text-slate-600">
                        {formatDate(effectiveDate(row, analysis.closingDate))}
                        {row.installmentCurrent && row.date && (
                          <div className="mt-1 text-xs text-slate-400">Original {formatDate(row.date)}</div>
                        )}
                      </td>
                      <td className="max-w-xs px-4 py-3 align-top">
                        <div className="font-semibold text-slate-900">{row.merchant}</div>
                        <div className="mt-1 text-xs text-slate-400">{row.kind === "charge" ? "Costo de tarjeta" : "Consumo"}</div>
                      </td>
                      <td className="whitespace-nowrap px-4 py-3 align-top text-slate-600">
                        {row.installmentCurrent && row.installmentTotal ? `${row.installmentCurrent}/${row.installmentTotal}` : "—"}
                      </td>
                      <td className="whitespace-nowrap px-4 py-3 text-right align-top font-bold text-slate-950">{formatCurrency(row.amount)}</td>
                      <td className="min-w-64 px-4 py-3 align-top">
                        <select
                          value={row.categoryId}
                          onChange={(event) => updateRow(row.key, { categoryId: event.target.value })}
                          className="w-full rounded-lg border border-slate-300 bg-white px-2 py-2 text-xs text-slate-800"
                        >
                          <option value="">Sin categorizar</option>
                          {categories.map((category) => (
                            <option key={category.id} value={category.id}>{category.label}</option>
                          ))}
                        </select>
                      </td>
                      <td className="whitespace-nowrap px-4 py-3 align-top">
                        {row.duplicateStatus === "new" && <span className="rounded-full bg-emerald-50 px-2 py-1 text-xs font-bold text-emerald-700">Nuevo</span>}
                        {row.duplicateStatus === "possible" && <span className="rounded-full bg-amber-100 px-2 py-1 text-xs font-bold text-amber-800">Posible duplicado</span>}
                        {row.duplicateStatus === "imported" && <span className="rounded-full bg-slate-200 px-2 py-1 text-xs font-bold text-slate-600">Ya importado</span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="border-t border-slate-200 bg-slate-50 px-5 py-4 text-sm text-slate-600 md:px-6">
              Control: consumos detectados {formatCurrency(detectedPurchaseTotal)} · costos adicionales {formatCurrency(detectedChargeTotal)}. Un posible duplicado queda desmarcado para que lo revises.
            </div>
          </section>
        </>
      )}
    </div>
  );
}

function Info({ title, value }: { title: string; value: string }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
      <p className="text-[11px] font-bold uppercase tracking-wide text-slate-500">{title}</p>
      <p className="mt-1 font-bold text-slate-950">{value}</p>
    </div>
  );
}
