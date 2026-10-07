import type { Prisma, PrismaClient, ProductCode, Purchase } from "@ryadom/db";
import {
  isPlusProduct,
  PLUS_HOURS,
  RULES,
  SUPER_HELLO_COUNT,
  type SUPER_HELLO_PRODUCTS,
} from "@ryadom/shared";
import type { PaymentProvider } from "./payments";

/**
 * «Плюс» и суперприветы (CLAUDE.md, «Тарифы и покупки»).
 * - Покупка начисляется только после подтверждения оплаты провайдером; переход
 *   pending → paid — условным UPDATE, поэтому повторный webhook не начислит дважды.
 * - Автопродление — только у месячных тарифов, только с явного согласия, с напоминанием
 *   за 2 дня и отменой в одно нажатие. Если провайдер не умеет повторные списания (Kaspi),
 *   автопродление не включается.
 * - Платное не обходит согласие (правило 11): «Плюс» даёт только количество (приветы,
 *   суперприветы) и буст видимости среди тех, кто и так тебя видит.
 */

type Tx = Prisma.TransactionClient;

const PRODUCT_TEXT: Record<"ru" | "kk", Record<ProductCode, string>> = {
  ru: {
    plus_evening: "Плюс на вечер",
    plus_week: "Плюс на неделю",
    plus_month: "Плюс на месяц",
    plus_3months: "Плюс на 3 месяца",
    super_hello_1: "Суперпривет",
    super_hello_5: "5 суперприветов",
  },
  kk: {
    plus_evening: "Плюс кешке",
    plus_week: "Плюс бір аптаға",
    plus_month: "Плюс бір айға",
    plus_3months: "Плюс 3 айға",
    super_hello_1: "Суперсәлем",
    super_hello_5: "5 суперсәлем",
  },
};

/** Описание покупки для платёжной страницы — на языке человека. */
export const productDescription = (product: ProductCode, locale: "ru" | "kk" = "ru") =>
  PRODUCT_TEXT[locale][product];

/** Описание подарка для платёжной страницы. */
export const giftDescription = (venueName: string, locale: "ru" | "kk" = "ru") =>
  locale === "kk" ? `«${venueName}» орнындағы сыйлық` : `Подарок в «${venueName}»`;

export const priceFor = (db: PrismaClient, countryCode: string, product: ProductCode) =>
  db.price.findUnique({
    where: { countryCode_product: { countryCode, product } },
    select: { amount: true, currency: true, isActive: true },
  });

/** Начислить оплаченный продукт. */
const grant = async (
  tx: Tx,
  userId: string,
  product: ProductCode,
  autoRenew: boolean,
  now: Date,
) => {
  const current = await tx.entitlement.upsert({
    where: { userId },
    create: { userId, superHellos: RULES.freeSuperHellosOnSignup },
    update: {},
  });
  if (isPlusProduct(product)) {
    const from = current.plusUntil && current.plusUntil > now ? current.plusUntil : now;
    await tx.entitlement.update({
      where: { userId },
      data: {
        plusUntil: new Date(from.getTime() + PLUS_HOURS[product] * 3600_000),
        renewalRemindedAt: null,
        ...(autoRenew ? { autoRenew: true, autoRenewProduct: product } : {}),
      },
    });
  } else {
    await tx.entitlement.update({
      where: { userId },
      data: {
        superHellos: {
          increment: SUPER_HELLO_COUNT[product as (typeof SUPER_HELLO_PRODUCTS)[number]],
        },
      },
    });
  }
};

/**
 * Оплата подтверждена (webhook, возврат со страницы оплаты или тестовая страница).
 * Возвращает покупку, если именно этот вызов перевёл её в paid; иначе null (уже обработана).
 * Продукт начисляется здесь же; подарок создаёт вызывающий код по giftDraft.
 */
export const markPaid = async (
  db: PrismaClient,
  paymentId: string,
  now = new Date(),
): Promise<Purchase | null> =>
  db.$transaction(async (tx) => {
    const res = await tx.purchase.updateMany({
      where: { paymentId, status: "pending" },
      data: { status: "paid", paidAt: now },
    });
    if (res.count !== 1) return null;
    const p = await tx.purchase.findUniqueOrThrow({ where: { paymentId } });
    if (p.product && p.userId) await grant(tx, p.userId, p.product, p.autoRenew, now);
    return p;
  });

