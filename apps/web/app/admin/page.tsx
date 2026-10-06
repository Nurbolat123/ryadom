import { notFound } from "next/navigation";
import { AdminReports } from "@/components/AdminReports";
import { Screen } from "@/components/Screen";
import { getAdmin } from "@/lib/server/admin";

export const dynamic = "force-dynamic";

/** Модерация жалоб. Не-модератору — 404, как будто страницы нет. */
export default async function Admin() {
  if (!(await getAdmin())) notFound();
  return (
    <Screen>
      <AdminReports />
    </Screen>
  );
}
