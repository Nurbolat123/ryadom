import { notFound } from "next/navigation";
import { AdminGifts } from "@/components/AdminGifts";
import { Screen } from "@/components/Screen";
import { getAdmin } from "@/lib/server/admin";

export const dynamic = "force-dynamic";

/** Отчёт по подаркам и комиссии. Не-модератору — 404. */
export default async function AdminGiftsPage() {
  if (!(await getAdmin())) notFound();
  return (
    <Screen>
      <AdminGifts />
    </Screen>
  );
}
