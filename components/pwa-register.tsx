"use client";

import { useEffect } from "react";

export function PwaRegister() {
  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;

    const register = async () => {
      try {
        const registration = await navigator.serviceWorker.register("/sw.js", { scope: "/" });
        await registration.update();
      } catch (error) {
        console.error("No se pudo registrar la PWA:", error);
      }
    };

    register();
  }, []);

  return null;
}
