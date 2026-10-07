import { MenuItemInputSchema } from "@ryadom/shared";
import { getAdmin } from "@/lib/server/admin";
import { addMenuItem } from "@/lib/server/admin-venues";
import { fail, readJson } from "@/lib/server/http";

export const dynamic = "force-dynamic";

/** Новая позиция меню. Алкоголь подарком быть не может (правило 8). */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!(await getAdmin())) return fail(404, "not_found");
  const body = MenuItemInputSchema.safeParse(await readJson(req));
  if (!body.success)
    return fail(
      400,
      body.error.issues.some((i) => i.message === "alcohol")
        ? "alcohol_not_giftable"
        : "invalid_menu_item",
    );
  const res = await addMenuItem((await params).id, body.data);
  if (!res.ok) return fail(404, res.error);
  return Response.json({ item: res.item }, { status: 201 });
}
