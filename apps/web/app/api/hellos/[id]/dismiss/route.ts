import { fail } from "@/lib/server/http";
import { getSession } from "@/lib/server/session";
import { dismissHello } from "@/lib/server/social";

export const dynamic = "force-dynamic";

/** «Не сейчас»: привет скрывается из входящих, отправитель ничего не узнаёт (правило 7). */
export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session?.user) return fail(401, "unauthorized");
  if (!(await dismissHello(session.user.id, (await params).id))) return fail(404, "not_found");
  return Response.json({ ok: true });
}
