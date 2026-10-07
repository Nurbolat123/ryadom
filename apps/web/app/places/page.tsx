import { PlacesView } from "@/components/PlacesView";
import { Screen } from "@/components/Screen";
import { getSession } from "@/lib/server/session";

export const dynamic = "force-dynamic";

/** «Где знакомятся сейчас» — открыто и без входа: людей здесь не видно, только места. */
export default async function Places() {
  const session = await getSession();
  return (
    <Screen nav={!!session?.user?.verifiedAt}>
      <PlacesView />
    </Screen>
  );
}
