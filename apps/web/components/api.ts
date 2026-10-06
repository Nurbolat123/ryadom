"use client";

/** Вызов нашего API: ответ или код ошибки (тексты — через i18n errors.<код>). */
export type ApiResult<T> =
  { ok: true; data: T } | { ok: false; error: string; retryAfterSec?: number };

export async function api<T = Record<string, unknown>>(
  url: string,
  init: { method?: string; json?: unknown; form?: FormData } = {},
): Promise<ApiResult<T>> {
  try {
    const res = await fetch(url, {
      method: init.method ?? (init.json || init.form ? "POST" : "GET"),
      headers: init.json ? { "content-type": "application/json" } : undefined,
      body: init.json ? JSON.stringify(init.json) : init.form,
    });
    const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    if (!res.ok) {
      return {
        ok: false,
        error: typeof body.error === "string" ? body.error : "unknown",
        retryAfterSec: typeof body.retryAfterSec === "number" ? body.retryAfterSec : undefined,
      };
    }
    return { ok: true, data: body as T };
  } catch {
    return { ok: false, error: "unknown" };
  }
}
