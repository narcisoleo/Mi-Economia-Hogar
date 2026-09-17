"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { VoiceMovementButton } from "@/components/voice-movement-button";
import { analyzeVoiceMovement, type VoiceMovementAnalysis } from "@/lib/voice-movement";
import {
  analyzeReceiptText,
  normalizeReceiptValue,
  type ReceiptAnalysis,
} from "@/lib/receipt-analysis";

type MovementType = "expense" | "income" | "transfer";

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

type EditableTransaction = {
  id: string;
  amount: number | string;
  account_id: string | null;
  destination_account_id: string | null;
  category_id: string | null;
  transaction_type: string;
  transaction_date: string;
  merchant: string | null;
  description: string | null;
  responsible_person_id: string | null;
  responsible_user_id: string | null;
  receipt_url: string | null;
};

type MovementFormProps = {
  mode: "create" | "edit";
  transactionId?: string;
};

type SharedDiagnostic = {
  channel: string;
  fileName?: string;
  fileType?: string;
  fileSize?: number;
  text?: string;
  note?: string;
};

type TesseractWorkerLike = {
  recognize: (image: File) => Promise<{ data: { text?: string } }>;
  terminate: () => Promise<void>;
};

type TesseractLike = {
  createWorker: (language?: string) => Promise<TesseractWorkerLike>;
};

declare global {
  interface Window {
    Tesseract?: TesseractLike;
  }
}

async function loadTesseractBrowser() {
  if (window.Tesseract) return window.Tesseract;

  await new Promise<void>((resolve, reject) => {
    const existing = document.getElementById("eco-tesseract-script") as HTMLScriptElement | null;
    if (existing) {
      existing.addEventListener("load", () => resolve(), { once: true });
      existing.addEventListener("error", () => reject(new Error("No se pudo cargar el lector OCR.")), { once: true });
      return;
    }

    const script = document.createElement("script");
    script.id = "eco-tesseract-script";
    script.src = "https://cdn.jsdelivr.net/npm/tesseract.js@6/dist/tesseract.min.js";
    script.async = true;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error("No se pudo cargar el lector OCR. Verificá la conexión a Internet."));
    document.head.appendChild(script);
  });

  if (!window.Tesseract) {
    throw new Error("El lector OCR no quedó disponible.");
  }
  return window.Tesseract;
}

async function prepareOcrImage(file: File, aggressive = false) {
  try {
    const bitmap = await createImageBitmap(file);
    const targetWidth = aggressive ? 1800 : 1450;
    const scale = Math.max(1, Math.min(2.6, targetWidth / Math.max(1, bitmap.width)));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);
    const context = canvas.getContext("2d", { willReadFrequently: aggressive });
    if (!context) return file;

    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = "high";
    context.filter = aggressive
      ? "grayscale(1) contrast(1.65) brightness(1.08)"
      : "grayscale(1) contrast(1.28) brightness(1.03)";
    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    bitmap.close();

    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png", 0.96));
    if (!blob) return file;
    return new File([blob], `${file.name.replace(/\.[^.]+$/, "")}-ocr.png`, { type: "image/png" });
  } catch {
    return file;
  }
}

function receiptAnalysisScore(analysis: ReceiptAnalysis) {
  let score = 0;
  if (analysis.amount !== null) score += analysis.amountConfidence === "alta" ? 4 : analysis.amountConfidence === "media" ? 2 : 0.5;
  if (analysis.date) score += 2;
  if (analysis.merchant || analysis.counterparty) score += 2;
  if (analysis.receiptKind === "transfer") score += 2;
  if (analysis.sourceAccountHint) score += 1;
  if (analysis.destinationAccountHint) score += 1;
  return score;
}

function needsSecondOcrPass(analysis: ReceiptAnalysis) {
  return (
    analysis.amount === null ||
    analysis.amountConfidence === "baja" ||
    !analysis.date ||
    analysis.receiptKind === "unknown" ||
    (analysis.receiptKind === "transfer" && !analysis.sourceAccountHint && !analysis.destinationAccountHint)
  );
}

function normalizeMovementType(value: string): MovementType {
  if (value === "income") return "income";
  if (value === "transfer") return "transfer";
  return "expense";
}

function personTokenSet(value: string) {
  return new Set(
    normalizeReceiptValue(value)
      .split(" ")
      .filter((token) => token.length >= 3 && !["carlos", "maria", "ana"].includes(token)),
  );
}

function samePersonName(a: string | null | undefined, b: string | null | undefined) {
  const left = personTokenSet(a ?? "");
  const right = personTokenSet(b ?? "");
  if (left.size === 0 || right.size === 0) return false;
  const common = [...left].filter((token) => right.has(token)).length;
  const smaller = Math.min(left.size, right.size);
  return common >= Math.max(1, smaller - 1);
}

function accountHintTokens(hint: string | null | undefined) {
  const normalized = normalizeReceiptValue(hint);
  if (!normalized) return [] as string[];
  if (/cuenta dni|banco provincia|banco de la provincia/.test(normalized)) return ["banco provincia", "provincia"];
  if (/banco carrefour|carrefour banco/.test(normalized)) return ["banco carrefour", "carrefour"];
  if (/mercado pago/.test(normalized)) return ["mercado pago"];
  if (/naranja x/.test(normalized)) return ["naranja x", "naranja"];
  if (/astro ?pay/.test(normalized)) return ["astro pay", "astropay"];
  return [normalized];
}

function accountMatchesHint(account: Account, hint: string | null | undefined) {
  const accountName = normalizeReceiptValue(account.name);
  return accountHintTokens(hint).some((token) => accountName.includes(token) || token.includes(accountName));
}

