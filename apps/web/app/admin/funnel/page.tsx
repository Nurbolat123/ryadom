import { notFound } from "next/navigation";
import { AdminFunnel } from "@/components/AdminFunnel";
import { Screen } from "@/components/Screen";
import { getAdmin } from "@/lib/server/admin";

export const dynamic = "force-dynamic";

/** Админка (этап 11). Не-модератору — 404. */
export default async function AdminFunnelPage() {
  if (!(await getAdmin())) notFound();
  return (
    <Screen>
      <AdminFunnel />
    </Screen>
  );
}
