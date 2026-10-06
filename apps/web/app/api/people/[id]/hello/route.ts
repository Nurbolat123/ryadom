import { HelloInputSchema } from "@ryadom/shared";
import { fail, readJson } from "@/lib/server/http";
import { getSession } from "@/lib/server/session";
import { sendHello } from "@/lib/server/social";

export const dynamic = "force-dynamic";

const STATUS = {
  not_found: 404,
  already_sent: 409,
  chat_exists: 409,
  hello_limit: 429,
  super_limit: 429,
  no_super_hellos: 402,
} as const;

/** Привет или суперпривет. От A к B — один раз (правило 6). */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session?.user) return fail(401, "unauthorized");
  const body = HelloInputSchema.safeParse(await readJson(req));
  if (!body.success) return fail(400, "invalid_hello");
  const res = await sendHello(session.user.id, (await params).id, body.data);
  if (!res.ok) return fail(STATUS[res.error], res.error);
  return Response.json({ ok: true }, { status: 201 });
}
