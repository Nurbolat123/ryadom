import { enterStep } from "../guard";
import { ProfileForm } from "./ProfileForm";

export const dynamic = "force-dynamic";

export default async function ProfilePage() {
  return <ProfileForm step={await enterStep("profile")} />;
}
