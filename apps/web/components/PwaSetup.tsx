"use client";

import { useEffect } from "react";
import { setupPwa } from "@/lib/client/pwa";

/** Один раз на загрузку: service worker и перехват предложения установки. */
export function PwaSetup() {
  useEffect(() => {
    setupPwa();
  }, []);
  return null;
}
