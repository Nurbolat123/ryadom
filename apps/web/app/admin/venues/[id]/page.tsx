import { notFound } from "next/navigation";
import { AdminVenue } from "@/components/AdminVenue";
import { Screen } from "@/components/Screen";
import { getAdmin } from "@/lib/server/admin";

export const dynamic = "force-dynamic";

/** Заведение: настройки, партнёрство, геозона, Telegram персонала, меню. Не-модератору — 404. */
export default async function AdminVenuePage({ params }: { params: Promise<{ id: string }> }) {
  if (!(await getAdmin())) notFound();
  return (
    <Screen>
      <AdminVenue id={(await params).id} />
    </Screen>
  );
}
