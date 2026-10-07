import { maskPhone } from "@ryadom/shared";

/** Отправка SMS. Реальный провайдер (например, Mobizon или SMSC.kz) подключается через этот интерфейс. */
export interface SmsProvider {
  /** text — готовый текст SMS на языке человека (см. loginCodeText). */
  sendCode(phone: string, code: string, text: string): Promise<void>;
}

/** Текст SMS с кодом входа: на языке интерфейса, с которого запросили код. */
export const loginCodeText = (code: string, locale: "ru" | "kk") =>
  locale === "kk"
    ? `рядом: кіру коды ${code}. Кодты ешкімге айтпа.`
    : `рядом: код входа ${code}. Никому его не сообщай.`;

/**
 * Заглушка для разработки: код пишется в лог сервера.
 * Номер в логе замаскирован (правило «логи без телефонов»).
 */
export class ConsoleSmsProvider implements SmsProvider {
  async sendCode(phone: string, code: string) {
    console.info(`[sms:dev] код входа для ${maskPhone(phone)}: ${code}`);
  }
}

let provider: SmsProvider | null = null;

export const getSmsProvider = (): SmsProvider => {
  if (provider) return provider;
  const kind = process.env.SMS_PROVIDER ?? "console";
  if (kind !== "console") throw new Error(`SMS_PROVIDER=${kind} пока не реализован`);
  if (process.env.NODE_ENV === "production" && process.env.ALLOW_CONSOLE_SMS !== "1") {
    throw new Error("Заглушка SMS запрещена в продакшене (задайте реальный SMS_PROVIDER)");
  }
  provider = new ConsoleSmsProvider();
  return provider;
};

/** Для тестов: подменить провайдера. */
export const setSmsProvider = (p: SmsProvider | null) => {
  provider = p;
};
