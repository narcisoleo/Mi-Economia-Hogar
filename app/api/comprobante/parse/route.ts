import { NextResponse } from "next/server";
import { writeFile, unlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";

const LOCAL_MAX_BYTES = 10 * 1024 * 1024;
const CLOUD_MAX_BYTES = 3 * 1024 * 1024;

function runCommand(command: string, args: string[]) {
  return new Promise<{ stdout: string; stderr: string; code: number | null }>((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: process.cwd(),
      windowsHide: true,
      env: process.env,
    });

    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => { stdout += chunk.toString(); });
    child.stderr.on("data", (chunk) => { stderr += chunk.toString(); });
    child.on("error", reject);
    child.on("close", (code) => resolve({ stdout, stderr, code }));
  });
}

async function runPython(scriptPath: string, pdfPath: string) {
  const candidates = process.platform === "win32"
    ? [
        { command: "python", prefix: [] as string[] },
        { command: "py", prefix: ["-3"] },
      ]
    : [
        { command: "python3", prefix: [] as string[] },
        { command: "python", prefix: [] as string[] },
      ];

  let lastError = "No se encontró Python 3.";
  for (const candidate of candidates) {
    try {
      const result = await runCommand(candidate.command, [...candidate.prefix, scriptPath, pdfPath]);
      if (result.stdout.trim()) return result.stdout.trim();
      lastError = result.stderr.trim() || `Python terminó con código ${result.code}`;
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }
  }
  throw new Error(lastError);
}

async function parseInVercel(request: Request, file: File, bytes: Buffer) {
  const secret = process.env.ECO_PARSER_INTERNAL_SECRET;
  if (!secret) throw new Error("Falta configurar ECO_PARSER_INTERNAL_SECRET en Vercel.");

  if (file.size > CLOUD_MAX_BYTES) {
    return NextResponse.json(
      {
        ok: false,
        error: "En la versión cloud, la lectura automática de PDF admite hasta 3 MB. El comprobante original puede seguir adjuntándose a Supabase hasta 10 MB.",
      },
      { status: 413 },
    );
  }

  const parserUrl = new URL("/api/python/receipt_pdf", request.url);
  const response = await fetch(parserUrl, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-eco-parser-secret": secret,
    },
    body: JSON.stringify({ filename: file.name, data: bytes.toString("base64") }),
    cache: "no-store",
  });

  const payload = await response.text();
  let parsed: unknown;
  try {
    parsed = JSON.parse(payload);
  } catch {
    throw new Error(`El lector cloud devolvió una respuesta inválida: ${payload.slice(0, 250)}`);
  }
  return NextResponse.json(parsed, { status: response.status });
}

export async function POST(request: Request) {
  let tempPath = "";
  try {
    const formData = await request.formData();
    const file = formData.get("file");
    if (!(file instanceof File)) {
      return NextResponse.json({ ok: false, error: "Seleccioná un PDF." }, { status: 400 });
    }
    if (file.type !== "application/pdf" && !file.name.toLowerCase().endsWith(".pdf")) {
      return NextResponse.json({ ok: false, error: "Este lector recibe PDF digitales." }, { status: 400 });
    }
    if (file.size > LOCAL_MAX_BYTES) {
      return NextResponse.json({ ok: false, error: "El PDF supera 10 MB." }, { status: 400 });
    }

    const bytes = Buffer.from(await file.arrayBuffer());

    if (process.env.VERCEL === "1") {
      return await parseInVercel(request, file, bytes);
    }

    tempPath = path.join(tmpdir(), `eco-receipt-${Date.now()}-${Math.random().toString(36).slice(2)}.pdf`);
    await writeFile(tempPath, bytes);
    const raw = await runPython(path.join(process.cwd(), "tools", "extract_receipt_text.py"), tempPath);
    const parsed = JSON.parse(raw) as { ok?: boolean; text?: string; error?: string };

    if (!parsed.ok) return NextResponse.json(parsed, { status: 422 });
    if (!parsed.text || parsed.text.trim().length < 15) {
      return NextResponse.json({
        ok: false,
        error: "El PDF no contiene texto digital suficiente. Si es un escaneo, sacá una foto/captura y usá la lectura OCR de imagen.",
      }, { status: 422 });
    }
    return NextResponse.json(parsed);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ ok: false, error: `No se pudo leer el comprobante: ${message}` }, { status: 500 });
  } finally {
    if (tempPath) {
      try { await unlink(tempPath); } catch { /* ignore */ }
    }
  }
}
