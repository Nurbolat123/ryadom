import { redirect } from "next/navigation";
import { CheckinPanel } from "@/components/CheckinPanel";
import { Screen } from "@/components/Screen";
import { nextPath } from "@/lib/server/onboarding";
import { getSession } from "@/lib/server/session";

export const dynamic = "force-dynamic";

/** Главный экран: «Я здесь» и текущий чек-ин. */
export default async function Home() {
  const session = await getSession();
  const path = await nextPath(session);
  if (path !== "/home") redirect(path);
  return (
    <Screen nav>
      <CheckinPanel />
    </Screen>
  );
}
