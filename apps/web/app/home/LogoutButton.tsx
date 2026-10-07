"use client";

import { useRouter } from "next/navigation";
import { api } from "@/components/api";
import { currentEndpoint } from "@/lib/client/pwa";
import ui from "@/components/ui.module.css";

export function LogoutButton({ label }: { label: string }) {
  const router = useRouter();
  return (
    <button
      type="button"
      className={ui.link}
      onClick={async () => {
        // Уведомления этого браузера больше не должны приходить на вышедший аккаунт.
        const endpoint = await currentEndpoint().catch(() => null);
        await api("/api/auth/logout", { method: "POST", json: endpoint ? { endpoint } : {} });
        router.replace("/");
      }}
    >
      {label}
    </button>
  );
}
