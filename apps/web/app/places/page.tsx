import { getTranslations } from "next-intl/server";
import { Screen } from "@/components/Screen";
import ui from "@/components/ui.module.css";

/** «Где знакомятся сейчас» — полностью на этапе 11. */
export default async function Places() {
  const t = await getTranslations("places");
  return (
    <Screen>
      <div className={ui.body}>
        <h1 className={ui.title}>{t("title")}</h1>
        <p className={ui.hint}>{t("soon")}</p>
      </div>
    </Screen>
  );
}
