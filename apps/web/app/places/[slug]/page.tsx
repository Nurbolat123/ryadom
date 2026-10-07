import { notFound } from "next/navigation";
import { getLocale } from "next-intl/server";
import { PlaceView, type Place } from "@/components/PlaceView";
import { Screen } from "@/components/Screen";
import { placeDetails } from "@/lib/server/places";
import { getSession } from "@/lib/server/session";

export const dynamic = "force-dynamic";

/** Место в «Где знакомятся сейчас». Людей здесь не видно: для этого нужен чек-ин в заведении. */
export default async function PlacePage({ params }: { params: Promise<{ slug: string }> }) {
  const locale = (await getLocale()) === "kk" ? "kk" : "ru";
  const place = await placeDetails((await params).slug, locale);
  if (!place) notFound();
  const session = await getSession();
  return (
    <Screen nav={!!session?.user?.verifiedAt}>
      <PlaceView place={place as Place} signedIn={!!session?.user?.verifiedAt} />
    </Screen>
  );
}
