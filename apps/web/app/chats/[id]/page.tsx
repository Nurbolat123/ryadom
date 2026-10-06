import { redirect } from "next/navigation";
import { ChatScreen } from "@/components/ChatScreen";
import { nextPath } from "@/lib/server/onboarding";
import { getSession } from "@/lib/server/session";
import ui from "@/components/ui.module.css";

export const dynamic = "force-dynamic";

export default async function Chat({ params }: { params: Promise<{ id: string }> }) {
  const path = await nextPath(await getSession());
  if (path !== "/home") redirect(path);
  return (
    <main className={ui.screen}>
      <ChatScreen id={(await params).id} />
    </main>
  );
}
