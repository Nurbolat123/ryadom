import { fail } from "@/lib/server/http";
import { getSession } from "@/lib/server/session";
import { inbox, superHellosLeft } from "@/lib/server/social";

export const dynamic = "force-dynamic";

/** Входящие: суперприветы, приветы, анонимные «кому-то здесь вы понравились». */
export async function GET() {
  const session = await getSession();
  if (!session?.user) return fail(401, "unauthorized");
  const [data, superHellos] = await Promise.all([
    inbox(session.user.id),
    superHellosLeft(session.user.id),
  ]);
  return Response.json({ ...data, superHellos: superHellos.total });
}
