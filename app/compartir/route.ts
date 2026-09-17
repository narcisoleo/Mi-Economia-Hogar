import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

const SERVER_FALLBACK_MAX_BYTES = 3 * 1024 * 1024;

function safeFileName(value: string) {
  const cleaned = (value || "comprobante-compartido")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9._-]/g, "-")
    .replace(/-+/g, "-")
    .slice(0, 120);
  return cleaned || "comprobante-compartido";
}

function inferredMime(file: File) {
  const current = (file.type || "").toLowerCase();
  if (current && current !== "application/octet-stream") return current;
  const name = file.name.toLowerCase();
  if (name.endsWith(".pdf")) return "application/pdf";
  if (name.endsWith(".png")) return "image/png";
  if (name.endsWith(".webp")) return "image/webp";
  if (name.endsWith(".jpg") || name.endsWith(".jpeg")) return "image/jpeg";
  return current || "application/octet-stream";
}

function fileLikeValues(formData: FormData) {
  return Array.from(formData.values()).filter(
    (value): value is File => value instanceof File && value.size > 0,
  );
}

function textValues(formData: FormData) {
  const preferred = ["title", "text", "url"]
    .map((key) => formData.get(key))
    .filter((value): value is string => typeof value === "string" && value.trim().length > 0);

  const allStrings = Array.from(formData.values()).filter(
    (value): value is string => typeof value === "string" && value.trim().length > 0,
  );

  return Array.from(new Set([...preferred, ...allStrings])).join(" ").trim().slice(0, 1800);
}

export async function POST(request: Request) {
  const destination = new URL("/movimientos/nuevo", request.url);
  destination.hash = "comprobante";

  try {
    const formData = await request.formData();
    const combined = textValues(formData);
    const files = fileLikeValues(formData);
    const file = files[0] ?? null;

    if (combined) destination.searchParams.set("sharedText", combined);
    destination.searchParams.set("shareChannel", "server");

    if (!file) {
      destination.searchParams.set("shareFallback", "text-only");
      return NextResponse.redirect(destination, 303);
    }

    const fileType = inferredMime(file);
    destination.searchParams.set("sharedFileName", file.name || "comprobante-compartido");
    destination.searchParams.set("sharedFileType", fileType);
    destination.searchParams.set("sharedFileSize", String(file.size));

    if (file.size > SERVER_FALLBACK_MAX_BYTES) {
      destination.searchParams.set("shareFileTooLarge", "1");
      destination.searchParams.set("shareFallback", "file-too-large");
      return NextResponse.redirect(destination, 303);
    }

    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      destination.searchParams.set("shareNeedsLogin", "1");
      destination.searchParams.set("shareFallback", "not-authenticated");
      return NextResponse.redirect(destination, 303);
    }

    const { data: membership } = await supabase
      .from("household_members")
      .select("household_id")
      .eq("user_id", user.id)
      .single();

    if (!membership?.household_id) {
      destination.searchParams.set("shareError", "household");
      return NextResponse.redirect(destination, 303);
    }

    const storagePath = `${membership.household_id}/_share_tmp/${user.id}/${Date.now()}-${safeFileName(file.name)}`;
    const { error: uploadError } = await supabase.storage
      .from("receipts")
      .upload(storagePath, file, {
        upsert: false,
        contentType: fileType,
      });

    if (uploadError) {
      console.error("ECO HOGAR share fallback upload:", uploadError);
      destination.searchParams.set("shareError", "upload");
      destination.searchParams.set("shareFallback", "upload-failed");
      return NextResponse.redirect(destination, 303);
    }

    destination.searchParams.set("sharedTempPath", storagePath);
    destination.searchParams.set("shareFallback", "private-temp");
    return NextResponse.redirect(destination, 303);
  } catch (error) {
    console.error("ECO HOGAR share target server error:", error);
    destination.searchParams.set("shareError", "parse");
    return NextResponse.redirect(destination, 303);
  }
}
