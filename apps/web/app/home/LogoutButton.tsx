"use client";

import { useRouter } from "next/navigation";
import { api } from "@/components/api";
import ui from "@/components/ui.module.css";

export function LogoutButton({ label }: { label: string }) {
  const router = useRouter();
  return (
    <button
      type="button"
      className={ui.link}
      onClick={async () => {
        await api("/api/auth/logout", { method: "POST" });
        router.replace("/");
      }}
    >
      {label}
    </button>
  );
}
