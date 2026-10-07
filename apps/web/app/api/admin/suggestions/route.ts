import { getAdmin } from "@/lib/server/admin";
import { listSuggestions } from "@/lib/server/admin-venues";
import { fail } from "@/lib/server/http";

export const dynamic = "force-dynamic";

/** «Нет моего заведения»: на проверке и рассмотренные за 30 дней. Кто предложил — не отдаётся. */
export async function GET() {
  if (!(await getAdmin())) return fail(404, "not_found");
  return Response.json({ suggestions: await listSuggestions() });
}
