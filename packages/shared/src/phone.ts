/**
 * Телефоны храним в E.164: +77011234567.
 * Принимаем привычные форматы РК/РФ: 8 701 123-45-67, 7701..., +7 (701) ...
 */
export const normalizePhone = (input: string): string | null => {
  const raw = input.trim();
  let digits = raw.replace(/\D/g, "");
  if (!raw.startsWith("+")) {
    if (digits.length === 11 && digits.startsWith("8")) digits = `7${digits.slice(1)}`;
    else if (digits.length === 10 && digits.startsWith("7")) digits = `7${digits}`; // 701 123 45 67
  }
  if (digits.startsWith("7") && digits.length !== 11) return null;
  if (digits.length < 10 || digits.length > 15) return null;
  return `+${digits}`;
};

/** Для логов: +7701*****67. Полный номер в логи не пишем. */
export const maskPhone = (phone: string): string =>
  phone.length <= 7
    ? "***"
    : `${phone.slice(0, 5)}${"*".repeat(phone.length - 7)}${phone.slice(-2)}`;
