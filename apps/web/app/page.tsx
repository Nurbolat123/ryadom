import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { LanguageSwitch } from "@/components/LanguageSwitch";
import ui from "@/components/ui.module.css";
import styles from "@/components/welcome.module.css";
import { nextPath } from "@/lib/server/onboarding";
import { getSession } from "@/lib/server/session";

export const dynamic = "force-dynamic";

const CIRCLES = [140, 240, 360, 500, 660];

/** Приветственный экран: логотип, слоган, «Начать», «Где знакомятся сейчас», строка доверия. */
export default async function Welcome({
  searchParams,
}: {
  searchParams: Promise<{ deleted?: string }>;
}) {
  const { deleted } = await searchParams;
  const t = await getTranslations();
  const session = await getSession();
  const startHref = session ? await nextPath(session) : "/login";

  return (
    <div className={styles.root}>
      <div className={styles.circles} aria-hidden>
        {CIRCLES.map((d) => (
          <span key={d} style={{ width: d, height: d }} />
        ))}
      </div>
      <main className={styles.content}>
        <div className={styles.top}>
          <LanguageSwitch />
        </div>
        <div className={styles.hero}>
          <img
            className={styles.mark}
            src="/brand/logo-mark-light.svg"
            width={96}
            height={96}
            alt=""
          />
          <h1 className={styles.word}>{t("brand.name")}</h1>
          <p className={styles.slogan}>{t("brand.slogan")}</p>
        </div>
        <div className={styles.actions}>
          <Link href={startHref} className={`${ui.button} ${ui.primary}`}>
            {session ? t("welcome.continue") : t("welcome.start")}
          </Link>
          <Link href="/places" className={styles.ghost}>
            {t("welcome.places")}
          </Link>
        </div>
        {deleted && !session ? (
          <p className={styles.trust} role="status">
            {t("welcome.deleted")}
          </p>
        ) : null}
        <p className={styles.trust}>{t("welcome.trust")}</p>
      </main>
    </div>
  );
}
