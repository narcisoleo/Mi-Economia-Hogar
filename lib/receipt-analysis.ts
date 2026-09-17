export type ReceiptCategory = {
  id: string;
  name: string;
  parent_id: string | null;
};

export type ReceiptAnalysis = {
  amount: number | null;
  amountConfidence: "alta" | "media" | "baja";
  date: string | null;
  merchant: string | null;
  categoryId: string;
  confidence: "alta" | "media" | "baja";
  notes: string[];
  receiptKind: "purchase" | "transfer" | "unknown";
  transferDirection: "sent" | "received" | null;
  sourceAccountHint: string | null;
  destinationAccountHint: string | null;
  sender: string | null;
  counterparty: string | null;
  description: string | null;
  reference: string | null;
};

export function normalizeReceiptValue(value: string | null | undefined) {
  return (value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function parseMoney(raw: string) {
  let value = raw
    .replace(/\$/g, "")
    .replace(/\s/g, "")
    .replace(/[^0-9,.-]/g, "")
    .trim();

  if (!value) return null;

  const comma = value.lastIndexOf(",");
  const dot = value.lastIndexOf(".");

  if (comma >= 0 && dot >= 0) {
    // Formato AR: 1.234,56. Formato US: 1,234.56.
    if (comma > dot) {
      value = value.replace(/\./g, "").replace(",", ".");
    } else {
      value = value.replace(/,/g, "");
    }
  } else if (comma >= 0) {
    const decimals = value.length - comma - 1;
    if (decimals === 1 || decimals === 2) {
      value = value.replace(/\./g, "").replace(",", ".");
    } else {
      value = value.replace(/,/g, "");
    }
  } else if (dot >= 0) {
    // 3.500 / 1.234.567 son miles; 3.50 es decimal.
    if (/^\d{1,3}(?:\.\d{3})+$/.test(value)) {
      value = value.replace(/\./g, "");
    } else {
      const decimals = value.length - dot - 1;
      if (decimals !== 1 && decimals !== 2) {
        value = value.replace(/\./g, "");
      }
    }
  }

  const number = Number(value);
  return Number.isFinite(number) ? Math.abs(number) : null;
}

type AmountCandidate = {
  value: number;
  score: number;
  index: number;
  line: string;
};

type AmountDetection = {
  value: number | null;
  confidence: "alta" | "media" | "baja";
  note?: string;
};

const MONEY_LABEL = /(?:^| )(?:total a pagar|importe total|monto total|total final|total|importe|monto|enviaste|enviaste|pagaste|transferencia recibida|transferencia enviada|recibiste|cobraste)(?: |$)/;
const MONEY_IGNORE = /(?:saldo anterior|saldo disponible|dinero disponible antes|antes y despues|antes y después|limite disponible|l[ií]mite|pago minimo|pago m[ií]nimo|financiacion|financiaci[oó]n|cuotas?|cbu|cvu|cuit|cuil|numero de operacion|n[uú]mero de operaci[oó]n|n de movimiento|n\. ?de movimiento)/;

function amountCandidates(text: string): AmountDetection {
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter(Boolean);

  const candidates: AmountCandidate[] = [];

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const normalized = normalizeReceiptValue(line);
    const previous = normalizeReceiptValue(lines[index - 1] ?? "");
    const previous2 = normalizeReceiptValue(lines[index - 2] ?? "");
    const context = `${previous2} ${previous} ${normalized}`.trim();

    // Balances "antes y después" y otros números técnicos jamás deben ganar como importe.
    if (MONEY_IGNORE.test(normalized) || /(?:antes y despues|antes y después)/i.test(line)) {
      continue;
    }

    const currencyMatches = Array.from(line.matchAll(/\$\s*([0-9][0-9.\s]*(?:,[0-9]{1,2})?)/g));
    if (currencyMatches.length > 1 && /(->|→|antes|despu[eé]s)/i.test(line)) continue;

    const labelScore = MONEY_LABEL.test(normalized) ? 8 : MONEY_LABEL.test(previous) ? 6 : MONEY_LABEL.test(previous2) ? 3 : 0;
    const topScore = index <= 6 ? 4 : index <= 12 ? 2 : 0;

    for (const match of currencyMatches) {
      const value = parseMoney(match[1]);
      if (value === null || value <= 0 || value >= 100_000_000) continue;
      candidates.push({ value, score: 5 + labelScore + topScore, index, line });
    }

    // Algunos OCR pierden el símbolo $. Solo lo aceptamos si hay un contexto fuerte.
    if (currencyMatches.length === 0 && (labelScore > 0 || index <= 5)) {
      const generic = line.match(/(?:^|\s)(\d{1,3}(?:\.\d{3})+(?:,\d{1,2})?|\d{2,}(?:,\d{1,2})|\d{2,}(?:\.\d{1,2}))(?:\s|$)/);
      if (generic) {
        const value = parseMoney(generic[1]);
        if (value !== null && value > 0 && value < 100_000_000) {
          candidates.push({ value, score: 2 + labelScore + topScore, index, line });
        }
      }
    }

    // Evita que una línea técnica aislada herede una etiqueta de dos líneas atrás.
    if (MONEY_IGNORE.test(context)) {
      for (let candidateIndex = candidates.length - 1; candidateIndex >= 0; candidateIndex -= 1) {
        if (candidates[candidateIndex].index !== index) break;
        candidates[candidateIndex].score -= 5;
      }
    }
  }

  if (candidates.length === 0) return { value: null, confidence: "baja" };

  candidates.sort((a, b) => b.score - a.score || a.index - b.index);
  const best = candidates[0];
  const second = candidates[1];
  const closeConflict = second && second.value !== best.value && Math.abs(best.score - second.score) <= 1;

  if (best.score >= 11 && !closeConflict) return { value: best.value, confidence: "alta" };
  if (best.score >= 7 && !closeConflict) return { value: best.value, confidence: "media" };
  return {
    value: best.value,
    confidence: "baja",
    note: "El importe aparece ambiguo en el comprobante; no conviene guardarlo sin revisarlo.",
  };
}

const SPANISH_MONTHS: Record<string, number> = {
  enero: 1,
  ene: 1,
  febrero: 2,
  feb: 2,
  marzo: 3,
  mar: 3,
  abril: 4,
  abr: 4,
  mayo: 5,
  may: 5,
  junio: 6,
  jun: 6,
  julio: 7,
  jul: 7,
  agosto: 8,
  ago: 8,
  septiembre: 9,
  setiembre: 9,
  sep: 9,
  sept: 9,
  octubre: 10,
  oct: 10,
  noviembre: 11,
  nov: 11,
  diciembre: 12,
  dic: 12,
};

function toIsoDate(day: number, month: number, year: number) {
  if (year < 100) year += 2000;
  if (day < 1 || day > 31 || month < 1 || month > 12 || year < 2000 || year > 2100) {
    return null;
  }

  const candidate = new Date(Date.UTC(year, month - 1, day));
  if (
    candidate.getUTCFullYear() !== year ||
    candidate.getUTCMonth() !== month - 1 ||
    candidate.getUTCDate() !== day
  ) {
    return null;
  }

  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function parseReceiptDate(text: string) {
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter(Boolean);
  const currentYear = new Date().getFullYear();

  const preferred = [
    ...lines.filter((line) => /fecha|transferencia|comprobante|emitid|realizad|recibid|enviaste|pagaste/i.test(line) && !/vencimiento/i.test(line)),
    ...lines.filter((line) => !/vencimiento/i.test(line)),
    ...lines.filter((line) => /vencimiento/i.test(line)),
  ];

  for (const line of preferred) {
    const numeric = line.match(/\b(\d{1,2})[\/-](\d{1,2})[\/-](\d{2,4})\b/)
      ?? line.match(/\b(\d{1,2})\.(\d{1,2})\.(\d{2,4})\b/);
    if (numeric) {
      const result = toIsoDate(Number(numeric[1]), Number(numeric[2]), Number(numeric[3]));
      if (result) return result;
    }

    const normalized = normalizeReceiptValue(line);
    const written = normalized.match(
      /(?:lunes |martes |miercoles |jueves |viernes |sabado |domingo )?(\d{1,2}) de (enero|febrero|marzo|abril|mayo|junio|julio|agosto|septiembre|setiembre|octubre|noviembre|diciembre)(?: de)? (\d{4})/
    );
    if (written) {
      const result = toIsoDate(Number(written[1]), SPANISH_MONTHS[written[2]] ?? 0, Number(written[3]));
      if (result) return result;
    }

    // Formatos de apps: 1/sep - 02:12, 27/AGO/2026, 01 sep 2026.
    // En "1/sep - 02:12" el 02 es la hora, NO el año.
    const abbreviatedWithYear = normalized.match(/\b(\d{1,2})[\/.\-](ene|feb|mar|abr|may|jun|jul|ago|sep|sept|oct|nov|dic)[\/.\-](\d{2,4})\b/)
      ?? normalized.match(/\b(\d{1,2})\s+(ene|feb|mar|abr|may|jun|jul|ago|sep|sept|oct|nov|dic)\s+(\d{4})\b/);
    if (abbreviatedWithYear) {
      const result = toIsoDate(
        Number(abbreviatedWithYear[1]),
        SPANISH_MONTHS[abbreviatedWithYear[2]] ?? 0,
        Number(abbreviatedWithYear[3]),
      );
      if (result) return result;
    }

    const abbreviatedWithoutYear = normalized.match(/\b(\d{1,2})[\/.\-](ene|feb|mar|abr|may|jun|jul|ago|sep|sept|oct|nov|dic)\b/)
      ?? normalized.match(/\b(\d{1,2})\s+(ene|feb|mar|abr|may|jun|jul|ago|sep|sept|oct|nov|dic)\b/);
    if (abbreviatedWithoutYear) {
      const result = toIsoDate(
        Number(abbreviatedWithoutYear[1]),
        SPANISH_MONTHS[abbreviatedWithoutYear[2]] ?? 0,
        currentYear,
      );
      if (result) return result;
    }
  }

  return null;
}

const INSTITUTIONS: Array<{ name: string; aliases: string[] }> = [
  { name: "Mercado Pago", aliases: ["mercado pago", "mercadopago"] },
  { name: "Banco Provincia", aliases: ["banco de la provincia de buenos aires", "banco provincia", "cuenta dni"] },
  { name: "Banco Carrefour", aliases: ["cuenta en carrefour banco", "banco carrefour", "carrefour banco"] },
  { name: "Naranja X", aliases: ["naranja x", "naranjax"] },
  { name: "AstroPay", aliases: ["astropay", "astro pay"] },
  { name: "Ualá", aliases: ["uala"] },
  { name: "Brubank", aliases: ["brubank"] },
];

function institutionMatchesInOrder(text: string) {
  const normalized = normalizeReceiptValue(text);
  const found: Array<{ name: string; index: number }> = [];

  for (const institution of INSTITUTIONS) {
    let best = Number.MAX_SAFE_INTEGER;
    for (const alias of institution.aliases) {
      const normalizedAlias = normalizeReceiptValue(alias);
      if (!normalizedAlias) continue;
      const index = normalized.indexOf(normalizedAlias);
      if (index >= 0) best = Math.min(best, index);
    }
    if (best !== Number.MAX_SAFE_INTEGER) found.push({ name: institution.name, index: best });
  }

  return found.sort((a, b) => a.index - b.index);
}

function detectInstitution(text: string) {
  return institutionMatchesInOrder(text)[0]?.name ?? null;
}

function institutionsInOrder(text: string) {
  return institutionMatchesInOrder(text).map((item) => item.name);
}

function partyLine(lines: string[], markerIndex: number) {
  for (let index = markerIndex + 1; index < Math.min(lines.length, markerIndex + 6); index += 1) {
    const line = lines[index]?.trim();
    if (!line) continue;
    const normalized = normalizeReceiptValue(line);
    if (/^(cuit|cuil|cvu|cbu|alias|banco|billetera|numero|número|codigo|código|referencia|motivo|informacion de la operacion)/i.test(line)) continue;
    if (detectInstitution(line)) continue;
    if (/^\d{8,}$/.test(line.replace(/\D/g, ""))) continue;
    if (/^(vos|dinero disponible|cuenta corriente|caja de ahorro)$/i.test(normalized)) continue;
    return line;
  }
  return null;
}

function findMarker(lines: string[], patterns: RegExp[]) {
  return lines.findIndex((line) => patterns.some((pattern) => pattern.test(normalizeReceiptValue(line))));
}

function institutionInSection(lines: string[], start: number, end: number) {
  if (start < 0) return null;
  const section = lines.slice(start, Math.max(start + 1, end)).join("\n");
  return detectInstitution(section);
}

function findReference(lines: string[]) {
  const marker = lines.findIndex((line) => /n[uú]mero de operaci[oó]n|n\.? ?de movimiento|c[oó]digo de referencia|c[oó]digo de transacci[oó]n|n[uú]mero de transacci[oó]n/i.test(line));
  if (marker < 0) return null;
  const sameLine = lines[marker].split(":").slice(1).join(":").trim();
  if (sameLine.length >= 6) return sameLine.replace(/\s+/g, "");
  const next = lines[marker + 1]?.trim() ?? "";
  return next.length >= 6 ? next.replace(/\s+/g, "") : null;
}

function parseTransferReceipt(text: string) {
  const normalized = normalizeReceiptValue(text);
  const transferSignal = /(comprobante de transferencia|transferencia realizada|transferencia exitosa|transferencia recibida|transferencia enviada|enviaste|transferiste|cuenta origen|cuenta destino|origen y destino)/.test(normalized);
  if (!transferSignal) return null;

  const lines = text
    .split(/\r?\n/)
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter(Boolean);

  const direction: "sent" | "received" = /transferencia recibida|recibiste|recibida/.test(normalized)
    ? "received"
    : "sent";

  const fromIndex = findMarker(lines, [/^de$/, /^origen$/, /^cuenta origen$/]);
  const toIndex = findMarker(lines, [/^para$/, /^destino$/, /^cuenta destino$/]);

  let sender = fromIndex >= 0 ? partyLine(lines, fromIndex) : null;
  let counterparty = toIndex >= 0 ? partyLine(lines, toIndex) : null;

  let sourceAccountHint = fromIndex >= 0
    ? institutionInSection(lines, fromIndex + 1, toIndex > fromIndex ? toIndex : lines.length)
    : null;
  let destinationAccountHint = toIndex >= 0
    ? institutionInSection(lines, toIndex + 1, lines.length)
    : null;

  const originDestinationIndex = findMarker(lines, [/^origen y destino$/]);
  if (originDestinationIndex >= 0) {
    const ordered = institutionsInOrder(lines.slice(originDestinationIndex + 1).join("\n"));
    if (!sourceAccountHint) sourceAccountHint = ordered[0] ?? null;
    if (!destinationAccountHint) destinationAccountHint = ordered[1] ?? null;
  }

  // Cuenta DNI suele aparecer solo como encabezado, no dentro del bloque "Origen".
  if (!sourceAccountHint && /cuenta dni/.test(normalized)) sourceAccountHint = "Banco Provincia";
  if (!sourceAccountHint && /naranja x/.test(normalized)) sourceAccountHint = "Naranja X";

  // Algunas transferencias recibidas de Mercado Pago no muestran el nombre del emisor,
  // pero sí las instituciones de origen y destino. En ese caso alcanza para mapear cuentas.
  if (direction === "received" && originDestinationIndex >= 0) {
    sender = sender ?? null;
    counterparty = counterparty ?? null;
  }

  const motiveLine = lines.find((line) => /^motivo\s*:/i.test(line));
  const motive = motiveLine?.replace(/^motivo\s*:\s*/i, "").trim() || null;
  const reference = findReference(lines);

  const descriptionParts = [
    direction === "received"
      ? counterparty ? `Transferencia recibida de ${counterparty}` : "Transferencia recibida"
      : counterparty ? `Transferencia a ${counterparty}` : "Transferencia enviada",
    motive ? `Motivo: ${motive}` : null,
    reference ? `Op. ${reference}` : null,
  ].filter(Boolean);

  return {
    direction,
    sender,
    counterparty,
    sourceAccountHint,
    destinationAccountHint,
    reference,
    description: descriptionParts.join(" · "),
  };
}

function parsePaymentReceipt(text: string) {
  const normalized = normalizeReceiptValue(text);
  if (!/(comprobante de pago|pago realizado|pagaste)/.test(normalized)) return null;

  const lines = text
    .split(/\r?\n/)
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter(Boolean);

  const toIndex = findMarker(lines, [/^para$/]);
  const counterparty = toIndex >= 0 ? partyLine(lines, toIndex) : null;

  const paymentLineIndex = lines.findIndex((line) => /forma de pago/i.test(line));
  const paymentContext = paymentLineIndex >= 0
    ? `${lines[paymentLineIndex]}\n${lines[paymentLineIndex + 1] ?? ""}`
    : text;
  const sourceAccountHint = detectInstitution(paymentContext);

  const title = lines.find((line) => /^t[ií]tulo\s*:/i.test(line))?.replace(/^t[ií]tulo\s*:\s*/i, "").trim() || null;
  const reference = findReference(lines);

  return {
    counterparty,
    sourceAccountHint,
    reference,
    description: [title, reference ? `Op. ${reference}` : null].filter(Boolean).join(" · ") || null,
  };
}

function detectMerchant(text: string) {
  const known: Array<[RegExp, string]> = [
    [/carrefour/i, "Carrefour"],
    [/coto\b/i, "Coto"],
    [/dia%?|supermercados? dia/i, "Día"],
    [/changomas|chango mas/i, "ChangoMás"],
    [/mercado\s*libre|mercadolibre/i, "Mercado Libre"],
    [/municipalidad de berazategui/i, "Municipalidad de Berazategui"],
    [/ypf\b/i, "YPF"],
    [/shell\b/i, "Shell"],
    [/axion/i, "Axion"],
    [/mostaza/i, "Mostaza"],
    [/mcdonald/i, "McDonald's"],
    [/burger king/i, "Burger King"],
    [/telecentro/i, "Telecentro"],
    [/movistar/i, "Movistar"],
    [/metrogas/i, "Metrogas"],
    [/edesur/i, "Edesur"],
    [/aysa/i, "AySA"],
    [/spotify/i, "Spotify"],
    [/prime\s*video|primevideo/i, "Prime Video"],
    [/netflix/i, "Netflix"],
    [/farmacity/i, "Farmacity"],
  ];

  for (const [pattern, name] of known) {
    if (pattern.test(text)) return name;
  }

  const ignored = /^(ticket|factura|consumidor|iva|cuit|ingresos brutos|inicio de actividades|fecha|hora|caja|terminal|comprobante|original|duplicado|subtotal|total|pago|efectivo|tarjeta|gracias|mercado pago|cuenta dni|naranja x|banco)/i;
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter((line) => line.length >= 3 && line.length <= 70)
    .filter((line) => /[A-Za-zÁÉÍÓÚÑáéíóúñ]/.test(line))
    .filter((line) => !ignored.test(line));

  return lines[0] ?? null;
}

function categoryByNames(categories: ReceiptCategory[], parentParts: string[], childParts: string[] = []) {
  const parents = categories.filter((category) => category.parent_id === null);
  const parent = parents.find((category) => {
    const value = normalizeReceiptValue(category.name);
    return parentParts.some((part) => value.includes(normalizeReceiptValue(part)));
  });
  if (!parent) return "";

  if (childParts.length === 0) return "";

  const matches = categories
    .filter((category) => category.parent_id === parent.id)
    .filter((category) => {
      const value = normalizeReceiptValue(category.name);
      return childParts.some((part) => value.includes(normalizeReceiptValue(part)));
    });

  // Si existen Movistar Línea 1/2/3 o Municipal 1/2 no elegimos una al azar.
  return matches.length === 1 ? matches[0].id : "";
}

function suggestCategory(text: string, merchant: string | null, categories: ReceiptCategory[]) {
  const haystack = normalizeReceiptValue(`${merchant ?? ""} ${text}`);

  const rules: Array<[RegExp, string[], string[]]> = [
    [/carrefour|coto|\bdia\b|changomas|supermercado|hipermercado/, ["alimentacion"], ["supermercado"]],
    [/carnicer|frigorifico/, ["alimentacion"], ["carniceria"]],
    [/verduler|fruta|verdura/, ["alimentacion"], ["verduleria"]],
    [/panader|confiteria/, ["alimentacion"], ["panaderia"]],
    [/mostaza|mcdonald|burger king|kfc/, ["alimentacion"], ["comida rapida"]],
    [/restaurant|restaurante|parrilla|sushi|cafe/, ["alimentacion"], ["restaurantes"]],
    [/ypf|shell|axion|combustible|nafta|gasoil/, ["transporte"], ["combustible"]],
    [/peaje|aubasa/, ["transporte"], ["peajes"]],
    [/uber|cabify|taxi/, ["transporte"], ["uber", "taxi"]],
    [/farmacia|farmacity|medicamento/, ["salud"], ["farmacia", "medicamentos"]],
    [/telecentro/, ["servicios"], ["telecentro"]],
    [/movistar/, ["servicios"], ["movistar"]],
    [/metrogas|gas natural/, ["servicios"], ["gas"]],
    [/edesur|electricidad|energia/, ["servicios"], ["electricidad"]],
    [/aysa|agua/, ["servicios"], ["agua"]],
    [/spotify|netflix|prime video|disney|streaming/, ["servicios"], ["streaming"]],
    [/mercado libre|mercadolibre/, ["compras"], ["mercado libre"]],
    [/ferreteria|pintureria/, ["vivienda"], ["ferreteria"]],
    [/ropa|indumentaria|zapatilla|calzado/, ["ropa"], []],
    [/veterinaria|mascota|pet shop/, ["mascotas"], []],
  ];

  for (const [pattern, parent, child] of rules) {
    if (!pattern.test(haystack)) continue;
    const category = categoryByNames(categories, parent, child);
    if (category) return category;
  }

  return "";
}

export function analyzeReceiptText(text: string, categories: ReceiptCategory[]): ReceiptAnalysis {
  const cleaned = text.replace(/\u0000/g, " ").trim();
  const transfer = parseTransferReceipt(cleaned);
  const payment = transfer ? null : parsePaymentReceipt(cleaned);
  const amountDetection = amountCandidates(cleaned);
  const amount = amountDetection.value;
  const date = parseReceiptDate(cleaned);

  const merchant = transfer
    ? transfer.counterparty
    : payment?.counterparty ?? detectMerchant(cleaned);
  const sourceAccountHint = transfer?.sourceAccountHint ?? payment?.sourceAccountHint ?? null;
  const destinationAccountHint = transfer?.destinationAccountHint ?? null;
  const categoryId = transfer ? "" : suggestCategory(cleaned, merchant, categories);
  const notes: string[] = [];

  if (amount === null) notes.push("No pude identificar con seguridad el importe.");
  if (amountDetection.note) notes.push(amountDetection.note);
  if (!date) notes.push("No pude identificar la fecha.");
  if (!merchant && !transfer) notes.push("No pude identificar el comercio o destinatario.");

  if (transfer) {
    if (!sourceAccountHint) notes.push("Detecté una transferencia, pero no pude identificar la cuenta de origen.");
    if (!destinationAccountHint && transfer.direction === "sent") notes.push("No pude identificar la cuenta de destino; si es una cuenta propia, seleccionála manualmente.");
    notes.push("La categoría queda para revisión manual porque una transferencia no indica por sí sola en qué se gastó el dinero.");
  } else if (!categoryId) {
    notes.push("La categoría necesita revisión manual.");
  }

  const qualitySignals = [
    amount !== null && amountDetection.confidence !== "baja",
    date !== null,
    transfer ? Boolean(sourceAccountHint || destinationAccountHint) : Boolean(merchant),
    transfer ? true : Boolean(categoryId || payment?.counterparty),
  ].filter(Boolean).length;

  return {
    amount,
    amountConfidence: amountDetection.confidence,
    date,
    merchant,
    categoryId,
    confidence: qualitySignals >= 4 ? "alta" : qualitySignals >= 2 ? "media" : "baja",
    notes,
    receiptKind: transfer ? "transfer" : merchant || amount !== null ? "purchase" : "unknown",
    transferDirection: transfer?.direction ?? null,
    sourceAccountHint,
    destinationAccountHint,
    sender: transfer?.sender ?? null,
    counterparty: transfer?.counterparty ?? null,
    description: transfer?.description ?? payment?.description ?? null,
    reference: transfer?.reference ?? payment?.reference ?? null,
  };
}
