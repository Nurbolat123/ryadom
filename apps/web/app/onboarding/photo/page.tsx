import { getSession } from "@/lib/server/session";
import { enterStep } from "../guard";
import { PhotoForm } from "./PhotoForm";

export const dynamic = "force-dynamic";

export default async function PhotoPage() {
  const step = await enterStep("photo");
  const session = await getSession();
  return (
    <PhotoForm step={step} hasPhoto={!!session?.user?.photo} edit={!!session?.user?.verifiedAt} />
  );
}
