"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";

type SpeechRecognitionAlternativeLike = {
  transcript?: string;
  confidence?: number;
};

type SpeechRecognitionResultLike = {
  length?: number;
  isFinal?: boolean;
  [index: number]: SpeechRecognitionAlternativeLike | undefined;
};

type SpeechRecognitionResultListLike = {
  length?: number;
  [index: number]: SpeechRecognitionResultLike | undefined;
};

type SpeechRecognitionEventLike = {
  resultIndex?: number;
  results?: SpeechRecognitionResultListLike;
};

type SpeechRecognitionErrorLike = {
  error?: string;
};

type SpeechRecognitionLike = {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  maxAlternatives: number;
  start: () => void;
  stop: () => void;
  abort?: () => void;
  onresult: ((event: SpeechRecognitionEventLike) => void) | null;
  onerror: ((event: SpeechRecognitionErrorLike) => void) | null;
  onend: (() => void) | null;
};

type SpeechRecognitionConstructor = new () => SpeechRecognitionLike;

declare global {
  interface Window {
    SpeechRecognition?: SpeechRecognitionConstructor;
    webkitSpeechRecognition?: SpeechRecognitionConstructor;
  }
}

type VoiceMovementButtonProps = {
  compact?: boolean;
  onTranscript?: (text: string) => void;
};

function errorMessage(code?: string) {
  if (code === "not-allowed" || code === "service-not-allowed") {
    return "Necesito permiso para usar el micrófono. Habilitalo para ECO HOGAR y volvé a intentar.";
  }
  if (code === "no-speech") return "No escuché voz. Probá nuevamente hablando cerca del teléfono.";
  if (code === "network") return "El reconocimiento de voz no pudo conectarse. Revisá Internet y volvé a intentar.";
  return "No pude iniciar el reconocimiento de voz en este dispositivo.";
}

function transcriptQuality(text: string, engineConfidence = 0) {
  const value = text
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();

  let score = engineConfidence * 2;
  if (/\d/.test(value)) score += 3;
  if (/\b(mil|miles|millon|millones|luca|lucas)\b/.test(value)) score += 2;
  if (/\b(gaste|gasto|compre|pague|cobre|recibi|transferi|pase|movi|envie)\b/.test(value)) score += 3;
  if (/\b(mercado pago|banco|efectivo|tarjeta|visa|mastercard|carrefour|coto|supermercado)\b/.test(value)) score += 1.5;
  if (/\b(caste|gastee)\b/.test(value)) score -= 0.25;
  return score;
}

function bestTranscript(result?: SpeechRecognitionResultLike) {
  if (!result) return "";
  const count = Math.max(1, Math.min(result.length ?? 1, 5));
  const alternatives: Array<{ transcript: string; confidence: number }> = [];

  for (let index = 0; index < count; index += 1) {
    const alternative = result[index];
    const transcript = alternative?.transcript?.trim() ?? "";
    if (!transcript) continue;
    alternatives.push({ transcript, confidence: alternative?.confidence ?? 0 });
  }

  alternatives.sort(
    (a, b) => transcriptQuality(b.transcript, b.confidence) - transcriptQuality(a.transcript, a.confidence),
  );
  return alternatives[0]?.transcript ?? "";
}

function cleanJoinedTranscript(parts: string[]) {
  return parts
    .join(" ")
    .replace(/\s+/g, " ")
    .replace(/\s+([,.;:!?])/g, "$1")
    .trim();
}

