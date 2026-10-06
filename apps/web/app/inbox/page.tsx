import { redirect } from "next/navigation";
import { InboxView } from "@/components/InboxView";
import { Screen } from "@/components/Screen";
import { nextPath } from "@/lib/server/onboarding";
import { getSession } from "@/lib/server/session";

export const dynamic = "force-dynamic";

/** «Приветы»: суперприветы, приветы, анонимные «кому-то здесь вы понравились», чаты. */
export default async function Inbox() {
  const path = await nextPath(await getSession());
  if (path !== "/home") redirect(path);
  return (
    <Screen nav>
      <InboxView />
    </Screen>
  );
}
