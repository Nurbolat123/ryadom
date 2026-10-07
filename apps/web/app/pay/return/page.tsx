import { redirect } from "next/navigation";
import { PayReturn } from "@/components/PayReturn";
import { Screen } from "@/components/Screen";
import { getSession } from "@/lib/server/session";

export const dynamic = "force-dynamic";

/** Возврат со страницы оплаты: ждём подтверждение и показываем итог. */
export default async function PayReturnPage({
  searchParams,
}: {
  searchParams: Promise<{ order?: string }>;
}) {
  const session = await getSession();
  if (!session?.user) redirect("/login");
  const { order } = await searchParams;
  if (!order) redirect("/plus");
  return (
    <Screen nav>
      <PayReturn purchaseId={order} />
    </Screen>
  );
}
