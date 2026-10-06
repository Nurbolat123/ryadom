import { config } from "dotenv";

/**
 * Права модератора: `pnpm admin:grant +77011234567` / `pnpm admin:revoke +77011234567`.
 * Человек должен быть уже зарегистрирован. Номер в вывод не печатается целиком.
 */
config({ path: "../../.env" });
const { maskPhone, normalizePhone } = await import("@ryadom/shared");
const { prisma } = await import("../src/index");

const [command, raw] = process.argv.slice(2);
const phone = raw ? normalizePhone(raw) : null;
if (!phone || (command !== "grant" && command !== "revoke")) {
  console.error("Использование: pnpm admin:grant <телефон> | pnpm admin:revoke <телефон>");
  process.exit(1);
}
const user = await prisma.user.findUnique({ where: { phone }, select: { id: true } });
if (!user) {
  console.error(
    `Пользователь ${maskPhone(phone)} не найден — сначала зарегистрируйся в приложении.`,
  );
  process.exit(1);
}
await prisma.user.update({
  where: { id: user.id },
  data: { role: command === "grant" ? "admin" : "user" },
});
console.info(
  command === "grant"
    ? `Готово: ${maskPhone(phone)} — модератор. Админка: /admin`
    : `Готово: у ${maskPhone(phone)} больше нет доступа к админке.`,
);
await prisma.$disconnect();
