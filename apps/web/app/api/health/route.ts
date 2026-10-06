import { prisma } from "@ryadom/db";

export const dynamic = "force-dynamic";

/** Проверка, что веб-приложение видит базу и PostGIS. */
export async function GET() {
  try {
    const [row] = await prisma.$queryRaw<
      { postgis: string }[]
    >`SELECT postgis_version() AS postgis`;
    const venues = await prisma.venue.count({ where: { isActive: true } });
    return Response.json({ ok: true, postgis: row?.postgis ?? null, venues });
  } catch (error) {
    console.error("health: база недоступна", error instanceof Error ? error.message : error);
    return Response.json({ ok: false }, { status: 503 });
  }
}
