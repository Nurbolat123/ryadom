import { z } from "zod";
import { confirmCheckin, currentCheckin, leave } from "@/lib/server/checkin";
import { fail, readJson } from "@/lib/server/http";
import { getSession } from "@/lib/server/session";

export const dynamic = "force-dynamic";

/** Текущий чек-ин (или null). */
export async function GET() {
  const session = await getSession();
  if (!session?.user) return fail(401, "unauthorized");
  return Response.json({ checkin: await currentCheckin(session.user.id) });
}

/** Подтвердить чек-ин в одном из найденных по геолокации заведений. */
export async function POST(req: Request) {
  const session = await getSession();
  if (!session?.user) return fail(401, "unauthorized");
  const body = z.object({ venueId: z.string().min(1) }).safeParse(await readJson(req));
  if (!body.success) return fail(400, "invalid_venue");

  const res = await confirmCheckin(session.user, body.data.venueId);
  if (!res.ok) return fail(res.error === "not_here" ? 403 : 409, res.error);
  return Response.json({ checkin: res.checkin }, { status: 201 });
}

/** «Я ушёл(ла)». */
export async function DELETE() {
  const session = await getSession();
  if (!session?.user) return fail(401, "unauthorized");
  await leave(session.user.id);
  return Response.json({ ok: true });
}
