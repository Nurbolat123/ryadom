import { notFound } from "next/navigation";
import { AdminVenues } from "@/components/AdminVenues";
import { Screen } from "@/components/Screen";
import { getAdmin } from "@/lib/server/admin";

export const dynamic = "force-dynamic";

/** Заведения и импорт. Не-модератору — 404. */
export default async function AdminVenuesPage() {
  if (!(await getAdmin())) notFound();
  return (
    <Screen>
      <AdminVenues />
    </Screen>
  );
}
