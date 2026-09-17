const STATIC_CACHE = "eco-hogar-static-v2.3.3";
const SHARE_CACHE = "eco-hogar-share-v2.3.3";
const SAFE_ASSETS = [
  "/offline.html",
  "/icons/icon-192.png",
  "/icons/icon-512.png",
  "/icons/icon-maskable-512.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(STATIC_CACHE).then((cache) => cache.addAll(SAFE_ASSETS))
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((key) => key !== STATIC_CACHE && key !== SHARE_CACHE)
          .map((key) => caches.delete(key))
      )
    )
  );
  self.clients.claim();
});

function shareId() {
  if (self.crypto && typeof self.crypto.randomUUID === "function") {
    return self.crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function firstSharedFile(formData) {
  for (const value of formData.values()) {
    if (typeof File !== "undefined" && value instanceof File && value.size > 0) {
      return value;
    }
  }
  return null;
}

function sharedStrings(formData) {
  const preferred = ["title", "text", "url"]
    .map((key) => formData.get(key))
    .filter((value) => typeof value === "string" && value.trim());
  const other = [];
  for (const value of formData.values()) {
    if (typeof value === "string" && value.trim()) other.push(value.trim());
  }
  return Array.from(new Set([...preferred, ...other])).join(" ").slice(0, 1800);
}

async function handleShareTarget(request) {
  try {
    const formData = await request.formData();
    const file = firstSharedFile(formData);
    const sharedText = sharedStrings(formData);
    const id = shareId();
    const cache = await caches.open(SHARE_CACHE);

    const metadata = {
      text: sharedText,
      hasFile: Boolean(file),
      fileName: file?.name || "comprobante-compartido",
      fileType: file?.type || "application/octet-stream",
      fileSize: file?.size || 0,
      channel: "service-worker",
      createdAt: new Date().toISOString(),
    };

    await cache.put(
      new Request(new URL(`/__eco_share_meta__/${id}`, self.location.origin).href),
      new Response(JSON.stringify(metadata), {
        headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
      })
    );

    if (file) {
      await cache.put(
        new Request(new URL(`/__eco_share_file__/${id}`, self.location.origin).href),
        new Response(file, {
          headers: {
            "Content-Type": file.type || "application/octet-stream",
            "Cache-Control": "no-store",
          },
        })
      );
    }

    const destination = new URL(`/movimientos/nuevo?shareId=${encodeURIComponent(id)}&shareChannel=service-worker#comprobante`, self.location.origin);
    return Response.redirect(destination.href, 303);
  } catch (error) {
    console.error("ECO HOGAR share target error", error);
    return Response.redirect(new URL("/movimientos/nuevo?shareError=service-worker#comprobante", self.location.origin).href, 303);
  }
}

self.addEventListener("fetch", (event) => {
  const request = event.request;
  const url = new URL(request.url);

  if (request.method === "POST" && url.pathname === "/compartir") {
    event.respondWith(handleShareTarget(request));
    return;
  }

  if (request.method === "GET" && (
    url.pathname.startsWith("/__eco_share_meta__/") ||
    url.pathname.startsWith("/__eco_share_file__/")
  )) {
    event.respondWith(
      caches.open(SHARE_CACHE).then(async (cache) => {
        const cached = await cache.match(request);
        return cached || new Response("Compartido no disponible", { status: 404 });
      })
    );
    return;
  }

  if (request.method !== "GET") return;
  if (url.pathname.startsWith("/api/")) return;

  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request).catch(() => caches.match("/offline.html"))
    );
  }
});
