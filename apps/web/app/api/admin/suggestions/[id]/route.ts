import { LatLngSchema, VenueCategorySchema } from "@ryadom/shared";
import { z } from "zod";
import { getAdmin } from "@/lib/server/admin";
import { approveSuggestion, rejectSuggestion } from "@/lib/server/admin-venues";
import { fail, readJson } from "@/lib/server/http";

export const dynamic = "force-dynamic";

const Body = z.discriminatedUnion("decision", [
  LatLngSchema.extend({
    decision: z.literal("approved"),
    category: VenueCategorySchema.optional(),
    name: z.string().trim().min(2).max(80).optional(),
  }).strict(),
  z.object({ decision: z.literal("rejected") }).strict(),
]);
const STATUS = {
  not_found: 404,
  already_reviewed: 409,
  category_required: 400,
  outside_city: 422,
} as const;

/** Одобрить (точку ставит модератор, геозона — круг 35 м) или отклонить. */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!(await getAdmin())) return fail(404, "not_found");
  const body = Body.safeParse(await readJson(req));
  if (!body.success) return fail(400, "bad_request");
  const id = (await params).id;
  if (body.data.decision === "rejected") {
    const res = await rejectSuggestion(id);
    if (!res.ok) return fail(STATUS[res.error], res.error);
    return Response.json({ ok: true });
  }
  const { lat, lng, category, name } = body.data;
  const res = await approveSuggestion(id, { lat, lng, category, name });
  if (!res.ok) return fail(STATUS[res.error], res.error);
  return Response.json({ venueId: res.venueId, slug: res.slug });
}
