import { enterStep } from "../guard";
import { SelfieForm } from "./SelfieForm";

export const dynamic = "force-dynamic";

export default async function SelfiePage() {
  return <SelfieForm step={await enterStep("selfie")} />;
}