export function VoiceMovementButton({ compact = false, onTranscript }: VoiceMovementButtonProps) {
  const router = useRouter();
  const [listening, setListening] = useState(false);
  const [heardPreview, setHeardPreview] = useState("");
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
  const finalPartsRef = useRef<string[]>([]);
  const interimRef = useRef("");
  const silenceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const maxTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const failedRef = useRef(false);

  const clearTimers = () => {
    if (silenceTimerRef.current) clearTimeout(silenceTimerRef.current);
    if (maxTimerRef.current) clearTimeout(maxTimerRef.current);
    silenceTimerRef.current = null;
    maxTimerRef.current = null;
  };

  const finish = () => {
    const transcript = cleanJoinedTranscript([
      ...finalPartsRef.current,
      interimRef.current,
    ].filter(Boolean));

    clearTimers();
    setListening(false);
    recognitionRef.current = null;
    finalPartsRef.current = [];
    interimRef.current = "";

    if (!transcript || failedRef.current) return;
    setHeardPreview(transcript);
    if (onTranscript) {
      onTranscript(transcript);
    } else {
      router.push(`/movimientos/nuevo?voice=${encodeURIComponent(transcript)}`);
    }
  };

  const stopListening = () => {
    const recognition = recognitionRef.current;
    if (!recognition) return;
    try {
      recognition.stop();
    } catch {
      finish();
    }
  };

  const restartSilenceTimer = () => {
    if (silenceTimerRef.current) clearTimeout(silenceTimerRef.current);
    // Le damos tiempo para hacer una pausa natural entre importe, comercio y cuenta.
    silenceTimerRef.current = setTimeout(() => stopListening(), 3500);
  };

  const start = () => {
    if (listening) {
      stopListening();
      return;
    }

    const Recognition = window.SpeechRecognition ?? window.webkitSpeechRecognition;
    if (!Recognition) {
      window.alert("Este navegador no ofrece reconocimiento de voz. En Android usá Chrome actualizado.");
      return;
    }

    const recognition = new Recognition();
    recognition.lang = "es-AR";
    recognition.interimResults = true;
    recognition.continuous = true;
    recognition.maxAlternatives = 5;
    recognitionRef.current = recognition;
    finalPartsRef.current = [];
    interimRef.current = "";
    failedRef.current = false;
    setHeardPreview("");

    recognition.onresult = (event) => {
      const results = event.results;
      if (!results) return;
      const startIndex = Math.max(0, event.resultIndex ?? 0);
      let interim = "";

      for (let index = startIndex; index < (results.length ?? 0); index += 1) {
        const result = results[index];
        if (!result) continue;
        const transcript = bestTranscript(result);
        if (!transcript) continue;
        if (result.isFinal) {
          finalPartsRef.current.push(transcript);
        } else {
          interim = transcript;
        }
      }

      interimRef.current = interim;
      const preview = cleanJoinedTranscript([...finalPartsRef.current, interim].filter(Boolean));
      setHeardPreview(preview);
      restartSilenceTimer();
    };

    recognition.onerror = (event) => {
      failedRef.current = true;
      clearTimers();
      setListening(false);
      recognitionRef.current = null;
      window.alert(errorMessage(event.error));
    };

    recognition.onend = () => finish();

    try {
      setListening(true);
      recognition.start();
      // Evita que el micrófono quede abierto indefinidamente si hay mucho ruido ambiente.
      maxTimerRef.current = setTimeout(() => stopListening(), 20_000);
    } catch {
      setListening(false);
      recognitionRef.current = null;
      window.alert("El micrófono ya estaba iniciándose. Esperá un segundo y volvé a tocar el botón.");
    }
  };

  return (
    <div className={compact ? "inline-flex flex-col items-stretch gap-1" : "flex flex-col items-stretch gap-1.5"}>
      <button
        type="button"
        onClick={start}
        className={
          compact
            ? `inline-flex items-center justify-center rounded-xl border px-4 py-3 text-sm font-semibold shadow-sm transition ${
                listening
                  ? "border-red-200 bg-red-50 text-red-800 hover:bg-red-100"
                  : "border-emerald-200 bg-emerald-50 text-emerald-800 hover:bg-emerald-100"
              }`
            : `inline-flex items-center justify-center rounded-xl px-4 py-3 text-sm font-bold text-white shadow-sm transition ${
                listening ? "bg-red-600 hover:bg-red-700" : "bg-emerald-600 hover:bg-emerald-700"
              }`
        }
      >
        {listening ? "⏹️ Terminar dictado" : "🎤 Registrar por voz"}
      </button>
      {listening && (
        <p className="px-1 text-center text-[11px] leading-4 text-emerald-800">
          Escuchando… hablá normal. Se corta solo después de una pausa de unos segundos o tocá “Terminar dictado”.
          {heardPreview ? <><br /><strong>Oyendo:</strong> {heardPreview}</> : null}
        </p>
      )}
    </div>
  );
}
