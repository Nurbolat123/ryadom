import { notFound } from "next/navigation";
import { AdminOffers } from "@/components/AdminOffers";
import { Screen } from "@/components/Screen";
import { getAdmin } from "@/lib/server/admin";

export const dynamic = "force-dynamic";

/** Админка (этап 11). Не-модератору — 404. */
export default async function AdminOffersPage() {
  if (!(await getAdmin())) notFound();
  return (
    <Screen>
      <AdminOffers />
    </Screen>
  );
}
