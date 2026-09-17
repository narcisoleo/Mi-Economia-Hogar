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

type TransactionImporterProps = {
  householdId: string;
  userId: string;
  accounts: Account[];
  categories: Category[];
  people: HouseholdPerson[];
};

type ParsedRow = {
  rowNumber: number;
  date: string;
  type: "expense" | "income" | "transfer";
  amount: number;
  accountId: string;
  destinationAccountId: string | null;
  categoryId: string | null;
  responsiblePersonId: string | null;
  responsibleUserId: string | null;
  merchant: string | null;
  description: string | null;
  necessity: string | null;
  error: string | null;
};

type ImportResult = {
  imported: number;
  duplicates: number;
  errors: number;
};

const REQUIRED_HEADERS = ["fecha", "importe", "cuenta"];

function normalizeText(value: string) {
  return value
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ");
}

function normalizeHeader(value: string) {
  const normalized = normalizeText(value).replace(/[\s-]+/g, "_");
  const aliases: Record<string, string> = {
    date: "fecha",
    transaction_date: "fecha",
    tipo_movimiento: "tipo",
    type: "tipo",
    transaction_type: "tipo",
    monto: "importe",
    amount: "importe",
    account: "cuenta",
    origen: "cuenta",
    cuenta_origen: "cuenta",
    destination_account: "cuenta_destino",
    destino: "cuenta_destino",
    categoria_principal: "categoria",
    category: "categoria",
    sub_category: "subcategoria",
    subcategory: "subcategoria",
    persona: "responsable",
    responsible: "responsable",
    merchant: "comercio",
    concepto: "comercio",
    description: "descripcion",
    detalle: "descripcion",
  };
  return aliases[normalized] ?? normalized;
}

function detectDelimiter(text: string) {
  const firstLine = text.split(/\r?\n/).find((line) => line.trim()) ?? "";
  const candidates = [";", ",", "\t"];
  return candidates.reduce((best, candidate) => {
    const count = firstLine.split(candidate).length;
    const bestCount = firstLine.split(best).length;
    return count > bestCount ? candidate : best;
  }, ";");
}

async function readCsvText(file: File) {
  const buffer = await file.arrayBuffer();
  const bytes = new Uint8Array(buffer);
  const utf8 = new TextDecoder("utf-8").decode(bytes);

  // Excel en Windows puede exportar CSV en ANSI/Windows-1252.
  // Si UTF-8 produce caracteres de reemplazo, reintentamos con Windows-1252
  // para conservar correctamente tildes y ñ en categorías/comercios.
  if (utf8.includes("\uFFFD")) {
    try {
      return new TextDecoder("windows-1252")
        .decode(bytes)
        .replace(/^\uFEFF/, "");
    } catch {
      // Si el navegador no admite Windows-1252, usamos UTF-8 como respaldo.
    }
  }

  return utf8.replace(/^\uFEFF/, "");
}

