import { getTranslations } from "next-intl/server";
import { Screen } from "@/components/Screen";
import { RetryButton } from "./RetryButton";
import ui from "@/components/ui.module.css";

/** Показывает service worker, когда нет сети. Без данных пользователя — кешируется на устройстве. */
export default async function Offline() {
  const t = await getTranslations("offline");
  return (
    <Screen>
      <div className={ui.body}>
        <h1 className={ui.title}>{t("title")}</h1>
        <p className={ui.hint}>{t("hint")}</p>
        <div style={{ flex: 1 }} />
        <RetryButton label={t("retry")} />
      </div>
    </Screen>
  );
}
