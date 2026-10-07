import { vi } from "vitest";

/** Замена cookies() из next/headers: одна «браузерная» банка cookie на тест. */
export const jar = new Map<string, string>();
/** Заголовки запроса для headers() (например, accept-language). */
export const requestHeaders = new Headers();

vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) => (jar.has(name) ? { name, value: jar.get(name)! } : undefined),
    set: (name: string, value: string) => void jar.set(name, value),
    delete: (name: string) => void jar.delete(name),
  }),
  headers: async () => requestHeaders,
}));
