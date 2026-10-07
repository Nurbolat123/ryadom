import { notFound } from "next/navigation";
import { AdminSuggestions } from "@/components/AdminSuggestions";
import { Screen } from "@/components/Screen";
import { getAdmin } from "@/lib/server/admin";

export const dynamic = "force-dynamic";

/** «Нет моего заведения» на проверке. Не-модератору — 404. */
export default async function AdminSuggestionsPage() {
  if (!(await getAdmin())) notFound();
  return (
    <Screen>
      <AdminSuggestions />
    </Screen>
  );
}
