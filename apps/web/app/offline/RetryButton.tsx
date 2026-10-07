"use client";

import ui from "@/components/ui.module.css";

export function RetryButton({ label }: { label: string }) {
  return (
    <button className={`${ui.button} ${ui.primary}`} onClick={() => window.location.reload()}>
      {label}
    </button>
  );
}
