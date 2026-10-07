import type { Metadata } from "next";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { Screen } from "@/components/Screen";
import styles from "@/components/places.module.css";
import ui from "@/components/ui.module.css";
import { topOfWeek } from "@/lib/server/places";
import { getSession } from "@/lib/server/session";

export const dynamic = "force-dynamic";

type Props = { searchParams: Promise<{ city?: string }> };
const cityOf = async (p: Props) => ((await p.searchParams).city === "astana" ? "astana" : "almaty");

export async function generateMetadata(props: Props): Promise<Metadata> {
  const t = await getTranslations();
  const title = t("places.topTitle", { city: t(`suggest.cities.${await cityOf(props)}`) });
  return {
    title,
    description: t("places.topHint"),
    openGraph: { title, description: t("places.topHint") },
  };
}

/** «Топ мест недели» — страница для соцсетей: только места по порядку, без чисел и людей. */
export default async function TopPlaces(props: Props) {
  const city = await cityOf(props);
  const t = await getTranslations();
  const [venues, session] = await Promise.all([topOfWeek(city), getSession()]);
  return (
    <Screen nav={!!session?.user?.verifiedAt}>
      <div className={ui.body}>
        <Link href="/places" className={`${ui.link} ${styles.topLink}`}>
          ← {t("places.back")}
        </Link>
        <h1 className={ui.title}>{t("places.topTitle", { city: t(`suggest.cities.${city}`) })}</h1>
        <p className={ui.hint}>{t("places.topHint")}</p>
        {venues.length === 0 ? <p className={ui.note}>{t("places.topEmpty")}</p> : null}
        <ol className={styles.list}>
          {venues.map((v, i) => (
            <li key={v.slug}>
              <Link href={`/places/${v.slug}`} className={`${styles.place} ${styles.topItem}`}>
                <span className={styles.rank}>{i + 1}</span>
                <span>
                  <span className={styles.placeName}>{v.name}</span>
                  <br />
                  <span className={styles.meta}>
                    {t(`checkin.category.${v.category}`)}
                    {v.address ? ` · ${v.address}` : ""}
                  </span>
                </span>
              </Link>
            </li>
          ))}
        </ol>
      </div>
    </Screen>
  );
}
