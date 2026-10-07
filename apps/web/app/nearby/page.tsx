import { redirect } from "next/navigation";
import { NearbyPanel } from "@/components/NearbyPanel";
import { Screen } from "@/components/Screen";
import { nextPath } from "@/lib/server/onboarding";
import { getSession } from "@/lib/server/session";

export const dynamic = "force-dynamic";

/** «Рядом»: живой список людей в заведении, где человек отмечен (правило 1). */
export default async function Nearby() {
  const path = await nextPath(await getSession());
  if (path !== "/home") redirect(path);
  return (
    <Screen nav>
      <NearbyPanel />
    </Screen>
  );
}
