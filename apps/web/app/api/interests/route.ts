import { prisma } from "@ryadom/db";

/** Справочник интересов (ru/kk). */
export async function GET() {
  const interests = await prisma.interest.findMany({
    where: { isActive: true },
    orderBy: { sortOrder: "asc" },
    select: { id: true, slug: true, nameRu: true, nameKk: true },
  });
  return Response.json({ interests });
}
