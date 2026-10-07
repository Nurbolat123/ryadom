import { MenuItemInputSchema } from "@ryadom/shared";
import { getAdmin } from "@/lib/server/admin";
import { deleteMenuItem, updateMenuItem } from "@/lib/server/admin-venues";
import { fail, readJson } from "@/lib/server/http";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string; itemId: string }> };
const STATUS = { not_found: 404, menu_item_in_use: 409 } as const;

export async function PATCH(req: Request, { params }: Ctx) {
  if (!(await getAdmin())) return fail(404, "not_found");
  const body = MenuItemInputSchema.safeParse(await readJson(req));
  if (!body.success)
    return fail(
      400,
      body.error.issues.some((i) => i.message === "alcohol")
        ? "alcohol_not_giftable"
        : "invalid_menu_item",
    );
  const { id, itemId } = await params;
  const res = await updateMenuItem(id, itemId, body.data);
  if (!res.ok) return fail(404, res.error);
  return Response.json({ ok: true });
}

/** Удалить позицию. Если её уже дарили — 409: можно только убрать из наличия. */
export async function DELETE(_req: Request, { params }: Ctx) {
  if (!(await getAdmin())) return fail(404, "not_found");
  const { id, itemId } = await params;
  const res = await deleteMenuItem(id, itemId);
  if (!res.ok) return fail(STATUS[res.error], res.error);
  return Response.json({ ok: true });
}
