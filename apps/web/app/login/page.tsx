import { redirect } from "next/navigation";
import { nextPath } from "@/lib/server/onboarding";
import { getSession } from "@/lib/server/session";
import { LoginForm } from "./LoginForm";

export const dynamic = "force-dynamic";

export default async function LoginPage() {
  const session = await getSession();
  if (session) redirect(await nextPath(session));
  return <LoginForm />;
}
