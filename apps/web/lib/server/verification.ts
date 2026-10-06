/**
 * Селфи-проверка: живой человек на селфи совпадает с фото профиля.
 * Реальный провайдер подключается через этот интерфейс; селфи никуда не сохраняется.
 */
export interface VerificationProvider {
  verifySelfie(input: { selfie: Buffer; profilePhoto: Buffer }): Promise<"approved" | "rejected">;
}

/** Заглушка для разработки: одобряет любое корректное изображение. */
export class StubVerificationProvider implements VerificationProvider {
  async verifySelfie() {
    return "approved" as const;
  }
}

let provider: VerificationProvider | null = null;

export const getVerificationProvider = (): VerificationProvider => {
  if (provider) return provider;
  const kind = process.env.VERIFICATION_PROVIDER ?? "stub";
  if (kind !== "stub") throw new Error(`VERIFICATION_PROVIDER=${kind} пока не реализован`);
  if (process.env.NODE_ENV === "production" && process.env.ALLOW_STUB_VERIFICATION !== "1") {
    throw new Error("Заглушка верификации запрещена в продакшене");
  }
  provider = new StubVerificationProvider();
  return provider;
};

export const setVerificationProvider = (p: VerificationProvider | null) => {
  provider = p;
};
