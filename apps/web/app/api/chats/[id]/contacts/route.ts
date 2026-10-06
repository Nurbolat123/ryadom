import { confirmContacts } from "@/lib/server/chat";
import { fail } from "@/lib/server/http";
import { getSession } from "@/lib/server/session";

export const dynamic = "force-dynamic";

/** «Обменяться контактами». Номер собеседника — только когда нажали оба (правило 13). */
export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session?.user) return fail(401, "unauthorized");
  const chat = await confirmContacts(session.user.id, (await params).id);
  if (!chat) return fail(404, "not_found");
  return Response.json({ chat });
}
