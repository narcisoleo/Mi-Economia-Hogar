export type VoiceAccount = {
  id: string;
  name: string;
  owner_user_id: string | null;
  account_type: string;
};

export type VoiceCategory = {
  id: string;
  name: string;
  parent_id: string | null;
  economic_type?: string | null;
};

export type VoicePerson = {
  id: string;
  full_name: string;
  linked_user_id: string | null;
};

export type VoiceMovementAnalysis = {
  transactionType: "expense" | "income" | "transfer";
  amount: number | null;
  transactionDate: string | null;
  accountId: string;
  destinationAccountId: string;
  responsible: string | null;
  parentCategoryId: string;
  categoryId: string;
  merchant: string;
  description: string;
  confidence: "alta" | "media" | "baja";
  notes: string[];
};

export function normalizeVoiceValue(value: string | null | undefined) {
  return (value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

const SMALL_NUMBERS: Record<string, number> = {
  cero: 0,
  un: 1,
  uno: 1,
  una: 1,
  dos: 2,
  tres: 3,
  cuatro: 4,
  cinco: 5,
  seis: 6,
  siete: 7,
  ocho: 8,
  nueve: 9,
  diez: 10,
  once: 11,
  doce: 12,
  trece: 13,
  catorce: 14,
  quince: 15,
  dieciseis: 16,
  diecisiete: 17,
  dieciocho: 18,
  diecinueve: 19,
  veinte: 20,
  veintiuno: 21,
  veintiuna: 21,
  veintidos: 22,
  veintitres: 23,
  veinticuatro: 24,
  veinticinco: 25,
  veintiseis: 26,
  veintisiete: 27,
  veintiocho: 28,
  veintinueve: 29,
  treinta: 30,
  cuarenta: 40,
  cincuenta: 50,
  sesenta: 60,
  setenta: 70,
  ochenta: 80,
  noventa: 90,
  cien: 100,
  ciento: 100,
  doscientos: 200,
  doscientas: 200,
  trescientos: 300,
  trescientas: 300,
  cuatrocientos: 400,
  cuatrocientas: 400,
  quinientos: 500,
  quinientas: 500,
  seiscientos: 600,
  seiscientas: 600,
  setecientos: 700,
  setecientas: 700,
  ochocientos: 800,
  ochocientas: 800,
  novecientos: 900,
  novecientas: 900,
};

function parseSpanishNumberWords(text: string) {
  const tokens = normalizeVoiceValue(text).split(" ").filter(Boolean);
  let total = 0;
  let current = 0;
  let recognized = 0;

  for (const token of tokens) {
    if (token === "y") continue;
    if (token === "mil" || token === "miles" || token === "luca" || token === "lucas") {
      total += (current || 1) * 1000;
      current = 0;
      recognized += 1;
      continue;
    }
    if (token === "millon" || token === "millones") {
      total += (current || 1) * 1_000_000;
      current = 0;
      recognized += 1;
      continue;
    }
    const value = SMALL_NUMBERS[token];
    if (value !== undefined) {
      current += value;
      recognized += 1;
    }
  }

  if (recognized === 0) return null;
  const result = total + current;
  return result > 0 ? result : null;
}

type ParsedAmount = { value: number | null; note?: string };

function normalizeLocalizedNumber(rawValue: string) {
  let raw = rawValue.replace(/\s/g, "");
  const commaCount = (raw.match(/,/g) ?? []).length;
  const dotCount = (raw.match(/\./g) ?? []).length;

  if (commaCount > 0 && dotCount > 0) {
    const lastComma = raw.lastIndexOf(",");
    const lastDot = raw.lastIndexOf(".");
    const lastSeparator = Math.max(lastComma, lastDot);
    const decimals = raw.length - lastSeparator - 1;

    if (decimals === 1 || decimals === 2) {
      const decimalSeparator = lastComma > lastDot ? "," : ".";
      const thousandsSeparator = decimalSeparator === "," ? "." : ",";
      raw = raw.split(thousandsSeparator).join("");
      if (decimalSeparator === ",") raw = raw.replace(",", ".");
    } else {
      raw = raw.replace(/[.,]/g, "");
    }
    return Number(raw);
  }

  const separator = commaCount > 0 ? "," : dotCount > 0 ? "." : "";
  if (!separator) return Number(raw);

  const pieces = raw.split(separator);
  const finalDigits = pieces[pieces.length - 1]?.length ?? 0;
  const looksLikeThousands =
    finalDigits === 3 &&
    pieces.length >= 2 &&
    pieces.slice(1).every((piece) => piece.length === 3);

  if (looksLikeThousands) {
    return Number(pieces.join(""));
  }

  if (pieces.length > 2) {
    return Number(pieces.join(""));
  }

  if (finalDigits === 1 || finalDigits === 2) {
    return Number(`${pieces[0]}.${pieces[1]}`);
  }

  return Number(pieces.join(""));
}

function parseDigitAmount(text: string): ParsedAmount {
  const pattern = /(?:\$\s*)?(\d{1,3}(?:[.,\s]\d{3})+(?:[.,]\d{1,2})?|\d+(?:[.,]\d{1,3})?)\s*(millones?|millon|mil|k|lucas?|luca)?\b/i;
  const match = text.match(pattern);
  if (!match) return { value: null };

  const raw = match[1];
  const multiplierWord = normalizeVoiceValue(match[2] ?? "");
  let value = normalizeLocalizedNumber(raw);
  if (!Number.isFinite(value) || value <= 0) return { value: null };

  if (multiplierWord === "mil" || multiplierWord === "k" || multiplierWord === "luca" || multiplierWord === "lucas") {
    value *= 1000;
  }
  if (multiplierWord === "millon" || multiplierWord === "millones") value *= 1_000_000;
  if (value <= 0 || value >= 1_000_000_000) return { value: null };

  const threeDigitSeparator = /^\d{1,3}[.,]\d{3}$/.test(raw.trim());
  return {
    value,
    note: threeDigitSeparator
      ? `Interpreté “${raw.trim()}” como ${new Intl.NumberFormat("es-AR").format(value)} pesos (separador de miles).`
      : undefined,
  };
}

function parseAmount(text: string): ParsedAmount {
  const digits = parseDigitAmount(text);
  if (digits.value !== null) return digits;

  const normalized = normalizeVoiceValue(text);
  const verbSplit = normalized
    .replace(/^(gaste|gasto|gaste|caste|compre|pague|abone|cobre|ingreso|recibi|transferi|pase|movi)\s+/, "")
    .split(/\b(?:en|con|usando|desde|hacia|para|categoria|subcategoria|de)\b/)[0];
  return { value: parseSpanishNumberWords(verbSplit || normalized) };
}

const MONTHS: Record<string, number> = {
  enero: 1,
  febrero: 2,
  marzo: 3,
  abril: 4,
  mayo: 5,
  junio: 6,
  julio: 7,
  agosto: 8,
  septiembre: 9,
  setiembre: 9,
  octubre: 10,
  noviembre: 11,
  diciembre: 12,
};

function toLocalIsoDate(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function validDateParts(year: number, month: number, day: number) {
  const date = new Date(year, month - 1, day);
  return date.getFullYear() === year && date.getMonth() === month - 1 && date.getDate() === day;
}

function parseVoiceDate(text: string) {
  const normalized = normalizeVoiceValue(text);
  const today = new Date();

  if (/\banteayer\b/.test(normalized)) {
    const date = new Date(today);
    date.setDate(date.getDate() - 2);
    return toLocalIsoDate(date);
  }
  if (/\bayer\b/.test(normalized)) {
    const date = new Date(today);
    date.setDate(date.getDate() - 1);
    return toLocalIsoDate(date);
  }
  if (/\bhoy\b/.test(normalized)) return toLocalIsoDate(today);

  const numeric = text.match(/\b(\d{1,2})[/-](\d{1,2})(?:[/-](\d{2,4}))?\b/);
  if (numeric) {
    const day = Number(numeric[1]);
    const month = Number(numeric[2]);
    let year = numeric[3] ? Number(numeric[3]) : today.getFullYear();
    if (year < 100) year += 2000;
    if (validDateParts(year, month, day)) return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  }

  const monthNames = Object.keys(MONTHS).join("|");
  const named = normalized.match(new RegExp(`\\b(?:el\\s+)?(\\d{1,2})\\s+(?:de\\s+)?(${monthNames})(?:\\s+(?:de\\s+)?(\\d{4}))?\\b`));
  if (named) {
    const day = Number(named[1]);
    const month = MONTHS[named[2]];
    const year = named[3] ? Number(named[3]) : today.getFullYear();
    if (validDateParts(year, month, day)) return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  }

  return null;
}

function detectType(text: string): VoiceMovementAnalysis["transactionType"] {
  const value = normalizeVoiceValue(text);
  if (/\b(transferi|transferencia|pase|pasar|movi|mover|envie|mande)\b/.test(value)) {
    return "transfer";
  }
  if (/\b(ingreso|ingrese|cobre|cobro|recibi|me pagaron|sueldo|salario|honorarios|alquiler cobrado)\b/.test(value)) {
    return "income";
  }
  return "expense";
}

function accountMatchKey(account: VoiceAccount, people: VoicePerson[]) {
  let key = normalizeVoiceValue(account.name);
  for (const person of people) {
    const personTokens = normalizeVoiceValue(person.full_name).split(" ").filter((token) => token.length >= 3);
    for (const token of personTokens) {
      key = key.replace(new RegExp(`\\b${token}\\b`, "g"), " ");
    }
  }
  return key.replace(/\s+/g, " ").trim();
}

function rankAccounts(
  text: string,
  accounts: VoiceAccount[],
  people: VoicePerson[],
  userId: string | null,
  allowCreditCards: boolean,
) {
  const normalized = normalizeVoiceValue(text);
  return accounts
    .filter((account) => allowCreditCards || account.account_type !== "credit_card")
    .map((account) => {
      const key = accountMatchKey(account, people);
      const tokens = key.split(" ").filter((token) => token.length >= 2);
      const matched = tokens.filter((token) => new RegExp(`\\b${token}\\b`).test(normalized));
      const exactBonus = key && normalized.includes(key) ? 4 : 0;
      const ownerBonus = account.owner_user_id === userId ? 0.5 : 0;
      const score = matched.length + exactBonus + ownerBonus;
      const positions = matched
        .map((token) => normalized.indexOf(token))
        .filter((position) => position >= 0);
      const position = positions.length > 0 ? Math.min(...positions) : Number.MAX_SAFE_INTEGER;
      return { account, score, position, key };
    })
    .filter((item) => item.score >= 1.5)
    .sort((a, b) => b.score - a.score || a.position - b.position);
}

function exactPhrase(text: string, phrase: string) {
  const normalizedText = normalizeVoiceValue(text);
  const normalizedPhrase = normalizeVoiceValue(phrase);
  if (!normalizedPhrase) return false;
  return ` ${normalizedText} `.includes(` ${normalizedPhrase} `);
}

function findBeneficiary(text: string, people: VoicePerson[], userId: string | null) {
  const normalized = normalizeVoiceValue(text);

  // Este dato solo se cambia cuando la frase lo indica de forma explícita.
  if (/\bpara\s+(?:el\s+|la\s+)?(?:hogar|casa|familia)\b/.test(normalized)) {
    return "household";
  }

  if (/\bpara\s+mi\b/.test(normalized) && userId) {
    const self = people.find((person) => person.linked_user_id === userId);
    if (self) return self.id;
  }

  for (const person of people) {
    const tokens = normalizeVoiceValue(person.full_name)
      .split(" ")
      .filter((token) => token.length >= 3);
    if (tokens.some((token) => new RegExp(`\\bpara\\s+(?:a\\s+)?${token}\\b`).test(normalized))) {
      return person.id;
    }
  }

  return null;
}

function categoryByParts(
  categories: VoiceCategory[],
  parentParts: string[],
  childParts: string[] = [],
) {
  const parent = categories.find((category) => {
    if (category.parent_id !== null) return false;
    const name = normalizeVoiceValue(category.name);
    return parentParts.some((part) => name.includes(normalizeVoiceValue(part)));
  });
  if (!parent) return { parentCategoryId: "", categoryId: "" };

  const children = categories.filter((category) => category.parent_id === parent.id);
  if (childParts.length === 0) {
    // Si solo reconocemos la categoría principal, no inventamos una subcategoría.
    return { parentCategoryId: parent.id, categoryId: "" };
  }

  const matches = children.filter((category) => {
    const name = normalizeVoiceValue(category.name);
    return childParts.some((part) => name.includes(normalizeVoiceValue(part)));
  });

  // Si hay varias opciones parecidas (por ejemplo Movistar Línea 1/2/3 o Curso Leo/Sofi/Alma),
  // no elegimos la primera al azar. La frase exacta se evalúa después.
  return { parentCategoryId: parent.id, categoryId: matches.length === 1 ? matches[0].id : "" };
}

function findCategory(text: string, type: VoiceMovementAnalysis["transactionType"], categories: VoiceCategory[]) {
  if (type === "transfer") return { parentCategoryId: "", categoryId: "" };
  const normalized = normalizeVoiceValue(text);

  if (type === "income") {
    const incomeRules: Array<[RegExp, string[]]> = [
      [/\b(?:sueldo|salario|haberes)\b/, ["sueldo", "haberes"]],
      [/\balquiler\b/, ["alquiler"]],
      [/\bventa\b/, ["venta"]],
      [/\b(?:honorarios|trabajo|servicio)\b/, ["honorarios", "trabajo", "otros"]],
    ];
    for (const [pattern, childParts] of incomeRules) {
      if (!pattern.test(normalized)) continue;
      const result = categoryByParts(categories, ["ingresos"], childParts);
      if (result.categoryId) return result;
    }

    // Si solo sabemos que es ingreso, marcamos la categoría principal sin inventar subcategoría.
    return categoryByParts(categories, ["ingresos"], []);
  }

  // Primero priorizamos señales fuertes y comercios conocidos.
  const rules: Array<[RegExp, string[], string[]]> = [
    [/\b(?:carrefour|coto|dia|changomas|chango mas|supermercado|super)\b/, ["alimentacion"], ["supermercado"]],
    [/\b(?:carniceria|carnicer|carne)\b/, ["alimentacion"], ["carniceria"]],
    [/\b(?:verduleria|verduler)\b/, ["alimentacion"], ["verduleria"]],
    [/\b(?:panaderia|panader)\b/, ["alimentacion"], ["panaderia"]],
    [/\b(?:delivery|rappi|pedidos ya)\b/, ["alimentacion"], ["delivery"]],
    [/\b(?:mcdonalds?|mcdonald|mostaza|burger king|comida rapida)\b/, ["alimentacion"], ["comida rapida"]],
    [/\b(?:restaurante|restaurant|parrilla|sushi)\b/, ["alimentacion"], ["restaurantes"]],
    [/\b(?:nafta|combustible|gasoil|ypf|shell|axion)\b/, ["transporte"], ["combustible"]],
    [/\b(?:uber|cabify|taxi)\b/, ["transporte"], ["uber", "taxi"]],
    [/\b(?:peaje|aubasa)\b/, ["transporte"], ["peaje"]],
    [/\b(?:farmacia|medicamento|farmacity)\b/, ["salud"], ["farmacia", "medicamentos"]],
    [/\btelecentro\b/, ["servicios"], ["telecentro"]],
    [/\bmovistar\b/, ["servicios"], ["movistar"]],
    [/\b(?:luz|electricidad|edesur)\b/, ["servicios"], ["electricidad"]],
    [/\b(?:gas|metrogas)\b/, ["servicios"], ["gas"]],
    [/\b(?:agua|aysa)\b/, ["servicios"], ["agua"]],
    [/\b(?:netflix|spotify|prime|disney|streaming)\b/, ["servicios"], ["streaming"]],
    [/\b(?:colegio|escuela|cuota escolar)\b/, ["educacion"], ["colegio"]],
    [/\bcurso\b/, ["educacion"], ["curso"]],
    [/\b(?:ropa|zapatilla|calzado|indumentaria)\b/, ["ropa"], []],
    [/\b(?:mascota|veterinaria|pet shop)\b/, ["mascotas"], []],
    [/\b(?:vacaciones|hotel|alojamiento)\b/, ["vacaciones"], []],
  ];

  for (const [pattern, parentParts, childParts] of rules) {
    if (!pattern.test(normalized)) continue;
    const result = categoryByParts(categories, parentParts, childParts);
    if (result.categoryId || result.parentCategoryId) return result;
  }

  // Después aceptamos una subcategoría dicha literalmente, pero como frase completa.
  // Esto evita falsos positivos como "gasté" => "gas".
  const children = categories
    .filter((category) => category.parent_id !== null)
    .map((category) => ({ category, key: normalizeVoiceValue(category.name) }))
    .filter(({ key }) => key.length >= 3 && exactPhrase(normalized, key))
    .sort((a, b) => b.key.length - a.key.length);

  if (children.length > 0) {
    const child = children[0].category;
    return { parentCategoryId: child.parent_id ?? "", categoryId: child.id };
  }

  return { parentCategoryId: "", categoryId: "" };
}

function detectKnownMerchant(text: string) {
  const known: Array<[RegExp, string]> = [
    [/carrefour/i, "Carrefour"],
    [/coto\b/i, "Coto"],
    [/changomas|chango mas/i, "ChangoMás"],
    [/mercado libre/i, "Mercado Libre"],
    [/ypf\b/i, "YPF"],
    [/shell\b/i, "Shell"],
    [/axion/i, "Axion"],
    [/telecentro/i, "Telecentro"],
    [/movistar/i, "Movistar"],
    [/edesur/i, "Edesur"],
    [/metrogas/i, "Metrogas"],
    [/aysa/i, "AySA"],
    [/netflix/i, "Netflix"],
    [/spotify/i, "Spotify"],
    [/farmacity/i, "Farmacity"],
  ];
  for (const [pattern, name] of known) {
    if (pattern.test(text)) return name;
  }
  return "";
}

function extractMerchant(text: string, accountKeys: string[]) {
  const known = detectKnownMerchant(text);
  if (known) return known;

  const match = text.match(/\b(?:en|a)\s+(.+?)(?=\s+(?:con|usando|desde|para|categoria|categoría|subcategoria|subcategoría)\b|$)/i);
  if (!match) return "";
  const candidate = match[1].replace(/[,.]+$/g, "").trim();
  const normalized = normalizeVoiceValue(candidate);
  if (!normalized || normalized.length < 2) return "";
  if (accountKeys.some((key) => key && (normalized.includes(key) || key.includes(normalized)))) return "";
  return candidate.slice(0, 80);
}

export function analyzeVoiceMovement(
  text: string,
  accounts: VoiceAccount[],
  categories: VoiceCategory[],
  people: VoicePerson[],
  userId: string | null,
): VoiceMovementAnalysis {
  const transactionType = detectType(text);
  const parsedAmount = parseAmount(text);
  const amount = parsedAmount.value;
  const transactionDate = parseVoiceDate(text);
  const allowCreditCards = transactionType === "expense";
  const ranked = rankAccounts(text, accounts, people, userId, allowCreditCards);

  let accountId = "";
  let destinationAccountId = "";

  if (transactionType === "transfer") {
    const normalized = normalizeVoiceValue(text);
    const transferParts = normalized.match(/(?:^|\b)(?:de|desde)\s+(.+?)\s+(?:a|hacia)\s+(.+)$/);
    if (transferParts) {
      const sourceRanked = rankAccounts(transferParts[1], accounts, people, userId, false);
      const destinationRanked = rankAccounts(transferParts[2], accounts, people, userId, false);
      accountId = sourceRanked[0]?.account.id ?? "";
      destinationAccountId = destinationRanked.find((item) => item.account.id !== accountId)?.account.id ?? "";
    } else {
      const byPosition = [...ranked].sort((a, b) => a.position - b.position || b.score - a.score);
      accountId = byPosition[0]?.account.id ?? "";
      destinationAccountId = byPosition.find((item) => item.account.id !== accountId)?.account.id ?? "";
    }
  } else {
    accountId = ranked[0]?.account.id ?? "";
  }

  const { parentCategoryId, categoryId } = findCategory(text, transactionType, categories);
  const responsible = transactionType === "transfer" ? null : findBeneficiary(text, people, userId);
  const merchant = transactionType === "transfer"
    ? "Transferencia entre cuentas"
    : extractMerchant(text, ranked.map((item) => item.key));

  const notes: string[] = [];
  if (parsedAmount.note) notes.push(parsedAmount.note);
  if (amount === null) notes.push("No pude identificar el importe.");
  if (!accountId) notes.push(transactionType === "transfer" ? "Revisá la cuenta de origen." : "Revisá la cuenta.");
  if (transactionType === "transfer" && !destinationAccountId) notes.push("Revisá la cuenta de destino.");
  if (transactionType !== "transfer" && !categoryId) notes.push("No completé una subcategoría sin evidencia suficiente. Revisala antes de guardar.");
  if (transactionType !== "transfer" && responsible === null) notes.push("No cambié ‘¿Para quién fue?’ porque no lo dijiste explícitamente.");

  const criticalOk = Boolean(amount && accountId && (transactionType !== "transfer" || destinationAccountId));
  const semanticOk = transactionType === "transfer" ? Boolean(destinationAccountId) : Boolean(categoryId && merchant);
  const confidence: VoiceMovementAnalysis["confidence"] = criticalOk && semanticOk
    ? "alta"
    : criticalOk
      ? "media"
      : "baja";

  return {
    transactionType,
    amount,
    transactionDate,
    accountId,
    destinationAccountId,
    responsible,
    parentCategoryId,
    categoryId,
    merchant,
    description: "",
    confidence,
    notes,
  };
}
