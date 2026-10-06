import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { CheckinPanel } from "@/components/CheckinPanel";
import { Screen } from "@/components/Screen";
import { nextPath } from "@/lib/server/onboarding";
import { getSession } from "@/lib/server/session";
import { LogoutButton } from "./LogoutButton";

export const dynamic = "force-dynamic";

/** Главный экран: «Я здесь» и текущий чек-ин. */
export default async function Home() {
  const session = await getSession();
  const path = await nextPath(session);
  if (path !== "/home") redirect(path);
  const t = await getTranslations("home");
  return (
    <Screen nav right={<LogoutButton label={t("logout")} />}>
      <CheckinPanel />
    </Screen>
  );
}
