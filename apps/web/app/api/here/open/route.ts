import { z } from "zod";
import { fail, readJson } from "@/lib/server/http";
import { toggleOpen } from "@/lib/server/people";
import { getSession } from "@/lib/server/session";

export const dynamic = "force-dynamic";

/** Переключатель «Открыт(а) к знакомству». */
export async function POST(req: Request) {
  const session = await getSession();
  if (!session?.user) return fail(401, "unauthorized");
  const body = z.object({ open: z.boolean() }).safeParse(await readJson(req));
  if (!body.success) return fail(400, "invalid_request");
  const p = await toggleOpen(session.user.id, body.data.open);
  if (!p) return fail(403, "not_checked_in");
  return Response.json({ openToMeet: p.openToMeet });
}