export const markFailed = async (db: PrismaClient, paymentId: string, now = new Date()) =>
  (
    await db.purchase.updateMany({
      where: { paymentId, status: "pending" },
      data: { status: "failed", failedAt: now },
    })
  ).count === 1;

/** Неоплаченные покупки старше 30 минут закрываются (подарок по ним не создаётся). */
export const expireStalePurchases = async (db: PrismaClient, now = new Date()) =>
  (
    await db.purchase.updateMany({
      where: {
        status: "pending",
        createdAt: { lt: new Date(now.getTime() - RULES.purchaseTtlSeconds * 1000) },
      },
      data: { status: "failed", failedAt: now },
    })
  ).count;

/** Отменить автопродление — одно нажатие, «Плюс» действует до конца оплаченного срока. */
export const cancelAutoRenew = (db: PrismaClient, userId: string) =>
  db.entitlement.updateMany({
    where: { userId },
    data: { autoRenew: false, autoRenewProduct: null },
  });

/**
 * Продления (раз в несколько минут из realtime):
 * 1) за 2 дня до окончания — напоминание «Плюс продлится …, отменить можно в одно нажатие»;
 * 2) срок вышел — повторное списание, если провайдер умеет; иначе автопродление
 *    выключается и человеку приходит «Плюс закончился», деньги не списываются.
 */
export const processRenewals = async ({
  db,
  payments,
  notify,
  now = new Date(),
}: {
  db: PrismaClient;
  payments: PaymentProvider;
  notify: (userId: string) => void;
  now?: Date;
}) => {
  const result = { reminded: 0, renewed: 0, failed: 0 };

  const soon = await db.entitlement.findMany({
    where: {
      autoRenew: true,
      renewalRemindedAt: null,
      plusUntil: { gt: now, lte: new Date(now.getTime() + RULES.renewalReminderSeconds * 1000) },
    },
    select: { userId: true },
  });
  for (const { userId } of soon) {
    const claimed = await db.entitlement.updateMany({
      where: { userId, renewalRemindedAt: null },
      data: { renewalRemindedAt: now },
    });
    if (claimed.count !== 1) continue;
    await db.notice.create({ data: { userId, kind: "plus_renewal_reminder" } });
    notify(userId);
    result.reminded++;
  }

  const due = await db.entitlement.findMany({
    where: { autoRenew: true, plusUntil: { lte: now } },
    include: { user: { select: { countryCode: true, bannedAt: true, locale: true } } },
  });
  for (const e of due) {
    const product = e.autoRenewProduct;
    const last = product
      ? await db.purchase.findFirst({
          where: { userId: e.userId, product, status: "paid", paymentId: { not: null } },
          orderBy: { paidAt: "desc" },
        })
      : null;
    const price = product ? await priceFor(db, e.user.countryCode, product) : null;
    let renewed = false;
    if (
      product &&
      last?.paymentId &&
      price?.isActive &&
      !e.user.bannedAt &&
      payments.chargeRecurring
    ) {
      const order = await db.purchase.create({
        data: {
          userId: e.userId,
          product,
          amount: price.amount,
          currency: price.currency,
          provider: payments.name,
          autoRenew: true,
          isRenewal: true,
        },
      });
      const charged = await payments
        .chargeRecurring({
          amount: price.amount,
          currency: price.currency,
          description: productDescription(product, e.user.locale),
          orderId: order.id,
          previousPaymentId: last.paymentId,
        })
        .catch(() => ({ ok: false as const }));
      if (charged.ok) {
        await db.purchase.update({
          where: { id: order.id },
          data: { paymentId: charged.paymentId },
        });
        renewed = !!(await markPaid(db, charged.paymentId, now));
      } else {
        await db.purchase.update({
          where: { id: order.id },
          data: { status: "failed", failedAt: now },
        });
      }
    }
    if (renewed) {
      await db.notice.create({ data: { userId: e.userId, kind: "plus_renewed" } });
      result.renewed++;
    } else {
      await cancelAutoRenew(db, e.userId);
      await db.notice.create({ data: { userId: e.userId, kind: "plus_renewal_failed" } });
      result.failed++;
    }
    notify(e.userId);
  }
  return result;
};
