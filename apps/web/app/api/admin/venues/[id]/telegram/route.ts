import { getAdmin } from "@/lib/server/admin";
import { staffLinkCode, unlinkStaffChat } from "@/lib/server/admin-venues";
import { fail } from "@/lib/server/http";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

/** Одноразовый код для `/link КОД` в чате персонала (живёт час). */
export async function POST(_req: Request, { params }: Ctx) {
  if (!(await getAdmin())) return fail(404, "not_found");
  const res = await staffLinkCode((await params).id);
  if (!res) return fail(404, "not_found");
  return Response.json(res);
}

/** Отвязать чат персонала. */
export async function DELETE(_req: Request, { params }: Ctx) {
  if (!(await getAdmin())) return fail(404, "not_found");
  if (!(await unlinkStaffChat((await params).id))) return fail(404, "not_found");
  return Response.json({ ok: true });
}
