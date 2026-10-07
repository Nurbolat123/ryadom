import { getPaymentProvider } from "@ryadom/billing";
import { prisma } from "@ryadom/db";
import { notFound, redirect } from "next/navigation";
import { Screen } from "@/components/Screen";
import { StubPay } from "@/components/StubPay";
import { getSession } from "@/lib/server/session";

export const dynamic = "force-dynamic";

/** Тестовая страница оплаты вместо Kaspi Pay. Только в разработке и только с заглушкой. */
export default async function StubPayPage({ params }: { params: Promise<{ paymentId: string }> }) {
  if (process.env.NODE_ENV === "production" || getPaymentProvider().name !== "stub") notFound();
  const session = await getSession();
  if (!session?.user) redirect("/login");
  const { paymentId } = await params;
  const p = await prisma.purchase.findFirst({
    where: { paymentId, userId: session.user.id },
    select: { id: true, amount: true, currency: true, status: true },
  });
  if (!p) notFound();
  if (p.status !== "pending") redirect(`/pay/return?order=${p.id}`);
  return (
    <Screen>
      <StubPay paymentId={paymentId} purchaseId={p.id} amount={p.amount} currency={p.currency} />
    </Screen>
  );
}
