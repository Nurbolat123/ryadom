import { prisma } from "@ryadom/db";
import { moderateOffer } from "@ryadom/places";
import { z } from "zod";
import { getAdmin } from "@/lib/server/admin";
import { fail, readJson } from "@/lib/server/http";

export const dynamic = "force-dynamic";

const STATUS = { not_found: 404, alcohol: 422 } as const;

/** Одобрить или отклонить. Предложение с алкоголем одобрить нельзя (законодательство РК). */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!(await getAdmin())) return fail(404, "not_found");
  const body = z
    .object({ decision: z.enum(["approved", "rejected"]) })
    .safeParse(await readJson(req));
  if (!body.success) return fail(400, "bad_request");
  const res = await moderateOffer(prisma, (await params).id, body.data.decision);
  if (!res.ok) return fail(STATUS[res.error], res.error);
  return Response.json({ ok: true });
}
