import { enterStep } from "../guard";
import { BirthForm } from "./BirthForm";

export const dynamic = "force-dynamic";

export default async function BirthPage() {
  return <BirthForm step={await enterStep("birth")} />;
}