export function MovementForm({ mode, transactionId }: MovementFormProps) {
  const router = useRouter();
  const supabase = useMemo(() => createClient(), []);

  const [userId, setUserId] = useState<string | null>(null);
  const [householdId, setHouseholdId] = useState<string | null>(null);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [householdPeople, setHouseholdPeople] = useState<HouseholdPerson[]>([]);

  const [transactionType, setTransactionType] =
    useState<MovementType>("expense");
  const [amount, setAmount] = useState("");
  const [accountId, setAccountId] = useState("");
  const [destinationAccountId, setDestinationAccountId] = useState("");
  const [responsible, setResponsible] = useState("household");
  const [parentCategoryId, setParentCategoryId] = useState("");
  const [categoryId, setCategoryId] = useState("");
  const [merchant, setMerchant] = useState("");
  const [description, setDescription] = useState("");
  const [transactionDate, setTransactionDate] = useState("");
  const [receiptFile, setReceiptFile] = useState<File | null>(null);
  const [currentReceiptPath, setCurrentReceiptPath] = useState<string | null>(null);
  const [currentReceiptUrl, setCurrentReceiptUrl] = useState<string | null>(null);
  const [receiptAnalysis, setReceiptAnalysis] = useState<ReceiptAnalysis | null>(null);
  const [receiptReading, setReceiptReading] = useState(false);
  const [receiptProgress, setReceiptProgress] = useState("");
  const [voiceTranscript, setVoiceTranscript] = useState("");
  const [voiceAnalysis, setVoiceAnalysis] = useState<VoiceMovementAnalysis | null>(null);
  const [inputSource, setInputSource] = useState("manual");
  const [sharedDiagnostic, setSharedDiagnostic] = useState<SharedDiagnostic | null>(null);
  const sharedLoadedRef = useRef(false);
  const voiceQueryLoadedRef = useRef(false);

  const [loading, setLoading] = useState(false);
  const [initialLoading, setInitialLoading] = useState(true);
  const [message, setMessage] = useState("");

  useEffect(() => {
    const today = new Date();
    const year = today.getFullYear();
    const month = String(today.getMonth() + 1).padStart(2, "0");
    const day = String(today.getDate()).padStart(2, "0");
    setTransactionDate(`${year}-${month}-${day}`);

    const loadInitialData = async () => {
      const {
        data: { user },
        error: userError,
      } = await supabase.auth.getUser();

      if (userError || !user) {
        router.push("/auth/login");
        return;
      }

      setUserId(user.id);

      const { data: membership, error: membershipError } = await supabase
        .from("household_members")
        .select("household_id")
        .eq("user_id", user.id)
        .single();

      if (membershipError || !membership) {
        setMessage("No se encontró el hogar del usuario.");
        setInitialLoading(false);
        return;
      }

      const currentHouseholdId = membership.household_id;
      setHouseholdId(currentHouseholdId);

      const [accountsResult, categoriesResult, peopleResult] = await Promise.all([
        supabase
          .from("accounts")
          .select("id, name, owner_user_id, account_type")
          .eq("household_id", currentHouseholdId)
          .eq("active", true)
          .order("name"),
        supabase
          .from("categories")
          .select("id, name, parent_id, economic_type")
          .eq("household_id", currentHouseholdId)
          .eq("active", true)
          .order("name"),
        supabase
          .from("household_people")
          .select("id, full_name, linked_user_id")
          .eq("household_id", currentHouseholdId)
          .eq("active", true)
          .order("full_name"),
      ]);

      if (accountsResult.error) {
        console.error("Error cargando cuentas:", accountsResult.error);
      }
      if (categoriesResult.error) {
        console.error("Error cargando categorías:", categoriesResult.error);
      }
      if (peopleResult.error) {
        console.error("Error cargando personas:", peopleResult.error);
      }

      const loadedAccounts = (accountsResult.data ?? []) as Account[];
      const loadedCategories = (categoriesResult.data ?? []) as Category[];
      const loadedPeople = (peopleResult.data ?? []) as HouseholdPerson[];

      setAccounts(loadedAccounts);
      setCategories(loadedCategories);
      setHouseholdPeople(loadedPeople);

      if (mode === "edit") {
        if (!transactionId) {
          setMessage("No se pudo identificar el movimiento a editar.");
          setInitialLoading(false);
          return;
        }

        const { data: transactionData, error: transactionError } = await supabase
          .from("transactions")
          .select(`
            id,
            amount,
            account_id,
            destination_account_id,
            category_id,
            transaction_type,
            transaction_date,
            merchant,
            description,
            responsible_person_id,
            responsible_user_id,
            receipt_url
          `)
          .eq("id", transactionId)
          .eq("household_id", currentHouseholdId)
          .single();

        if (transactionError || !transactionData) {
          console.error("Error cargando movimiento:", transactionError);
          setMessage(
            "No se encontró el movimiento o no tenés permiso para editarlo."
          );
          setInitialLoading(false);
          return;
        }

        const transaction = transactionData as EditableTransaction;
        const loadedType = normalizeMovementType(transaction.transaction_type);

        setTransactionType(loadedType);
        setAmount(String(transaction.amount));
        setAccountId(transaction.account_id ?? "");
        setDestinationAccountId(transaction.destination_account_id ?? "");
        setMerchant(transaction.merchant ?? "");
        setDescription(transaction.description ?? "");
        setTransactionDate(transaction.transaction_date);
        setCurrentReceiptPath(transaction.receipt_url ?? null);

        if (transaction.receipt_url) {
          const { data: signedReceipt } = await supabase.storage
            .from("receipts")
            .createSignedUrl(transaction.receipt_url, 60 * 60);
          setCurrentReceiptUrl(signedReceipt?.signedUrl ?? null);
        }

        if (loadedType !== "transfer" && transaction.category_id) {
          const savedCategory = loadedCategories.find(
            (category) => category.id === transaction.category_id
          );

          if (savedCategory?.parent_id) {
            setParentCategoryId(savedCategory.parent_id);
            setCategoryId(savedCategory.id);
          } else if (savedCategory) {
            setParentCategoryId(savedCategory.id);
            setCategoryId("");
          }
        }

        if (loadedType === "transfer") {
          setResponsible("household");
        } else if (transaction.responsible_person_id) {
          setResponsible(transaction.responsible_person_id);
        } else if (transaction.responsible_user_id) {
          const linkedPerson = loadedPeople.find(
            (person) => person.linked_user_id === transaction.responsible_user_id
          );
          setResponsible(linkedPerson?.id ?? "household");
        } else {
          setResponsible("household");
        }
      }

      setInitialLoading(false);
    };

    loadInitialData();
  }, [mode, router, supabase, transactionId]);

  useEffect(() => {
    if (initialLoading || typeof window === "undefined") return;
    if (window.location.hash !== "#comprobante") return;

    const timer = window.setTimeout(() => {
      document.getElementById("comprobante")?.scrollIntoView({
        behavior: "smooth",
        block: "center",
      });
    }, 150);

    return () => window.clearTimeout(timer);
  }, [initialLoading]);

  const parentCategories = categories.filter((category) => {
    if (category.parent_id !== null) return false;
    if (transactionType === "income") return category.name === "Ingresos";
    if (transactionType === "transfer") return false;
    return !["Ingresos", "Ahorro"].includes(category.name);
  });

  const subcategories = categories.filter(
    (category) => category.parent_id === parentCategoryId
  );

  const selectedSubcategory = categories.find(
    (category) => category.id === categoryId
  );

  const sourceAccounts = accounts.filter((account) => {
    if (transactionType === "expense") return true;
    return account.account_type !== "credit_card";
  });

  const myAccounts = sourceAccounts.filter(
    (account) => account.owner_user_id === userId
  );
  const otherAccounts = sourceAccounts.filter(
    (account) => account.owner_user_id !== userId
  );

  const myRegularAccounts = myAccounts.filter(
    (account) => account.account_type !== "credit_card"
  );
  const myCreditCards = myAccounts.filter(
    (account) => account.account_type === "credit_card"
  );
  const otherRegularAccounts = otherAccounts.filter(
    (account) => account.account_type !== "credit_card"
  );
  const otherCreditCards = otherAccounts.filter(
    (account) => account.account_type === "credit_card"
  );

  // Las transferencias comunes no se envían a tarjetas de crédito.
  // El pago de tarjetas se registra desde Tarjetas > Pagar tarjeta para
  // evitar mezclar una transferencia normal con un pago de deuda.
  // Al editar un pago ya existente, mantenemos visible la tarjeta destino.
  const destinationAccounts = accounts.filter(
    (account) =>
      account.id !== accountId &&
      (account.account_type !== "credit_card" || account.id === destinationAccountId)
  );

  const voiceAccountName = voiceAnalysis?.accountId
    ? accounts.find((account) => account.id === voiceAnalysis.accountId)?.name ?? ""
    : "";
  const voiceDestinationName = voiceAnalysis?.destinationAccountId
    ? accounts.find((account) => account.id === voiceAnalysis.destinationAccountId)?.name ?? ""
    : "";
  const voiceParentCategoryName = voiceAnalysis?.parentCategoryId
    ? categories.find((category) => category.id === voiceAnalysis.parentCategoryId)?.name ?? ""
    : "";
  const voiceCategoryName = voiceAnalysis?.categoryId
    ? categories.find((category) => category.id === voiceAnalysis.categoryId)?.name ?? ""
    : "";
  const voiceResponsibleName = voiceAnalysis?.responsible === "household"
    ? "Hogar"
    : voiceAnalysis?.responsible
      ? householdPeople.find((person) => person.id === voiceAnalysis.responsible)?.full_name ?? "Revisar"
      : "Sin cambio";

  const selectedAccount = accounts.find((account) => account.id === accountId);
  const isCreditCardPurchase =
    transactionType === "expense" && selectedAccount?.account_type === "credit_card";

  const changeType = (type: MovementType) => {
    setTransactionType(type);
    setMessage("");

    const currentAccount = accounts.find((account) => account.id === accountId);
    if (type !== "expense" && currentAccount?.account_type === "credit_card") {
      setAccountId("");
    }

    if (type === "transfer") {
      setParentCategoryId("");
      setCategoryId("");
      setResponsible("household");
    } else {
      setDestinationAccountId("");
      setParentCategoryId("");
      setCategoryId("");
    }
  };

  const applyVoiceTranscript = (transcript: string) => {
    const clean = transcript.trim();
    if (!clean) return;

    const analysis = analyzeVoiceMovement(
      clean,
      accounts,
      categories,
      householdPeople,
      userId,
    );

    setVoiceTranscript(clean);
    setVoiceAnalysis(analysis);
    setInputSource("voice");
    setMessage("");
    setTransactionType(analysis.transactionType);
    if (analysis.amount !== null) setAmount(String(analysis.amount));
    if (analysis.transactionDate) setTransactionDate(analysis.transactionDate);
    setAccountId(analysis.accountId);
    setDestinationAccountId(analysis.destinationAccountId);
    if (analysis.responsible) setResponsible(analysis.responsible);
    setParentCategoryId(analysis.parentCategoryId);
    setCategoryId(analysis.categoryId);
    setMerchant(analysis.merchant);
    setDescription(analysis.description);
  };

  const applyReceiptAnalysis = (analysis: ReceiptAnalysis) => {
    if (analysis.amount !== null && analysis.amountConfidence !== "baja") {
      setAmount(String(analysis.amount));
    }
    if (analysis.date) setTransactionDate(analysis.date);
    if (analysis.merchant) setMerchant(analysis.merchant);
    if (analysis.description) setDescription(analysis.description);

    const findAccount = (hint: string | null, ownerId?: string | null) =>
      hint
        ? accounts.find(
            (account) =>
              account.account_type !== "credit_card" &&
              (ownerId === undefined || account.owner_user_id === ownerId) &&
              accountMatchesHint(account, hint),
          )
        : undefined;

    const mySourceAccount = findAccount(analysis.sourceAccountHint, userId);

    if (analysis.receiptKind === "transfer") {
      const householdCounterparty = analysis.counterparty
        ? householdPeople.find((person) => samePersonName(person.full_name, analysis.counterparty))
        : undefined;
      const householdSender = analysis.sender
        ? householdPeople.find((person) => samePersonName(person.full_name, analysis.sender))
        : undefined;

      const sourceOwnerId = householdSender?.linked_user_id ?? userId;
      const sourceAccount = findAccount(analysis.sourceAccountHint, sourceOwnerId)
        ?? (analysis.transferDirection === "sent" ? mySourceAccount : undefined);

      const destinationOwnerId = householdCounterparty?.linked_user_id
        ?? (analysis.transferDirection === "received" ? userId : null);
      const destinationAccount = destinationOwnerId
        ? findAccount(analysis.destinationAccountHint, destinationOwnerId)
        : undefined;

      // Solo la convertimos automáticamente en transferencia interna cuando podemos
      // identificar a una persona del hogar. Compartir la misma institución no alcanza:
      // una transferencia recibida desde Banco Provincia, por ejemplo, puede venir de un tercero.
      const internalTransfer = Boolean(householdCounterparty || householdSender);

      if (internalTransfer) {
        changeType("transfer");
        const inferredSource = sourceAccount ?? findAccount(analysis.sourceAccountHint, userId);
        const inferredDestination = destinationAccount ?? findAccount(analysis.destinationAccountHint, userId);
        if (inferredSource) setAccountId(inferredSource.id);
        if (inferredDestination && inferredDestination.id !== inferredSource?.id) {
          setDestinationAccountId(inferredDestination.id);
        }
        setMerchant(analysis.counterparty ?? "Transferencia entre cuentas");
        setDescription(analysis.description ?? "Transferencia entre cuentas del hogar");
      } else if (analysis.transferDirection === "received") {
        // Transferencia recibida desde un tercero: es ingreso, no gasto.
        changeType("income");
        const incomeAccount = destinationAccount ?? findAccount(analysis.destinationAccountHint, userId);
        if (incomeAccount) setAccountId(incomeAccount.id);
        setMerchant(analysis.sender ?? analysis.counterparty ?? "Transferencia recibida");
      } else {
        // Transferencia enviada a un tercero: económicamente es una salida/gasto.
        changeType("expense");
        if (sourceAccount ?? mySourceAccount) setAccountId((sourceAccount ?? mySourceAccount)!.id);
        setMerchant(analysis.counterparty ?? analysis.merchant ?? "Transferencia enviada");
      }
    } else {
      // Compras/pagos: si el comprobante informa el medio, sugerimos la cuenta real.
      if (mySourceAccount) setAccountId(mySourceAccount.id);
    }

    if (analysis.categoryId && analysis.receiptKind !== "transfer") {
      const detectedCategory = categories.find(
        (category) => category.id === analysis.categoryId,
      );
      if (detectedCategory?.parent_id) {
        setParentCategoryId(detectedCategory.parent_id);
        setCategoryId(detectedCategory.id);
      }
    }
  };

  const readReceiptFile = async (file: File) => {
    setReceiptReading(true);
    setReceiptProgress("Preparando lectura...");
    setMessage("");
    setReceiptAnalysis(null);

    try {
      let analysis: ReceiptAnalysis;
      const isPdf =
        file.type === "application/pdf" ||
        file.name.toLowerCase().endsWith(".pdf");

      if (isPdf) {
        setReceiptProgress("Leyendo texto del PDF...");
        const formData = new FormData();
        formData.append("file", file);
        const response = await fetch("/api/comprobante/parse", {
          method: "POST",
          body: formData,
        });
        const result = (await response.json()) as {
          ok?: boolean;
          text?: string;
          error?: string;
        };
        if (!response.ok || !result.ok || !result.text) {
          throw new Error(result.error || "No se pudo leer el PDF.");
        }
        if (result.text.trim().length < 10) {
          throw new Error("El PDF no contiene suficiente texto para interpretarlo.");
        }
        setReceiptProgress("Interpretando el PDF...");
        analysis = analyzeReceiptText(result.text, categories);
      } else {
        setReceiptProgress("Preparando la imagen para mejorar la lectura...");
        const tesseract = await loadTesseractBrowser();
        const worker = await tesseract.createWorker("spa");
        try {
          const firstInput = await prepareOcrImage(file, false);
          setReceiptProgress("Reconociendo texto de la imagen...");
          const firstResult = await worker.recognize(firstInput);
          const firstText = firstResult.data.text ?? "";
          if (firstText.trim().length < 10) {
            throw new Error("No pude reconocer suficiente texto. Probá con una imagen más nítida.");
          }
          const firstAnalysis = analyzeReceiptText(firstText, categories);
          analysis = firstAnalysis;

          if (needsSecondOcrPass(firstAnalysis)) {
            setReceiptProgress("Haciendo una segunda lectura de precisión...");
            const secondInput = await prepareOcrImage(file, true);
            const secondResult = await worker.recognize(secondInput);
            const secondText = secondResult.data.text ?? "";
            if (secondText.trim().length >= 10) {
              const secondAnalysis = analyzeReceiptText(secondText, categories);
              if (receiptAnalysisScore(secondAnalysis) > receiptAnalysisScore(firstAnalysis)) {
                analysis = secondAnalysis;
              }
            }
          }
        } finally {
          await worker.terminate();
        }
      }

      setReceiptProgress("Aplicando únicamente los datos con evidencia suficiente...");
      setReceiptAnalysis(analysis);
      applyReceiptAnalysis(analysis);
      setInputSource((current) => current === "shared" ? "shared" : "receipt");
      setReceiptProgress("");
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      setMessage(`No se pudo leer el comprobante: ${detail}`);
      setReceiptProgress("");
    } finally {
      setReceiptReading(false);
    }
  };

  const readReceipt = async () => {
    if (!receiptFile) {
      setMessage("Seleccioná primero una foto o PDF del comprobante.");
      return;
    }
    await readReceiptFile(receiptFile);
  };

  useEffect(() => {
    if (initialLoading || voiceQueryLoadedRef.current || typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.search);
    const transcript = params.get("voice");
    if (!transcript) return;
    voiceQueryLoadedRef.current = true;
    applyVoiceTranscript(transcript);
  }, [initialLoading]);

  useEffect(() => {
    if (initialLoading || sharedLoadedRef.current || typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.search);
    const shareId = params.get("shareId");
    const sharedTextFallback = params.get("sharedText");
    const sharedTempPath = params.get("sharedTempPath");
    const sharedFileName = params.get("sharedFileName") || "comprobante-compartido";
    const sharedFileType = params.get("sharedFileType") || "application/octet-stream";
    const sharedFileSize = Number(params.get("sharedFileSize") || "0");
    const shareChannel = params.get("shareChannel") || "desconocido";
    const shareError = params.get("shareError");
    const shareFallback = params.get("shareFallback");
    const shareFileTooLarge = params.get("shareFileTooLarge");
    const shareNeedsLogin = params.get("shareNeedsLogin");

    if (shareError && !shareId && !sharedTempPath && !sharedTextFallback) {
      sharedLoadedRef.current = true;
      setSharedDiagnostic({
        channel: shareChannel,
        note: `La app de origen abrió ECO HOGAR, pero el contenido no pudo procesarse (${shareError}).`,
      });
      setMessage("No pude recibir el comprobante compartido. Probá compartirlo otra vez o guardalo y cargalo desde ECO HOGAR.");
      return;
    }

    if (!shareId && !sharedTextFallback && !sharedTempPath && !shareFileTooLarge && !shareNeedsLogin) return;
    sharedLoadedRef.current = true;

    const loadShared = async () => {
      try {
        setInputSource("shared");
        setReceiptProgress("Recibiendo contenido compartido...");

        if (shareId) {
          const metaResponse = await fetch(`/__eco_share_meta__/${encodeURIComponent(shareId)}`);
          if (!metaResponse.ok) throw new Error("El contenido compartido ya no está disponible en el teléfono.");
          const metadata = (await metaResponse.json()) as {
            title?: string;
            text?: string;
            url?: string;
            hasFile?: boolean;
            fileName?: string;
            fileType?: string;
            fileSize?: number;
            channel?: string;
          };

          const sharedText = metadata.text || [metadata.title, metadata.text, metadata.url].filter(Boolean).join(" ").trim();
          setSharedDiagnostic({
            channel: metadata.channel || shareChannel || "service-worker",
            fileName: metadata.hasFile ? metadata.fileName : undefined,
            fileType: metadata.hasFile ? metadata.fileType : undefined,
            fileSize: metadata.fileSize,
            text: sharedText || undefined,
          });

          if (sharedText.length >= 5) {
            const analysis = analyzeReceiptText(sharedText, categories);
            setReceiptAnalysis(analysis);
            applyReceiptAnalysis(analysis);
          }

          if (metadata.hasFile) {
            const fileResponse = await fetch(`/__eco_share_file__/${encodeURIComponent(shareId)}`);
            if (!fileResponse.ok) throw new Error("No pude recuperar el archivo compartido del teléfono.");
            const blob = await fileResponse.blob();
            if (blob.size > 10 * 1024 * 1024) {
              throw new Error("El comprobante compartido supera los 10 MB.");
            }
            const file = new File(
              [blob],
              metadata.fileName || "comprobante-compartido",
              { type: metadata.fileType || blob.type || "application/octet-stream" },
            );
            setReceiptFile(file);
            setReceiptProgress("Comprobante recibido. Lo estoy leyendo para completar los datos...");
            await readReceiptFile(file);
          } else {
            setReceiptProgress(sharedText ? "Texto/enlace compartido recibido. Revisá los campos." : "La app abrió ECO HOGAR, pero no envió un archivo ni texto utilizable.");
          }

          if ("caches" in window) {
            const cache = await caches.open("eco-hogar-share-v2.3.3");
            await Promise.all([
              cache.delete(`/__eco_share_meta__/${shareId}`),
              cache.delete(`/__eco_share_file__/${shareId}`),
            ]);
          }
        } else if (sharedTempPath) {
          setSharedDiagnostic({
            channel: "servidor privado",
            fileName: sharedFileName,
            fileType: sharedFileType,
            fileSize: Number.isFinite(sharedFileSize) ? sharedFileSize : undefined,
            text: sharedTextFallback || undefined,
            note: "El archivo pasó por almacenamiento privado temporal porque Android no entregó el POST al Service Worker.",
          });

          if (sharedTextFallback && sharedTextFallback.length >= 5) {
            const analysis = analyzeReceiptText(sharedTextFallback, categories);
            setReceiptAnalysis(analysis);
            applyReceiptAnalysis(analysis);
          }

          const { data: tempBlob, error: downloadError } = await supabase.storage
            .from("receipts")
            .download(sharedTempPath);
          if (downloadError || !tempBlob) throw new Error(downloadError?.message || "No pude descargar el archivo temporal compartido.");

          const file = new File([tempBlob], sharedFileName, {
            type: sharedFileType || tempBlob.type || "application/octet-stream",
          });
          setReceiptFile(file);
          setReceiptProgress("Comprobante recibido por canal seguro. Lo estoy leyendo...");

          // El archivo temporal deja de existir en Supabase apenas ya está en memoria del teléfono.
          await supabase.storage.from("receipts").remove([sharedTempPath]);
          await readReceiptFile(file);
        } else if (sharedTextFallback) {
          setSharedDiagnostic({
            channel: shareChannel,
            fileName: sharedFileName !== "comprobante-compartido" ? sharedFileName : undefined,
            fileType: sharedFileType !== "application/octet-stream" ? sharedFileType : undefined,
            fileSize: Number.isFinite(sharedFileSize) && sharedFileSize > 0 ? sharedFileSize : undefined,
            text: sharedTextFallback,
            note: shareFallback ? `Canal alternativo: ${shareFallback}.` : undefined,
          });
          const analysis = analyzeReceiptText(sharedTextFallback, categories);
          setReceiptAnalysis(analysis);
          applyReceiptAnalysis(analysis);
          setReceiptProgress("Recibí texto o enlace compartido. Revisá los campos antes de guardar.");
        } else if (shareFileTooLarge) {
          setSharedDiagnostic({
            channel: shareChannel,
            fileName: sharedFileName,
            fileType: sharedFileType,
            fileSize: sharedFileSize,
            note: "El archivo llegó al canal servidor, pero supera el máximo seguro de 3 MB para ese fallback.",
          });
          setReceiptProgress("La app de origen compartió un archivo grande. Guardalo en el teléfono y cargalo desde ‘Comprobante’.");
        } else if (shareNeedsLogin) {
          setSharedDiagnostic({ channel: shareChannel, note: "El archivo llegó cuando no había una sesión autenticada disponible para el canal servidor." });
          setReceiptProgress("Abrí ECO HOGAR, iniciá sesión y volvé a compartir el comprobante.");
        }

        window.setTimeout(() => {
          document.getElementById("comprobante")?.scrollIntoView({ behavior: "smooth", block: "center" });
        }, 150);
      } catch (error) {
        const detail = error instanceof Error ? error.message : String(error);
        setMessage(`No se pudo recibir el comprobante: ${detail}`);
        setReceiptProgress("");
      }
    };

    void loadShared();
  }, [initialLoading, supabase]);


  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    if (!userId || !householdId) {
      setMessage("No se pudo identificar el usuario o el hogar.");
      return;
    }

    if (!amount || Number(amount) <= 0) {
      setMessage("Ingresá un importe válido.");
      return;
    }

    if (!accountId) {
      setMessage(
        transactionType === "transfer"
          ? "Seleccioná la cuenta de origen."
          : "Seleccioná una cuenta."
      );
      return;
    }

    if (transactionType === "transfer") {
      if (!destinationAccountId) {
        setMessage("Seleccioná la cuenta de destino.");
        return;
      }

      if (destinationAccountId === accountId) {
        setMessage("La cuenta de origen y destino deben ser diferentes.");
        return;
      }
    } else if (!categoryId) {
      setMessage("Seleccioná una subcategoría.");
      return;
    }

    if (!transactionDate) {
      setMessage("Seleccioná una fecha.");
      return;
    }

    setLoading(true);
    setMessage("");

    const selectedPerson = householdPeople.find(
      (person) => person.id === responsible
    );

    const isTransfer = transactionType === "transfer";

    const payload = {
      responsible_person_id:
        isTransfer || responsible === "household" ? null : responsible,
      responsible_user_id:
        isTransfer || responsible === "household"
          ? null
          : (selectedPerson?.linked_user_id ?? null),
      account_id: accountId,
      destination_account_id: isTransfer ? destinationAccountId : null,
      category_id: isTransfer ? null : categoryId,
      transaction_type: transactionType,
      amount: Number(amount),
      currency: "ARS",
      transaction_date: transactionDate,
      description: description.trim() || null,
      merchant: merchant.trim() || null,
      economic_destination: "household",
      necessity:
        transactionType === "expense"
          ? (selectedSubcategory?.economic_type ?? null)
          : null,
      status: "confirmed",
    };

    let saveError = null;
    let savedTransactionId = transactionId ?? null;

    if (mode === "edit" && transactionId) {
      const result = await supabase
        .from("transactions")
        .update(payload)
        .eq("id", transactionId)
        .eq("household_id", householdId);
      saveError = result.error;
    } else {
      const result = await supabase
        .from("transactions")
        .insert({
          ...payload,
          household_id: householdId,
          created_by: userId,
          is_recurring: false,
          input_source: inputSource,
        })
        .select("id")
        .single();
      saveError = result.error;
      savedTransactionId = result.data?.id ?? null;
    }

    if (saveError) {
      console.error(saveError);
      setMessage(`Error al guardar: ${saveError.message}`);
      setLoading(false);
      return;
    }

    const returnMonth = transactionDate.slice(0, 7);
    const returnUrl = `/dashboard?month=${returnMonth}`;

    if (receiptFile && savedTransactionId) {
      if (receiptFile.size > 10 * 1024 * 1024) {
        window.alert("El movimiento se guardó, pero el comprobante supera el máximo de 10 MB. Podés adjuntarlo luego desde Editar.");
        router.push(returnUrl);
        router.refresh();
        return;
      }

      const safeName = receiptFile.name
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .replace(/[^a-zA-Z0-9._-]/g, "-");
      const storagePath = `${householdId}/${savedTransactionId}/${Date.now()}-${safeName}`;

      const { error: uploadError } = await supabase.storage
        .from("receipts")
        .upload(storagePath, receiptFile, { upsert: false });

      if (uploadError) {
        console.error("Error subiendo comprobante:", uploadError);
        window.alert(
          `El movimiento se guardó, pero no se pudo adjuntar el comprobante: ${uploadError.message}. Podés adjuntarlo luego desde Editar.`
        );
        router.push(returnUrl);
        router.refresh();
        return;
      }

      const { error: receiptUpdateError } = await supabase
        .from("transactions")
        .update({ receipt_url: storagePath })
        .eq("id", savedTransactionId)
        .eq("household_id", householdId);

      if (receiptUpdateError) {
        console.error("Error vinculando comprobante:", receiptUpdateError);
        await supabase.storage.from("receipts").remove([storagePath]);
        window.alert(
          `El movimiento se guardó, pero no se pudo vincular el comprobante: ${receiptUpdateError.message}. Podés intentarlo luego desde Editar.`
        );
        router.push(returnUrl);
        router.refresh();
        return;
      }

      if (mode === "edit" && currentReceiptPath && currentReceiptPath !== storagePath) {
        await supabase.storage.from("receipts").remove([currentReceiptPath]);
      }
    }

    router.push(returnUrl);
    router.refresh();
  };

  if (initialLoading) {
    return (
      <main className="min-h-screen bg-[#e7ebf0] text-slate-900">
        <div className="mx-auto max-w-2xl px-4 py-10">
          <div className="rounded-2xl border border-slate-200 bg-white p-8 shadow-sm">
            <p className="font-medium text-slate-700">Cargando ECO HOGAR...</p>
          </div>
        </div>
      </main>
    );
  }

  const isEdit = mode === "edit";
  const isTransfer = transactionType === "transfer";

  const accountOptions = (items: Account[]) =>
    items.map((account) => (
      <option key={account.id} value={account.id}>
        {account.name}
      </option>
    ));

  return (
    <main className="min-h-screen bg-[#e7ebf0] text-slate-900">
      <div className="mx-auto max-w-2xl px-4 py-6 md:px-6 md:py-10">
        <button
          type="button"
          onClick={() => router.back()}
          className="mb-6 inline-flex items-center gap-2 text-sm font-medium text-slate-600 transition hover:text-slate-950"
        >
          <span>←</span>
          Volver
        </button>

        <div className="mb-6">
          <div className="flex items-center gap-2">
            <p className="text-sm font-semibold uppercase tracking-wider text-slate-500">
              ECO HOGAR
            </p>
            <span className="rounded-full bg-slate-200 px-2 py-0.5 text-[10px] font-bold text-slate-600">
              v2.3.3
            </span>
          </div>

          <h1 className="mt-1 text-3xl font-bold tracking-tight text-slate-950 md:text-4xl">
            {isEdit ? "Editar movimiento" : "Nuevo movimiento"}
          </h1>

          <p className="mt-2 text-slate-600">
            {isEdit
              ? "Corregí los datos y guardá los cambios."
              : "Registrá un gasto, ingreso o transferencia entre cuentas."}
          </p>
        </div>

        {!isEdit && (
          <div className="mb-5 rounded-2xl border border-emerald-200 bg-emerald-50 p-4 shadow-sm">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <p className="text-sm font-bold text-emerald-950">Carga rápida por voz</p>
                <p className="mt-1 text-xs leading-5 text-emerald-800">
                  Ejemplo: “Gasté 35 mil en Carrefour con Mercado Pago, supermercado, para el hogar”.
                </p>
              </div>
              <VoiceMovementButton onTranscript={applyVoiceTranscript} />
            </div>
            {voiceTranscript && voiceAnalysis && (
              <div className="mt-3 rounded-xl border border-emerald-200 bg-white/80 p-3 text-xs text-emerald-950">
                <div className="flex flex-col gap-2">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="font-semibold">Texto escuchado <span className="font-normal text-emerald-700">(podés corregirlo)</span></p>
                    <span className="rounded-full bg-emerald-100 px-2 py-1 text-[10px] font-bold uppercase text-emerald-800">
                      Confianza {voiceAnalysis.confidence}
                    </span>
                  </div>
                  <div className="flex flex-col gap-2 sm:flex-row">
                    <input
                      type="text"
                      value={voiceTranscript}
                      onChange={(event) => setVoiceTranscript(event.target.value)}
                      className="min-w-0 flex-1 rounded-lg border border-emerald-200 bg-white px-3 py-2 text-xs text-slate-900 outline-none focus:border-emerald-400 focus:ring-2 focus:ring-emerald-100"
                    />
                    <button
                      type="button"
                      onClick={() => applyVoiceTranscript(voiceTranscript)}
                      className="rounded-lg border border-emerald-300 bg-white px-3 py-2 text-xs font-bold text-emerald-800 hover:bg-emerald-50"
                    >
                      Reanalizar
                    </button>
                  </div>
                </div>
                <div className="mt-2 rounded-lg bg-emerald-50 p-2.5 text-emerald-950">
                  <p className="font-semibold">Interpreté:</p>
                  <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-[11px] sm:text-xs">
                    <span><strong>Tipo:</strong> {voiceAnalysis.transactionType === "expense" ? "Gasto" : voiceAnalysis.transactionType === "income" ? "Ingreso" : "Transferencia"}</span>
                    <span><strong>Importe:</strong> {voiceAnalysis.amount !== null ? new Intl.NumberFormat("es-AR", { style: "currency", currency: "ARS", maximumFractionDigits: 2 }).format(voiceAnalysis.amount) : "Revisar"}</span>
                    <span><strong>Cuenta:</strong> {voiceAccountName || "Revisar"}</span>
                    {voiceAnalysis.transactionType === "transfer" && <span><strong>Destino:</strong> {voiceDestinationName || "Revisar"}</span>}
                    {voiceAnalysis.transactionType !== "transfer" && <span><strong>Categoría:</strong> {[voiceParentCategoryName, voiceCategoryName].filter(Boolean).join(" → ") || "Revisar"}</span>}
                    {voiceAnalysis.transactionType !== "transfer" && <span><strong>Concepto:</strong> {voiceAnalysis.merchant || "Revisar"}</span>}
                    {voiceAnalysis.transactionType !== "transfer" && <span><strong>¿Para quién fue?</strong> {voiceResponsibleName}</span>}
                    <span><strong>Fecha:</strong> {voiceAnalysis.transactionDate ? voiceAnalysis.transactionDate.split("-").reverse().join("/") : "hoy"}</span>
                  </div>
                </div>
                <p className="mt-2 text-emerald-800">Revisá esta interpretación antes de guardar. Si algo quedó mal, podés corregir cualquier campo manualmente.</p>
                {voiceAnalysis.notes.length > 0 && (
                  <p className="mt-1 text-amber-800">{voiceAnalysis.notes.join(" ")}</p>
                )}
              </div>
            )}
          </div>
        )}

        <form
          onSubmit={handleSubmit}
          className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm"
        >
          <div className="border-b border-slate-200 p-5 md:p-6">
            <p className="mb-3 text-sm font-semibold text-slate-700">
              Tipo de movimiento
            </p>

            <div className="grid grid-cols-3 gap-2 sm:gap-3">
              <button
                type="button"
                onClick={() => changeType("expense")}
                className={`rounded-xl border px-2 py-3 text-sm font-semibold transition sm:px-4 sm:text-base ${
                  transactionType === "expense"
                    ? "border-red-600 bg-red-600 text-white shadow-sm"
                    : "border-slate-200 bg-slate-50 text-slate-700 hover:bg-slate-100"
                }`}
              >
                Gasto
              </button>

              <button
                type="button"
                onClick={() => changeType("income")}
                className={`rounded-xl border px-2 py-3 text-sm font-semibold transition sm:px-4 sm:text-base ${
                  transactionType === "income"
                    ? "border-emerald-600 bg-emerald-600 text-white shadow-sm"
                    : "border-slate-200 bg-slate-50 text-slate-700 hover:bg-slate-100"
                }`}
              >
                Ingreso
              </button>

              <button
                type="button"
                onClick={() => changeType("transfer")}
                className={`rounded-xl border px-2 py-3 text-sm font-semibold transition sm:px-4 sm:text-base ${
                  transactionType === "transfer"
                    ? "border-blue-600 bg-blue-600 text-white shadow-sm"
                    : "border-slate-200 bg-slate-50 text-slate-700 hover:bg-slate-100"
                }`}
              >
                Transferir
              </button>
            </div>

            {isTransfer && (
              <div className="mt-4 rounded-xl border border-blue-100 bg-blue-50 px-4 py-3 text-sm text-blue-800">
                Una transferencia mueve dinero entre tus cuentas. No se suma como
                ingreso ni como gasto del hogar.
              </div>
            )}

            <p className="mt-4 text-xs text-slate-500">
              ¿Vas a pagar una tarjeta? Hacelo desde {" "}
              <a href="/tarjetas" className="font-semibold text-slate-800 underline underline-offset-2">
                Tarjetas → Pagar tarjeta
              </a>
              . Así el pago no se duplica como gasto.
            </p>
          </div>

          <div className="space-y-6 p-5 md:p-6">
            <div>
              <label
                htmlFor="amount"
                className="mb-2 block text-sm font-semibold text-slate-700"
              >
                Importe
              </label>
              <div className="relative">
                <span className="absolute left-4 top-1/2 -translate-y-1/2 text-xl font-bold text-slate-500">
                  $
                </span>
                <input
                  id="amount"
                  type="number"
                  min="0"
                  step="0.01"
                  inputMode="decimal"
                  value={amount}
                  onChange={(event) => setAmount(event.target.value)}
                  placeholder="35000"
                  className="w-full rounded-xl border border-slate-300 bg-white py-4 pl-9 pr-4 text-2xl font-bold text-slate-950 outline-none placeholder:text-slate-300 focus:border-slate-500 focus:ring-2 focus:ring-slate-200"
                  required
                />
              </div>
              {amount && Number.isFinite(Number(amount)) && Number(amount) > 0 && (
                <p className="mt-1.5 text-xs font-medium text-slate-500">
                  Importe interpretado: {new Intl.NumberFormat("es-AR", { style: "currency", currency: "ARS", maximumFractionDigits: 2 }).format(Number(amount))}
                </p>
              )}
            </div>

            <div>
              <label
                htmlFor="account"
                className="mb-2 block text-sm font-semibold text-slate-700"
              >
                {isTransfer ? "Cuenta de origen" : "Cuenta"}
              </label>
              <select
                id="account"
                value={accountId}
                onChange={(event) => {
                  const value = event.target.value;
                  setAccountId(value);
                  if (value === destinationAccountId) {
                    setDestinationAccountId("");
                  }
                }}
                className="w-full rounded-xl border border-slate-300 bg-white px-4 py-3.5 text-slate-900 outline-none focus:border-slate-500 focus:ring-2 focus:ring-slate-200"
                required
              >
                <option value="">
                  {isTransfer ? "Seleccionar cuenta de origen" : "Seleccionar cuenta"}
                </option>
                {myRegularAccounts.length > 0 && (
                  <optgroup label="Mis cuentas">{accountOptions(myRegularAccounts)}</optgroup>
                )}
                {transactionType === "expense" && myCreditCards.length > 0 && (
                  <optgroup label="Mis tarjetas de crédito">{accountOptions(myCreditCards)}</optgroup>
                )}
                {otherRegularAccounts.length > 0 && (
                  <optgroup label="Otras cuentas del hogar">
                    {accountOptions(otherRegularAccounts)}
                  </optgroup>
                )}
                {transactionType === "expense" && otherCreditCards.length > 0 && (
                  <optgroup label="Otras tarjetas de crédito">
                    {accountOptions(otherCreditCards)}
                  </optgroup>
                )}
              </select>

              {isCreditCardPurchase && (
                <div className="mt-3 rounded-xl border border-violet-100 bg-violet-50 px-4 py-3 text-sm leading-6 text-violet-900">
                  <strong>Compra con tarjeta:</strong> este importe se cuenta como gasto y aumenta la deuda de la tarjeta. El saldo de tu banco no baja hasta que registres el pago del resumen.
                </div>
              )}
            </div>

            {isTransfer && (
              <div>
                <label
                  htmlFor="destinationAccount"
                  className="mb-2 block text-sm font-semibold text-slate-700"
                >
                  Cuenta de destino
                </label>
                <select
                  id="destinationAccount"
                  value={destinationAccountId}
                  onChange={(event) => setDestinationAccountId(event.target.value)}
                  className="w-full rounded-xl border border-slate-300 bg-white px-4 py-3.5 text-slate-900 outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
                  required
                >
                  <option value="">Seleccionar cuenta de destino</option>
                  {destinationAccounts.map((account) => (
                    <option key={account.id} value={account.id}>
                      {account.name}
                    </option>
                  ))}
                </select>
                <p className="mt-1.5 text-xs text-slate-500">
                  El importe se descuenta del origen y se suma al destino.
                </p>
              </div>
            )}

            {!isTransfer && (
              <>
                <div>
                  <label
                    htmlFor="responsible"
                    className="mb-2 block text-sm font-semibold text-slate-700"
                  >
                    ¿Para quién fue? <span className="font-normal text-slate-400">(opcional)</span>
                  </label>
                  <select
                    id="responsible"
                    value={responsible}
                    onChange={(event) => setResponsible(event.target.value)}
                    className="w-full rounded-xl border border-slate-300 bg-white px-4 py-3.5 text-slate-900 outline-none focus:border-slate-500 focus:ring-2 focus:ring-slate-200"
                  >
                    <option value="household">Gasto común / sin asignar a una persona</option>
                    {householdPeople.map((person) => (
                      <option key={person.id} value={person.id}>
                        {person.full_name}
                      </option>
                    ))}
                  </select>
                  <p className="mt-1.5 text-xs text-slate-500">
                    No indica quién pagó: eso lo muestra la cuenta. Dejalo como gasto común si no necesitás atribuirlo a una persona.
                  </p>
                </div>

                <div className="grid grid-cols-1 gap-5 md:grid-cols-2">
                  <div>
                    <label
                      htmlFor="category"
                      className="mb-2 block text-sm font-semibold text-slate-700"
                    >
                      Categoría
                    </label>
                    <select
                      id="category"
                      value={parentCategoryId}
                      onChange={(event) => {
                        setParentCategoryId(event.target.value);
                        setCategoryId("");
                      }}
                      className="w-full rounded-xl border border-slate-300 bg-white px-4 py-3.5 text-slate-900 outline-none focus:border-slate-500 focus:ring-2 focus:ring-slate-200"
                      required
                    >
                      <option value="">Seleccionar categoría</option>
                      {parentCategories.map((category) => (
                        <option key={category.id} value={category.id}>
                          {category.name}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label
                      htmlFor="subcategory"
                      className="mb-2 block text-sm font-semibold text-slate-700"
                    >
                      Subcategoría
                    </label>
                    <select
                      id="subcategory"
                      value={categoryId}
                      onChange={(event) => setCategoryId(event.target.value)}
                      disabled={!parentCategoryId}
                      className="w-full rounded-xl border border-slate-300 bg-white px-4 py-3.5 text-slate-900 outline-none focus:border-slate-500 focus:ring-2 focus:ring-slate-200 disabled:cursor-not-allowed disabled:bg-slate-100 disabled:text-slate-400"
                      required
                    >
                      <option value="">Seleccionar subcategoría</option>
                      {subcategories.map((category) => (
                        <option key={category.id} value={category.id}>
                          {category.name}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
              </>
            )}

            <div>
              <label
                htmlFor="merchant"
                className="mb-2 block text-sm font-semibold text-slate-700"
              >
                {isTransfer ? "Concepto" : "Comercio / Concepto"}
                {isTransfer && (
                  <span className="ml-1 font-normal text-slate-400">(opcional)</span>
                )}
              </label>
              <input
                id="merchant"
                type="text"
                value={merchant}
                onChange={(event) => setMerchant(event.target.value)}
                placeholder={
                  isTransfer ? "Ej. Pasar dinero a Mercado Pago" : "Ej. Carrefour"
                }
                className="w-full rounded-xl border border-slate-300 bg-white px-4 py-3.5 text-slate-900 outline-none placeholder:text-slate-400 focus:border-slate-500 focus:ring-2 focus:ring-slate-200"
              />
            </div>

            <div>
              <label
                htmlFor="description"
                className="mb-2 block text-sm font-semibold text-slate-700"
              >
                Descripción
                <span className="ml-1 font-normal text-slate-400">(opcional)</span>
              </label>
              <input
                id="description"
                type="text"
                value={description}
                onChange={(event) => setDescription(event.target.value)}
                placeholder={isTransfer ? "Ej. Dinero para gastos diarios" : "Ej. Compra semanal"}
                className="w-full rounded-xl border border-slate-300 bg-white px-4 py-3.5 text-slate-900 outline-none placeholder:text-slate-400 focus:border-slate-500 focus:ring-2 focus:ring-slate-200"
              />
            </div>

            <div>
              <label
                htmlFor="transactionDate"
                className="mb-2 block text-sm font-semibold text-slate-700"
              >
                Fecha
              </label>
              <input
                id="transactionDate"
                type="date"
                value={transactionDate}
                onChange={(event) => setTransactionDate(event.target.value)}
                className="w-full rounded-xl border border-slate-300 bg-white px-4 py-3.5 text-slate-900 outline-none focus:border-slate-500 focus:ring-2 focus:ring-slate-200"
                required
              />
            </div>

            <div id="comprobante" className="scroll-mt-6 rounded-xl border border-violet-200 bg-violet-50/40 p-4">
              <label
                htmlFor="receipt"
                className="block text-sm font-semibold text-slate-700"
              >
                Comprobante
                <span className="ml-1 font-normal text-slate-400">(opcional)</span>
              </label>
              <p className="mt-1 text-xs leading-5 text-slate-500">
                Podés adjuntar una foto o PDF de hasta 10 MB. En v2.3.3 también podés leerlo para completar automáticamente importe, fecha, comercio/destinatario, cuenta sugerida y categoría cuando sea posible.
              </p>

              {sharedDiagnostic && (
                <div className="mt-3 rounded-xl border border-sky-200 bg-sky-50 p-3 text-xs text-sky-950">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="font-bold">Diagnóstico de contenido compartido</p>
                    <span className="rounded-full bg-white px-2 py-1 text-[10px] font-bold uppercase text-sky-700">
                      {sharedDiagnostic.channel}
                    </span>
                  </div>
                  <div className="mt-2 grid gap-1 sm:grid-cols-2">
                    <p><strong>Archivo:</strong> {sharedDiagnostic.fileName || "No recibido"}</p>
                    <p><strong>Tipo:</strong> {sharedDiagnostic.fileType || "No informado"}</p>
                    <p><strong>Tamaño:</strong> {sharedDiagnostic.fileSize ? `${Math.round(sharedDiagnostic.fileSize / 1024)} KB` : "No informado"}</p>
                    <p><strong>Texto/enlace:</strong> {sharedDiagnostic.text ? "Sí" : "No"}</p>
                  </div>
                  {sharedDiagnostic.note && <p className="mt-2 text-[11px] leading-5 text-sky-800">{sharedDiagnostic.note}</p>}
                </div>
              )}

              {currentReceiptUrl && !receiptFile && (
                <a
                  href={currentReceiptUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="mt-3 inline-flex rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-100"
                >
                  Ver comprobante actual
                </a>
              )}

              <input
                id="receipt"
                type="file"
                accept="image/jpeg,image/png,image/webp,application/pdf,.pdf"
                onChange={(event) => {
                  const file = event.target.files?.[0] ?? null;
                  if (file && file.size > 10 * 1024 * 1024) {
                    setReceiptFile(null);
                    setMessage("El comprobante no puede superar los 10 MB.");
                    event.currentTarget.value = "";
                    return;
                  }
                  setMessage("");
                  setReceiptAnalysis(null);
                  setReceiptProgress("");
                  setReceiptFile(file);
                }}
                className="mt-3 block w-full text-sm text-slate-600 file:mr-4 file:rounded-lg file:border-0 file:bg-slate-900 file:px-4 file:py-2.5 file:text-sm file:font-semibold file:text-white hover:file:bg-slate-700"
              />

              {receiptFile && (
                <div className="mt-3 space-y-3">
                  <p className="text-xs font-medium text-emerald-700">
                    Listo para adjuntar: {receiptFile.name}
                  </p>

                  <button
                    type="button"
                    onClick={readReceipt}
                    disabled={receiptReading}
                    className="inline-flex items-center rounded-lg bg-violet-600 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-violet-700 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {receiptReading ? "Leyendo comprobante..." : "Leer comprobante y completar"}
                  </button>

                  {receiptProgress && (
                    <div className="rounded-lg border border-violet-100 bg-violet-50 px-3 py-2 text-xs font-medium text-violet-800">
                      {receiptProgress}
                    </div>
                  )}

                  {receiptAnalysis && (
                    <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-4">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <p className="text-sm font-bold text-emerald-950">Datos detectados y aplicados</p>
                        <span className="rounded-full bg-white px-2 py-1 text-[10px] font-bold uppercase text-emerald-700">
                          Confianza {receiptAnalysis.confidence}
                        </span>
                      </div>
                      <div className="mt-3 grid grid-cols-1 gap-2 text-xs text-emerald-950 sm:grid-cols-2">
                        <p>
                          <strong>Importe:</strong>{" "}
                          {receiptAnalysis.amount !== null
                            ? new Intl.NumberFormat("es-AR", { style: "currency", currency: "ARS" }).format(receiptAnalysis.amount)
                            : "Revisar"}
                          {receiptAnalysis.amount !== null && receiptAnalysis.amountConfidence === "baja" ? " (no aplicado; revisar)" : ""}
                        </p>
                        <p><strong>Fecha:</strong> {receiptAnalysis.date ?? "Revisar"}</p>
                        {receiptAnalysis.receiptKind === "transfer" ? (
                          <>
                            <p><strong>Tipo detectado:</strong> {receiptAnalysis.transferDirection === "received" ? "Transferencia recibida" : "Transferencia enviada"}</p>
                            <p><strong>Contraparte:</strong> {receiptAnalysis.counterparty ?? receiptAnalysis.sender ?? "No informada"}</p>
                            <p><strong>Cuenta origen:</strong> {receiptAnalysis.sourceAccountHint ?? "Revisar"}</p>
                            <p><strong>Cuenta destino:</strong> {receiptAnalysis.destinationAccountHint ?? "Revisar"}</p>
                          </>
                        ) : (
                          <>
                            <p><strong>Comercio / destinatario:</strong> {receiptAnalysis.merchant ?? "Revisar"}</p>
                            <p><strong>Tipo detectado:</strong> {receiptAnalysis.receiptKind === "purchase" ? "Compra / pago" : "Revisar"}</p>
                            {receiptAnalysis.sourceAccountHint && (
                              <p><strong>Cuenta / medio:</strong> {receiptAnalysis.sourceAccountHint}</p>
                            )}
                          </>
                        )}
                        {receiptAnalysis.reference && (
                          <p><strong>Operación:</strong> {receiptAnalysis.reference}</p>
                        )}
                        <p><strong>Categoría:</strong> {receiptAnalysis.categoryId ? "Sugerida" : "Revisar manualmente"}</p>
                      </div>
                      <p className="mt-3 text-[11px] leading-5 text-emerald-800">
                        Revisá los campos antes de guardar. La lectura es una ayuda y puede equivocarse.
                      </p>
                      {receiptAnalysis.notes.length > 0 && (
                        <p className="mt-1 text-[11px] text-amber-800">
                          {receiptAnalysis.notes.join(" ")}
                        </p>
                      )}
                    </div>
                  )}
                </div>
              )}
            </div>

            {message && (
              <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-medium text-red-700">
                {message}
              </div>
            )}
          </div>

          <div className="border-t border-slate-200 bg-slate-50 p-5 md:p-6">
            <button
              type="submit"
              disabled={loading}
              className={`w-full rounded-xl px-5 py-4 text-base font-bold text-white shadow-sm transition disabled:cursor-not-allowed disabled:opacity-50 ${
                transactionType === "transfer"
                  ? "bg-blue-600 hover:bg-blue-700"
                  : "bg-slate-950 hover:bg-slate-800"
              }`}
            >
              {loading
                ? "Guardando..."
                : isEdit
                  ? "Guardar cambios"
                  : transactionType === "expense"
                    ? "Guardar gasto"
                    : transactionType === "income"
                      ? "Guardar ingreso"
                      : "Guardar transferencia"}
            </button>
          </div>
        </form>
      </div>
    </main>
  );
}
