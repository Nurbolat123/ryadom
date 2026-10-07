import { notFound } from "next/navigation";
import { AdminPartners } from "@/components/AdminPartners";
import { Screen } from "@/components/Screen";
import { getAdmin } from "@/lib/server/admin";

export const dynamic = "force-dynamic";

/** Админка (этап 11). Не-модератору — 404. */
export default async function AdminPartnersPage() {
  if (!(await getAdmin())) notFound();
  return (
    <Screen>
      <AdminPartners />
    </Screen>
  );
}
