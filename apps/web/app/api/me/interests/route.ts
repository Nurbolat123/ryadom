import { prisma } from "@ryadom/db";
import { RULES } from "@ryadom/shared";
import { z } from "zod";
import { fail, readJson } from "@/lib/server/http";
import { getSession } from "@/lib/server/session";

export const dynamic = "force-dynamic";

const BodySchema = z.object({
  interestIds: z.array(z.string().min(1)).min(1).max(RULES.maxInterestsPerUser),
});

/** Заменить интересы: от 1 до 10. */
export async function PUT(req: Request) {
  const session = await getSession();
  if (!session?.user) return fail(401, "unauthorized");
  const parsed = BodySchema.safeParse(await readJson(req));
  if (!parsed.success) return fail(400, "invalid_interests");

  const ids = [...new Set(parsed.data.interestIds)];
  const found = await prisma.interest.count({ where: { id: { in: ids }, isActive: true } });
  if (found !== ids.length) return fail(400, "invalid_interests");

  const userId = session.user.id;
  await prisma.$transaction([
    prisma.userInterest.deleteMany({ where: { userId } }),
    prisma.userInterest.createMany({ data: ids.map((interestId) => ({ userId, interestId })) }),
  ]);
  return Response.json({ ok: true });
}
