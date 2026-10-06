import { prisma } from "@ryadom/db";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { CheckinPanel } from "@/components/CheckinPanel";
import { Screen } from "@/components/Screen";
import ui from "@/components/ui.module.css";
import { nextPath } from "@/lib/server/onboarding";
import { getSession } from "@/lib/server/session";

export const dynamic = "force-dynamic";

/**
 * Ссылка на заведение для рекламы и соцсетей. Показывает только название и адрес;
 * людей заведения по ссылке не видно — сначала проверка геолокации (правило 1).
 */
export default async function VenueLink({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const venue = await prisma.venue.findFirst({
    where: { slug, isActive: true },
    select: { name: true, address: true, slug: true },
  });
  if (!venue) notFound();
  const t = await getTranslations("venueLink");
  const session = await getSession();
  const path = await nextPath(session);

  return (
    <Screen>
      <div className={ui.card}>
        <h1 className={ui.title}>{venue.name}</h1>
        {venue.address ? <p className={ui.hint}>{venue.address}</p> : null}
      </div>
      {path === "/home" ? (
        <CheckinPanel expectSlug={venue.slug} />
      ) : (
        <div className={ui.body}>
          <p className={ui.hint}>{t("needAccount")}</p>
          <div style={{ flex: 1 }} />
          <Link href={path} className={`${ui.button} ${ui.primary}`}>
            {t("start")}
          </Link>
        </div>
      )}
    </Screen>
  );
}
