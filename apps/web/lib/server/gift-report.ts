import { prisma } from "@ryadom/db";

/**
 * Отчёт по подаркам и комиссии для админки: по заведениям за период.
 * Выручка и комиссия считаются только по выданным подаркам; возвраты — отдельно.
 * Без данных о людях.
 */
export const giftReport = async (days = 30) => {
  const since = new Date(Date.now() - days * 24 * 3600_000);
  const rows = await prisma.gift.groupBy({
    by: ["venueId", "status"],
    where: { createdAt: { gte: since } },
    _count: { _all: true },
    _sum: { amount: true, commission: true },
  });
  const refunded = await prisma.gift.groupBy({
    by: ["venueId"],
    where: { createdAt: { gte: since }, refundedAt: { not: null } },
    _count: { _all: true },
    _sum: { amount: true },
  });
  const venues = await prisma.venue.findMany({
    where: { id: { in: [...new Set(rows.map((r) => r.venueId))] } },
    select: { id: true, name: true },
  });
  return venues
    .map((v) => {
      const of = (status: string) => rows.find((r) => r.venueId === v.id && r.status === status);
      const redeemed = of("redeemed");
      const ref = refunded.find((r) => r.venueId === v.id);
      return {
        venueId: v.id,
        venueName: v.name,
        sent: rows.filter((r) => r.venueId === v.id).reduce((n, r) => n + r._count._all, 0),
        accepted: (of("accepted")?._count._all ?? 0) + (redeemed?._count._all ?? 0),
        redeemed: redeemed?._count._all ?? 0,
        refunded: ref?._count._all ?? 0,
        refundedAmount: ref?._sum.amount ?? 0,
        revenue: redeemed?._sum.amount ?? 0,
        commission: redeemed?._sum.commission ?? 0,
      };
    })
    .sort((a, b) => b.sent - a.sent);
};