function csvCell(value: string) {
  if (/[;"\r\n]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

function parseCsv(text: string, delimiter: string) {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];

    if (char === '"') {
      if (quoted && text[index + 1] === '"') {
        cell += '"';
        index += 1;
      } else {
        quoted = !quoted;
      }
      continue;
    }

    if (!quoted && char === delimiter) {
      row.push(cell.trim());
      cell = "";
      continue;
    }

    if (!quoted && (char === "\n" || char === "\r")) {
      if (char === "\r" && text[index + 1] === "\n") index += 1;
      row.push(cell.trim());
      cell = "";
      if (row.some((value) => value.length > 0)) rows.push(row);
      row = [];
      continue;
    }

    cell += char;
  }

  row.push(cell.trim());
  if (row.some((value) => value.length > 0)) rows.push(row);
  return rows;
}

function parseDate(value: string) {
  const trimmed = value.trim();
  let year: number;
  let month: number;
  let day: number;

  const iso = trimmed.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  const local = trimmed.match(/^(\d{1,2})[\/-](\d{1,2})[\/-](\d{4})$/);

  if (iso) {
    year = Number(iso[1]);
    month = Number(iso[2]);
    day = Number(iso[3]);
  } else if (local) {
    day = Number(local[1]);
    month = Number(local[2]);
    year = Number(local[3]);
  } else {
    return null;
  }

  const date = new Date(year, month - 1, day);
  if (
    date.getFullYear() !== year ||
    date.getMonth() !== month - 1 ||
    date.getDate() !== day
  ) {
    return null;
  }

  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function parseAmount(value: string) {
  let cleaned = value.trim().replace(/[$\s]/g, "").replace(/[^\d.,+-]/g, "");
  if (!cleaned) return null;

  const negative = cleaned.startsWith("-");
  cleaned = cleaned.replace(/[+-]/g, "");

  if (cleaned.includes(",") && cleaned.includes(".")) {
    if (cleaned.lastIndexOf(",") > cleaned.lastIndexOf(".")) {
      cleaned = cleaned.replace(/\./g, "").replace(",", ".");
    } else {
      cleaned = cleaned.replace(/,/g, "");
    }
  } else if (cleaned.includes(",")) {
    const parts = cleaned.split(",");
    if (parts.length === 2 && parts[1].length <= 2) {
      cleaned = `${parts[0]}.${parts[1]}`;
    } else {
      cleaned = cleaned.replace(/,/g, "");
    }
  } else if (/^\d{1,3}(\.\d{3})+$/.test(cleaned)) {
    cleaned = cleaned.replace(/\./g, "");
  }

  const numeric = Number(cleaned);
  if (!Number.isFinite(numeric) || numeric === 0) return null;
  return negative ? -Math.abs(numeric) : numeric;
}

function parseType(value: string, signedAmount: number) {
  const normalized = normalizeText(value);
  if (["gasto", "expense", "egreso", "debito"].includes(normalized)) return "expense" as const;
  if (["ingreso", "income", "credito"].includes(normalized)) return "income" as const;
  if (["transferencia", "transfer", "transferir"].includes(normalized)) return "transfer" as const;
  if (!normalized) return signedAmount < 0 ? ("expense" as const) : ("income" as const);
  return null;
}

function duplicateKey(row: {
  transaction_date: string;
  amount: number | string;
  transaction_type: string;
  account_id: string | null;
  destination_account_id: string | null;
  merchant: string | null;
  description: string | null;
}) {
  return [
    row.transaction_date,
    row.transaction_type,
    Number(row.amount).toFixed(2),
    row.account_id ?? "",
    row.destination_account_id ?? "",
    normalizeText(row.merchant ?? ""),
    normalizeText(row.description ?? ""),
  ].join("|");
}

export function TransactionImporter({
  householdId,
  userId,
  accounts,
  categories,
  people,
}: TransactionImporterProps) {
  const supabase = useMemo(() => createClient(), []);
  const router = useRouter();
  const [fileName, setFileName] = useState("");
  const [rows, setRows] = useState<ParsedRow[]>([]);
  const [message, setMessage] = useState("");
  const [importing, setImporting] = useState(false);
  const [result, setResult] = useState<ImportResult | null>(null);

  const accountByName = useMemo(
    () => new Map(accounts.map((account) => [normalizeText(account.name), account])),
    [accounts]
  );

  const parentCategories = useMemo(
    () => categories.filter((category) => category.parent_id === null),
    [categories]
  );

  const parentByName = useMemo(
    () => new Map(parentCategories.map((category) => [normalizeText(category.name), category])),
    [parentCategories]
  );

  const peopleByName = useMemo(
    () => new Map(people.map((person) => [normalizeText(person.full_name), person])),
    [people]
  );

  const formatCurrency = (value: number) =>
    new Intl.NumberFormat("es-AR", {
      style: "currency",
      currency: "ARS",
      maximumFractionDigits: 2,
    }).format(value);

  const resolveCategory = (parentName: string, childName: string) => {
    const normalizedParent = normalizeText(parentName);
    const normalizedChild = normalizeText(childName);
    const parent = parentByName.get(normalizedParent);

    if (parent) {
      if (!normalizedChild) {
        const children = categories.filter((category) => category.parent_id === parent.id);
        return children.length === 0 ? parent : null;
      }

      const exactChild = categories.find(
        (category) =>
          category.parent_id === parent.id &&
          normalizeText(category.name) === normalizedChild
      );
      if (exactChild) return exactChild;
    }

    // Respaldo tolerante: si la subcategoría existe una sola vez en todo el hogar,
    // la aceptamos aunque Excel haya alterado el texto acentuado de la categoría padre.
    if (normalizedChild) {
      const uniqueChildren = categories.filter(
        (category) =>
          category.parent_id !== null && normalizeText(category.name) === normalizedChild
      );
      if (uniqueChildren.length === 1) return uniqueChildren[0];
    }

    return null;
  };

  const analyzeFile = async (file: File) => {
    setFileName(file.name);
    setRows([]);
    setResult(null);
    setMessage("");

    const text = await readCsvText(file);
    const delimiter = detectDelimiter(text);
    const parsed = parseCsv(text, delimiter);

    if (parsed.length < 2) {
      setMessage("El CSV no contiene filas para importar.");
      return;
    }

    const headers = parsed[0].map(normalizeHeader);
    const missing = REQUIRED_HEADERS.filter((header) => !headers.includes(header));
    if (missing.length > 0) {
      setMessage(`Faltan columnas obligatorias: ${missing.join(", ")}.`);
      return;
    }

    const column = (record: string[], name: string) => {
      const index = headers.indexOf(name);
      return index >= 0 ? record[index] ?? "" : "";
    };

    const analyzed = parsed.slice(1).map((record, index): ParsedRow => {
      const signedAmount = parseAmount(column(record, "importe"));
      const date = parseDate(column(record, "fecha"));
      const type = signedAmount === null ? null : parseType(column(record, "tipo"), signedAmount);
      const account = accountByName.get(normalizeText(column(record, "cuenta")));
      const destinationAccount = accountByName.get(
        normalizeText(column(record, "cuenta_destino"))
      );
      const responsibleRaw = column(record, "responsable");
      const responsible =
        !responsibleRaw.trim() || normalizeText(responsibleRaw) === "hogar"
          ? null
          : peopleByName.get(normalizeText(responsibleRaw)) ?? null;

      let category: Category | null = null;
      if (type && type !== "transfer") {
        category = resolveCategory(
          column(record, "categoria"),
          column(record, "subcategoria")
        );
      }

      const errors: string[] = [];
      if (!date) errors.push("fecha inválida");
      if (signedAmount === null) errors.push("importe inválido");
      if (!type) errors.push("tipo inválido");
      if (!account) errors.push("cuenta no encontrada");
      if (type === "transfer" && !destinationAccount) {
        errors.push("cuenta destino no encontrada");
      }
      if (type === "transfer" && account && destinationAccount?.id === account.id) {
        errors.push("origen y destino son iguales");
      }
      if (type && type !== "transfer" && !category) {
        const parentLabel = column(record, "categoria").trim() || "sin categoría";
        const childLabel = column(record, "subcategoria").trim() || "sin subcategoría";
        errors.push(`categoría/subcategoría no encontrada (${parentLabel} > ${childLabel})`);
      }
      if (
        responsibleRaw.trim() &&
        normalizeText(responsibleRaw) !== "hogar" &&
        !responsible
      ) {
        errors.push("persona de ‘¿para quién fue?’ no encontrada");
      }

      return {
        rowNumber: index + 2,
        date: date ?? "",
        type: type ?? "expense",
        amount: Math.abs(signedAmount ?? 0),
        accountId: account?.id ?? "",
        destinationAccountId: type === "transfer" ? destinationAccount?.id ?? null : null,
        categoryId: type === "transfer" ? null : category?.id ?? null,
        responsiblePersonId: type === "transfer" ? null : responsible?.id ?? null,
        responsibleUserId:
          type === "transfer" ? null : responsible?.linked_user_id ?? null,
        merchant: column(record, "comercio").trim() || null,
        description: column(record, "descripcion").trim() || null,
        necessity: type === "expense" ? category?.economic_type ?? null : null,
        error: errors.length > 0 ? errors.join(" · ") : null,
      };
    });

    setRows(analyzed);
    const errorCount = analyzed.filter((row) => row.error).length;
    setMessage(
      errorCount > 0
        ? `Archivo analizado. ${errorCount} fila(s) necesitan corrección antes de importarse.`
        : `Archivo analizado correctamente. ${analyzed.length} fila(s) listas para importar.`
    );
  };

  const importRows = async () => {
    const validRows = rows.filter((row) => !row.error);
    if (validRows.length === 0) {
      setMessage("No hay filas válidas para importar.");
      return;
    }

    setImporting(true);
    setResult(null);
    setMessage("");

    const dates = validRows.map((row) => row.date).sort();
    const minDate = dates[0];
    const maxDate = dates[dates.length - 1];

    const { data: existingData, error: existingError } = await supabase
      .from("transactions")
      .select(
        "transaction_date, amount, transaction_type, account_id, destination_account_id, merchant, description"
      )
      .eq("household_id", householdId)
      .gte("transaction_date", minDate)
      .lte("transaction_date", maxDate);

    if (existingError) {
      console.error("Error buscando duplicados:", existingError);
      setMessage(`No se pudo comprobar duplicados: ${existingError.message}`);
      setImporting(false);
      return;
    }

    const seen = new Set(
      (existingData ?? []).map((transaction) => duplicateKey(transaction))
    );

    const newRows: ParsedRow[] = [];
    let duplicates = 0;

    for (const row of validRows) {
      const key = duplicateKey({
        transaction_date: row.date,
        amount: row.amount,
        transaction_type: row.type,
        account_id: row.accountId,
        destination_account_id: row.destinationAccountId,
        merchant: row.merchant,
        description: row.description,
      });

      if (seen.has(key)) {
        duplicates += 1;
      } else {
        seen.add(key);
        newRows.push(row);
      }
    }

    let imported = 0;
    const batchSize = 150;

    for (let start = 0; start < newRows.length; start += batchSize) {
      const batch = newRows.slice(start, start + batchSize).map((row) => ({
        household_id: householdId,
        created_by: userId,
        responsible_person_id: row.responsiblePersonId,
        responsible_user_id: row.responsibleUserId,
        account_id: row.accountId,
        destination_account_id: row.destinationAccountId,
        category_id: row.categoryId,
        transaction_type: row.type,
        amount: row.amount,
        currency: "ARS",
        transaction_date: row.date,
        description: row.description,
        merchant: row.merchant,
        economic_destination: "household",
        necessity: row.necessity,
        is_recurring: false,
        input_source: "csv",
        status: "confirmed",
      }));

      const { error } = await supabase.from("transactions").insert(batch);
      if (error) {
        console.error("Error importando CSV:", error);

        const inputSourceConstraint =
          error.message?.includes("input_source_check") ||
          error.details?.includes?.("input_source_check");

        setMessage(
          inputSourceConstraint
            ? "Supabase todavía no permite la fuente CSV. Ejecutá una sola vez SUPABASE-v1.9.1-IMPORTACION.sql y volvé a importar."
            : `La importación se detuvo después de ${imported} movimientos: ${error.message}`
        );
        setImporting(false);
        return;
      }

      imported += batch.length;
    }

    const importResult = {
      imported,
      duplicates,
      errors: rows.filter((row) => row.error).length,
    };
    setResult(importResult);
    setMessage(
      `Importación terminada: ${imported} nuevos, ${duplicates} duplicados omitidos y ${importResult.errors} filas con error.`
    );
    setImporting(false);
    router.refresh();
  };

  const downloadTemplate = () => {
    const today = new Date();
    const dateLabel = `${String(today.getDate()).padStart(2, "0")}/${String(
      today.getMonth() + 1
    ).padStart(2, "0")}/${today.getFullYear()}`;

    const ownAccount =
      accounts.find(
        (account) => account.owner_user_id === userId && account.account_type !== "credit_card"
      ) ?? accounts.find((account) => account.account_type !== "credit_card") ?? accounts[0];

    const secondAccount = accounts.find(
      (account) => account.id !== ownAccount?.id && account.account_type !== "credit_card"
    );

    const expenseLeaf = categories.find((category) => {
      if (!category.parent_id) return false;
      const parent = categories.find((candidate) => candidate.id === category.parent_id);
      return parent ? !["ingresos", "ahorro"].includes(normalizeText(parent.name)) : false;
    });

    const incomeParent = parentCategories.find(
      (category) => normalizeText(category.name) === "ingresos"
    );
    const incomeLeaf = incomeParent
      ? categories.find((category) => category.parent_id === incomeParent.id)
      : undefined;

    const responsiblePerson =
      people.find((person) => person.linked_user_id === userId) ?? people[0];

    const parentNameFor = (category?: Category) => {
      if (!category?.parent_id) return category?.name ?? "";
      return categories.find((candidate) => candidate.id === category.parent_id)?.name ?? "";
    };

    const rows: string[][] = [
      [
        "fecha",
        "tipo",
        "importe",
        "cuenta",
        "cuenta_destino",
        "categoria",
        "subcategoria",
        "responsable",
        "comercio",
        "descripcion",
      ],
    ];

    if (ownAccount && expenseLeaf) {
      rows.push([
        dateLabel,
        "gasto",
        "35000",
        ownAccount.name,
        "",
        parentNameFor(expenseLeaf),
        expenseLeaf.name,
        responsiblePerson?.full_name ?? "Hogar",
        "Comercio ejemplo",
        "Compra de ejemplo",
      ]);
    }

    if (ownAccount && incomeLeaf) {
      rows.push([
        dateLabel,
        "ingreso",
        "800000",
        ownAccount.name,
        "",
        parentNameFor(incomeLeaf),
        incomeLeaf.name,
        responsiblePerson?.full_name ?? "Hogar",
        "Ingreso ejemplo",
        "Ingreso mensual",
      ]);
    }

    if (ownAccount && secondAccount) {
      rows.push([
        dateLabel,
        "transferencia",
        "50000",
        ownAccount.name,
        secondAccount.name,
        "",
        "",
        "Hogar",
        "",
        "Transferencia entre cuentas",
      ]);
    }

    const content = rows.map((row) => row.map(csvCell).join(";")).join("\r\n");

    const blob = new Blob(["\uFEFF", content], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = "plantilla-eco-hogar.csv";
    anchor.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-5">
      <section className="rounded-2xl border border-slate-200 bg-white shadow-sm">
        <div className="border-b border-slate-200 p-5 md:p-6">
          <h2 className="text-xl font-bold text-slate-950">Importar movimientos desde CSV</h2>
          <p className="mt-1 text-sm leading-6 text-slate-500">
            Ideal para cargar muchos movimientos juntos. Antes de guardar, ECO HOGAR valida cuentas,
            categorías y personas de “¿para quién fue?”, y evita duplicados exactos.
          </p>
        </div>

        <div className="space-y-5 p-5 md:p-6">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
            <label className="inline-flex cursor-pointer items-center justify-center rounded-xl bg-slate-950 px-4 py-3 text-sm font-semibold text-white transition hover:bg-slate-800">
              Seleccionar CSV
              <input
                type="file"
                accept=".csv,text/csv"
                className="hidden"
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  if (file) void analyzeFile(file);
                  event.currentTarget.value = "";
                }}
              />
            </label>

            <button
              type="button"
              onClick={downloadTemplate}
              className="rounded-xl border border-slate-300 bg-white px-4 py-3 text-sm font-semibold text-slate-700 transition hover:bg-slate-50"
            >
              Descargar plantilla CSV
            </button>

            {fileName && <span className="text-sm text-slate-500">{fileName}</span>}
          </div>

          <div className="rounded-xl border border-blue-200 bg-blue-50 p-4 text-sm leading-6 text-blue-900">
            <strong>Columnas:</strong> fecha, tipo, importe, cuenta, cuenta_destino, categoría,
            subcategoría, responsable (¿para quién fue?), comercio y descripción. Para gastos/ingresos sin “tipo”,
            un importe negativo se interpreta como gasto y uno positivo como ingreso.
          </div>

          {message && (
            <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 text-sm text-slate-700">
              {message}
            </div>
          )}

          {result && (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-4">
                <p className="text-xs font-semibold uppercase text-emerald-700">Importados</p>
                <p className="mt-1 text-2xl font-bold text-emerald-800">{result.imported}</p>
              </div>
              <div className="rounded-xl border border-amber-200 bg-amber-50 p-4">
                <p className="text-xs font-semibold uppercase text-amber-700">Duplicados omitidos</p>
                <p className="mt-1 text-2xl font-bold text-amber-800">{result.duplicates}</p>
              </div>
              <div className="rounded-xl border border-red-200 bg-red-50 p-4">
                <p className="text-xs font-semibold uppercase text-red-700">Filas con error</p>
                <p className="mt-1 text-2xl font-bold text-red-800">{result.errors}</p>
              </div>
            </div>
          )}
        </div>
      </section>

      {rows.length > 0 && (
        <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
          <div className="flex flex-col gap-3 border-b border-slate-200 p-5 sm:flex-row sm:items-center sm:justify-between md:p-6">
            <div>
              <h2 className="text-lg font-bold text-slate-950">Vista previa</h2>
              <p className="mt-1 text-sm text-slate-500">
                {rows.length} filas · {rows.filter((row) => !row.error).length} válidas
              </p>
            </div>
            <button
              type="button"
              onClick={() => void importRows()}
              disabled={importing || rows.every((row) => row.error)}
              className="rounded-xl bg-slate-950 px-4 py-3 text-sm font-semibold text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {importing ? "Importando..." : "Importar filas válidas"}
            </button>
          </div>

          <div className="overflow-x-auto">
            <table className="min-w-full text-left text-sm">
              <thead className="bg-slate-50 text-xs uppercase text-slate-500">
                <tr>
                  <th className="px-4 py-3">Fila</th>
                  <th className="px-4 py-3">Fecha</th>
                  <th className="px-4 py-3">Tipo</th>
                  <th className="px-4 py-3">Importe</th>
                  <th className="px-4 py-3">Comercio</th>
                  <th className="px-4 py-3">Estado</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {rows.slice(0, 100).map((row) => (
                  <tr key={row.rowNumber} className={row.error ? "bg-red-50/50" : "bg-white"}>
                    <td className="px-4 py-3 font-medium text-slate-600">{row.rowNumber}</td>
                    <td className="whitespace-nowrap px-4 py-3 text-slate-700">{row.date || "—"}</td>
                    <td className="px-4 py-3 text-slate-700">
                      {row.type === "expense" ? "Gasto" : row.type === "income" ? "Ingreso" : "Transferencia"}
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 font-semibold text-slate-900">
                      {formatCurrency(row.amount)}
                    </td>
                    <td className="max-w-[220px] truncate px-4 py-3 text-slate-600">
                      {row.merchant ?? row.description ?? "—"}
                    </td>
                    <td className="px-4 py-3">
                      {row.error ? (
                        <span className="text-xs font-medium text-red-700">{row.error}</span>
                      ) : (
                        <span className="rounded-full bg-emerald-50 px-2 py-1 text-xs font-semibold text-emerald-700">
                          Lista
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {rows.length > 100 && (
            <div className="border-t border-slate-200 bg-slate-50 px-5 py-3 text-xs text-slate-500">
              Se muestran las primeras 100 filas. Las demás también se importarán si son válidas.
            </div>
          )}
        </section>
      )}
    </div>
  );
}
