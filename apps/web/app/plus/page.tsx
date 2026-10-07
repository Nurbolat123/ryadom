import { paymentsEnabled } from "@ryadom/billing";
import { redirect } from "next/navigation";
import { PlusScreen } from "@/components/PlusScreen";
import { Screen } from "@/components/Screen";
import { nextPath } from "@/lib/server/onboarding";
import { getSession } from "@/lib/server/session";

export const dynamic = "force-dynamic";

/** «Плюс»: тарифы, суперприветы, продление. */
export default async function Plus() {
  if (!paymentsEnabled()) redirect("/profile");
  const path = await nextPath(await getSession());
  if (path !== "/home") redirect(path);
  return (
    <Screen nav>
      <PlusScreen testPay={process.env.NODE_ENV !== "production"} />
    </Screen>
  );
}
