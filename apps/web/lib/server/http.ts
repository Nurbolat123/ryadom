/** Единый формат ошибок API: { error: "<код>" }. Тексты для людей — на клиенте через i18n. */
export const fail = (status: number, error: string, extra: Record<string, unknown> = {}) =>
  Response.json({ error, ...extra }, { status });

export const readJson = async (req: Request): Promise<unknown> => req.json().catch(() => null);
